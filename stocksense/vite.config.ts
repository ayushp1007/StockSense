import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Generated archives and SQLite files can be exclusively locked on Windows.
      // They are not client sources and must not be watched for hot reload.
      ignored: ["**/outputs/**", "**/work/**", "**/data/**"],
    },
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:4000",
        // Preserve the browser-facing host/port for the API's Origin check.
        // Vite's string shorthand rewrites Host to the backend address.
        changeOrigin: false,
      },
    },
  },
});
