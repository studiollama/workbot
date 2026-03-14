import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
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

const { serverPort, clientPort } = loadPorts();

export default defineConfig({
  plugins: [react()],
  server: {
    port: clientPort,
    proxy: {
      "/api": `http://localhost:${serverPort}`,
    },
  },
});
