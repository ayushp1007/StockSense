import { asyncMap, asyncEvery, asyncForEach } from './async-collections.js';
import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import OpenAI from "openai";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { db, logAudit, nowIso, uuid } from "./db.js";
const isProduction = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
const jwtSecret = process.env.JWT_SECRET || (isProduction ? "" : "local-only-secret-change-before-deploy-2026");
if (isProduction && (jwtSecret.length < 32 || /replace|placeholder|local-only|change-before-deploy/i.test(jwtSecret))) {
    throw new Error("Set JWT_SECRET to a unique random value of at least 32 characters before production startup. Example secrets are rejected.");
}
if (isProduction && (await db.prepare("SELECT id FROM audit_logs WHERE action='demo_access_created' LIMIT 1").get())) {
    throw new Error("Production startup refused a demo database. Use a fresh database and the production company bootstrap command.");
}
let configuredOrigin: string | undefined;
if (process.env.APP_ORIGIN) {
    const url = new URL(process.env.APP_ORIGIN);
    if (url.origin !== process.env.APP_ORIGIN.replace(/\/$/, "") || (isProduction && url.protocol !== "https:")) {
        throw new Error("APP_ORIGIN must be your application's public origin, using HTTPS in production and no path.");
    }
    configuredOrigin = url.origin;
}
const PORT = Number(process.env.PORT || 4000);
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(helmet({
    contentSecurityPolicy: { directives: {
            defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"], fontSrc: ["'self'", "data:"], connectSrc: ["'self'"],
            objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"],
        } },
    crossOriginEmbedderPolicy: false,
}));
type User = {
    id: string;
    company_id: string;
    email: string;
    name: string;
    role: "admin" | "manager" | "staff";
    token_version?: number;
};
declare global {
    namespace Express {
        interface Request {
            user?: User;
        }
    }
}
class HttpError extends Error {
    constructor(public status: number, message: string, public code = "request_error") { super(message); }
}
// SameSite cookies are additional protection; explicit origin checks also stop
// sibling-domain CSRF and login/logout requests from an unrelated web page.
app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const queryEntries = Object.entries(req.query);
    if (queryEntries.length > 20 || queryEntries.some(([key, value]) => key.length > 64 || typeof value !== "string" || value.length > 500)) {
        return next(new HttpError(400, "Use one query value per field and keep search text within 500 characters.", "validation_error"));
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const expectedOrigin = configuredOrigin || `${req.protocol}://${req.get("host")}`;
        const origin = req.get("origin");
        if ((origin && origin !== expectedOrigin) || req.get("sec-fetch-site") === "cross-site") {
            return next(new HttpError(403, "This request did not come from this StockSense application. Refresh the page and try again.", "csrf_origin"));
        }
        // Non-browser clients can omit Origin. Browser requests must establish
        // same-origin through Origin or Fetch Metadata before mutating a session.
        if (!origin && req.get("sec-fetch-site") && req.get("sec-fetch-site") !== "same-origin" && req.get("sec-fetch-site") !== "none") {
            return next(new HttpError(403, "This request requires a same-origin browser session.", "csrf_origin"));
        }
    }
    next();
});
app.use(express.json({ limit: "40kb" }));
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const hashMatches = (left: string, right: string) => { const a = Buffer.from(left, "hex"), b = Buffer.from(right, "hex"); return a.length === b.length && timingSafeEqual(a, b); };
const getCookie = (req: Request, name: string) => {
    const entry = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    if (!entry)
        return undefined;
    try {
        return decodeURIComponent(entry.slice(name.length + 1));
    }
    catch {
        return undefined;
    }
};
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: isProduction, path: "/", maxAge: 8 * 60 * 60 * 1000 };
const auth = asyncRoute(async (req, _res, next) => {
    const token = getCookie(req, "stocksense_session");
    if (!token)
        throw new HttpError(401, "Please sign in to continue.", "unauthorized");
    let payload: jwt.JwtPayload;
    try {
        payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"], issuer: "stocksense" }) as jwt.JwtPayload;
    }
    catch {
        throw new HttpError(401, "Your session expired. Please sign in again.", "unauthorized");
    }
    if (typeof payload.sub !== "string" || !(await db.prepare("SELECT 1 FROM auth_sessions WHERE token_hash=? AND user_id=? AND revoked_at IS NULL AND expires_at>?").get(hash(token), payload.sub, nowIso()))) {
        throw new HttpError(401, "Your session ended. Please sign in again.", "session_revoked");
    }
    const user = (await db.prepare("SELECT id, company_id, email, name, role,token_version FROM users WHERE id=? AND active=1").get(payload.sub)) as User | undefined;
    if (!user)
        throw new HttpError(401, "This account is no longer active.", "unauthorized");
    if (Number(payload.ver || 0) !== Number(user.token_version || 0))
        throw new HttpError(401, "This session was revoked. Please sign in again.", "session_revoked");
    req.user = user;
    next();
});
const roles = (...allowed: User["role"][]) => (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !allowed.includes(req.user.role))
        return next(new HttpError(403, "Your role cannot perform this action.", "forbidden"));
    next();
};
const adminOnly = roles("admin");
const managers = roles("admin", "manager");
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many sign-in attempts. Try again in a few minutes." } });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 4, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Please wait before requesting another reset code." } });
const resetConfirmLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many reset attempts. Try again later." } });
const copilotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 25, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Copilot is taking a short break. Try again later." } });
const bodySchema = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
    const result = schema.safeParse(body);
    if (!result.success)
        throw new HttpError(400, result.error.issues[0]?.message || "Please review the submitted fields.", "validation_error");
    return result.data;
};
const passwordInput = z.string().min(12).max(128).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Passwords must be at most 72 UTF-8 bytes.");
const quantityInput = z.number().finite().min(0).max(1e9).refine((value) => value === Math.round(value * 1000) / 1000, "Use no more than three decimal places for quantities.");
const roundQuantity = (quantity: number) => Math.round(quantity * 1000) / 1000;
const rowGet = async <T>(stmt: string, params: unknown[]) => (await db.prepare(stmt).get(...params)) as T | undefined;
const countSnapshot = async (companyId: string, productIds: string[], locationId: string) => Object.fromEntries((await asyncMap([...productIds].sort(), async (productId) => [productId, Number((await rowGet<{
        revision: number;
    }>("SELECT COALESCE(MAX(rowid),0) AS revision FROM ledger WHERE company_id=? AND product_id=? AND location_id=?", [companyId, productId, locationId]))?.revision || 0)])));
const quantitiesFingerprint = (quantities: Array<{
    lineId: string;
    quantity: number;
}> | undefined) => hash(JSON.stringify(quantities === undefined ? null : [...quantities].sort((left, right) => left.lineId.localeCompare(right.lineId))));
const productCompany = async (user: User, productId: string) => (await rowGet<{
    id: string;
    name: string;
    unit: string;
}>("SELECT id,name,unit FROM products WHERE id=? AND company_id=? AND active=1", [productId, user.company_id]));
const locationValid = async (user: User, locationId: string) => !!(await rowGet<{
    id: string;
}>(user.role === "staff"
    ? "SELECT l.id FROM locations l JOIN user_locations ul ON ul.location_id=l.id WHERE l.id=? AND l.company_id=? AND l.active=1 AND ul.user_id=?"
    : "SELECT id FROM locations WHERE id=? AND company_id=? AND active=1", user.role === "staff" ? [locationId, user.company_id, user.id] : [locationId, user.company_id]));
const allowedLocations = async (user: User): Promise<string[] | undefined> => user.role === "staff"
    ? ((await db.prepare("SELECT location_id FROM user_locations WHERE user_id=?").all(user.id)) as Array<{
        location_id: string;
    }>).map((r) => r.location_id)
    : undefined;
