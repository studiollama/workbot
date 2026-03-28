import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadPorts() {
  try {
    const cfg = JSON.parse(readFileSync(resolve(__dirname, "../.workbot/mcp.json"), "utf-8"));
    return {
      serverPort: cfg.serverPort ?? 3001,
      clientPort: cfg.clientPort ?? 5173,
    };
  } catch {
    return { serverPort: 3001, clientPort: 5173 };
  }
}

function loadCerts() {
  const keyPath = resolve(__dirname, "../.workbot/certs/server.key");
  const certPath = resolve(__dirname, "../.workbot/certs/server.crt");
  if (existsSync(keyPath) && existsSync(certPath)) {
    return {
      key: readFileSync(keyPath, "utf-8"),
      cert: readFileSync(certPath, "utf-8"),
    };
  }
  return undefined;
}

const { serverPort, clientPort } = loadPorts();
const certs = loadCerts();

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: clientPort,
    ...(certs ? { https: certs } : {}),
    proxy: {
      "/api": {
        target: `https://localhost:${serverPort}`,
        secure: false, // Accept self-signed certs
      },
    },
  },
});
