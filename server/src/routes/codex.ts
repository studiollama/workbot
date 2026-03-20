import { Router } from "express";
import { spawn } from "child_process";

const router = Router();

// POST /api/codex/ping — check Codex CLI is available
router.post("/ping", (_req, res) => {
  const proc = spawn("npx", ["@openai/codex", "--version"], {
    shell: true,
    timeout: 15000,
  });

  let output = "";
  proc.stdout.on("data", (data: Buffer) => {
    output += data.toString();
  });
  proc.stderr.on("data", (data: Buffer) => {
    output += data.toString();
  });

  proc.on("close", (code) => {
    if (code === 0) {
      res.json({
        available: true,
        version: output.trim(),
      });
    } else {
      res.json({
        available: false,
        error: "Codex CLI not available: " + output.trim(),
      });
    }
  });

  proc.on("error", (err) => {
    res.json({
      available: false,
      error: `Failed to spawn Codex CLI: ${err.message}`,
    });
  });
});

export default router;
