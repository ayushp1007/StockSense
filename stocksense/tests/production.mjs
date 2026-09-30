import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import Database from "better-sqlite3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(root, "work"), { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, "work", "production-check-"));
const productionDb = path.join(scratch, "production.db");
const port = 46500 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const origin = "https://stocksense.example.test";
const password = "IsolatedProductionTest2026!";
const commonEnv = {
  ...process.env, NODE_ENV: "production", APP_ENV: "production", DB_PATH: productionDb,
  PORT: String(port), JWT_SECRET: randomBytes(48).toString("hex"), APP_ORIGIN: origin,
  OPENAI_API_KEY: "", RESEND_API_KEY: "", EMAIL_FROM: "", TRUST_PROXY: "false",
  BOOTSTRAP_COMPANY: "Isolated production checks", BOOTSTRAP_ADMIN_NAME: "Test Administrator",
  BOOTSTRAP_ADMIN_EMAIL: "administrator@example.test", BOOTSTRAP_ADMIN_PASSWORD: password,
};
let passed = 0;
let child;
let logs = "";
const check = (description, callback) => { callback(); passed++; console.log(`PASS ${description}`); };
const run = (entry, extra = {}) => spawnSync(process.execPath, ["--import", "tsx", entry], {
  cwd: root, env: { ...commonEnv, ...extra }, encoding: "utf8", timeout: 12000,
});
const closed = (result, pattern) => {
  assert.equal(result.status, 1, `Expected safe refusal, received ${result.status}: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, pattern);
};
const call = async (route, options = {}) => {
  const response = await fetch(`${base}${route}`, options);
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { response, data };
};

try {
  const untouched = path.join(scratch, "must-not-exist.db");
  check("bootstrap rejects demo mode before opening a database", () => {
    closed(run("src/server/bootstrap.ts", { NODE_ENV: "development", APP_ENV: "demo", DB_PATH: untouched }), /production setup/);
    assert.equal(fs.existsSync(untouched), false);
  });
  check("bootstrap rejects passwords beyond bcrypt's byte limit before opening a database", () => {
    closed(run("src/server/bootstrap.ts", { DB_PATH: untouched, BOOTSTRAP_ADMIN_PASSWORD: "密".repeat(25) }), /72 UTF-8 bytes/);
    assert.equal(fs.existsSync(untouched), false);
  });
  check("production bootstrap creates one administrator without demo accounts", () => {
    const result = run("src/server/bootstrap.ts");
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const db = new Database(productionDb, { readonly: true });
    try { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1); assert.equal(db.prepare("SELECT email FROM users").get().email, "administrator@example.test"); }
    finally { db.close(); }
  });
  check("bootstrap refuses to overwrite an existing company", () => closed(run("src/server/bootstrap.ts"), /already has a user/));
  check("demo reset refuses a production-mode environment", () => closed(run("src/server/reset-demo.ts"), /cannot run in production/));
  check("demo reset also refuses a real company even when APP_ENV is demo", () => {
    closed(run("src/server/reset-demo.ts", { NODE_ENV: "development", APP_ENV: "demo" }), /not the seeded StockSense demo/);
    const db = new Database(productionDb, { readonly: true });
    try { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1); } finally { db.close(); }
  });
  check("development startup refuses production configuration", () => {
    closed(run("src/server/dev.ts", { DB_PATH: untouched }), /Development startup refused/);
    assert.equal(fs.existsSync(untouched), false);
  });
  check("production entry enforces production even with demo mode variables", () => closed(run("src/server/start.ts", { NODE_ENV: "development", APP_ENV: "demo", JWT_SECRET: "" }), /JWT_SECRET/));
  check("production rejects the published example secret", () => closed(run("src/server/start.ts", { JWT_SECRET: "replace-with-a-random-32-character-or-longer-secret" }), /JWT_SECRET/));

  const demoDb = path.join(scratch, "demo.db");
  const seed = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "const {db} = await import('./src/server/db.ts'); db.close();"], {
    cwd: root, env: { ...commonEnv, DB_PATH: demoDb, NODE_ENV: "development", APP_ENV: "demo" }, encoding: "utf8", timeout: 12000,
  });
  assert.equal(seed.status, 0, seed.stderr);
  check("production refuses a database containing demo accounts", () => closed(run("src/server/start.ts", { DB_PATH: demoDb }), /demo/i));

  assert.ok(fs.existsSync(path.join(root, "dist/server/start.js")), "Run npm run build before the production checks.");
  child = spawn(process.execPath, ["dist/server/start.js"], { cwd: root, env: commonEnv, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`Production server exited: ${logs}`);
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch { /* starting */ }
    await delay(200);
  }
  assert.ok(ready, `Production server failed to start: ${logs}`);
  const config = await call("/api/public-config");
  check("compiled production server hides demo access and applies security headers", () => {
    assert.equal(config.response.status, 200); assert.equal(config.data.demo, false);
    assert.equal(config.response.headers.get("x-powered-by"), null);
    assert.equal(config.response.headers.get("x-content-type-options"), "nosniff");
    assert.match(config.response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.ok(config.response.headers.get("strict-transport-security"));
  });
  const signIn = await call("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email: "administrator@example.test", password }) });
  check("production sign-in issues Secure, HttpOnly, SameSite cookies", () => {
    assert.equal(signIn.response.status, 200, JSON.stringify(signIn.data));
    const cookie = signIn.response.headers.get("set-cookie");
    assert.match(cookie, /; Secure/i); assert.match(cookie, /; HttpOnly/i); assert.match(cookie, /; SameSite=Lax/i);
    assert.match(signIn.response.headers.get("cache-control"), /no-store/);
  });
  const reset = await call("/api/auth/password-reset/request", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email: "administrator@example.test" }) });
  check("unconfigured production email reports unavailability and never exposes a reset code", () => {
    assert.equal(reset.response.status, 503); assert.equal(reset.data.devCode, undefined);
  });
  const logo = await call("/stocksense-mark.svg"); const page = await call("/"); const missing = await call("/api/does-not-exist");
  check("production serves the built app/logo and returns JSON for unknown API routes", () => {
    assert.equal(logo.response.status, 200); assert.match(logo.response.headers.get("content-type"), /image\/svg/);
    assert.equal(page.response.status, 200); assert.match(page.data, /stocksense-mark\.svg/);
    assert.equal(missing.response.status, 404); assert.equal(missing.data.code, "not_found");
  });
  console.log(`Production checks passed: ${passed} scenarios.`);
} catch (error) {
  console.error(error.stack || error);
  if (logs) console.error(logs);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit"); child.kill();
    await Promise.race([exited, delay(5000)]);
  }
  // This directory is allocated by this test under the workspace, never a configured user DB.
  const workRoot = path.resolve(root, "work") + path.sep;
  if (path.resolve(scratch).startsWith(workRoot)) fs.rmSync(scratch, { recursive: true, force: true });
}