const operationScope = async (user: User, alias = "o") => {
    if (user.role !== "staff")
        return { sql: "", params: [] as unknown[] };
    const ids = (await allowedLocations(user)) || [];
    if (!ids.length)
        return { sql: " AND 1=0", params: [] as unknown[] };
    const slots = ids.map(() => "?").join(",");
    return { sql: ` AND ${alias}.assigned_to_user_id=? AND (${alias}.source_location_id IS NULL OR ${alias}.source_location_id IN (${slots})) AND (${alias}.destination_location_id IS NULL OR ${alias}.destination_location_id IN (${slots}))`, params: [user.id, ...ids, ...ids] as unknown[] };
};
const pendingReviewCount = async (user: User) => {
    const scope = (await operationScope(user));
    return Number((await rowGet<{
        count: number;
    }>(`SELECT COUNT(*) AS count FROM operation_submissions s
    JOIN operations o ON o.id=s.operation_id AND o.company_id=s.company_id
    WHERE s.company_id=? AND s.status='pending' AND o.status IN ('ready','partial')${scope.sql}`, [user.company_id, ...scope.params]))?.count || 0);
};
const queryInventory = async (companyId: string, locationScope?: string[]): Promise<Array<Record<string, any>>> => {
    const products = (await db.prepare(`SELECT p.id,p.sku,p.name,p.unit,p.reorder_point,p.lead_days,p.description,p.category_id,
      c.name AS category,c.color AS category_color, COALESCE(SUM(s.quantity),0) AS total
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    LEFT JOIN stock_balances s ON s.product_id=p.id
    WHERE p.company_id=? AND p.active=1 GROUP BY p.id ORDER BY p.name`).all(companyId)) as Array<Record<string, any>>;
    const locationRows = (await db.prepare(`SELECT p.id AS product_id,l.id AS location_id,l.name AS location,l.code,COALESCE(s.quantity,0) AS quantity,
      COALESCE((SELECT SUM(rv.quantity) FROM reservations rv WHERE rv.product_id=p.id AND rv.location_id=l.id AND rv.company_id=p.company_id),0) AS reserved,
      COALESCE(r.reorder_point,0) AS reorder_point
    FROM products p JOIN locations l ON l.company_id=p.company_id AND l.active=1
    LEFT JOIN stock_balances s ON s.product_id=p.id AND s.location_id=l.id
    LEFT JOIN location_reorder_rules r ON r.product_id=p.id AND r.location_id=l.id
    WHERE p.company_id=? AND p.active=1 ORDER BY l.name`).all(companyId)) as Array<Record<string, any>>;
    const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const usageScope = locationScope === undefined ? "" : locationScope.length ? ` AND le.location_id IN (${locationScope.map(() => "?").join(",")})` : " AND 1=0";
    const usageRows = (await db.prepare(`SELECT le.product_id, SUM(ABS(le.delta)) AS quantity, COUNT(*) AS movements,
      MIN(le.created_at) AS first_at
    FROM ledger le JOIN operations o ON o.id=le.operation_id
    WHERE le.company_id=? AND o.type='delivery' AND le.delta<0 AND le.created_at>=?${usageScope}
    GROUP BY le.product_id`).all(companyId, cutoff30, ...(locationScope || []))) as Array<Record<string, any>>;
    const usageByProduct = new Map(usageRows.map((row) => [row.product_id, row]));
    const locationsByProduct = new Map<string, Array<{
        id: string;
        name: string;
        code: string;
        quantity: number;
        reserved: number;
        available: number;
        reorder_point: number;
    }>>();
    for (const row of locationRows.filter((r) => !locationScope || locationScope.includes(r.location_id))) {
        const list = locationsByProduct.get(row.product_id) || [];
        const quantity = roundQuantity(Number(row.quantity)), reserved = roundQuantity(Number(row.reserved));
        list.push({ id: row.location_id, name: row.location, code: row.code, quantity, reserved, available: Math.max(0, roundQuantity(quantity - reserved)), reorder_point: Number(row.reorder_point) });
        locationsByProduct.set(row.product_id, list);
    }
    return products.map((p) => {
        const locations = locationsByProduct.get(p.id) || [];
        const total = roundQuantity(locationScope ? locations.reduce((sum, loc) => sum + loc.quantity, 0) : Number(p.total));
        const reserved = roundQuantity(locations.reduce((sum, loc) => sum + loc.reserved, 0));
        const available = Math.max(0, roundQuantity(total - reserved));
        const reorderPoint = locationScope ? locations.reduce((sum, loc) => sum + loc.reorder_point, 0) : Number(p.reorder_point);
        const usage = usageByProduct.get(p.id);
        const daily = usage ? Number(usage.quantity) / 30 : 0;
        const hasHistory = !!usage && Number(usage.movements) >= 3 && Date.now() - Date.parse(usage.first_at) >= 14 * 86400000;
        const daysCover = daily > 0 ? available / daily : null;
        const leadProjection = daily > 0 ? available - daily * Number(p.lead_days) : available;
        const reorderSuggestion = hasHistory
            ? Math.max(0, Math.ceil((reorderPoint + daily * Number(p.lead_days) - available) * 10) / 10)
            : Math.max(0, Math.ceil((reorderPoint - available) * 10) / 10);
        const stockStatus = available <= 0 ? "out" : available <= reorderPoint ? "low" : "healthy";
        return { ...p, total, reserved, available, reorder_point: reorderPoint, lead_days: Number(p.lead_days), locations,
            dailyUsage: daily, movementCount30d: Number(usage?.movements || 0), enoughHistory: hasHistory, daysCover,
            stockoutDays: daysCover, leadProjection, reorderSuggestion, status: stockStatus,
            risk: stockStatus === "out" || (daysCover !== null && daysCover <= Number(p.lead_days)) ? "high" : stockStatus === "low" || (daysCover !== null && daysCover <= Number(p.lead_days) + 14) ? "watch" : "normal" };
    });
};
const opSelect = `SELECT o.*, sl.name AS source_name, dl.name AS destination_name, u.name AS created_by_name, au.name AS assigned_to_name
  FROM operations o LEFT JOIN locations sl ON sl.id=o.source_location_id
  LEFT JOIN locations dl ON dl.id=o.destination_location_id JOIN users u ON u.id=o.created_by LEFT JOIN users au ON au.id=o.assigned_to_user_id`;
