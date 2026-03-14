import "dotenv/config";
import express from "express";
import session from "express-session";
import cors from "cors";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import authRoutes from "./routes/auth.js";
import codexRoutes from "./routes/codex.js";
import servicesRoutes from "./routes/services.js";
import mcpRoutes from "./routes/mcp.js";
import devRoutes from "./routes/development.js";
import skillsRoutes from "./routes/skills.js";
import { loadMcpConfig } from "./mcp-config.js";

// Bootstrap gitignored config files with defaults for fresh clones
function ensureDefaults() {
  const launchDir = resolve(__dirname, "../../.claude");
  const launchPath = resolve(launchDir, "launch.json");
  if (!existsSync(launchPath)) {
    const config = loadMcpConfig();
    const launch = {
      version: "0.0.1",
      configurations: [
        {
          name: "workbot-server",
          runtimeExecutable: "node",
          runtimeArgs: ["../node_modules/tsx/dist/cli.mjs", "src/index.ts"],
          port: config.serverPort,
          cwd: "server",
        },
        {
          name: "workbot-client",
          runtimeExecutable: "node",
          runtimeArgs: ["../node_modules/vite/bin/vite.js"],
          port: config.clientPort,
          cwd: "client",
        },
      ],
    };
    if (!existsSync(launchDir)) mkdirSync(launchDir, { recursive: true });
    writeFileSync(launchPath, JSON.stringify(launch, null, 2) + "\n");
    console.log("Created .claude/launch.json with default ports");
  }
}
ensureDefaults();

declare module "express-session" {
  interface SessionData {
    apiKey?: string;
    chatgptAuth?: boolean;
    org?: string | null;
    [key: `svc_${string}`]: { token: string; user: string } | undefined;
  }
}

const app = express();
const mcpConfig = loadMcpConfig();
const PORT = parseInt(process.env.PORT ?? String(mcpConfig.serverPort), 10);

app.use(cors({
  origin: (_origin, cb) => cb(null, true),
  credentials: true,
}));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // dev only — set true behind HTTPS in prod
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24h
    },
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/codex", codexRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/mcp", mcpRoutes);
app.use("/api/dev", devRoutes);
app.use("/api/skills", skillsRoutes);

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
app.set("server", server);
