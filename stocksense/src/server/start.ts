import "dotenv/config";

// npm start is always production, even when a development .env was copied.
// Set the mode before loading server/db modules so demo data cannot be seeded.
process.env.NODE_ENV = "production";
process.env.APP_ENV = "production";
await import("./server.js");
