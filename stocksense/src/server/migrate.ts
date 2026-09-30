import "dotenv/config";
import { db } from "./db.js";
const versions = (await db.prepare("SELECT version,applied_at FROM schema_migrations ORDER BY version").all());
console.log("StockSense SQLite schema is current.");
console.log(versions);