const operationById = async (companyId: string, id: string): Promise<Record<string, any> | undefined> => {
    const op = (await rowGet<Record<string, any>>(`${opSelect} WHERE o.id=? AND o.company_id=?`, [id, companyId]));
    if (!op)
        return undefined;
    const lines = (await db.prepare(`SELECT ol.*,p.name AS product_name,p.sku,p.unit,COALESCE((SELECT r.quantity FROM reservations r WHERE r.operation_line_id=ol.id),0) AS reserved_qty FROM operation_lines ol
    JOIN products p ON p.id=ol.product_id WHERE ol.operation_id=? ORDER BY ol.position`).all(id)) as Array<Record<string, any>>;
    const submission = (await rowGet<Record<string, any>>("SELECT s.*,u.name AS submitted_by_name FROM operation_submissions s JOIN users u ON u.id=s.submitted_by WHERE s.operation_id=? ORDER BY s.created_at DESC LIMIT 1", [id]));
    const countVersion = op.type === "adjustment" ? hash(JSON.stringify((await countSnapshot(companyId, lines.map((line) => line.product_id), op.source_location_id)))) : undefined;
    // Cancellation closes a report's review queue while retaining the original
    // submitted record for history; it does not imply approval of its quantities.
    return { ...op, countVersion, submission: submission ? { ...submission, status: effectiveSubmissionStatus(submission, op.status), quantities: JSON.parse(submission.quantities_json) } : null,
        lines: lines.map((line) => ({ ...line, planned_qty: Number(line.planned_qty), completed_qty: Number(line.completed_qty) })) };
};
const operationForUser = (user: User, operation: Record<string, any> | undefined) => {
    if (!operation || user.role !== "staff")
        return operation;
    return { ...operation, count_snapshot_json: undefined, submission: publicSubmission(operation.submission), lines: operation.lines.map((line: Record<string, any>) => ({ ...line, planned_qty: operation.type === "adjustment" ? undefined : line.planned_qty })) };
};
const effectiveSubmissionStatus = (submission: Record<string, any>, operationStatus?: string) => operationStatus === "canceled" && ["pending", "needs_action"].includes(submission.status) ? "canceled" : submission.status;
const publicSubmission = (submission: Record<string, any> | null | undefined, operationStatus?: string) => submission ? { ...submission, status: effectiveSubmissionStatus(submission, operationStatus), count_snapshot_json: undefined, request_hash: undefined } : submission;
const routeId = (req: Request): string => String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id || "");
const getAnomalies = async (companyId: string) => {
    const alerts: Array<Record<string, unknown>> = [];
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const adjustments = (await db.prepare(`SELECT le.product_id,le.location_id,p.name,p.sku,p.unit,l.name AS location,
      COUNT(*) AS count,SUM(ABS(le.delta)) AS corrected,MAX(le.created_at) AS latest
    FROM ledger le JOIN operations o ON o.id=le.operation_id JOIN products p ON p.id=le.product_id JOIN locations l ON l.id=le.location_id
    WHERE le.company_id=? AND o.type='adjustment' AND le.created_at>=? GROUP BY le.product_id,le.location_id HAVING COUNT(*)>=2 OR SUM(ABS(le.delta))>=25`).all(companyId, since)) as Array<Record<string, any>>;
    for (const row of adjustments)
        alerts.push({ id: `adjustment-${row.product_id}-${row.location_id}`, type: "adjustment", severity: Number(row.corrected) >= 50 ? "high" : "medium",
            title: Number(row.count) >= 2 ? "Repeated stock corrections" : "Large stock correction", detail: `${row.count} count corrections changed ${row.corrected} ${row.unit} over 14 days.`,
            product: row.name, sku: row.sku, location: row.location, evidence: { corrections: Number(row.count), quantity: Number(row.corrected), latest: row.latest } });
    const discrepancies = (await db.prepare(`SELECT o.id,o.reference,o.partner,p.name,p.unit,ol.planned_qty,ol.completed_qty,o.updated_at,
      COALESCE(dl.name,'') AS location FROM operations o JOIN operation_lines ol ON ol.operation_id=o.id
    JOIN products p ON p.id=ol.product_id LEFT JOIN locations dl ON dl.id=o.destination_location_id
    WHERE o.company_id=? AND o.type='receipt' AND o.status='done' AND ol.completed_qty<ol.planned_qty*0.8 AND ol.planned_qty>0
    ORDER BY o.updated_at DESC LIMIT 10`).all(companyId)) as Array<Record<string, any>>;
    for (const row of discrepancies)
        alerts.push({ id: `receipt-${row.id}`, type: "receipt", severity: "medium", title: "Receipt below expected quantity",
            detail: `${row.reference} closed at ${row.completed_qty} of ${row.planned_qty} ${row.unit}.`, product: row.name, reference: row.reference,
            location: row.location, evidence: { planned: Number(row.planned_qty), received: Number(row.completed_qty), partner: row.partner } });
    return alerts.sort((a, b) => (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1));
};
const recommendationFacts = async (companyId: string, locationScope?: string[]) => (await queryInventory(companyId, locationScope)).sort((a, b) => {
    const av = a.daysCover === null ? Infinity : a.daysCover;
    const bv = b.daysCover === null ? Infinity : b.daysCover;
    return av - bv;
});
app.get("/api/health", (_req, res) => res.json({ status: "ok", app: "StockSense", time: nowIso() }));
app.get("/api/public-config", (_req, res) => res.json({ demo: process.env.APP_ENV === "demo" && !isProduction }));
app.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
    const data = bodySchema(z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Passwords must be at most 72 UTF-8 bytes.") }), req.body);
    const users = (await db.prepare("SELECT * FROM users WHERE lower(email)=lower(?) AND active=1").all(data.email.trim())) as Array<User & {
        password_hash: string;
    }>;
    // Use one password comparison for both unknown and known email addresses.
    // Ambiguous legacy emails need an administrator to fix the account record.
    const candidate = users.length === 1 ? users[0] : undefined;
    const valid = await bcrypt.compare(data.password, candidate?.password_hash || "$2b$12$kSu6mbAWyfFE5wzSZrQTWuaKbRmWpSjMrDp8TwwHwju10knhdawvy");
    const match = valid ? candidate : undefined;
    if (!match)
        throw new HttpError(401, "Email or password does not match.", "invalid_credentials");
    const token = jwt.sign({ sub: match.id, role: match.role, ver: match.token_version }, jwtSecret, { algorithm: "HS256", expiresIn: "8h", issuer: "stocksense", jwtid: uuid() });
    const at = nowIso();
    (await db.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").run(at));
    (await db.prepare("INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").run(hash(token), match.id, at, new Date(Date.now() + cookieOptions.maxAge).toISOString()));
    res.cookie("stocksense_session", token, cookieOptions);
    (await logAudit(match.company_id, match.id, "signed_in", "user", match.id));
    res.json({ user: { id: match.id, email: match.email, name: match.name, role: match.role } });
}));
app.post("/api/auth/logout", async (req, res) => {
    const token = getCookie(req, "stocksense_session");
    if (token)
        (await db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").run(nowIso(), hash(token)));
    res.clearCookie("stocksense_session", { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/" });
    res.json({ ok: true });
});
app.get("/api/auth/me", auth, (req, res) => res.json({ user: { id: req.user!.id, email: req.user!.email, name: req.user!.name, role: req.user!.role }, demo: process.env.APP_ENV === "demo" && !isProduction }));
app.post("/api/auth/password-reset/request", resetLimiter, asyncRoute(async (req, res) => {
    const data = bodySchema(z.object({ email: z.string().email().max(254) }), req.body);
    if (isProduction && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM))
        throw new HttpError(503, "Password reset email is not configured. Contact your workspace administrator.", "email_unavailable");
    const accounts = (await db.prepare("SELECT id,company_id,email,name,role FROM users WHERE lower(email)=lower(?) AND active=1").all(data.email.trim())) as User[];
    const user = accounts.length === 1 ? accounts[0] : undefined;
    const generic = { message: "If an active account uses that email, a one-time code has been sent." };
    if (!user)
        return res.json(generic);
    const recent = (await rowGet<{
        id: string;
    }>("SELECT id FROM password_resets WHERE user_id=? AND created_at>? ORDER BY created_at DESC LIMIT 1", [user.id, new Date(Date.now() - 60000).toISOString()]));
    if (recent)
        return res.json(generic);
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const tx = db.transaction(async () => {
        (await db.prepare("UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL").run(nowIso(), user.id));
        (await db.prepare("INSERT INTO password_resets(id,user_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)").run(uuid(), user.id, hash(code), expiresAt, nowIso()));
    });
    (await tx());
    if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
        // Complete the HTTP response before contacting the email provider, so account
        // existence is not disclosed through delivery latency or provider failures.
        res.json(generic);
        try {
            const mail = await fetch("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [user.email], subject: "Your StockSense reset code", text: `Your reset code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.` }) });
            if (!mail.ok)
                console.error("Password reset email delivery failed:", mail.status);
        }
        catch {
            console.error("Password reset email delivery failed or timed out.");
        }
        return;
    }
    if (!isProduction && process.env.APP_ENV === "demo")
        return res.json({ ...generic, devCode: code });
    return res.json(generic);
}));
app.post("/api/auth/password-reset/confirm", resetConfirmLimiter, asyncRoute(async (req, res) => {
    const data = bodySchema(z.object({ email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/), password: passwordInput }), req.body);
    const accounts = (await db.prepare("SELECT id,company_id,email,name,role FROM users WHERE lower(email)=lower(?) AND active=1").all(data.email.trim())) as User[];
    const user = accounts.length === 1 ? accounts[0] : undefined;
    if (!user)
        throw new HttpError(400, "That reset code is invalid or has expired.", "invalid_reset_code");
    const reset = (await rowGet<{
        id: string;
        code_hash: string;
        expires_at: string;
        attempts: number;
    }>("SELECT id,code_hash,expires_at,attempts FROM password_resets WHERE user_id=? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1", [user.id]));
    if (!reset || reset.expires_at < nowIso() || reset.attempts >= 5)
        throw new HttpError(400, "That reset code is invalid or has expired.", "invalid_reset_code");
    if (!hashMatches(reset.code_hash, hash(data.code))) {
        const attempts = reset.attempts + 1;
        (await db.prepare("UPDATE password_resets SET attempts=?,used_at=CASE WHEN ?>=5 THEN ? ELSE used_at END WHERE id=?").run(attempts, attempts, nowIso(), reset.id));
        throw new HttpError(400, "That reset code is invalid or has expired.", "invalid_reset_code");
    }
    const passwordHash = await bcrypt.hash(data.password, 12);
    const tx = db.transaction(async () => {
        const consumed = (await db.prepare("UPDATE password_resets SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>? AND attempts<5").run(nowIso(), reset.id, nowIso()));
        if (!consumed.changes)
            throw new HttpError(400, "That reset code is invalid or has expired.", "invalid_reset_code");
        (await db.prepare("UPDATE users SET password_hash=?,token_version=token_version+1 WHERE id=?").run(passwordHash, user.id));
        (await db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(nowIso(), user.id));
        (await logAudit(user.company_id, user.id, "password_reset", "user", user.id));
    });
    (await tx());
    res.json({ message: "Password updated. You can sign in now." });
}));
app.get("/api/meta", auth, async (req, res) => {
    const user = req.user!;
    const locationIds = (await allowedLocations(user));
    const locations = locationIds === undefined
        ? (await db.prepare("SELECT id,name,code,kind,parent_id FROM locations WHERE company_id=? AND active=1 ORDER BY name").all(user.company_id)) : (await db.prepare(`SELECT id,name,code,kind,parent_id FROM locations WHERE company_id=? AND active=1 AND id IN (${locationIds.map(() => "?").join(",") || "NULL"}) ORDER BY name`).all(user.company_id, ...locationIds));
    const categories = (await db.prepare("SELECT id,name,color FROM categories WHERE company_id=? ORDER BY name").all(user.company_id));
    const company = (await rowGet<{
        name: string;
    }>("SELECT name FROM companies WHERE id=?", [user.company_id]));
    const users = user.role === "admin" ? (await asyncMap(((await db.prepare("SELECT id,email,name,role,active,created_at FROM users WHERE company_id=? ORDER BY name").all(user.company_id)) as Array<Record<string, any>>), async (member) => ({ ...member,
        locationIds: ((await db.prepare("SELECT location_id FROM user_locations WHERE user_id=? ORDER BY location_id").all(member.id)) as Array<{
            location_id: string;
        }>).map((r) => r.location_id) }))) : undefined;
    const assignees = user.role === "staff" ? [] : (await db.prepare("SELECT id,name FROM users WHERE company_id=? AND role='staff' AND active=1 ORDER BY name").all(user.company_id));
    res.json({ locations, categories, company, users, assignees, demo: process.env.APP_ENV === "demo" && !isProduction, aiEnabled: !!process.env.OPENAI_API_KEY });
});
app.post("/api/users", auth, adminOnly, asyncRoute(async (req, res) => {
    const data = bodySchema(z.object({ email: z.string().email().max(254), name: z.string().trim().min(2).max(100), role: z.enum(["admin", "manager", "staff"]), password: passwordInput, locationIds: z.array(z.string().uuid()).max(100).default([]) }), req.body);
    if (new Set(data.locationIds).size !== data.locationIds.length)
        throw new HttpError(400, "Each warehouse can be assigned only once.");
    if ((await db.prepare("SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1").get(data.email.trim())))
        throw new HttpError(409, "An account already uses that email.", "duplicate_email");
    if (data.role === "staff" && !data.locationIds.length)
        throw new HttpError(400, "Assign at least one warehouse to a warehouse staff account.");
    if (data.role !== "staff" && data.locationIds.length)
        throw new HttpError(400, "Warehouse assignments apply to warehouse staff accounts.");
    for (const id of data.locationIds)
        if (!(await locationValid({ ...req.user!, role: "admin" }, id)))
            throw new HttpError(400, "Choose warehouses in this company.");
    const id = uuid();
    const passwordHash = await bcrypt.hash(data.password, 12);
    try {
        const tx = db.transaction(async () => {
            if ((await db.prepare("SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1").get(data.email.trim())))
                throw new HttpError(409, "An account already uses that email.", "duplicate_email");
            (await db.prepare("INSERT INTO users(id,company_id,email,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?,?)")
                .run(id, req.user!.company_id, data.email.trim().toLowerCase(), data.name, data.role, passwordHash, nowIso()));
            const assign = db.prepare("INSERT INTO user_locations(user_id,location_id,assigned_at) VALUES(?,?,?)");
            for (const locationId of data.locationIds)
                (await assign.run(id, locationId, nowIso()));
            (await logAudit(req.user!.company_id, req.user!.id, "user_created", "user", id, { role: data.role, locationIds: data.locationIds }));
        });
        (await tx());
    }
    catch (error: any) {
        if (String(error?.message).includes("UNIQUE"))
            throw new HttpError(409, "That email is already in this workspace.", "duplicate_email");
        throw error;
    }
    res.status(201).json({ user: { id, email: data.email.trim().toLowerCase(), name: data.name, role: data.role } });
}));
app.patch("/api/users/:id/status", auth, adminOnly, async (req, res) => {
    const data = bodySchema(z.object({ active: z.boolean() }), req.body);
    const id = routeId(req);
    if (id === req.user!.id && !data.active)
        throw new HttpError(400, "You cannot deactivate your own account.");
    if (!data.active && (await rowGet<{
        role: string;
    }>("SELECT role FROM users WHERE id=? AND company_id=?", [id, req.user!.company_id]))?.role === "admin") {
        const activeAdmins = (await rowGet<{
            count: number;
        }>("SELECT COUNT(*) AS count FROM users WHERE company_id=? AND role='admin' AND active=1", [req.user!.company_id]))?.count || 0;
        if (activeAdmins <= 1)
            throw new HttpError(409, "The workspace needs at least one active administrator.", "last_admin");
    }
    const result = (await db.prepare("UPDATE users SET active=?,token_version=token_version+1 WHERE id=? AND company_id=?").run(data.active ? 1 : 0, id, req.user!.company_id));
    if (!result.changes)
        throw new HttpError(404, "That user could not be found.", "not_found");
    (await logAudit(req.user!.company_id, req.user!.id, data.active ? "user_activated" : "user_deactivated", "user", id));
    res.json({ ok: true });
});
app.put("/api/users/:id/locations", auth, adminOnly, async (req, res) => {
    const data = bodySchema(z.object({ locationIds: z.array(z.string().uuid()).min(1).max(100) }), req.body);
    const id = routeId(req);
    if (new Set(data.locationIds).size !== data.locationIds.length)
        throw new HttpError(400, "Each warehouse can be assigned only once.");
    const target = (await rowGet<{
        role: string;
    }>("SELECT role FROM users WHERE id=? AND company_id=?", [id, req.user!.company_id]));
    if (!target)
        throw new HttpError(404, "That user could not be found.", "not_found");
    if (target.role !== "staff")
        throw new HttpError(400, "Warehouse assignments are only used for staff accounts.");
    for (const locationId of data.locationIds)
        if (!(await locationValid({ ...req.user!, role: "admin" }, locationId)))
            throw new HttpError(400, "Choose warehouses in this company.");
    const tx = db.transaction(async () => { (await db.prepare("DELETE FROM user_locations WHERE user_id=?").run(id)); const assign = db.prepare("INSERT INTO user_locations(user_id,location_id,assigned_at) VALUES(?,?,?)"); for (const locationId of data.locationIds)
        (await assign.run(id, locationId, nowIso())); (await db.prepare("UPDATE users SET token_version=token_version+1 WHERE id=?").run(id)); (await logAudit(req.user!.company_id, req.user!.id, "warehouse_access_updated", "user", id, { locationIds: data.locationIds })); });
    (await tx());
    res.json({ ok: true });
});
app.post("/api/users/:id/revoke-sessions", auth, adminOnly, async (req, res) => { const id = routeId(req); const result = (await db.prepare("UPDATE users SET token_version=token_version+1 WHERE id=? AND company_id=?").run(id, req.user!.company_id)); if (!result.changes)
    throw new HttpError(404, "That user could not be found.", "not_found"); (await logAudit(req.user!.company_id, req.user!.id, "sessions_revoked", "user", id)); res.json({ ok: true }); });
app.get("/api/admin/overview", auth, adminOnly, async (req, res) => {
    const user = req.user!, products = (await queryInventory(user.company_id));
    const roles = (await db.prepare("SELECT role,COUNT(*) AS count FROM users WHERE company_id=? AND active=1 GROUP BY role").all(user.company_id));
    const pendingReview = (await pendingReviewCount(user));
    const openOperations = (await rowGet<{
        count: number;
    }>("SELECT COUNT(*) AS count FROM operations WHERE company_id=? AND status IN ('draft','ready','partial')", [user.company_id]))?.count || 0;
    const activity = (await db.prepare(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.metadata,a.created_at,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.company_id=? ORDER BY a.created_at DESC LIMIT 12`).all(user.company_id)) as Array<Record<string, any>>;
    res.json({ metrics: { activeUsers: (await rowGet<{
                count: number;
            }>("SELECT COUNT(*) AS count FROM users WHERE company_id=? AND active=1", [user.company_id]))?.count || 0, locations: (await rowGet<{
                count: number;
            }>("SELECT COUNT(*) AS count FROM locations WHERE company_id=? AND active=1", [user.company_id]))?.count || 0, products: products.length, lowStock: products.filter((p) => p.status === "low").length, outOfStock: products.filter((p) => p.status === "out").length, openOperations, pendingReview, ledgerEntries: (await rowGet<{
                count: number;
            }>("SELECT COUNT(*) AS count FROM ledger WHERE company_id=?", [user.company_id]))?.count || 0 }, roles, activity: activity.map((a) => ({ ...a, metadata: JSON.parse(a.metadata || "{}") })) });
});
app.get("/api/admin/audit", auth, adminOnly, async (req, res) => {
    const user = req.user!, q = String(req.query.q || "").trim().toLowerCase();
    const rows = (await db.prepare(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.metadata,a.created_at,u.name AS actor,u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.company_id=? AND (?='' OR lower(a.action) LIKE ? OR lower(a.entity_type) LIKE ? OR lower(COALESCE(u.name,'')) LIKE ?) ORDER BY a.created_at DESC LIMIT 250`).all(user.company_id, q, `%${q}%`, `%${q}%`, `%${q}%`)) as Array<Record<string, any>>;
    res.json({ items: rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata || "{}") })) });
});
const csvCell = (value: unknown) => { let text = String(value ?? ""); if (/^[\s\u0000-\u001f]*[=+@\-]/.test(text) || /^[\t\r\n]/.test(text))
    text = "'" + text; return `"${text.replace(/"/g, '""')}"`; };
