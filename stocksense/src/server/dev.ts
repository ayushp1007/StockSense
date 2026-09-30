import "dotenv/config";

if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") {
  console.error("Development startup refused: use a separate demo .env and database, or run npm start for production.");
  process.exit(1);
}
process.env.NODE_ENV ||= "development";
process.env.APP_ENV ||= "demo";
await import("./server.js");
