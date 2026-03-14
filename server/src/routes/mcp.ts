import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
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
  const { qmdCliPath, nodePath } = req.body;
  const updates: Record<string, unknown> = {};
  if (typeof qmdCliPath === "string" || qmdCliPath === null) {
    updates.qmdCliPath = qmdCliPath;
  }
  if (typeof nodePath === "string") {
    updates.nodePath = nodePath;
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
    const { stdout } = await execFileAsync(
      nodePath,
      [qmdPath, "status"],
      { timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }
    );
    res.json({ qmdAvailable: true, details: stdout.trim() });
  } catch (err: any) {
    res.json({
      qmdAvailable: false,
      error: err.message?.substring(0, 200) ?? "QMD check failed",
    });
  }
});

export default router;