app.get("/api/admin/audit.csv", auth, adminOnly, async (req, res) => {
    const user = req.user!;
    const rows = (await db.prepare(`SELECT a.created_at,u.name AS actor,a.action,a.entity_type,a.entity_id,a.metadata FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.company_id=? ORDER BY a.created_at DESC LIMIT 5000`).all(user.company_id)) as Array<Record<string, any>>;
    const content = [["Timestamp", "Actor", "Action", "Entity type", "Entity ID", "Metadata"], ...rows.map((r) => [r.created_at, r.actor, r.action, r.entity_type, r.entity_id, r.metadata])].map((row) => row.map(csvCell).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=stocksense-audit.csv");
    res.send("\uFEFF" + content);
});
app.get("/api/reports/inventory.csv", auth, managers, async (req, res) => {
    const user = req.user!;
    const products = (await queryInventory(user.company_id));
    const rows = products.flatMap((p) => p.locations.map((l: any) => [p.sku, p.name, p.category, p.unit, l.name, l.quantity, l.reserved, l.available, l.reorder_point, p.status, p.lead_days, p.dailyUsage, p.reorderSuggestion]));
    const content = [["SKU", "Product", "Category", "Unit", "Location", "On hand", "Reserved", "Available", "Location reorder point", "Stock status", "Lead days", "30 day daily usage", "Suggested reorder"], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=stocksense-inventory-report.csv");
    res.send("\uFEFF" + content);
});
app.get("/api/suppliers", auth, managers, async (req, res) => { const items = (await db.prepare("SELECT id,name,contact_name,email,phone,active,created_at FROM suppliers WHERE company_id=? ORDER BY name").all(req.user!.company_id)); res.json({ items }); });
app.post("/api/suppliers", auth, managers, async (req, res) => { const user = req.user!, data = bodySchema(z.object({ name: z.string().trim().min(2).max(100), contactName: z.string().trim().max(100).default(""), email: z.union([z.string().email().max(254), z.literal("")]).default(""), phone: z.string().trim().max(40).default("") }), req.body); const id = uuid(); try {
    (await db.prepare("INSERT INTO suppliers(id,company_id,name,contact_name,email,phone,created_at) VALUES(?,?,?,?,?,?,?)").run(id, user.company_id, data.name, data.contactName, data.email, data.phone, nowIso()));
}
catch (error: any) {
    if (String(error?.message).includes("UNIQUE"))
        throw new HttpError(409, "That supplier already exists.", "duplicate_supplier");
    throw error;
} (await logAudit(user.company_id, user.id, "supplier_created", "supplier", id)); res.status(201).json({ supplier: { id, ...data, active: 1 } }); });
app.get("/api/dashboard", auth, async (req, res) => {
    const user = req.user!;
    const scope = (await allowedLocations(user));
    const products = (await queryInventory(user.company_id, scope));
    const opScope = (await operationScope(user));
    const ops = (await db.prepare(`${opSelect} WHERE o.company_id=? AND o.status IN ('draft','ready','partial')${opScope.sql} ORDER BY CASE o.status WHEN 'partial' THEN 0 WHEN 'ready' THEN 1 ELSE 2 END,o.expected_on LIMIT 6`).all(user.company_id, ...opScope.params));
    const openCounts = (await db.prepare(`SELECT o.type,COUNT(*) AS count FROM operations o WHERE o.company_id=? AND o.status IN ('draft','ready','partial')${opScope.sql} GROUP BY o.type`).all(user.company_id, ...opScope.params)) as Array<{
        type: string;
        count: number;
    }>;
    const pendingReview = (await pendingReviewCount(user));
    const countOf = (type: string) => Number(openCounts.find((row) => row.type === type)?.count || 0);
    const recent = (await db.prepare(`${opSelect} WHERE o.company_id=?${opScope.sql} ORDER BY o.updated_at DESC LIMIT 6`).all(user.company_id, ...opScope.params));
    const scopeWhere = scope === undefined ? "" : scope.length ? ` AND location_id IN (${scope.map(() => "?").join(",")})` : " AND 1=0";
    const daily = (await db.prepare(`SELECT substr(created_at,1,10) AS day,COUNT(*) AS events,SUM(CASE WHEN delta>0 THEN delta ELSE 0 END) AS incoming,
    SUM(CASE WHEN delta<0 THEN ABS(delta) ELSE 0 END) AS outgoing FROM ledger WHERE company_id=? AND created_at>=?${scopeWhere} GROUP BY substr(created_at,1,10)`)
        .all(user.company_id, new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), ...(scope || []))) as Array<Record<string, any>>;
    const dailyMap = new Map(daily.map((r) => [r.day, r]));
    const activity = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(Date.now() - (6 - i) * 86400000);
        const key = d.toISOString().slice(0, 10);
        const row = dailyMap.get(key);
        return { date: key, label: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }), events: Number(row?.events || 0), incoming: Number(row?.incoming || 0), outgoing: Number(row?.outgoing || 0) };
    });
    const anomalies = user.role === "staff" ? [] : (await getAnomalies(user.company_id));
    res.json({ metrics: { stockedSkus: products.filter((p) => p.total > 0).length,
            lowProducts: products.filter((p) => p.status === "low").length, outProducts: products.filter((p) => p.status === "out").length,
            lowLocations: products.reduce((n, p) => n + p.locations.filter((l: any) => l.available > 0 && l.available <= l.reorder_point).length, 0),
            pendingReceipts: countOf("receipt"), pendingDeliveries: countOf("delivery"), openTransfers: countOf("transfer"),
            anomalyCount: anomalies.length, pendingReview },
        watchlist: products.filter((p) => p.status !== "healthy" || p.risk === "high").sort((a, b) => (a.daysCover ?? Infinity) - (b.daysCover ?? Infinity)).slice(0, 5),
        recommendations: (await recommendationFacts(user.company_id, scope)).filter((p) => p.available <= p.reorder_point || p.risk !== "normal").slice(0, 5),
        operations: ops, recentOperations: recent, activity, anomalies: anomalies.slice(0, 4) });
});
app.get("/api/inventory", auth, async (req, res) => {
    const user = req.user!;
    const q = String(req.query.q || "").trim().toLocaleLowerCase();
    const category = String(req.query.category || "");
    const status = String(req.query.status || "all");
    const location = String(req.query.location || "");
    const items = (await queryInventory(user.company_id, (await allowedLocations(user)))).filter((p) => {
        const searchMatch = !q || `${p.name} ${p.sku} ${p.category}`.toLocaleLowerCase().includes(q);
        const categoryMatch = !category || p.category_id === category;
        const statusMatch = status === "all" || status === p.status || (status === "attention" && p.status !== "healthy");
        const locationMatch = !location || p.locations.some((l: any) => l.id === location);
        return searchMatch && categoryMatch && statusMatch && locationMatch;
    });
    res.json({ items });
});
app.get("/api/products/:id", auth, async (req, res) => {
    const user = req.user!;
    const product = (await queryInventory(user.company_id, (await allowedLocations(user)))).find((p) => p.id === routeId(req));
    if (!product)
        throw new HttpError(404, "That product could not be found.", "not_found");
    const movements = (await db.prepare(`SELECT le.id,le.delta,le.balance_before,le.balance_after,le.reason,le.created_at,le.location_id,
      l.name AS location,l.code,o.reference,o.type,o.status,u.name AS actor
    FROM ledger le JOIN locations l ON l.id=le.location_id LEFT JOIN operations o ON o.id=le.operation_id LEFT JOIN users u ON u.id=le.actor_id
    WHERE le.company_id=? AND le.product_id=?${user.role === "staff" ? ((await allowedLocations(user))?.length ? ` AND le.location_id IN (${(await allowedLocations(user))!.map(() => "?").join(",")})` : " AND 1=0") : ""} ORDER BY le.created_at DESC LIMIT 30`).all(user.company_id, product.id, ...(user.role === "staff" ? ((await allowedLocations(user)) || []) : [])));
    res.json({ product, movements });
});
const productInput = z.object({ name: z.string().trim().min(2).max(120), sku: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9._/-]+$/),
    categoryId: z.string().uuid().nullable().optional(), unit: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9%._-]+$/), reorderPoint: quantityInput,
    leadDays: z.number().int().min(0).max(365), description: z.string().trim().max(500).optional(), initialQuantity: quantityInput.optional(), locationId: z.string().uuid().optional() });
