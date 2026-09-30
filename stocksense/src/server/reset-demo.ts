import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

if (process.env.NODE_ENV === "production" || process.env.APP_ENV !== "demo") {
  console.error("Demo reset requires APP_ENV=demo and cannot run in production. Set this only for a disposable demo database.");
  process.exit(1);
}
const dbPath = path.resolve(process.env.DB_PATH || "data/stocksense.db");
if (fs.existsSync(dbPath)) {
  const existing = new Database(dbPath, { readonly: true, fileMustExist: true });
  let isDemo = false;
  try {
    const companies = existing.prepare("SELECT slug FROM companies").all() as Array<{ slug: string }>;
    const demoUser = existing.prepare("SELECT 1 FROM users WHERE email='admin@stocksense.demo'").get();
    isDemo = companies.length === 1 && companies[0].slug === "northstar-works" && !!demoUser;
  } catch { /* Unknown databases must never be deleted by a demo command. */ }
  finally { existing.close(); }
  if (!isDemo) {
    console.error("Demo reset refused: this is not the seeded StockSense demo workspace.");
    process.exit(1);
  }
}
for (const suffix of ["", "-wal", "-shm"]) {
  const candidate = dbPath + suffix;
  if (fs.existsSync(candidate)) fs.rmSync(candidate);
}
await import("./db.js");
console.log("StockSense demo database reset and reseeded.");
