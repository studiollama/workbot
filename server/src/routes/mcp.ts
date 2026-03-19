import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadMcpConfig, saveMcpConfig, MCP_TOOLS } from "../mcp-config.js";

const router = Router();
const execFileAsync = promisify(execFile);

// GET /api/mcp/config — returns MCP config + tool list
router.get("/config", (_req, res) => {
  const config = loadMcpConfig();
  res.json({ config, tools: MCP_TOOLS });
});

// PUT /api/mcp/config — saves MCP config
router.put("/config", (req, res) => {
  const { qmdCliPath, nodePath, agentsFilePath, claudeMdPath, serverPort, clientPort } = req.body;
  const updates: Record<string, unknown> = {};
  if (typeof qmdCliPath === "string" || qmdCliPath === null) {
    updates.qmdCliPath = qmdCliPath;
  }
  if (typeof nodePath === "string") {
    updates.nodePath = nodePath;
  }
  if (typeof agentsFilePath === "string") {
    updates.agentsFilePath = agentsFilePath;
  }
  if (typeof claudeMdPath === "string") {
    updates.claudeMdPath = claudeMdPath;
  }
  if (typeof serverPort === "number" && serverPort > 0 && serverPort < 65536) {
    updates.serverPort = serverPort;
  }
  if (typeof clientPort === "number" && clientPort > 0 && clientPort < 65536) {
    updates.clientPort = clientPort;
  }
  saveMcpConfig(updates);
  res.json({ ok: true });
});

// GET /api/mcp/status — checks if QMD is reachable
router.get("/status", async (_req, res) => {
  const config = loadMcpConfig();

  if (!config.qmdCliPath) {
    return res.json({ qmdAvailable: false, error: "QMD CLI path not configured" });
  }

  try {
    const nodePath = config.nodePath.replace(/\\/g, "/");
    const qmdPath = config.qmdCliPath!.replace(/\\/g, "/");
    const indexArgs = config.qmdIndex ? ["--index", config.qmdIndex] : [];
    const { stdout } = await execFileAsync(
      nodePath,
      [qmdPath, ...indexArgs, "status"],
      { timeout: 10_000 }
    );
    res.json({ qmdAvailable: true, details: stdout.trim() });
  } catch (err: any) {
    res.json({
      qmdAvailable: false,
      error: err.message?.substring(0, 200) ?? "QMD check failed",
    });
  }
});

// POST /api/mcp/pick-file — opens native file picker dialog (Windows)
router.post("/pick-file", async (_req, res) => {
  try {
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = "Markdown files (*.md)|*.md|All files (*.*)|*.*"
$d.Title = "Select file"
if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName } else { exit 1 }
`;
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-Command", psScript,
    ], { timeout: 60_000 });
    const filePath = stdout.trim().replace(/\\/g, "/");
    if (!filePath) return res.status(400).json({ error: "No file selected" });
    res.json({ path: filePath });
  } catch {
    res.status(400).json({ error: "File picker cancelled" });
  }
});

// POST /api/mcp/restart — save port config (restart happens externally)
router.post("/restart", (req, res) => {
  const { serverPort, clientPort } = req.body;
  const newServerPort = typeof serverPort === "number" && serverPort > 0 && serverPort < 65536
    ? serverPort : undefined;
  const newClientPort = typeof clientPort === "number" && clientPort > 0 && clientPort < 65536
    ? clientPort : undefined;

  const updates: Record<string, unknown> = {};
  if (newServerPort !== undefined) updates.serverPort = newServerPort;
  if (newClientPort !== undefined) updates.clientPort = newClientPort;

  saveMcpConfig(updates);
  const config = loadMcpConfig();

  // Sync launch.json (gitignored) so preview system uses correct ports
  const launchPath = resolve(__dirname, "../../.claude/launch.json");
  try {
    if (existsSync(launchPath)) {
      const launch = JSON.parse(readFileSync(launchPath, "utf-8"));
      for (const cfg of launch.configurations) {
        if (cfg.name === "workbot-server") cfg.port = config.serverPort;
        if (cfg.name === "workbot-client") cfg.port = config.clientPort;
      }
      writeFileSync(launchPath, JSON.stringify(launch, null, 2) + "\n");
    }
  } catch { /* launch.json may not exist */ }

  res.json({ ok: true, serverPort: config.serverPort, clientPort: config.clientPort });
});

export default router;