app.post("/api/products", auth, managers, asyncRoute(async (req, res) => {
    const data = bodySchema(productInput, req.body);
    const user = req.user!;
    if (data.categoryId && !(await rowGet("SELECT id FROM categories WHERE id=? AND company_id=?", [data.categoryId, user.company_id])))
        throw new HttpError(400, "Choose a category in this company.");
    if ((data.initialQuantity || 0) > 0 && (!data.locationId || !(await locationValid(user, data.locationId))))
        throw new HttpError(400, "Choose a valid location for the opening stock.");
    const id = uuid();
    const at = nowIso();
    try {
        const tx = db.transaction(async () => {
            (await db.prepare("INSERT INTO products(id,company_id,category_id,name,sku,unit,reorder_point,lead_days,description,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
                .run(id, user.company_id, data.categoryId || null, data.name, data.sku.toUpperCase(), data.unit, data.reorderPoint, data.leadDays, data.description || "", at));
            if ((data.initialQuantity || 0) > 0) {
                (await db.prepare("INSERT INTO stock_balances(product_id,location_id,quantity,updated_at) VALUES(?,?,?,?)").run(id, data.locationId, data.initialQuantity, at));
                (await db.prepare("INSERT INTO ledger(id,company_id,product_id,location_id,delta,balance_before,balance_after,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
                    .run(uuid(), user.company_id, id, data.locationId, data.initialQuantity, 0, data.initialQuantity, user.id, "Opening stock", at));
            }
            (await logAudit(user.company_id, user.id, "product_created", "product", id, { sku: data.sku.toUpperCase() }));
        });
        (await tx());
    }
    catch (error: any) {
        if (String(error?.message).includes("UNIQUE"))
            throw new HttpError(409, "That SKU is already in use.", "duplicate_sku");
        throw error;
    }
    res.status(201).json({ product: (await queryInventory(user.company_id)).find((p) => p.id === id) });
}));
app.put("/api/products/:id", auth, managers, asyncRoute(async (req, res) => {
    const data = bodySchema(productInput.omit({ initialQuantity: true, locationId: true }), req.body);
    const user = req.user!;
    const product = (await rowGet<Record<string, any>>("SELECT * FROM products WHERE id=? AND company_id=? AND active=1", [routeId(req), user.company_id]));
    if (!product)
        throw new HttpError(404, "That product could not be found.", "not_found");
    if (data.categoryId && !(await rowGet("SELECT id FROM categories WHERE id=? AND company_id=?", [data.categoryId, user.company_id])))
        throw new HttpError(400, "Choose a category in this company.");
    if (data.unit !== product.unit && ((await rowGet("SELECT id FROM ledger WHERE product_id=? LIMIT 1", [product.id])) || (await rowGet("SELECT id FROM operation_lines WHERE product_id=? LIMIT 1", [product.id]))))
        throw new HttpError(409, "Unit cannot change after the product is used by a stock operation.", "unit_locked");
    try {
        (await db.prepare("UPDATE products SET category_id=?,name=?,sku=?,unit=?,reorder_point=?,lead_days=?,description=? WHERE id=? AND company_id=?")
            .run(data.categoryId || null, data.name, data.sku.toUpperCase(), data.unit, data.reorderPoint, data.leadDays, data.description || "", product.id, user.company_id));
    }
    catch (error: any) {
        if (String(error?.message).includes("UNIQUE"))
            throw new HttpError(409, "That SKU is already in use.", "duplicate_sku");
        throw error;
    }
    (await logAudit(user.company_id, user.id, "product_updated", "product", product.id, { sku: data.sku.toUpperCase() }));
    res.json({ product: (await queryInventory(user.company_id)).find((p) => p.id === product.id) });
}));
app.delete("/api/products/:id", auth, adminOnly, async (req, res) => {
    const product = (await productCompany(req.user!, routeId(req)));
    if (!product)
        throw new HttpError(404, "That product could not be found.", "not_found");
    if ((await rowGet("SELECT 1 FROM stock_balances WHERE product_id=? AND quantity>0 LIMIT 1", [product.id])) || (await rowGet("SELECT 1 FROM operation_lines ol JOIN operations o ON o.id=ol.operation_id WHERE ol.product_id=? AND o.status IN ('draft','ready','partial') LIMIT 1", [product.id]))) {
        throw new HttpError(409, "Clear this product's remaining stock and complete or cancel its open operations before archiving it.", "product_in_use");
    }
    const result = (await db.prepare("UPDATE products SET active=0 WHERE id=? AND company_id=? AND active=1").run(routeId(req), req.user!.company_id));
    if (!result.changes)
        throw new HttpError(404, "That product could not be found.", "not_found");
    (await logAudit(req.user!.company_id, req.user!.id, "product_archived", "product", routeId(req)));
    res.json({ ok: true });
});
const operationInput = z.object({ type: z.enum(["receipt", "delivery", "transfer", "adjustment"]), sourceLocationId: z.string().uuid().nullable().optional(),
    destinationLocationId: z.string().uuid().nullable().optional(), partner: z.string().trim().max(120).optional(), note: z.string().trim().max(500).optional(), expectedOn: z.string().date().nullable().optional(),
    lines: z.array(z.object({ productId: z.string().uuid(), quantity: quantityInput })).min(1).max(50) });
app.get("/api/operations", auth, async (req, res) => {
    const user = req.user!;
    const clauses = ["o.company_id=?"];
    const args: unknown[] = [user.company_id];
    const scope = (await operationScope(user));
    if (scope.sql) {
        clauses.push(scope.sql.slice(5));
        args.push(...scope.params);
    }
    if (req.query.type && ["receipt", "delivery", "transfer", "adjustment"].includes(String(req.query.type))) {
        clauses.push("o.type=?");
        args.push(req.query.type);
    }
    if (req.query.status && ["draft", "ready", "partial", "done", "canceled"].includes(String(req.query.status))) {
        clauses.push("o.status=?");
        args.push(req.query.status);
    }
    if (req.query.location) {
        clauses.push("(o.source_location_id=? OR o.destination_location_id=?)");
        args.push(req.query.location, req.query.location);
    }
    if (req.query.q) {
        clauses.push("(lower(o.reference) LIKE ? OR lower(o.partner) LIKE ? OR lower(o.note) LIKE ?)");
        const q = `%${String(req.query.q).toLowerCase()}%`;
        args.push(q, q, q);
    }
    const rows = (await db.prepare(`${opSelect} WHERE ${clauses.join(" AND ")} ORDER BY CASE o.status WHEN 'partial' THEN 0 WHEN 'ready' THEN 1 WHEN 'draft' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,o.updated_at DESC LIMIT 200`).all(...args)) as Array<Record<string, any>>;
    res.json({ items: (await asyncMap(rows, async (r) => operationForUser(user, (await operationById(user.company_id, String(r.id)))))) });
});
app.get("/api/operations/:id", auth, async (req, res) => {
    const user = req.user!;
    const op = (await operationById(user.company_id, routeId(req)));
    if (!op)
        throw new HttpError(404, "That operation could not be found.", "not_found");
    const staffHasAccess = user.role !== "staff" || (op.assigned_to_user_id === user.id && (await asyncEvery([op.source_location_id, op.destination_location_id].filter(Boolean), async (id) => (await locationValid(user, String(id))))));
    if (!staffHasAccess)
        throw new HttpError(404, "That operation could not be found.", "not_found");
    res.json({ operation: operationForUser(user, op) });
});
app.get("/api/tasks", auth, async (req, res) => {
    const user = req.user!;
    if (user.role !== "staff")
        throw new HttpError(403, "My tasks is available to warehouse staff accounts.", "forbidden");
    const scope = (await operationScope(user));
    const rows = (await db.prepare(`${opSelect} WHERE o.company_id=?${scope.sql} AND o.status IN ('draft','ready','partial') ORDER BY CASE o.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,o.expected_on,o.created_at`).all(user.company_id, ...scope.params)) as Array<Record<string, any>>;
    res.json({ items: (await asyncMap(rows, async (row) => operationForUser(user, (await operationById(user.company_id, row.id))))) });
});
app.post("/api/operations/:id/submit", auth, async (req, res) => {
    const user = req.user!;
    if (user.role !== "staff")
        throw new HttpError(403, "Only assigned warehouse staff can submit task results.", "forbidden");
    const data = bodySchema(z.object({ submissionKey: z.string().min(8).max(120), quantities: z.array(z.object({ lineId: z.string().uuid(), quantity: quantityInput })).min(1).max(50), notes: z.string().trim().max(500).default(""), exceptionType: z.enum(["", "short", "damaged", "unexpected", "count_variance", "other"]).default(""), countVersion: z.string().length(64).optional() }), req.body);
    const op = (await operationById(user.company_id, routeId(req)));
    if (!op || op.assigned_to_user_id !== user.id || !(await asyncEvery([op.source_location_id, op.destination_location_id].filter(Boolean), async (id) => (await locationValid(user, String(id))))))
        throw new HttpError(404, "That assigned task could not be found.", "not_found");
    const requestHash = hash(JSON.stringify({ quantities: quantitiesFingerprint(data.quantities), notes: data.notes, exceptionType: data.exceptionType, countVersion: data.countVersion }));
    const sameKey = (await rowGet<{
        id: string;
        operation_id: string;
        submitted_by: string;
        request_hash: string | null;
    }>("SELECT id,operation_id,submitted_by,request_hash FROM operation_submissions WHERE submission_key=?", [data.submissionKey]));
    if (sameKey) {
        if (sameKey.operation_id !== op.id || sameKey.submitted_by !== user.id || sameKey.request_hash !== requestHash)
            throw new HttpError(409, "That submission key was already used with a different task or result.", "idempotency_conflict");
        return res.json({ submission: publicSubmission((await rowGet("SELECT * FROM operation_submissions WHERE id=?", [sameKey.id])), op.status), operation: operationForUser(user, op) });
    }
    if (!["ready", "partial"].includes(op.status))
        throw new HttpError(409, "A task can be submitted after a manager marks it ready.", "invalid_transition");
    if ((await rowGet("SELECT id FROM operation_submissions WHERE operation_id=? AND status='pending'", [op.id])))
        throw new HttpError(409, "This task already has a submission waiting for manager review.", "submission_pending");
    const supplied = new Map(data.quantities.map((entry) => [entry.lineId, entry.quantity]));
    if (supplied.size !== data.quantities.length || supplied.size !== op.lines.length || op.lines.some((line: any) => !supplied.has(line.id)))
        throw new HttpError(400, "Submit a quantity for every line exactly once, using only this task's product lines.");
    for (const line of op.lines as Array<Record<string, any>>) {
        const qty = supplied.get(line.id)!;
        if (op.type !== "adjustment") {
            const remaining = roundQuantity(Number(line.planned_qty) - Number(line.completed_qty));
            if (qty > remaining)
                throw new HttpError(400, `${line.product_name}: submit a quantity no greater than ${remaining} ${line.unit}.`);
            if (op.type === "transfer" && qty !== remaining)
                throw new HttpError(400, "Transfers must be submitted as one complete move.");
        }
    }
    if (op.type !== "adjustment" && !data.quantities.some((line) => line.quantity > 0))
        throw new HttpError(400, "Include at least one positive quantity to submit.");
    if (op.type === "adjustment" && !data.countVersion)
        throw new HttpError(400, "Open the count task again before recording the physical count.", "missing_count_version");
    if (op.type === "adjustment" && data.countVersion !== op.countVersion)
        throw new HttpError(409, "Stock moved after this count was opened. Refresh the task and recount before submitting.", "stale_count");
    const snapshot = op.type === "adjustment" ? JSON.stringify((await countSnapshot(user.company_id, op.lines.map((line: any) => line.product_id), op.source_location_id))) : null;
    const id = uuid(), at = nowIso();
    (await db.prepare("INSERT INTO operation_submissions(id,company_id,operation_id,submitted_by,submission_key,quantities_json,notes,exception_type,status,created_at,request_hash,count_snapshot_json) VALUES(?,?,?,?,?,?,?,?, 'pending',?,?,?)").run(id, user.company_id, op.id, user.id, data.submissionKey, JSON.stringify(data.quantities), data.notes, data.exceptionType, at, requestHash, snapshot));
    (await logAudit(user.company_id, user.id, "task_submitted", "operation", op.id, { submissionId: id, exceptionType: data.exceptionType }));
    res.status(201).json({ submission: publicSubmission((await rowGet("SELECT * FROM operation_submissions WHERE id=?", [id]))), operation: operationForUser(user, (await operationById(user.company_id, op.id))) });
});
app.post("/api/operations/:id/review", auth, managers, async (req, res) => {
    const user = req.user!;
    const op = (await operationById(user.company_id, routeId(req)));
    if (!op)
        throw new HttpError(404, "That operation could not be found.", "not_found");
    if (!["ready", "partial"].includes(op.status))
        throw new HttpError(409, "This operation is closed or is not ready for review.", "invalid_transition");
    const data = bodySchema(z.object({ submissionId: z.string().uuid(), decision: z.literal("needs_action"), feedback: z.string().trim().min(3).max(500) }), req.body);
    const result = (await db.prepare("UPDATE operation_submissions SET status='needs_action',feedback=?,reviewed_by=?,reviewed_at=? WHERE id=? AND operation_id=? AND company_id=? AND status='pending'").run(data.feedback, user.id, nowIso(), data.submissionId, op.id, user.company_id));
    if (!result.changes)
        throw new HttpError(409, "That submission is no longer awaiting review.", "submission_already_reviewed");
    (await logAudit(user.company_id, user.id, "task_submission_needs_action", "operation", op.id, { submissionId: data.submissionId }));
    res.json({ operation: (await operationById(user.company_id, op.id)) });
});
app.post("/api/operations", auth, asyncRoute(async (req, res) => {
    const data = bodySchema(operationInput.extend({ assignedToUserId: z.string().uuid().nullable().optional(), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal") }), req.body);
    const user = req.user!;
    if (user.role === "staff" && data.type === "adjustment")
        throw new HttpError(403, "Warehouse staff cannot create count adjustments.", "forbidden");
    const source = data.sourceLocationId || null;
    const destination = data.destinationLocationId || null;
    if (data.type === "receipt" && (!destination || source))
        throw new HttpError(400, "A receipt needs one destination location.");
    if (data.type === "delivery" && (!source || destination))
        throw new HttpError(400, "A delivery needs one source location.");
    if (data.type === "transfer" && (!source || !destination || source === destination))
        throw new HttpError(400, "Choose two different locations for the transfer.");
    if (data.type === "adjustment" && (!source || destination))
        throw new HttpError(400, "Choose the location where the count was taken.");
    if (data.type === "adjustment" && (!data.note || data.note.length < 3))
        throw new HttpError(400, "Give a reason for the physical count correction.");
    if ((source && !(await locationValid(user, source))) || (destination && !(await locationValid(user, destination))))
        throw new HttpError(400, "Choose locations in this company.");
    const assignedTo = user.role === "staff" ? user.id : (data.assignedToUserId || null);
    if (assignedTo) {
        const assignee = (await rowGet<{
            role: string;
        }>("SELECT role FROM users WHERE id=? AND company_id=? AND active=1", [assignedTo, user.company_id]));
        if (!assignee || assignee.role !== "staff")
            throw new HttpError(400, "Assign tasks to an active warehouse staff account.");
        for (const locationId of [source, destination].filter(Boolean) as string[])
            if (!(await locationValid({ ...user, role: "admin" }, locationId)) || !(await rowGet("SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?", [assignedTo, locationId])))
                throw new HttpError(400, "The assignee must be assigned to every warehouse on this task.");
    }
    if (data.lines.some((line) => data.type === "adjustment" ? line.quantity < 0 : line.quantity <= 0))
        throw new HttpError(400, data.type === "adjustment" ? "Counted quantity must be zero or higher." : "Operation quantities must be greater than zero.");
    if (new Set(data.lines.map((line) => line.productId)).size !== data.lines.length)
        throw new HttpError(400, "Add each product only once per operation.");
    for (const line of data.lines)
        if (!(await productCompany(user, line.productId)))
            throw new HttpError(400, "Choose products in this company.");
    if (user.role === "staff" && req.body.status && req.body.status !== "draft")
        throw new HttpError(403, "Staff can only create draft operations.", "forbidden");
    const status = "draft";
    const id = uuid();
    const at = nowIso();
    const lastRef = (await rowGet<{
        n: number;
    }>("SELECT COUNT(*) AS n FROM operations WHERE company_id=?", [user.company_id]))?.n || 0;
    const reference = `${{ receipt: "RCV", delivery: "OUT", transfer: "TRF", adjustment: "ADJ" }[data.type]}-${2501 + lastRef}`;
    const tx = db.transaction(async () => {
        (await db.prepare("INSERT INTO operations(id,company_id,reference,type,status,source_location_id,destination_location_id,partner,note,expected_on,assigned_to_user_id,priority,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .run(id, user.company_id, reference, data.type, status, source, destination, data.partner || "", data.note || "", data.expectedOn || null, assignedTo, data.priority, user.id, at, at));
        const add = db.prepare("INSERT INTO operation_lines(id,operation_id,product_id,planned_qty,completed_qty,position) VALUES(?,?,?,?,0,?)");
        (await asyncForEach(data.lines, async (line, index) => (await add.run(uuid(), id, line.productId, line.quantity, index))));
        if (data.type === "adjustment")
            (await db.prepare("UPDATE operations SET count_snapshot_json=? WHERE id=?").run(JSON.stringify((await countSnapshot(user.company_id, data.lines.map((line) => line.productId), source!))), id));
        (await logAudit(user.company_id, user.id, "operation_created", "operation", id, { type: data.type, status, reference }));
    });
    (await tx());
    res.status(201).json({ operation: (await operationById(user.company_id, id)) });
}));
app.post("/api/operations/:id/ready", auth, managers, async (req, res) => {
    const user = req.user!;
    const op = (await operationById(user.company_id, routeId(req)));
    if (!op)
        throw new HttpError(404, "That operation could not be found.", "not_found");
    if (op.status !== "draft")
        throw new HttpError(409, "Only a draft operation can be marked ready.", "invalid_transition");
    if (!op.lines.length)
        throw new HttpError(400, "Add at least one product before marking this ready.");
    const at = nowIso();
    const tx = db.transaction(async () => {
        if (op.type === "delivery" || op.type === "transfer")
            for (const line of op.lines) {
                const onHand = Number((await rowGet<{
                    quantity: number;
                }>("SELECT quantity FROM stock_balances WHERE product_id=? AND location_id=?", [line.product_id, op.source_location_id]))?.quantity || 0);
                const reserved = Number((await rowGet<{
                    quantity: number;
                }>("SELECT COALESCE(SUM(quantity),0) AS quantity FROM reservations WHERE company_id=? AND product_id=? AND location_id=?", [user.company_id, line.product_id, op.source_location_id]))?.quantity || 0);
                const available = Math.max(0, onHand - reserved);
                if (available + 0.000001 < line.planned_qty)
                    throw new HttpError(409, `${line.product_name} has ${available} ${line.unit} available to reserve at the source location.`, "insufficient_stock");
                (await db.prepare("INSERT INTO reservations(id,company_id,operation_id,operation_line_id,product_id,location_id,quantity,created_at) VALUES(?,?,?,?,?,?,?,?)").run(uuid(), user.company_id, op.id, line.id, line.product_id, op.source_location_id, line.planned_qty, at));
            }
        const updated = (await db.prepare("UPDATE operations SET status='ready',updated_at=? WHERE id=? AND company_id=? AND status='draft'").run(at, op.id, user.company_id));
        if (!updated.changes)
            throw new HttpError(409, "This operation changed. Refresh and try again.", "invalid_transition");
        (await logAudit(user.company_id, user.id, "operation_marked_ready", "operation", op.id, { reference: op.reference }));
    });
    (await tx());
    res.json({ operation: (await operationById(user.company_id, op.id)) });
});
app.post("/api/operations/:id/validate", auth, managers, asyncRoute(async (req, res) => {
    const user = req.user!;
    const op = (await operationById(user.company_id, routeId(req)));
    if (!op)
        throw new HttpError(404, "That operation could not be found.", "not_found");
    const key = String(req.header("Idempotency-Key") || "");
    if (key.length < 8 || key.length > 120)
        throw new HttpError(400, "A validation request key is required. Please try again.", "missing_idempotency_key");
    const quantitiesSchema = z.object({ quantities: z.array(z.object({ lineId: z.string().uuid(), quantity: quantityInput })).max(50).optional() }).default({});
    const input = bodySchema(quantitiesSchema, req.body || {});
    const requestHash = quantitiesFingerprint(input.quantities?.length ? input.quantities : undefined);
    const saved = (await rowGet<{
        operation_id: string;
        company_id: string;
        result_json: string;
        request_hash: string | null;
    }>("SELECT operation_id,company_id,result_json,request_hash FROM operation_validations WHERE idempotency_key=?", [key]));
    if (saved) {
        if (saved.operation_id !== op.id || saved.company_id !== user.company_id || saved.request_hash !== requestHash)
            throw new HttpError(409, "That request key was already used for a different operation or quantity.", "idempotency_conflict");
        return res.json(JSON.parse(saved.result_json));
    }
    if (op.status !== "ready" && op.status !== "partial")
        throw new HttpError(409, "Only a ready or partially completed operation can be validated.", "invalid_transition");
    const supplied = new Map((input.quantities || []).map((line) => [line.lineId, line.quantity]));
    if (supplied.size !== (input.quantities || []).length)
        throw new HttpError(400, "Each product line can appear only once.");
    const pendingSubmission = op.submission?.status === "pending" ? op.submission : null;
    if (pendingSubmission && !supplied.size) {
        for (const item of pendingSubmission.quantities as Array<{
            lineId: string;
            quantity: number;
        }>)
            supplied.set(item.lineId, item.quantity);
    }
    const at = nowIso();
    const tx = db.transaction(async () => {
        const again = (await rowGet<{
            operation_id: string;
            company_id: string;
            result_json: string;
            request_hash: string | null;
        }>("SELECT operation_id,company_id,result_json,request_hash FROM operation_validations WHERE idempotency_key=?", [key]));
        if (again) {
            if (again.operation_id !== op.id || again.company_id !== user.company_id || again.request_hash !== requestHash)
                throw new HttpError(409, "That request key was already used for a different operation or quantity.", "idempotency_conflict");
            return JSON.parse(again.result_json);
        }
        const active = (await operationById(user.company_id, op.id));
        if (!active || (active.status !== "ready" && active.status !== "partial"))
            throw new HttpError(409, "This operation has already changed. Refresh it before continuing.", "invalid_transition");
        if (op.type === "transfer" && active.status === "partial")
            throw new HttpError(409, "Transfers must post in one complete movement.", "invalid_transition");
        if (supplied.size && (supplied.size !== active.lines.length || active.lines.some((line: any) => !supplied.has(line.id))))
            throw new HttpError(400, "Include the amount for every product line, using only lines from this operation.");
        if (active.type === "adjustment") {
            const snapshot = pendingSubmission?.count_snapshot_json || active.count_snapshot_json;
            const current = JSON.stringify((await countSnapshot(user.company_id, active.lines.map((line: any) => line.product_id), active.source_location_id)));
            if (!snapshot || snapshot !== current)
                throw new HttpError(409, "Stock moved after this physical count was recorded. Request a fresh staff count or create a new count adjustment before posting.", "stale_count");
        }
        const updateLine = db.prepare("UPDATE operation_lines SET completed_qty=? WHERE id=? AND operation_id=?");
        const addLedger = db.prepare("INSERT INTO ledger(id,company_id,product_id,operation_id,location_id,other_location_id,delta,balance_before,balance_after,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
        const setBalance = db.prepare(`INSERT INTO stock_balances(product_id,location_id,quantity,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(product_id,location_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`);
        let anyChange = false;
        for (const line of active.lines as Array<Record<string, any>>) {
            if (op.type === "adjustment") {
                const target = supplied.has(line.id) ? supplied.get(line.id)! : line.planned_qty;
                if (!Number.isFinite(target) || target < 0)
                    throw new HttpError(400, `${line.product_name}: counted quantity must be zero or higher.`);
                const before = (await rowGet<{
                    quantity: number;
                }>("SELECT quantity FROM stock_balances WHERE product_id=? AND location_id=?", [line.product_id, op.source_location_id]))?.quantity || 0;
                const reserved = Number((await rowGet<{
                    quantity: number;
                }>("SELECT COALESCE(SUM(quantity),0) AS quantity FROM reservations WHERE company_id=? AND product_id=? AND location_id=?", [user.company_id, line.product_id, op.source_location_id]))?.quantity || 0);
                if (target + 0.000001 < reserved)
                    throw new HttpError(409, `${line.product_name}: ${reserved} ${line.unit} are reserved. Cancel or complete affected deliveries and transfers, then take a fresh count.`, "reserved_stock_conflict");
                const delta = roundQuantity(target - before);
                if (delta !== 0) {
                    (await setBalance.run(line.product_id, op.source_location_id, target, at));
                    (await addLedger.run(uuid(), user.company_id, line.product_id, op.id, op.source_location_id, null, delta, before, target, user.id, active.note || "Physical count correction", at));
                    anyChange = true;
                }
                (await updateLine.run(target, line.id, op.id));
                continue;
            }
            const remaining = roundQuantity(line.planned_qty - line.completed_qty);
            const amount = supplied.has(line.id) ? supplied.get(line.id)! : remaining;
            if (!Number.isFinite(amount) || amount < 0 || amount > remaining)
                throw new HttpError(400, `${line.product_name}: amount must be zero or more and no more than the remaining ${remaining} ${line.unit}.`);
            if (op.type === "transfer" && Math.abs(amount - remaining) > 0.000001)
                throw new HttpError(400, "Transfers are posted as one complete move.");
            if (amount === 0)
                continue;
            if (op.type === "delivery" || op.type === "transfer") {
                const reserved = Number((await rowGet<{
                    quantity: number;
                }>("SELECT quantity FROM reservations WHERE operation_line_id=? AND company_id=?", [line.id, user.company_id]))?.quantity || 0);
                if (reserved + 0.000001 < amount)
                    throw new HttpError(409, "This operation no longer has enough stock reserved. Recheck availability before posting.", "reservation_missing");
            }
            const nextDone = roundQuantity(line.completed_qty + amount);
            if (op.type === "receipt") {
                const before = (await rowGet<{
                    quantity: number;
                }>("SELECT quantity FROM stock_balances WHERE product_id=? AND location_id=?", [line.product_id, op.destination_location_id]))?.quantity || 0;
                const after = roundQuantity(before + amount);
                if (after > 1e12)
                    throw new HttpError(400, "A single location balance cannot exceed one trillion units.");
                (await setBalance.run(line.product_id, op.destination_location_id, after, at));
                (await addLedger.run(uuid(), user.company_id, line.product_id, op.id, op.destination_location_id, null, amount, before, after, user.id, active.partner || "Supplier receipt", at));
            }
            else {
                const before = (await rowGet<{
                    quantity: number;
                }>("SELECT quantity FROM stock_balances WHERE product_id=? AND location_id=?", [line.product_id, op.source_location_id]))?.quantity || 0;
                if (before + 0.000001 < amount)
                    throw new HttpError(409, `${line.product_name} has only ${before} ${line.unit} available at the source location.`, "insufficient_stock");
                const after = roundQuantity(before - amount);
                (await setBalance.run(line.product_id, op.source_location_id, after, at));
                (await addLedger.run(uuid(), user.company_id, line.product_id, op.id, op.source_location_id, op.type === "transfer" ? op.destination_location_id : null, -amount, before, after, user.id, op.type === "transfer" ? "Internal transfer · source" : active.partner || "Customer delivery", at));
                if (op.type === "transfer") {
                    const destBefore = (await rowGet<{
                        quantity: number;
                    }>("SELECT quantity FROM stock_balances WHERE product_id=? AND location_id=?", [line.product_id, op.destination_location_id]))?.quantity || 0;
                    const destAfter = roundQuantity(destBefore + amount);
                    if (destAfter > 1e12)
                        throw new HttpError(400, "A single location balance cannot exceed one trillion units.");
                    (await setBalance.run(line.product_id, op.destination_location_id, destAfter, at));
                    (await addLedger.run(uuid(), user.company_id, line.product_id, op.id, op.destination_location_id, op.source_location_id, amount, destBefore, destAfter, user.id, "Internal transfer · destination", at));
                }
            }
            (await updateLine.run(nextDone, line.id, op.id));
            if (op.type === "delivery" || op.type === "transfer") {
                (await db.prepare("UPDATE reservations SET quantity=ROUND(MAX(0,quantity-?),3) WHERE operation_line_id=? AND company_id=?").run(amount, line.id, user.company_id));
                (await db.prepare("DELETE FROM reservations WHERE operation_line_id=? AND company_id=? AND quantity<=0.000001").run(line.id, user.company_id));
            }
            anyChange = true;
        }
        const refreshed = (await operationById(user.company_id, op.id))!;
        const fulfilled = op.type === "adjustment" || op.type === "transfer" || refreshed.lines.every((line: any) => line.completed_qty + 0.000001 >= line.planned_qty);
        const nextStatus = fulfilled ? "done" : "partial";
        if (!anyChange && op.type !== "adjustment")
            throw new HttpError(400, "Add a quantity to receive or deliver.");
        (await db.prepare("UPDATE operations SET status=?,updated_at=? WHERE id=? AND company_id=? AND status IN ('ready','partial')").run(nextStatus, at, op.id, user.company_id));
        if (pendingSubmission)
            (await db.prepare("UPDATE operation_submissions SET status='approved',reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending'").run(user.id, at, pendingSubmission.id));
        (await logAudit(user.company_id, user.id, "operation_validated", "operation", op.id, { reference: op.reference, status: nextStatus }));
        const result = { operation: (await operationById(user.company_id, op.id)) };
        (await db.prepare("INSERT INTO operation_validations(idempotency_key,operation_id,company_id,result_json,created_at,request_hash) VALUES(?,?,?,?,?,?)").run(key, op.id, user.company_id, JSON.stringify(result), at, requestHash));
        return result;
    });
    const result = (await tx());
    res.json(result);
}));
app.post("/api/operations/:id/cancel", auth, managers, async (req, res) => {
    const user = req.user!;
    const op = (await operationById(user.company_id, routeId(req)));
    if (!op)
        throw new HttpError(404, "That operation could not be found.", "not_found");
    if (!["draft", "ready", "partial"].includes(op.status))
        throw new HttpError(409, "Only open operations can be canceled.", "invalid_transition");
    const tx = db.transaction(async () => { (await db.prepare("DELETE FROM reservations WHERE operation_id=? AND company_id=?").run(op.id, user.company_id)); (await db.prepare("UPDATE operations SET status='canceled',updated_at=? WHERE id=? AND company_id=? AND status IN ('draft','ready','partial')").run(nowIso(), op.id, user.company_id)); (await logAudit(user.company_id, user.id, "operation_canceled", "operation", op.id, { reference: op.reference })); });
    (await tx());
    res.json({ operation: (await operationById(user.company_id, op.id)) });
});
app.get("/api/ledger", auth, async (req, res) => {
    const user = req.user!;
    const where = ["le.company_id=?"];
    const params: unknown[] = [user.company_id];
    const scope = (await allowedLocations(user));
    if (scope !== undefined) {
        if (scope.length) {
            where.push(`le.location_id IN (${scope.map(() => "?").join(",")})`);
            params.push(...scope);
        }
        else
            where.push("1=0");
    }
    if (req.query.q) {
        const q = `%${String(req.query.q).toLowerCase()}%`;
        where.push("(lower(p.name) LIKE ? OR lower(p.sku) LIKE ? OR lower(COALESCE(o.reference,'')) LIKE ? OR lower(le.reason) LIKE ?)");
        params.push(q, q, q, q);
    }
    if (req.query.type && ["receipt", "delivery", "transfer", "adjustment"].includes(String(req.query.type))) {
        where.push("o.type=?");
        params.push(req.query.type);
    }
    if (req.query.location) {
        where.push("le.location_id=?");
        params.push(req.query.location);
    }
    const page = bodySchema(z.coerce.number().int().min(1).max(100).default(1), req.query.page);
    const rows = (await db.prepare(`SELECT le.*,p.name AS product_name,p.sku,p.unit,l.name AS location,l.code AS location_code,
      ol.reference,o.type,o.status,u.name AS actor,other.name AS other_location
    FROM ledger le JOIN products p ON p.id=le.product_id JOIN locations l ON l.id=le.location_id
    LEFT JOIN operations o ON o.id=le.operation_id LEFT JOIN users u ON u.id=le.actor_id
    LEFT JOIN locations other ON other.id=le.other_location_id LEFT JOIN operations ol ON ol.id=le.operation_id
    WHERE ${where.join(" AND ")} ORDER BY le.created_at DESC LIMIT 100 OFFSET ?`).all(...params, (page - 1) * 100));
    res.json({ items: rows });
});
app.get("/api/insights", auth, async (req, res) => { const user = req.user!; res.json({ recommendations: (await recommendationFacts(user.company_id, (await allowedLocations(user)))), anomalies: user.role === "staff" ? [] : (await getAnomalies(user.company_id)) }); });
app.post("/api/copilot", auth, copilotLimiter, asyncRoute(async (req, res) => {
    const data = bodySchema(z.object({ question: z.string().trim().min(4).max(500) }), req.body);
    const user = req.user!;
    const companyId = user.company_id;
    const all = (await recommendationFacts(companyId, (await allowedLocations(user))));
    const evidence = all.filter((p) => p.available <= p.reorder_point || p.risk !== "normal").slice(0, 12);
    const askedRisk = /(run.?out|stock.?out|risk|month|soon|reorder|low)/i.test(data.question);
    const ranked = all.filter((p) => p.daysCover !== null || p.status !== "healthy").sort((a, b) => (a.daysCover ?? -1) - (b.daysCover ?? -1));
    const picks = (askedRisk ? ranked.slice(0, 3) : (evidence.length ? evidence : ranked).slice(0, 3));
    const fallbackAnswer = picks.length
        ? picks.map((p) => p.enoughHistory
            ? `${p.name}: ${p.total} ${p.unit} on hand, ${p.reserved} ${p.unit} reserved, and ${p.available} ${p.unit} available across your locations; ${p.dailyUsage.toFixed(1)} ${p.unit}/day delivered over the last 30 days gives about ${Math.floor(p.daysCover || 0)} days of available cover${p.daysCover !== null && p.daysCover <= 30 ? ", so it may run out this month" : ""}. Reorder point ${p.reorder_point} ${p.unit}; estimated lead time ${p.lead_days} days. A rule-based order of about ${p.reorderSuggestion} ${p.unit} restores lead-time cover.`
            : `${p.name}: ${p.total} ${p.unit} on hand, ${p.reserved} ${p.unit} reserved, and ${p.available} ${p.unit} available against a ${p.reorder_point} ${p.unit} reorder point. There is not enough recent delivery history for a reliable usage forecast; the rule-based top-up to the threshold is ${p.reorderSuggestion} ${p.unit}.`).join(" ")
        : "I do not see a current low-stock item or a recent delivery rate to estimate a stockout. Ask about a product or location, and I can show its current quantities.";
    let source: "rules" | "openai" = "rules";
    let answer = fallbackAnswer;
    let productIds = picks.map((p) => p.id);
    let providerError = false;
    if (process.env.OPENAI_API_KEY) {
        try {
            const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 12000, maxRetries: 1 });
            const model = process.env.OPENAI_MODEL || "gpt-5-mini";
            const facts = all.map(({ id, sku, name, unit, total, reserved, available, reorder_point, lead_days, dailyUsage, movementCount30d, enoughHistory, daysCover, reorderSuggestion, locations }) => ({ id, sku, name, unit, total, reserved, available, reorder_point, lead_days, dailyUsage, movementCount30d, enoughHistory, daysCover, reorderSuggestion, locations: locations.map((l: any) => ({ name: l.name, quantity: l.quantity, reserved: l.reserved, available: l.available })) }));
            const response = await client.responses.create({ model, store: false,
                input: [
                    { role: "system", content: [{ type: "input_text", text: "You are StockSense Copilot. Answer operational inventory questions using only the supplied company inventory facts. Never invent a quantity, location, unit, delivery, or policy. Clearly say when usage history is insufficient. Explain simple estimates and recommend human review before action. Return concise prose and IDs only from the facts." }] },
                    { role: "user", content: [{ type: "input_text", text: `Question: ${data.question}\n\nCurrent company inventory facts (authorized for this user): ${JSON.stringify(facts)}` }] },
                ],
                text: { format: { type: "json_schema", name: "stocksense_copilot_answer", strict: true,
                        schema: { type: "object", additionalProperties: false, properties: { answer: { type: "string" }, focus_product_ids: { type: "array", items: { type: "string" } } }, required: ["answer", "focus_product_ids"] } } },
            });
            const parsed = z.object({ answer: z.string().min(1).max(1600), focus_product_ids: z.array(z.string()).max(5) }).safeParse(JSON.parse(response.output_text));
            if (!parsed.success)
                throw new Error("Copilot returned an invalid answer format.");
            answer = parsed.data.answer;
            productIds = parsed.data.focus_product_ids.filter((id) => all.some((p) => p.id === id)).slice(0, 3);
            source = "openai";
        }
        catch (error) {
            console.error("Copilot provider unavailable:", error instanceof Error ? error.message : "unknown error");
            providerError = true;
        }
    }
    const focused = productIds.map((id) => all.find((p) => p.id === id)).filter(Boolean);
    res.json({ answer, source, model: source === "openai" ? (process.env.OPENAI_MODEL || "gpt-5-mini") : null, providerError,
        evidence: focused.map((p: any) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, total: p.total, reserved: p.reserved, available: p.available, reorderPoint: p.reorder_point,
            leadDays: p.lead_days, daysCover: p.daysCover, dailyUsage: p.dailyUsage, enoughHistory: p.enoughHistory, recommendation: p.reorderSuggestion,
            locations: p.locations })), policy: "Forecasts use the last 30 days of posted deliveries. If that history is limited, the suggestion only tops stock back up to the reorder point." });
}));
app.post("/api/locations", auth, adminOnly, async (req, res) => {
    const data = bodySchema(z.object({ name: z.string().trim().min(2).max(80), code: z.string().trim().min(2).max(10).regex(/^[A-Za-z0-9-]+$/), kind: z.enum(["Warehouse", "Production", "Retail", "Other"]) }), req.body);
    const id = uuid();
    try {
        (await db.prepare("INSERT INTO locations(id,company_id,name,code,kind) VALUES(?,?,?,?,?)").run(id, req.user!.company_id, data.name, data.code.toUpperCase(), data.kind));
    }
    catch (error: any) {
        if (String(error?.message).includes("UNIQUE"))
            throw new HttpError(409, "That location code is already used.");
        throw error;
    }
    (await logAudit(req.user!.company_id, req.user!.id, "location_created", "location", id, { code: data.code.toUpperCase() }));
    res.status(201).json({ location: { id, name: data.name, code: data.code.toUpperCase(), kind: data.kind } });
});
app.post("/api/categories", auth, adminOnly, async (req, res) => {
    const data = bodySchema(z.object({ name: z.string().trim().min(2).max(60), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#6875d9") }), req.body);
    const id = uuid();
    try {
        (await db.prepare("INSERT INTO categories(id,company_id,name,color) VALUES(?,?,?,?)").run(id, req.user!.company_id, data.name, data.color));
    }
    catch (error: any) {
        if (String(error?.message).includes("UNIQUE"))
            throw new HttpError(409, "That category already exists.");
        throw error;
    }
    (await logAudit(req.user!.company_id, req.user!.id, "category_created", "category", id));
    res.status(201).json({ category: { id, name: data.name, color: data.color } });
});
if (isProduction) {
    const staticDir = path.resolve("dist/client");
    app.use(express.static(staticDir, { maxAge: "1h", index: false, dotfiles: "deny" }));
}
app.use((req, res) => {
    if (req.path.startsWith("/api/"))
        return res.status(404).json({ error: "This API route was not found.", code: "not_found" });
    if (isProduction)
        return res.sendFile(path.join(path.resolve("dist/client"), "index.html"));
    return res.status(404).send("Not found");
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent)
        return;
    if (error instanceof HttpError)
        return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof z.ZodError)
        return res.status(400).json({ error: error.issues[0]?.message || "Invalid request.", code: "validation_error" });
    const parseError = error as {
        type?: string;
        status?: number;
    };
    if (parseError?.type === "entity.parse.failed")
        return res.status(400).json({ error: "The request body must contain valid JSON.", code: "invalid_json" });
    if (parseError?.type === "entity.too.large")
        return res.status(413).json({ error: "The request is too large. Keep it under 40 KB.", code: "payload_too_large" });
    if (parseError?.status === 400)
        return res.status(400).json({ error: "The request could not be read.", code: "invalid_request" });
    const message = error instanceof Error ? error.message : "unknown";
    console.error("Unhandled API error:", message);
    res.status(500).json({ error: isProduction ? "Something went wrong. Try again, or contact your administrator." : message, code: "internal_error" });
});
export default app;
if (!process.env.VERCEL) {
    app.listen(PORT, isProduction ? "0.0.0.0" : "127.0.0.1", () => console.log(`StockSense API listening on http://localhost:${PORT}`));
}
