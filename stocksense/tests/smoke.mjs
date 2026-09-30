import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", `stocksense-smoke-${process.pid}.db`);
const port = 43500 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["--import", "tsx", "src/server/server.ts"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DB_PATH: dbPath, NODE_ENV: "development", APP_ENV: "demo", OPENAI_API_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let childOutput = "";
child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });
let cookie = "";
const call = async (route, { method = "GET", body, headers = {}, auth = true } = {}) => {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(auth && cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { response, data: await response.json().catch(() => ({})) };
};

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`Smoke server exited early.\n${childOutput}`);
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch { /* server is still starting */ }
    await delay(250);
  }
  assert.ok(ready, `Smoke server did not become healthy.\n${childOutput}`);
  const unauth = await call("/api/inventory", { auth: false });
  assert.equal(unauth.response.status, 401, "private inventory API rejects anonymous access");

  const login = await call("/api/auth/login", { method: "POST", auth: false, body: { email: "manager@stocksense.demo", password: "Demo2026!" } });
  assert.equal(login.response.status, 200, `manager login: ${JSON.stringify(login.data)}`);
  cookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
  assert.ok(cookie.startsWith("stocksense_session="), "login creates an httpOnly session cookie");

  const inventory0 = (await call("/api/inventory")).data.items;
  const steel0 = inventory0.find((p) => p.sku === "RM-2048");
  assert.ok(steel0, "seed includes the steel product");
  assert.equal(steel0.total, 58, "stock totals reconcile by product across locations");
  assert.equal(steel0.status, "low", "seeded steel is at or below its reorder point");
  assert.equal(steel0.reserved, 8, "ready demo delivery reserves its stock");
  assert.equal(steel0.available, 50, "available stock excludes open reservations");
  assert.equal(steel0.movementCount30d, 6, "usage forecast is based on actual posted deliveries");
  const mwh = steel0.locations.find((l) => l.code === "MWH");
  const prod = steel0.locations.find((l) => l.code === "PROD");
  const east = (await call("/api/meta")).data.locations.find((l) => l.code === "EAST");

  const hold1=await call("/api/operations",{method:"POST",body:{type:"delivery",sourceLocationId:mwh.id,lines:[{productId:steel0.id,quantity:40}]}});
  assert.equal((await call(`/api/operations/${hold1.data.operation.id}/ready`,{method:"POST"})).response.status,200,"ready delivery reserves available stock");
  const hold2=await call("/api/operations",{method:"POST",body:{type:"delivery",sourceLocationId:mwh.id,lines:[{productId:steel0.id,quantity:7}]}});
  assert.equal((await call(`/api/operations/${hold2.data.operation.id}/ready`,{method:"POST"})).response.status,409,"second delivery cannot reserve stock already held by another operation");
  const held=(await call("/api/inventory")).data.items.find((p)=>p.id===steel0.id).locations.find((l)=>l.id===mwh.id);
  assert.equal(held.reserved,40,"reservation is visible by location");assert.equal(held.available,6,"location availability accounts for the reservation");
  await call(`/api/operations/${hold1.data.operation.id}/cancel`,{method:"POST"});
  assert.equal((await call(`/api/operations/${hold2.data.operation.id}/ready`,{method:"POST"})).response.status,200,"canceling an unposted delivery releases the reservation");
  await call(`/api/operations/${hold2.data.operation.id}/cancel`,{method:"POST"});

  const openOps = (await call("/api/operations")).data.items;
  const receipt = openOps.find((o) => o.reference === "RCV-2501");
  assert.ok(receipt, "seeded ready receipt exists");
  const receiptLine = receipt.lines[0];
  const firstReceiptKey = randomUUID();
  const receipt1 = await call(`/api/operations/${receipt.id}/validate`, { method: "POST", headers: { "Idempotency-Key": firstReceiptKey }, body: { quantities: [{ lineId: receiptLine.id, quantity: 12 }] } });
  assert.equal(receipt1.response.status, 200);
  assert.equal(receipt1.data.operation.status, "partial", "partial receipt stays in progress");
  const stockAfterFirst = (await call("/api/inventory")).data.items.find((p) => p.id === steel0.id).total;
  assert.equal(stockAfterFirst, 70, "partial receipt immediately increases stock by the received amount");
  await call(`/api/operations/${receipt.id}/validate`, { method: "POST", headers: { "Idempotency-Key": firstReceiptKey }, body: { quantities: [{ lineId: receiptLine.id, quantity: 12 }] } });
  assert.equal((await call("/api/inventory")).data.items.find((p) => p.id === steel0.id).total, 70, "retry with the same idempotency key cannot post twice");
  const receipt2 = await call(`/api/operations/${receipt.id}/validate`, { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: { quantities: [{ lineId: receiptLine.id, quantity: 38 }] } });
  assert.equal(receipt2.response.status, 200);
  assert.equal(receipt2.data.operation.status, "done", "receipt closes when its planned amount is fully received");
  assert.equal((await call("/api/inventory")).data.items.find((p) => p.id === steel0.id).total, 108, "completed receipt total is correct");

  const beforeTransfer = (await call("/api/inventory")).data.items.find((p) => p.id === steel0.id);
  const transferCreated = await call("/api/operations", { method: "POST", body: { type: "transfer", sourceLocationId: mwh.id, destinationLocationId: prod.id, note: "Smoke check transfer", lines: [{ productId: steel0.id, quantity: 8 }] } });
  assert.equal(transferCreated.response.status, 201);
  const transferId = transferCreated.data.operation.id;
  assert.equal((await call(`/api/operations/${transferId}/ready`, { method: "POST" })).response.status, 200);
  const transferPosted = await call(`/api/operations/${transferId}/validate`, { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: {} });
  assert.equal(transferPosted.response.status, 200);
  const afterTransfer = (await call("/api/inventory")).data.items.find((p) => p.id === steel0.id);
  assert.equal(afterTransfer.total, beforeTransfer.total, "transfer preserves company-wide quantity");
  assert.equal(afterTransfer.locations.find((l) => l.id === mwh.id).quantity, beforeTransfer.locations.find((l) => l.id === mwh.id).quantity - 8, "transfer removes stock from source");
  assert.equal(afterTransfer.locations.find((l) => l.id === prod.id).quantity, beforeTransfer.locations.find((l) => l.id === prod.id).quantity + 8, "transfer adds stock at destination");

  const deliveryCreated = await call("/api/operations", { method: "POST", body: { type: "delivery", sourceLocationId: prod.id, partner: "Smoke-test customer", lines: [{ productId: steel0.id, quantity: 6 }] } });
  const deliveryId = deliveryCreated.data.operation.id;
  assert.equal((await call(`/api/operations/${deliveryId}/ready`, { method: "POST" })).response.status, 200);
  const deliveryLine = deliveryCreated.data.operation.lines[0];
  const partialDelivery = await call(`/api/operations/${deliveryId}/validate`, { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: { quantities: [{ lineId: deliveryLine.id, quantity: 2 }] } });
  assert.equal(partialDelivery.data.operation.status, "partial", "partial deliveries remain open");
  const delivered = await call(`/api/operations/${deliveryId}/validate`, { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: { quantities: [{ lineId: deliveryLine.id, quantity: 4 }] } });
  assert.equal(delivered.data.operation.status, "done");
  assert.equal((await call("/api/inventory")).data.items.find((p) => p.id === steel0.id).total, 102, "delivery decreases company stock by the posted amount");

  const count = await call("/api/operations", { method: "POST", body: { type: "adjustment", sourceLocationId: prod.id, note: "Cycle count found a damaged bar", lines: [{ productId: steel0.id, quantity: 11 }] } });
  assert.equal(count.response.status, 201);
  assert.equal((await call(`/api/operations/${count.data.operation.id}/ready`, { method: "POST" })).response.status, 200);
  const countPost = await call(`/api/operations/${count.data.operation.id}/validate`, { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: { quantities: [] } });
  assert.equal(countPost.data.operation.status, "done", "a physical count posts as one completed adjustment");
  const finalSteel = (await call("/api/inventory")).data.items.find((p) => p.id === steel0.id);
  assert.equal(finalSteel.total, 99, "count correction moves the balance to the physical count");

  const ledger = (await call(`/api/ledger?q=${encodeURIComponent("Smoke-test customer")}`)).data.items;
  assert.equal(ledger.filter((entry) => entry.type === "delivery").reduce((sum,entry)=>sum+entry.delta,0),-6,"partial delivery postings reconcile in the stock ledger");
  const copilot = await call("/api/copilot", { method: "POST", body: { question: "What may run out this month?" } });
  assert.equal(copilot.response.status, 200);
  assert.equal(copilot.data.source, "rules", "copilot has an honest no-key fallback");
  assert.ok(copilot.data.evidence.length>0&&copilot.data.evidence.every((product)=>inventory0.some((item)=>item.id===product.id)),"copilot evidence cites current products from this workspace");

  const staffId=(await call("/api/meta")).data.assignees.find((u)=>u.name==="Sam Rivera").id;
  const assignedDelivery=await call("/api/operations",{method:"POST",body:{type:"delivery",sourceLocationId:mwh.id,partner:"Assigned staff pick",assignedToUserId:staffId,priority:"high",lines:[{productId:steel0.id,quantity:1}]} });
  assert.equal(assignedDelivery.response.status,201,"manager can assign a warehouse task");
  assert.equal((await call(`/api/operations/${assignedDelivery.data.operation.id}/ready`,{method:"POST"})).response.status,200);
  const countTask=await call("/api/operations",{method:"POST",body:{type:"adjustment",sourceLocationId:mwh.id,note:"Blind cycle count",assignedToUserId:staffId,lines:[{productId:steel0.id,quantity:8}]} });
  assert.equal(countTask.response.status,201);
  assert.equal((await call(`/api/operations/${countTask.data.operation.id}/ready`,{method:"POST"})).response.status,200);

  const staffLogin = await call("/api/auth/login", { method: "POST", auth: false, body: { email: "staff@stocksense.demo", password: "Demo2026!" } });
  assert.equal(staffLogin.response.status,200);
  const managerCookie = cookie;
  const staffCookie = staffLogin.response.headers.get("set-cookie")?.split(";")[0] || "";
  cookie = staffCookie;
  const staffInventory=(await call("/api/inventory")).data.items.find((p)=>p.id===steel0.id);
  assert.equal(staffInventory.total,finalSteel.total,"warehouse stock lookup is scoped to assigned locations");
  assert.ok(staffInventory.locations.every((l)=>l.id!==east.id),"staff cannot see unassigned warehouse balances");
  const staffLedger=(await call("/api/ledger")).data.items;
  assert.ok(staffLedger.every((entry)=>entry.location_id!==east.id),"staff ledger is filtered to assigned warehouses");
  const staffOperations=(await call("/api/operations")).data.items;
  assert.ok(!staffOperations.some((op)=>op.id===transferId||op.id===deliveryId),"staff operation list excludes work that is not assigned to them");
  assert.equal((await call("/api/admin/overview")).response.status,403,"staff cannot invoke administrator endpoints");
  assert.equal((await call(`/api/operations/${transferId}`)).response.status,404,"staff cannot read an unassigned task by its ID");
  const blindTask=(await call(`/api/operations/${countTask.data.operation.id}`)).data.operation;
  assert.equal(Object.hasOwn(blindTask.lines[0],"planned_qty"),false,"staff count tasks do not disclose the expected physical count");
  const tasks=(await call("/api/tasks")).data.items;
  assert.ok(tasks.some((task)=>task.id===assignedDelivery.data.operation.id),"staff task queue includes assigned work");
  const quantityBeforeSubmission=staffInventory.total;
  const taskLine=assignedDelivery.data.operation.lines[0];const submissionKey=randomUUID();const taskSubmission={submissionKey,quantities:[{lineId:taskLine.id,quantity:1}],notes:"Picked and verified one unit."};
  const submitted=await call(`/api/operations/${assignedDelivery.data.operation.id}/submit`,{method:"POST",body:taskSubmission});
  assert.equal(submitted.response.status,201,"staff can submit task quantities for review");
  assert.equal((await call("/api/inventory")).data.items.find((p)=>p.id===steel0.id).total,quantityBeforeSubmission,"staff submission does not post stock");
  assert.equal((await call(`/api/operations/${assignedDelivery.data.operation.id}/submit`,{method:"POST",body:taskSubmission})).response.status,200,"task submission retries are idempotent");
  cookie=managerCookie;
  const pending=(await call(`/api/operations/${assignedDelivery.data.operation.id}`)).data.operation;
  assert.equal(pending.submission.status,"pending","manager sees staff submission awaiting review");
  const returned=await call(`/api/operations/${assignedDelivery.data.operation.id}/review`,{method:"POST",body:{submissionId:pending.submission.id,decision:"needs_action",feedback:"Confirm the picked quantity against the order slip."}});
  assert.equal(returned.response.status,200,"manager can request a correction");
  cookie=staffCookie;
  assert.equal((await call("/api/tasks")).data.items.find((task)=>task.id===assignedDelivery.data.operation.id).submission.status,"needs_action","staff sees review feedback state");
  const resubmitted=await call(`/api/operations/${assignedDelivery.data.operation.id}/submit`,{method:"POST",body:{...taskSubmission,submissionKey:randomUUID()}});
  assert.equal(resubmitted.response.status,201,"staff can resubmit after manager feedback");
  cookie=managerCookie;
  const approved=await call(`/api/operations/${assignedDelivery.data.operation.id}/validate`,{method:"POST",headers:{"Idempotency-Key":randomUUID()},body:{}});
  assert.equal(approved.data.operation.status,"done","manager can review and post submitted task quantities");
  cookie=staffCookie;
  const countPublic=(await call(`/api/operations/${countTask.data.operation.id}`)).data.operation;
  const countSubmission=await call(`/api/operations/${countTask.data.operation.id}/submit`,{method:"POST",body:{submissionKey:randomUUID(),quantities:[{lineId:countPublic.lines[0].id,quantity:8}],notes:"Counted in location bin.",countVersion:countPublic.countVersion}});
  assert.equal(countSubmission.response.status,201,"staff can submit a blind physical count");
  cookie=managerCookie;
  const countApproved=await call(`/api/operations/${countTask.data.operation.id}/validate`,{method:"POST",headers:{"Idempotency-Key":randomUUID()},body:{}});
  assert.equal(countApproved.data.operation.status,"done","manager posts the submitted physical count");
  const stockAfterCount=(await call("/api/inventory")).data.items.find((p)=>p.id===steel0.id);
  assert.equal(stockAfterCount.locations.find((l)=>l.id===mwh.id).quantity,8,"posted count sets the warehouse balance to the staff-submitted quantity");
  const adminLogin=await call("/api/auth/login",{method:"POST",auth:false,body:{email:"admin@stocksense.demo",password:"Demo2026!"}});
  assert.equal(adminLogin.response.status,200);
  cookie=adminLogin.response.headers.get("set-cookie")?.split(";")[0]||"";
  assert.equal((await call("/api/admin/overview")).response.status,200,"admin has a distinct control overview");
  assert.equal((await call("/api/admin/audit")).response.status,200,"admin can review the audit log");
  assert.equal((await call(`/api/users/${adminLogin.data.user.id}/status`,{method:"PATCH",body:{active:false}})).response.status,400,"administrator cannot suspend their own account");
  const temporaryUser=await call("/api/users",{method:"POST",body:{name:"Smoke Staff",email:`smoke-${process.pid}@example.test`,role:"staff",password:"TemporaryPass2026!",locationIds:[mwh.id]}});
  assert.equal(temporaryUser.response.status,201,"admin can create a warehouse-scoped account");
  assert.equal((await call(`/api/users/${temporaryUser.data.user.id}/status`,{method:"PATCH",body:{active:false}})).response.status,200,"admin can suspend an account");
  assert.equal((await call("/api/auth/login",{method:"POST",auth:false,body:{email:`smoke-${process.pid}@example.test`,password:"TemporaryPass2026!"}})).response.status,401,"suspended account cannot start a session");
  const managerCookieAgain=managerCookie;
  cookie=managerCookieAgain;
  assert.equal((await call("/api/suppliers",{method:"POST",body:{name:"Smoke supplier",contactName:"Casey",email:"casey@example.test",phone:"555-0100"}})).response.status,201,"manager can maintain supplier records");
  cookie=adminLogin.response.headers.get("set-cookie")?.split(";")[0]||"";
  assert.equal((await call(`/api/users/${login.data.user.id}/revoke-sessions`,{method:"POST"})).response.status,200,"admin can revoke the manager's active sessions");
  cookie=managerCookie;
  assert.equal((await call("/api/auth/me")).response.status,401,"session revocation invalidates the existing manager session");
  const staffLoginAgain=await call("/api/auth/login",{method:"POST",auth:false,body:{email:"staff@stocksense.demo",password:"Demo2026!"}});
  cookie=staffLoginAgain.response.headers.get("set-cookie")?.split(";")[0]||"";
  const staffDraft = await call("/api/operations", { method: "POST", body: { type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: steel0.id, quantity: 1 }] } });
  assert.equal(staffDraft.response.status, 201, "warehouse staff can create drafts");
  assert.equal((await call(`/api/operations/${staffDraft.data.operation.id}/ready`, { method: "POST" })).response.status, 403, "warehouse staff cannot validate operations");
  cookie = managerCookie;

  console.log("StockSense smoke checks passed: authentication, role isolation, warehouse scoping, reservations and release, staff task submission and review, blind counts, inventory reporting APIs, partial receipt/delivery, idempotency, conserving transfers, count corrections, immutable ledger and Copilot evidence.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  console.error(childOutput);
  process.exitCode = 1;
} finally {
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(5000)]);
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* child may still be closing */ } }
}
