import { asyncForEach } from './async-collections.js';
import { db } from './database-client.js';
export { db } from './database-client.js';
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
(await db.pragma("journal_mode = WAL"));
(await db.pragma("foreign_keys = ON"));
(await db.pragma("busy_timeout = 5000"));
async function schemaIsCurrent() {
    try {
        const row = await db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
        return Number(row?.version || 0) >= 6;
    } catch (error) {
        if (error instanceof Error && /no such table.*schema_migrations/i.test(error.message)) return false;
        throw error;
    }
}
if (!await schemaIsCurrent()) await db.transaction(async () => {
if (await schemaIsCurrent()) return;
(await db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,datetime('now'));
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), email TEXT NOT NULL,
    name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','manager','staff')),
    password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, token_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    UNIQUE(company_id,email)
  );
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), name TEXT NOT NULL,
    code TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'Warehouse', active INTEGER NOT NULL DEFAULT 1,
    parent_id TEXT REFERENCES locations(id),
    UNIQUE(company_id,code)
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6875d9', UNIQUE(company_id,name)
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), category_id TEXT REFERENCES categories(id),
    name TEXT NOT NULL, sku TEXT NOT NULL, unit TEXT NOT NULL, reorder_point REAL NOT NULL DEFAULT 0,
    lead_days INTEGER NOT NULL DEFAULT 7, description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, UNIQUE(company_id,sku), CHECK(reorder_point >= 0), CHECK(lead_days >= 0)
  );
  CREATE TABLE IF NOT EXISTS location_reorder_rules (
    product_id TEXT NOT NULL REFERENCES products(id), location_id TEXT NOT NULL REFERENCES locations(id),
    reorder_point REAL NOT NULL DEFAULT 0 CHECK(reorder_point >= 0), safety_stock REAL NOT NULL DEFAULT 0 CHECK(safety_stock >= 0),
    PRIMARY KEY(product_id,location_id)
  );
  CREATE TABLE IF NOT EXISTS stock_balances (
    product_id TEXT NOT NULL REFERENCES products(id), location_id TEXT NOT NULL REFERENCES locations(id),
    quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0), updated_at TEXT NOT NULL,
    PRIMARY KEY(product_id,location_id)
  );
  CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), reference TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('receipt','delivery','transfer','adjustment')),
    status TEXT NOT NULL CHECK(status IN ('draft','ready','partial','done','canceled')),
    source_location_id TEXT REFERENCES locations(id), destination_location_id TEXT REFERENCES locations(id),
    partner TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', expected_on TEXT,
    assigned_to_user_id TEXT REFERENCES users(id), priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(company_id,reference)
  );
  CREATE TABLE IF NOT EXISTS operation_lines (
    id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id), product_id TEXT NOT NULL REFERENCES products(id),
    planned_qty REAL NOT NULL CHECK(planned_qty >= 0), completed_qty REAL NOT NULL DEFAULT 0 CHECK(completed_qty >= 0),
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), operation_id TEXT NOT NULL REFERENCES operations(id),
    operation_line_id TEXT NOT NULL REFERENCES operation_lines(id), product_id TEXT NOT NULL REFERENCES products(id),
    location_id TEXT NOT NULL REFERENCES locations(id), quantity REAL NOT NULL CHECK(quantity >= 0), created_at TEXT NOT NULL,
    UNIQUE(operation_line_id,location_id)
  );
  CREATE TABLE IF NOT EXISTS user_locations (
    user_id TEXT NOT NULL REFERENCES users(id), location_id TEXT NOT NULL REFERENCES locations(id), assigned_at TEXT NOT NULL,
    PRIMARY KEY(user_id,location_id)
  );
  CREATE TABLE IF NOT EXISTS operation_submissions (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), operation_id TEXT NOT NULL REFERENCES operations(id),
    submitted_by TEXT NOT NULL REFERENCES users(id), submission_key TEXT NOT NULL UNIQUE, quantities_json TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '', exception_type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','approved','needs_action')),
    feedback TEXT NOT NULL DEFAULT '', reviewed_by TEXT REFERENCES users(id), created_at TEXT NOT NULL, reviewed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), name TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
    UNIQUE(company_id,name)
  );
  CREATE TABLE IF NOT EXISTS ledger (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), product_id TEXT NOT NULL REFERENCES products(id),
    operation_id TEXT REFERENCES operations(id), location_id TEXT NOT NULL REFERENCES locations(id),
    other_location_id TEXT REFERENCES locations(id), delta REAL NOT NULL, balance_before REAL NOT NULL,
    balance_after REAL NOT NULL CHECK(balance_after >= 0), actor_id TEXT REFERENCES users(id), reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id, active, name);
  CREATE INDEX IF NOT EXISTS idx_operations_company_status ON operations(company_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_ledger_company_time ON ledger(company_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ledger_product_time ON ledger(product_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ledger_location_time ON ledger(company_id,location_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reservations_location_product ON reservations(company_id,location_id,product_id);
  CREATE INDEX IF NOT EXISTS idx_operation_submissions_pending ON operation_submissions(company_id,status,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_submissions_operation_status ON operation_submissions(operation_id,status,created_at DESC);
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), actor_id TEXT REFERENCES users(id),
    action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL, used_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS operation_validations (
    idempotency_key TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id),
    company_id TEXT NOT NULL REFERENCES companies(id), result_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at);
`));
const ensureColumn = async (table: string, column: string, definition: string) => {
    const columns = (await db.pragma(`table_info(${table})`)) as Array<{
        name: string;
    }>;
    if (!columns.some((item) => item.name === column))
        (await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`));
};
(await ensureColumn("locations", "parent_id", "TEXT REFERENCES locations(id)"));
(await ensureColumn("users", "token_version", "INTEGER NOT NULL DEFAULT 0"));
(await ensureColumn("operations", "assigned_to_user_id", "TEXT REFERENCES users(id)"));
(await ensureColumn("operations", "priority", "TEXT NOT NULL DEFAULT 'normal'"));
(await ensureColumn("password_resets", "attempts", "INTEGER NOT NULL DEFAULT 0"));
(await ensureColumn("operation_validations", "request_hash", "TEXT"));
(await ensureColumn("operation_submissions", "request_hash", "TEXT"));
(await ensureColumn("operation_submissions", "count_snapshot_json", "TEXT"));
(await ensureColumn("operations", "count_snapshot_json", "TEXT"));
// Build indexes that use migrated columns only after older databases gain them.
(await db.exec("CREATE INDEX IF NOT EXISTS idx_operations_assignee_status ON operations(company_id,assigned_to_user_id,status,expected_on)"));
(await db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,datetime('now'))").run());
(await db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(3,datetime('now'))").run());
(await db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,datetime('now'))").run());
(await db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(5,datetime('now'))").run());
(await db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(6,datetime('now'))").run());
})();
export const nowIso = () => new Date().toISOString();
export const uuid = () => randomUUID();
async function seedDemo() {
    const exists = (await db.prepare("SELECT id FROM companies LIMIT 1").get()) as {
        id: string;
    } | undefined;
    if (exists)
        return;
    const tx = db.transaction(async () => {
        const now = nowIso();
        const companyId = uuid();
        const users = [
            { id: uuid(), email: "admin@stocksense.demo", name: "Olivia Bennett", role: "admin" },
            { id: uuid(), email: "manager@stocksense.demo", name: "Marcus Chen", role: "manager" },
            { id: uuid(), email: "staff@stocksense.demo", name: "Sam Rivera", role: "staff" },
        ];
        (await db.prepare("INSERT INTO companies(id,name,slug,created_at) VALUES(?,?,?,?)").run(companyId, "Northstar Works", "northstar-works", now));
        const addUser = db.prepare("INSERT INTO users(id,company_id,email,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?,?)");
        for (const user of users)
            (await addUser.run(user.id, companyId, user.email, user.name, user.role, bcrypt.hashSync("Demo2026!", 10), now));
        const locs = [
            { id: uuid(), code: "MWH", name: "Main warehouse", kind: "Warehouse" },
            { id: uuid(), code: "PROD", name: "Production floor", kind: "Production" },
            { id: uuid(), code: "EAST", name: "East distribution", kind: "Warehouse" },
        ];
        const addLocation = db.prepare("INSERT INTO locations(id,company_id,name,code,kind) VALUES(?,?,?,?,?)");
        for (const loc of locs)
            (await addLocation.run(loc.id, companyId, loc.name, loc.code, loc.kind));
        const assignLocation = db.prepare("INSERT INTO user_locations(user_id,location_id,assigned_at) VALUES(?,?,?)");
        for (const location of [locs[0], locs[1]])
            (await assignLocation.run(users[2].id, location.id, now));
        const categories = [
            { id: uuid(), name: "Raw materials", color: "#d98a4f" },
            { id: uuid(), name: "Components", color: "#6577c8" },
            { id: uuid(), name: "Packaging", color: "#4f9d82" },
            { id: uuid(), name: "Safety", color: "#d5a43a" },
            { id: uuid(), name: "Maintenance", color: "#8771bd" },
        ];
        const addCategory = db.prepare("INSERT INTO categories(id,company_id,name,color) VALUES(?,?,?,?)");
        for (const category of categories)
            (await addCategory.run(category.id, companyId, category.name, category.color));
        const products = [
            { id: uuid(), sku: "RM-2048", name: "Steel rod · 12 mm", category: 0, unit: "kg", reorder: 60, lead: 7, desc: "Low-carbon steel stock for frame production." },
            { id: uuid(), sku: "RM-1182", name: "Aluminium sheet · 2 mm", category: 0, unit: "sheets", reorder: 36, lead: 14, desc: "Cut-ready aluminium sheets." },
            { id: uuid(), sku: "CP-4401", name: "Hex bolt · M8 × 30", category: 1, unit: "pcs", reorder: 500, lead: 10, desc: "Zinc-plated fastener, grade 8.8." },
            { id: uuid(), sku: "PK-9200", name: "Shipping carton · L", category: 2, unit: "pcs", reorder: 250, lead: 5, desc: "Double-wall corrugated cartons." },
            { id: uuid(), sku: "SF-3108", name: "Nitrile gloves · M", category: 3, unit: "boxes", reorder: 140, lead: 8, desc: "Powder-free industrial gloves." },
            { id: uuid(), sku: "MT-5084", name: "Machine oil · ISO 46", category: 4, unit: "L", reorder: 30, lead: 5, desc: "Hydraulic oil for shop equipment." },
            { id: uuid(), sku: "SF-2004", name: "Safety glasses · clear", category: 3, unit: "pcs", reorder: 18, lead: 9, desc: "Clear anti-fog protective eyewear." },
            { id: uuid(), sku: "PK-1012", name: "Wooden pallet · EUR", category: 2, unit: "pcs", reorder: 40, lead: 12, desc: "Reusable 1200 × 800 mm pallet." },
        ];
        const addProduct = db.prepare("INSERT INTO products(id,company_id,category_id,name,sku,unit,reorder_point,lead_days,description,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
        for (const product of products)
            (await addProduct.run(product.id, companyId, categories[product.category].id, product.name, product.sku, product.unit, product.reorder, product.lead, product.desc, now));
        const locationRules = [
            [45, 15, 0], [28, 0, 8], [350, 150, 0], [0, 0, 250], [110, 30, 0], [30, 0, 0], [0, 0, 18], [40, 0, 0],
        ];
        const saveRule = db.prepare("INSERT INTO location_reorder_rules(product_id,location_id,reorder_point,safety_stock) VALUES(?,?,?,?)");
        (await asyncForEach(products, async (product, index) => (await asyncForEach(locs, async (location, locationIndex) => (await saveRule.run(product.id, location.id, locationRules[index][locationIndex], Math.ceil(locationRules[index][locationIndex] * .15)))))));
        const balances: [
            number,
            number,
            number
        ][] = [
            [0, 46, 12], [1, 23, 4], [2, 845, 210], [3, 188, 0], [4, 126, 12], [5, 41, 0], [6, 0, 0], [7, 38, 0],
        ];
        const addBalance = db.prepare("INSERT INTO stock_balances(product_id,location_id,quantity,updated_at) VALUES(?,?,?,?)");
        const addLedger = db.prepare("INSERT INTO ledger(id,company_id,product_id,operation_id,location_id,other_location_id,delta,balance_before,balance_after,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
        const openingAt = new Date(Date.now() - 60 * 86400000).toISOString();
        // An opening ledger row establishes the audited starting point. The synthetic steel movement history below is fully linked to completed demo operations.
        for (let i = 1; i < products.length; i++) {
            for (let j = 0; j < 2; j++) {
                const qty = balances[i][j + 1];
                (await addBalance.run(products[i].id, locs[j].id, qty, now));
                (await addLedger.run(uuid(), companyId, products[i].id, null, locs[j].id, null, qty, 0, qty, users[0].id, "Opening balance · demo setup", openingAt));
            }
        }
        const createHistoricOperation = async (reference: string, type: string, at: Date, actor = users[1]) => {
            const id = uuid();
            (await db.prepare("INSERT INTO operations(id,company_id,reference,type,status,source_location_id,destination_location_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
                .run(id, companyId, reference, type, "done", type === "receipt" ? null : locs[0].id, type === "receipt" ? locs[0].id : type === "transfer" ? locs[1].id : null, actor.id, at.toISOString(), at.toISOString()));
            return id;
        };
        const addLine = db.prepare("INSERT INTO operation_lines(id,operation_id,product_id,planned_qty,completed_qty,position) VALUES(?,?,?,?,?,?)");
        const steel = products[0].id;
        let mainBalance = 118;
        (await addBalance.run(steel, locs[0].id, mainBalance, now));
        (await addBalance.run(steel, locs[1].id, 0, now));
        (await addLedger.run(uuid(), companyId, steel, null, locs[0].id, null, 118, 0, 118, users[0].id, "Opening balance · demo setup", openingAt));
        (await addLedger.run(uuid(), companyId, steel, null, locs[1].id, null, 0, 0, 0, users[0].id, "Opening balance · demo setup", openingAt));
        const receiptAt = new Date(Date.now() - 39 * 86400000);
        const receiptId = (await createHistoricOperation("RCV-2418", "receipt", receiptAt));
        (await addLine.run(uuid(), receiptId, steel, 35, 35, 0));
        (await addLedger.run(uuid(), companyId, steel, receiptId, locs[0].id, null, 35, mainBalance, mainBalance + 35, users[1].id, "Supplier delivery · demo history", receiptAt.toISOString()));
        mainBalance += 35;
        const dailyDrops = [14, 15, 16, 14, 17, 14, 5];
        const daysAgo = [2, 6, 12, 18, 24, 29, 36];
        const movements = [
            ...dailyDrops.map((quantity, index) => ({ reference: `OUT-${8620 + index}`, type: "delivery", quantity, daysAgo: daysAgo[index] })),
            { reference: "TRF-1075", type: "transfer", quantity: 12, daysAgo: 22 },
        ].sort((left, right) => right.daysAgo - left.daysAgo);
        // Build before/after balances in time order, including the transfer between
        // deliveries, so sample ledger detail reconciles as well as its final sum.
        for (const movement of movements) {
            const at = new Date(Date.now() - movement.daysAgo * 86400000);
            const opId = (await createHistoricOperation(movement.reference, movement.type, at));
            const isTransfer = movement.type === "transfer";
            (await addLine.run(uuid(), opId, steel, movement.quantity, movement.quantity, 0));
            (await addLedger.run(uuid(), companyId, steel, opId, locs[0].id, isTransfer ? locs[1].id : null, -movement.quantity, mainBalance, mainBalance - movement.quantity, users[2].id, isTransfer ? "Move to production · demo history" : "Customer shipment · demo history", at.toISOString()));
            if (isTransfer)
                (await addLedger.run(uuid(), companyId, steel, opId, locs[1].id, locs[0].id, movement.quantity, 0, movement.quantity, users[2].id, "Move from main warehouse · demo history", at.toISOString()));
            mainBalance -= movement.quantity;
        }
        (await db.prepare("UPDATE stock_balances SET quantity=? WHERE product_id=? AND location_id=?").run(mainBalance, steel, locs[0].id));
        (await db.prepare("UPDATE stock_balances SET quantity=12 WHERE product_id=? AND location_id=?").run(steel, locs[1].id));
        const addOpen = async (reference: string, type: string, status: string, source: string | null, destination: string | null, product: string, planned: number, partner: string, note: string, assignee: string) => {
            const id = uuid();
            (await db.prepare("INSERT INTO operations(id,company_id,reference,type,status,source_location_id,destination_location_id,partner,note,expected_on,assigned_to_user_id,priority,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
                .run(id, companyId, reference, type, status, source, destination, partner, note, new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), assignee, reference === "RCV-2501" ? "high" : "normal", users[1].id, now, now));
            const lineId = uuid();
            (await addLine.run(lineId, id, product, planned, 0, 0));
            return { id, lineId };
        };
        const staffReceipt = (await addOpen("RCV-2501", "receipt", "ready", null, locs[0].id, steel, 50, "Meridian Metals", "Production replenishment · 50 kg steel rod", users[2].id));
        const staffDelivery = (await addOpen("OUT-9084", "delivery", "ready", locs[1].id, null, steel, 8, "Atlas Fabrication", "Priority frame order", users[2].id));
        (await db.prepare("INSERT INTO reservations(id,company_id,operation_id,operation_line_id,product_id,location_id,quantity,created_at) VALUES(?,?,?,?,?,?,?,?)").run(uuid(), companyId, staffDelivery.id, staffDelivery.lineId, steel, locs[1].id, 8, now));
        (await addOpen("TRF-1182", "transfer", "draft", locs[0].id, locs[1].id, steel, 10, "", "Replenish production rack", users[2].id));
        (await db.prepare("INSERT INTO operation_submissions(id,company_id,operation_id,submitted_by,submission_key,quantities_json,notes,exception_type,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
            .run(uuid(), companyId, staffReceipt.id, users[2].id, `demo-${uuid()}`, JSON.stringify([{ lineId: staffReceipt.lineId, quantity: 44 }]), "Six kilograms short against the supplier slip.", "shortage", "pending", now));
        for (const user of users) {
            (await db.prepare("INSERT INTO audit_logs(id,company_id,actor_id,action,entity_type,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)")
                .run(uuid(), companyId, user.id, "demo_access_created", "user", user.id, JSON.stringify({ role: user.role }), now));
        }
    });
    (await tx());
}
if (process.env.NODE_ENV !== "production" && process.env.APP_ENV !== "production")
    (await seedDemo());
export async function companyForUser(userId: string) {
    return (await db.prepare("SELECT id, name FROM companies WHERE id=(SELECT company_id FROM users WHERE id=? AND active=1)").get(userId)) as {
        id: string;
        name: string;
    } | undefined;
}
export async function logAudit(companyId: string, actorId: string | null, action: string, entityType: string, entityId: string, metadata: object = {}) {
    (await db.prepare("INSERT INTO audit_logs(id,company_id,actor_id,action,entity_type,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(uuid(), companyId, actorId, action, entityType, entityId, JSON.stringify(metadata), nowIso()));
}
