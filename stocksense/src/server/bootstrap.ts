import "dotenv/config";
import bcrypt from "bcryptjs";
import { z } from "zod";

if (process.env.NODE_ENV !== "production" || process.env.APP_ENV !== "production") {
  console.error("Company bootstrap is a one-time production setup command. Set NODE_ENV and APP_ENV to production.");
  process.exit(1);
}
const input = z.object({
  BOOTSTRAP_COMPANY: z.string().trim().min(2).max(100),
  BOOTSTRAP_ADMIN_NAME: z.string().trim().min(2).max(100),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().max(254),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(14).max(128)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes."),
}).safeParse(process.env);
if (!input.success) {
  console.error("Set BOOTSTRAP_COMPANY, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, and BOOTSTRAP_ADMIN_PASSWORD (14+ characters, at most 72 UTF-8 bytes) in a protected environment.");
  process.exit(1);
}
// Validate the mode and input before opening or migrating any database.
const { db, nowIso, uuid } = await import("./db.js");
const existing = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
if (existing.count) {
  console.error("Bootstrap stopped: this database already has a user. It will not overwrite existing accounts.");
  process.exit(1);
}
const companyId = uuid(); const userId = uuid(); const at = nowIso();
const tx = db.transaction(() => {
  db.prepare("INSERT INTO companies(id,name,slug,created_at) VALUES(?,?,?,?)").run(companyId, input.data.BOOTSTRAP_COMPANY, `company-${companyId}`, at);
  db.prepare("INSERT INTO users(id,company_id,email,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(userId, companyId, input.data.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), input.data.BOOTSTRAP_ADMIN_NAME, "admin", bcrypt.hashSync(input.data.BOOTSTRAP_ADMIN_PASSWORD, 12), at);
  db.prepare("INSERT INTO audit_logs(id,company_id,actor_id,action,entity_type,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(uuid(), companyId, userId, "company_bootstrapped", "company", companyId, "{}", at);
});
tx();
console.log(`Production company initialized with administrator ${input.data.BOOTSTRAP_ADMIN_EMAIL}. No demo credentials were created.`);
