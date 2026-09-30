import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Each run owns an OS temporary directory and its API process. Never use the
// developer's database, credentials, email provider, or AI provider in this suite.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stocksense-security-"));
const dbPath = path.join(tempDir, "security.db");
const port = 45500 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const testSecret = "security-test-only-secret-not-for-production-2026";
const child = spawn(process.execPath, ["--import", "tsx", "src/server/server.ts"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DB_PATH: dbPath, NODE_ENV: "development", APP_ENV: "demo", APP_ORIGIN: base, TRUST_PROXY: "false", JWT_SECRET: testSecret, OPENAI_API_KEY: "", RESEND_API_KEY: "", EMAIL_FROM: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
let fixture;
let passed = 0;
const failures = [];
const cookies = {};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
const call = async (route, { role = "manager", method = "GET", body, raw, headers = {} } = {}) => {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookies[role] ? { Cookie: cookies[role] } : {}),
      ...(method !== "GET" ? { Origin: base } : {}),
      ...headers,
    },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  return { response, data, text };
};
const status = (result, expected, message) => assert.equal(result.response.status, expected, `${message}: ${result.text.slice(0, 600)}`);
const check = async (name, action) => {
  try { await action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
};
const login = async (email, password = "Demo2026!") => {
  const result = await call("/api/auth/login", { role: "anonymous", method: "POST", body: { email, password } });
  status(result, 200, `login ${email}`);
  assert.match(result.response.headers.get("set-cookie") || "", /HttpOnly/i, "session cookie is inaccessible to browser JavaScript");
  assert.match(result.response.headers.get("set-cookie") || "", /SameSite=Lax/i, "session cookie has SameSite protection");
  return { cookie: result.response.headers.get("set-cookie").split(";")[0], user: result.data.user };
};
const newProduct = async (locationId, overrides = {}) => {
  const result = await call("/api/products", { method: "POST", body: { name: "Security fixture product", sku: `SEC-${randomUUID().slice(0, 8)}`, unit: "pcs", reorderPoint: 0, leadDays: 1, initialQuantity: 10, locationId, ...overrides } });
  status(result, 201, "fixture product creation");
  return result.data.product;
};
const newOperation = async (body, ready = true) => {
  const result = await call("/api/operations", { method: "POST", body: { ...(body.type === "adjustment" ? { note: "Security count review" } : {}), ...body } });
  status(result, 201, "fixture operation creation");
  if (ready) status(await call(`/api/operations/${result.data.operation.id}/ready`, { method: "POST" }), 200, "fixture ready operation");
  return result.data.operation;
};
const postOperation = (operation, body = {}, key = randomUUID()) => call(`/api/operations/${operation.id}/validate`, { method: "POST", headers: { "Idempotency-Key": key }, body });
const snapshot = (productId) => ({
  balances: fixture.prepare("SELECT location_id,quantity FROM stock_balances WHERE product_id=? ORDER BY location_id").all(productId),
  ledger: fixture.prepare("SELECT COUNT(*) AS count FROM ledger WHERE product_id=?").get(productId).count,
  reservations: fixture.prepare("SELECT operation_line_id,quantity FROM reservations WHERE product_id=? ORDER BY operation_line_id").all(productId),
});

try {
  let healthy = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`Security server exited early.\n${output}`);
    try { if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; } } catch { /* server is starting */ }
    await delay(250);
  }
  assert.ok(healthy, `Security server did not become healthy.\n${output}`);
  fixture = new Database(dbPath);
  fixture.pragma("foreign_keys = ON");
  fixture.pragma("busy_timeout = 5000");
  const users = {};
  for (const role of ["admin", "manager", "staff"]) {
    const result = await login(`${role}@stocksense.demo`);
    cookies[role] = result.cookie;
    users[role] = result.user;
  }
  const meta = (await call("/api/meta", { role: "admin" })).data;
  const mwh = meta.locations.find((location) => location.code === "MWH");
  const east = meta.locations.find((location) => location.code === "EAST");
  const steel = (await call("/api/inventory")).data.items.find((product) => product.sku === "RM-2048");
  const companyId = fixture.prepare("SELECT company_id FROM users WHERE id=?").get(users.admin.id).company_id;

  // The second tenant exists only inside this suite's disposable database.
  const other = Object.fromEntries(["company", "user", "location", "category", "product", "operation", "line"].map((key) => [key, randomUUID()]));
  fixture.transaction(() => {
    fixture.prepare("INSERT INTO companies(id,name,slug,created_at) VALUES(?,?,?,?)").run(other.company, "Private second company", "security-second-company", now());
    fixture.prepare("INSERT INTO users(id,company_id,email,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?,?)").run(other.user, other.company, "other@example.test", "Other manager", "manager", bcrypt.hashSync("OtherTenantPass2026!", 10), now());
    fixture.prepare("INSERT INTO locations(id,company_id,name,code) VALUES(?,?,?,?)").run(other.location, other.company, "Private second warehouse", "SEC2");
    fixture.prepare("INSERT INTO categories(id,company_id,name) VALUES(?,?,?)").run(other.category, other.company, "Private second category");
    fixture.prepare("INSERT INTO products(id,company_id,category_id,name,sku,unit,created_at) VALUES(?,?,?,?,?,?,?)").run(other.product, other.company, other.category, "Private second product", "PRIVATE-002", "pcs", now());
    fixture.prepare("INSERT INTO stock_balances(product_id,location_id,quantity,updated_at) VALUES(?,?,?,?)").run(other.product, other.location, 7, now());
    fixture.prepare("INSERT INTO operations(id,company_id,reference,type,status,destination_location_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(other.operation, other.company, "PRIVATE-RCV", "receipt", "ready", other.location, other.user, now(), now());
    fixture.prepare("INSERT INTO operation_lines(id,operation_id,product_id,planned_qty) VALUES(?,?,?,?)").run(other.line, other.operation, other.product, 1);
  })();

  await check("anonymous access, invalid sessions, and response hardening", async () => {
    for (const route of ["/api/inventory", "/api/meta", "/api/operations", "/api/ledger", "/api/admin/audit", "/api/reports/inventory.csv"]) {
      status(await call(route, { role: "anonymous" }), 401, `anonymous ${route}`);
    }
    status(await call("/api/auth/me", { headers: { Cookie: "stocksense_session=forged.invalid.token" } }), 401, "forged JWT");
    status(await call("/api/auth/me", { headers: { Cookie: "stocksense_session=%invalid" } }), 401, "malformed cookie");
    for (const options of [{ algorithm: "HS256", issuer: "attacker" }, { algorithm: "HS384", issuer: "stocksense" }, { algorithm: "HS256", issuer: "stocksense", expiresIn: -1 }]) {
      const token = jwt.sign({ sub: users.manager.id, ver: 0 }, testSecret, { expiresIn: "1h", jwtid: randomUUID(), ...options });
      fixture.prepare("INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").run(sha256(token), users.manager.id, now(), new Date(Date.now() + 3_600_000).toISOString());
      status(await call("/api/auth/me", { headers: { Cookie: `stocksense_session=${token}` } }), 401, "wrong issuer, algorithm, or expired JWT is rejected even with a session record");
    }
    const response = await call("/api/inventory");
    assert.match(response.response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/, "framing prohibited");
    assert.equal(response.response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.response.headers.get("x-powered-by"), null);
    assert.match(response.response.headers.get("cache-control") || "", /no-store/, "private API responses must not be cached");
    assert.ok(!JSON.stringify(response.data).includes("password_hash"), "API never exposes password hashes");
  });

  await check("role restrictions and warehouse scope", async () => {
    for (const role of ["staff", "manager"]) {
      for (const route of ["/api/admin/overview", "/api/admin/audit", "/api/admin/audit.csv"]) status(await call(route, { role }), 403, `${role} ${route}`);
      status(await call("/api/users", { role, method: "POST", body: {} }), 403, `${role} cannot provision users`);
    }
    status(await call("/api/products", { role: "staff", method: "POST", body: {} }), 403, "staff cannot create products");
    status(await call("/api/reports/inventory.csv", { role: "staff" }), 403, "staff cannot export company stock");
    status(await call(`/api/products/${steel.id}`, { role: "staff", method: "DELETE" }), 403, "staff cannot archive stock");
    const staffInventory = (await call("/api/inventory", { role: "staff" })).data.items;
    assert.ok(staffInventory.every((product) => product.locations.every((location) => location.id !== east.id)), "unassigned warehouse balances are hidden");
    status(await call("/api/operations", { role: "staff", method: "POST", body: { type: "receipt", destinationLocationId: east.id, lines: [{ productId: steel.id, quantity: 1 }] } }), 400, "staff cannot write an unassigned warehouse");
    status(await call("/api/operations", { role: "staff", method: "POST", body: { type: "adjustment", sourceLocationId: mwh.id, lines: [{ productId: steel.id, quantity: 1 }] } }), 403, "staff cannot create stock adjustments");
  });

  await check("seeded inventory history is chronological and location-linked", async () => {
    const balances = new Map();
    const history = fixture.prepare(`SELECT le.*,o.type,o.source_location_id,o.destination_location_id
      FROM ledger le LEFT JOIN operations o ON o.id=le.operation_id
      WHERE le.company_id=? AND le.product_id=? ORDER BY le.created_at,le.rowid`).all(companyId,steel.id);
    for (const movement of history) {
      assert.equal(movement.balance_before,balances.get(movement.location_id)||0,"each historical movement starts at the previous chronological balance");
      assert.equal(movement.balance_after,movement.balance_before+movement.delta);
      balances.set(movement.location_id,movement.balance_after);
      if(movement.operation_id){
        if(movement.type==="receipt")assert.equal(movement.destination_location_id,movement.location_id,"historic receipt links destination");
        else if(movement.type==="delivery")assert.equal(movement.source_location_id,movement.location_id,"historic delivery links source");
        else if(movement.type==="transfer")assert.ok([movement.source_location_id,movement.destination_location_id].includes(movement.location_id),"historic transfer links both warehouses");
      }
    }
    assert.equal([...balances.values()].reduce((total,value)=>total+value,0),58,"chronological history retains intended steel balance");
  });

  await check("company object isolation across reads and mutations", async () => {
    for (const route of [`/api/products/${other.product}`, `/api/operations/${other.operation}`]) status(await call(route), 404, `foreign object ${route}`);
    for (const action of ["ready", "validate", "cancel"]) status(await call(`/api/operations/${other.operation}/${action}`, { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: {} }), 404, `foreign operation ${action}`);
    status(await call(`/api/users/${other.user}/status`, { role: "admin", method: "PATCH", body: { active: false } }), 404, "foreign user status");
    status(await call(`/api/users/${other.user}/revoke-sessions`, { role: "admin", method: "POST" }), 404, "foreign user session revoke");
    status(await call(`/api/products/${other.product}`, { role: "admin", method: "DELETE" }), 404, "foreign product archive");
    for (const body of [
      { type: "receipt", destinationLocationId: other.location, lines: [{ productId: steel.id, quantity: 1 }] },
      { type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: other.product, quantity: 1 }] },
    ]) status(await call("/api/operations", { method: "POST", body }), 400, "foreign object references rejected");
    assert.ok(!(await call("/api/inventory")).data.items.some((product) => product.id === other.product));
    assert.ok(!(await call("/api/operations")).data.items.some((operation) => operation.id === other.operation));
    assert.equal(fixture.prepare("SELECT active FROM users WHERE id=?").get(other.user).active, 1, "foreign account unchanged");
    assert.equal(fixture.prepare("SELECT quantity FROM stock_balances WHERE product_id=?").get(other.product).quantity, 7, "foreign stock unchanged");
  });

  await check("cross-origin and cross-site mutation rejection", async () => {
    const before = fixture.prepare("SELECT COUNT(*) AS count FROM suppliers WHERE company_id=?").get(companyId).count;
    for (const headers of [{ Origin: "https://attacker.example" }, { Origin: "null" }, { Origin: base, "Sec-Fetch-Site": "cross-site" }]) {
      const result = await call("/api/suppliers", { method: "POST", body: { name: `Blocked ${randomUUID()}` }, headers });
      status(result, 403, "untrusted browser mutation");
      assert.equal(result.data.code, "csrf_origin");
    }
    status(await call("/api/auth/login", { role: "anonymous", method: "POST", body: { email: "manager@stocksense.demo", password: "Demo2026!" }, headers: { Origin: "https://attacker.example" } }), 403, "login CSRF");
    assert.equal(fixture.prepare("SELECT COUNT(*) AS count FROM suppliers WHERE company_id=?").get(companyId).count, before, "blocked request never writes");
    status(await call("/api/suppliers", { method: "POST", body: { name: `Allowed ${randomUUID()}` }, headers: { Origin: base, "Sec-Fetch-Site": "same-origin" } }), 201, "trusted frontend mutation");
  });

  await check("malformed, oversized, and invalid payloads fail without mutation", async () => {
    const before = fixture.prepare("SELECT COUNT(*) AS count FROM products WHERE company_id=?").get(companyId).count;
    const malformed = await call("/api/products", { method: "POST", raw: '{"name":' });
    status(malformed, 400, "malformed JSON");
    assert.equal(malformed.data.code, "invalid_json");
    status(await call("/api/products", { method: "POST", raw: JSON.stringify({ name: "X".repeat(45_000) }) }), 413, "oversized JSON");
    for (const body of [{}, { name: "X", reorderPoint: -1 }, { type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: steel.id, quantity: -1 }] }]) {
      status(await call(body.type ? "/api/operations" : "/api/products", { method: "POST", body }), 400, "invalid schema");
    }
    status(await call("/api/operations", { method: "POST", body: { type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: steel.id, quantity: 1 }, { productId: steel.id, quantity: 1 }] } }), 400, "duplicate product lines");
    for (const page of ["invalid", "1.5", "-1"]) status(await call(`/api/ledger?page=${encodeURIComponent(page)}`), 400, "invalid ledger pagination");
    const search = await call(`/api/ledger?q=${encodeURIComponent("' OR 1=1 --")}`);
    status(search, 200, "SQL-like text remains a normal search value");
    assert.equal(search.data.items.length, 0, "search input cannot change the query predicate");
    assert.equal(fixture.prepare("SELECT COUNT(*) AS count FROM products WHERE company_id=?").get(companyId).count, before);
    status(await call("/api/health", { role: "anonymous" }), 200, "server remains healthy after bad input");
  });

  await check("CSV formula injection is neutralized", async () => {
    const formula = '=HYPERLINK("https://example.test","click")';
    const product = await newProduct(mwh.id, { name: formula });
    const csv = await call("/api/reports/inventory.csv");
    status(csv, 200, "inventory export");
    assert.match(csv.response.headers.get("content-type") || "", /text\/csv/);
    const productRow = csv.text.split(/\r?\n/).find((row) => row.includes(product.sku));
    assert.ok(productRow?.includes(`"'${formula.replace(/"/g, '""')}"`), "formula product name is prefixed by a literal apostrophe");
    // Legacy/imported values can preserve leading whitespace even though forms trim it.
    fixture.prepare("UPDATE products SET name=? WHERE id=?").run(" \t=1+1", product.id);
    const whitespaceCsv = await call("/api/reports/inventory.csv");
    const whitespaceRow = whitespaceCsv.text.split(/\r?\n/).find((row) => row.includes(product.sku));
    assert.ok(whitespaceRow?.includes("\"' \t=1+1\""), "leading whitespace must not bypass formula escaping");
  });

  await check("duplicate and oversized query values are rejected consistently", async () => {
    for (const route of [`/api/operations?location=${mwh.id}&location=${mwh.id}`, `/api/ledger?location=${mwh.id}&location=${mwh.id}`, `/api/inventory?q=${"x".repeat(501)}`]) {
      const result = await call(route);
      status(result, 400, "query value validation");
      assert.equal(result.data.code, "validation_error");
    }
    status(await call(`/api/operations?location=${mwh.id}`), 200, "single valid query still works");
  });

  await check("sign-in rejects passwords that bcrypt would silently truncate", async () => {
    const email = `bcrypt-boundary-${randomUUID()}@example.test`;
    const password = "a".repeat(72);
    fixture.prepare("INSERT INTO users(id,company_id,email,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(), companyId, email, "Bcrypt boundary fixture", "manager", bcrypt.hashSync(password, 10), now());
    const result = await call("/api/auth/login", { role: "anonymous", method: "POST", body: { email, password: `${password}suffix` } });
    status(result, 400, "overlong password cannot authenticate with a truncated match");
    assert.equal(result.response.headers.get("set-cookie"), null, "invalid password input creates no session");
  });

  await check("account identity and product metadata protect existing records", async () => {
    const duplicate = await call("/api/users", { role: "admin", method: "POST", body: { name: "Duplicate other account", email: "OTHER@EXAMPLE.TEST", role: "manager", password: "TemporarySecurity2026!" } });
    status(duplicate, 409, "an existing email in another company cannot become an ambiguous login");
    const live = await newProduct(mwh.id);
    status(await call(`/api/products/${live.id}`, { role: "admin", method: "DELETE" }), 409, "product with live stock cannot be hidden by archive");
    const pending = await newProduct(mwh.id, { initialQuantity: 0 });
    await newOperation({ type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: pending.id, quantity: 1 }] }, false);
    status(await call(`/api/products/${pending.id}`, { method: "PUT", body: { name: pending.name, sku: pending.sku, unit: "kg", reorderPoint: 0, leadDays: 1 } }), 409, "unit cannot change underneath an open operation");
    status(await call(`/api/products/${pending.id}`, { role: "admin", method: "DELETE" }), 409, "product referenced by an open operation cannot be archived");
    assert.equal((await call(`/api/products/${pending.id}`)).data.product.unit, "pcs", "pending operation keeps its original unit");
  });

  await check("validation retry, payload binding, and foreign key reuse", async () => {
    const product = await newProduct(mwh.id);
    const operation = await newOperation({ type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: product.id, quantity: 4 }] });
    const key = randomUUID();
    const body = { quantities: [{ lineId: operation.lines[0].id, quantity: 4 }] };
    const first = await postOperation(operation, body, key);
    status(first, 200, "initial full posting");
    const posted = snapshot(product.id);
    const retry = await postOperation(operation, body, key);
    status(retry, 200, "completed operation retry");
    assert.deepEqual(retry.data, first.data, "retry returns recorded result");
    assert.deepEqual(snapshot(product.id), posted, "retry cannot duplicate balance or ledger writes");
    const conflict = await postOperation(operation, { quantities: [{ lineId: operation.lines[0].id, quantity: 1 }] }, key);
    status(conflict, 409, "same key different quantity");
    assert.equal(conflict.data.code, "idempotency_conflict");
    const another = await newOperation({ type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: product.id, quantity: 1 }] });
    status(await postOperation(another, {}, key), 409, "same key different operation");
    status(await call(`/api/operations/${another.id}/validate`, { method: "POST", body: {} }), 400, "posting requires an idempotency key");
    assert.deepEqual(snapshot(product.id), posted, "rejected retries preserve inventory");
  });

  await check("unknown lines and invalid multiline posting roll back atomically", async () => {
    const first = await newProduct(mwh.id);
    const second = await newProduct(mwh.id);
    const operation = await newOperation({ type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: first.id, quantity: 2 }, { productId: second.id, quantity: 2 }] });
    const beforeFirst = snapshot(first.id), beforeSecond = snapshot(second.id);
    const unknown = await postOperation(operation, { quantities: [...operation.lines.map((line) => ({ lineId: line.id, quantity: 1 })), { lineId: other.line, quantity: 1 }] });
    status(unknown, 400, "unexpected line ID");
    status(await postOperation(operation, { quantities: [{ lineId: operation.lines[0].id, quantity: 1 }, { lineId: operation.lines[1].id, quantity: 3 }] }), 400, "over-quantity second line");
    assert.deepEqual(snapshot(first.id), beforeFirst, "first line write rolled back");
    assert.deepEqual(snapshot(second.id), beforeSecond, "second line unchanged");
  });

  await check("partial multiline receipts allow untouched and already completed lines", async () => {
    const first = await newProduct(mwh.id), second = await newProduct(mwh.id);
    const operation = await newOperation({ type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: first.id, quantity: 2 }, { productId: second.id, quantity: 3 }] });
    const partial = await postOperation(operation, { quantities: [{ lineId: operation.lines[0].id, quantity: 2 }, { lineId: operation.lines[1].id, quantity: 0 }] });
    status(partial, 200, "first product arrived while second is still missing");
    assert.equal(partial.data.operation.status, "partial");
    const completed = await postOperation(operation, { quantities: [{ lineId: operation.lines[0].id, quantity: 0 }, { lineId: operation.lines[1].id, quantity: 3 }] });
    status(completed, 200, "second product arrives after first is complete");
    assert.equal(completed.data.operation.status, "done");
    assert.equal(snapshot(first.id).balances[0].quantity, 12);
    assert.equal(snapshot(second.id).balances[0].quantity, 13);
    assert.equal(snapshot(first.id).ledger, 2, "zero quantities do not create ledger noise");
    assert.equal(snapshot(second.id).ledger, 2);
  });

  await check("concurrent reservations cannot oversell stock", async () => {
    const product = await newProduct(mwh.id);
    const first = await newOperation({ type: "delivery", sourceLocationId: mwh.id, lines: [{ productId: product.id, quantity: 8 }] }, false);
    const second = await newOperation({ type: "delivery", sourceLocationId: mwh.id, lines: [{ productId: product.id, quantity: 8 }] }, false);
    const results = await Promise.all([first, second].map((operation) => call(`/api/operations/${operation.id}/ready`, { method: "POST" })));
    assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 409], "exactly one of two competing reservations succeeds");
    assert.equal(snapshot(product.id).reservations.reduce((sum, row) => sum + row.quantity, 0), 8);
    const winner = results[0].response.status === 200 ? first : second;
    status(await call(`/api/operations/${winner.id}/cancel`, { method: "POST" }), 200, "cancel reserved operation");
    assert.equal(snapshot(product.id).reservations.length, 0, "cancel releases reservation");
  });

  await check("canceling a reported task closes its review and releases held stock", async () => {
    const beforeReviews = (await call("/api/admin/overview", { role: "admin" })).data.metrics.pendingReview;
    const product = await newProduct(mwh.id);
    const operation = await newOperation({ type: "delivery", sourceLocationId: mwh.id, assignedToUserId: users.staff.id, lines: [{ productId: product.id, quantity: 3 }] });
    const body = { submissionKey: randomUUID(), quantities: [{ lineId: operation.lines[0].id, quantity: 2 }], notes: "Reported before order cancellation" };
    const submitted = await call(`/api/operations/${operation.id}/submit`, { role: "staff", method: "POST", body });
    status(submitted, 201, "assigned task report");
    assert.equal((await call("/api/admin/overview", { role: "admin" })).data.metrics.pendingReview, beforeReviews + 1);
    const reportedStock = snapshot(product.id);
    const canceled = await call(`/api/operations/${operation.id}/cancel`, { method: "POST" });
    status(canceled, 200, "cancel operation with pending report");
    assert.equal(canceled.data.operation.status, "canceled");
    assert.equal(canceled.data.operation.submission.status, "canceled", "closed report no longer requests review");
    assert.equal((await call("/api/admin/overview", { role: "admin" })).data.metrics.pendingReview, beforeReviews, "canceled task leaves manager queue");
    assert.equal((await call("/api/dashboard")).data.metrics.pendingReview, beforeReviews, "manager dashboard stays consistent");
    const canceledStock = snapshot(product.id);
    assert.deepEqual(canceledStock.balances, reportedStock.balances, "cancel never posts stock");
    assert.equal(canceledStock.ledger, reportedStock.ledger);
    assert.equal(canceledStock.reservations.length, 0, "cancel releases remaining hold");
    status(await call(`/api/operations/${operation.id}/review`, { method: "POST", body: { submissionId: submitted.data.submission.id, decision: "needs_action", feedback: "This operation is already closed" } }), 409, "closed operation cannot request impossible rework");
    const retry = await call(`/api/operations/${operation.id}/submit`, { role: "staff", method: "POST", body });
    status(retry, 200, "old report retry remains safe after cancellation");
    assert.equal(retry.data.submission.status, "canceled");
    assert.equal(retry.data.operation.submission.status, "canceled");
  });

  await check("physical counts cannot consume stock reserved for another order", async () => {
    const product = await newProduct(mwh.id);
    await newOperation({ type: "delivery", sourceLocationId: mwh.id, lines: [{ productId: product.id, quantity: 8 }] });
    const count = await newOperation({ type: "adjustment", sourceLocationId: mwh.id, lines: [{ productId: product.id, quantity: 1 }] });
    const before = snapshot(product.id);
    const result = await postOperation(count);
    status(result, 409, "reserved count conflict");
    assert.equal(result.data.code, "reserved_stock_conflict");
    assert.deepEqual(snapshot(product.id), before, "reserved stock and ledger remain consistent");
  });

  await check("stale physical counts cannot overwrite intervening movements", async () => {
    const product = await newProduct(mwh.id);
    const count = await newOperation({ type: "adjustment", sourceLocationId: mwh.id, lines: [{ productId: product.id, quantity: 9 }] });
    const receipt = await newOperation({ type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: product.id, quantity: 2 }] });
    status(await postOperation(receipt), 200, "intervening receipt");
    const afterReceipt = snapshot(product.id);
    const stale = await postOperation(count);
    status(stale, 409, "stale manager count");
    assert.equal(stale.data.code, "stale_count");
    assert.deepEqual(snapshot(product.id), afterReceipt, "stale count cannot erase a receipt");
  });

  await check("count revision changes even when movements restore the same quantity", async () => {
    const product = await newProduct(mwh.id);
    const count = await newOperation({ type: "adjustment", sourceLocationId: mwh.id, lines: [{ productId: product.id, quantity: 9 }] });
    const receipt = await newOperation({ type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: product.id, quantity: 1 }] });
    status(await postOperation(receipt), 200, "intervening receipt");
    const delivery = await newOperation({ type: "delivery", sourceLocationId: mwh.id, lines: [{ productId: product.id, quantity: 1 }] });
    status(await postOperation(delivery), 200, "intervening delivery restores original quantity");
    const restored = snapshot(product.id);
    assert.equal(restored.balances[0].quantity, 10);
    const stale = await postOperation(count);
    status(stale, 409, "stale count with equal current quantity");
    assert.equal(stale.data.code, "stale_count");
    assert.deepEqual(snapshot(product.id), restored, "movement revision protects counts when numeric quantity happens to match");
  });

  await check("decimal quantities reconcile and subprecision amounts are rejected", async () => {
    const product = await newProduct(mwh.id, { initialQuantity: 0.3 });
    for (const quantity of [0.1, 0.2]) {
      const delivery = await newOperation({ type: "delivery", sourceLocationId: mwh.id, lines: [{ productId: product.id, quantity }] });
      status(await postOperation(delivery), 200, `decimal delivery ${quantity}`);
    }
    assert.equal(snapshot(product.id).balances[0].quantity, 0, "decimal deliveries deplete stock exactly without negative residuals");
    for (const quantity of [0.00001, 0.00000001]) status(await call("/api/operations", { method: "POST", body: { type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: product.id, quantity }] } }), 400, "quantities smaller than supported precision");
  });

  await check("blind count submission retries remain private and bind payloads", async () => {
    const product = await newProduct(mwh.id);
    const count = await newOperation({ type: "adjustment", sourceLocationId: mwh.id, assignedToUserId: users.staff.id, lines: [{ productId: product.id, quantity: 9 }] });
    const body = { submissionKey: randomUUID(), quantities: [{ lineId: count.lines[0].id, quantity: 8 }], notes: "Counted shelf A", exceptionType: "count_variance", countVersion: count.countVersion };
    const submitted = await call(`/api/operations/${count.id}/submit`, { role: "staff", method: "POST", body });
    status(submitted, 201, "staff count submission");
    const retry = await call(`/api/operations/${count.id}/submit`, { role: "staff", method: "POST", body });
    status(retry, 200, "staff submission retry");
    for (const result of [submitted, retry, await call(`/api/operations/${count.id}`, { role: "staff" })]) {
      assert.ok(result.data.operation.lines.every((line) => !Object.hasOwn(line, "planned_qty")), "every staff response hides expected counts");
      assert.ok(!JSON.stringify(result.data).includes("count_snapshot_json"), "staff responses cannot leak the system count through stored snapshots");
    }
    const conflict = await call(`/api/operations/${count.id}/submit`, { role: "staff", method: "POST", body: { ...body, quantities: [{ lineId: count.lines[0].id, quantity: 7 }] } });
    status(conflict, 409, "same submission key changed quantity");
    assert.equal(conflict.data.code, "idempotency_conflict");
    const receipt = await newOperation({ type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: product.id, quantity: 1 }] });
    status(await postOperation(receipt), 200, "movement after staff count submission");
    const before = snapshot(product.id);
    const stale = await postOperation(count);
    status(stale, 409, "stale submitted count");
    assert.equal(stale.data.code, "stale_count");
    assert.deepEqual(snapshot(product.id), before);
  });

  await check("staff counts require the opened revision and reject movement before submission", async () => {
    const product = await newProduct(mwh.id);
    const count = await newOperation({ type: "adjustment", sourceLocationId: mwh.id, assignedToUserId: users.staff.id, lines: [{ productId: product.id, quantity: 9 }] });
    const opened = (await call(`/api/operations/${count.id}`, { role: "staff" })).data.operation;
    const body = { submissionKey: randomUUID(), quantities: [{ lineId: count.lines[0].id, quantity: 9 }], notes: "Physical count finished" };
    const missing = await call(`/api/operations/${count.id}/submit`, { role: "staff", method: "POST", body });
    status(missing, 400, "count revision is required");
    assert.equal(missing.data.code, "missing_count_version");
    const receipt = await newOperation({ type: "receipt", destinationLocationId: mwh.id, lines: [{ productId: product.id, quantity: 1 }] });
    status(await postOperation(receipt), 200, "stock moved after staff opened the count");
    const before = snapshot(product.id);
    const stale = await call(`/api/operations/${count.id}/submit`, { role: "staff", method: "POST", body: { ...body, countVersion: opened.countVersion } });
    status(stale, 409, "stale opened count cannot be submitted");
    assert.equal(stale.data.code, "stale_count");
    assert.equal(fixture.prepare("SELECT COUNT(*) AS count FROM operation_submissions WHERE operation_id=?").get(count.id).count, 0, "rejected count never enters approval queue");
    const refreshed = (await call(`/api/operations/${count.id}`, { role: "staff" })).data.operation;
    assert.notEqual(refreshed.countVersion, opened.countVersion, "refresh exposes new movement revision");
    status(await call(`/api/operations/${count.id}/submit`, { role: "staff", method: "POST", body: { ...body, countVersion: refreshed.countVersion, quantities: [{ lineId: count.lines[0].id, quantity: 11 }] } }), 201, "fresh recount can be submitted");
    assert.deepEqual(snapshot(product.id), before, "staff submission still does not post inventory");
  });

  await check("session logout prevents replay without invalidating another session", async () => {
    cookies.logoutSession = (await login("manager@stocksense.demo")).cookie;
    status(await call("/api/auth/logout", { role: "logoutSession", method: "POST" }), 200, "logout");
    status(await call("/api/auth/me", { role: "logoutSession" }), 401, "logged-out cookie replay");
    status(await call("/api/auth/me"), 200, "separate manager session remains active");
  });

  const resetUser = (label, code, expiresAt = new Date(Date.now() + 600_000).toISOString()) => {
    const id = randomUUID(), resetId = randomUUID(), email = `reset-${label}@example.test`;
    fixture.prepare("INSERT INTO users(id,company_id,email,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?,?)").run(id, companyId, email, `Reset ${label}`, "manager", bcrypt.hashSync("OriginalResetPass2026!", 10), now());
    fixture.prepare("INSERT INTO password_resets(id,user_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)").run(resetId, id, sha256(code), expiresAt, now());
    return { id, resetId, email, code };
  };
  await check("password reset attempts are limited and expired codes rejected", async () => {
    const user = resetUser("attempts", "246810");
    for (let i = 0; i < 5; i++) status(await call("/api/auth/password-reset/confirm", { role: "anonymous", method: "POST", body: { email: user.email, code: "000000", password: "ReplacedResetPass2026!" } }), 400, `wrong reset code attempt ${i + 1}`);
    status(await call("/api/auth/password-reset/confirm", { role: "anonymous", method: "POST", body: { email: user.email, code: user.code, password: "ReplacedResetPass2026!" } }), 400, "correct code after attempt limit");
    const record = fixture.prepare("SELECT attempts,used_at FROM password_resets WHERE id=?").get(user.resetId);
    assert.equal(record.attempts, 5);
    assert.ok(record.used_at, "exhausted code is consumed");
    const expired = resetUser("expired", "135791", new Date(Date.now() - 60_000).toISOString());
    status(await call("/api/auth/password-reset/confirm", { role: "anonymous", method: "POST", body: { email: expired.email, code: expired.code, password: "ReplacedResetPass2026!" } }), 400, "expired reset code");
  });

  await check("password reset codes are single use and revoke prior sessions", async () => {
    const user = resetUser("success", "112233");
    cookies.resetOldSession = (await login(user.email, "OriginalResetPass2026!")).cookie;
    const body = { email: user.email, code: user.code, password: "ReplacedResetPass2026!" };
    status(await call("/api/auth/password-reset/confirm", { role: "anonymous", method: "POST", body }), 200, "valid reset");
    status(await call("/api/auth/me", { role: "resetOldSession" }), 401, "old session after password reset");
    status(await call("/api/auth/password-reset/confirm", { role: "anonymous", method: "POST", body }), 400, "reset code replay");
    status(await call("/api/auth/login", { role: "anonymous", method: "POST", body: { email: user.email, password: "OriginalResetPass2026!" } }), 401, "old password rejected");
    cookies.resetNewSession = (await login(user.email, body.password)).cookie;
    status(await call("/api/auth/me", { role: "resetNewSession" }), 200, "new password usable");
  });

  await check("reset request cooldown and unknown-account response", async () => {
    const user = resetUser("request", "334455");
    fixture.prepare("DELETE FROM password_resets WHERE user_id=?").run(user.id);
    const first = await call("/api/auth/password-reset/request", { role: "anonymous", method: "POST", body: { email: user.email } });
    status(first, 200, "first demo reset request");
    assert.match(first.data.devCode || "", /^\d{6}$/, "demo-only code is returned without email provider");
    status(await call("/api/auth/password-reset/request", { role: "anonymous", method: "POST", body: { email: user.email } }), 200, "reset cooldown uses generic response");
    assert.equal(fixture.prepare("SELECT COUNT(*) AS count FROM password_resets WHERE user_id=?").get(user.id).count, 1, "cooldown does not issue another code");
    const unknown = await call("/api/auth/password-reset/request", { role: "anonymous", method: "POST", body: { email: "missing@example.test" } });
    status(unknown, 200, "unknown account reset request");
    assert.equal(unknown.data.message, first.data.message, "generic wording avoids account disclosure outside demo code");
    assert.equal(unknown.data.devCode, undefined);
  });

  await check("administrator suspension and session revocation are enforced", async () => {
    status(await call(`/api/users/${users.admin.id}/status`, { role: "admin", method: "PATCH", body: { active: false } }), 400, "admin cannot suspend own account");
    status(await call(`/api/users/${users.staff.id}/status`, { role: "admin", method: "PATCH", body: { active: false } }), 200, "suspend staff account");
    status(await call("/api/auth/me", { role: "staff" }), 401, "suspended session rejected");
    status(await call("/api/auth/login", { role: "anonymous", method: "POST", body: { email: "staff@stocksense.demo", password: "Demo2026!" } }), 401, "suspended login rejected");
    status(await call(`/api/users/${users.manager.id}/revoke-sessions`, { role: "admin", method: "POST" }), 200, "revoke manager sessions");
    status(await call("/api/auth/me"), 401, "revoked manager session rejected");
    status(await call("/api/auth/me", { role: "admin" }), 200, "admin session unaffected by manager revocation");
  });

  await check("all company balances reconcile to the ledger and cover reservations", async () => {
    const rows = fixture.prepare(`SELECT p.sku,b.quantity,b.location_id,
      COALESCE((SELECT SUM(le.delta) FROM ledger le WHERE le.product_id=b.product_id AND le.location_id=b.location_id),0) AS ledger_total,
      COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.product_id=b.product_id AND r.location_id=b.location_id),0) AS reserved
      FROM stock_balances b JOIN products p ON p.id=b.product_id WHERE p.company_id=?`).all(companyId);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.ok(row.quantity >= 0, `${row.sku}: balance never negative`);
      assert.ok(Math.abs(row.quantity - row.ledger_total) < 0.000001, `${row.sku}: balance agrees with ledger sum`);
      assert.ok(row.reserved <= row.quantity + 0.000001, `${row.sku}: reservations never exceed on-hand stock`);
    }
  });

  console.log(`\nStockSense security regression: ${passed} passed, ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  console.error(output);
  process.exitCode = 1;
} finally {
  fixture?.close();
  child.kill();
  if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(5000)]);
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
