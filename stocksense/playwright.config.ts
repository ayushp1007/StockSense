import { defineConfig } from "@playwright/test";
import path from "node:path";

const apiPort = 47821;
const webPort = 47820;
const webOrigin = `http://127.0.0.1:${webPort}`;
const runId = process.env.STOCKSENSE_BROWSER_RUN ||= `${Date.now()}-${process.pid}`;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: "work/browser-results",
  reporter: [["list"], ["html", { outputFolder: "work/browser-report", open: "never" }]],
  use: { baseURL: webOrigin, browserName: "chromium", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    {
      command: "node --import tsx src/server/dev.ts",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      env: { PORT: String(apiPort), NODE_ENV: "development", APP_ENV: "demo", DB_PATH: path.resolve(`work/browser-data/${runId}.db`), JWT_SECRET: "isolated-browser-check-secret-is-not-for-deployment", APP_ORIGIN: "", TRUST_PROXY: "false", OPENAI_API_KEY: "", RESEND_API_KEY: "", EMAIL_FROM: "" },
    },
    {
      command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: webOrigin,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
    },
  ],
});
