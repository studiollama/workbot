import { Router } from "express";
import OpenAI from "openai";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";

const router = Router();

// Project-local auth — keeps credentials scoped per project, not machine-wide
const PROJECT_ROOT = join(process.cwd(), "..");
const WORKBOT_DIR = join(PROJECT_ROOT, ".workbot");
const CODEX_AUTH_PATH = join(WORKBOT_DIR, "codex-auth.json");

// Point Codex CLI at project-local dir
process.env.CODEX_HOME = WORKBOT_DIR;

// Check if ChatGPT OAuth credentials exist on disk
function getChatGPTAuth(): { valid: boolean } {
  try {
    if (!existsSync(CODEX_AUTH_PATH)) return { valid: false };
    const data = JSON.parse(readFileSync(CODEX_AUTH_PATH, "utf-8"));
    return { valid: !!data.tokens || !!data.OPENAI_API_KEY || !!data.access_token };
  } catch {
    return { valid: false };
  }
}

// GET /api/auth/status
router.get("/status", (req, res) => {
  if (req.session?.apiKey) {
    return res.json({
      authenticated: true,
      method: "apikey",
      org: req.session.org ?? null,
    });
  }

  const chatgpt = getChatGPTAuth();
  if (chatgpt.valid) {
    return res.json({
      authenticated: true,
      method: "chatgpt",
      org: null,
    });
  }

  res.json({ authenticated: false, method: null, org: null });
});

// POST /api/auth/openai — API key auth (fallback)
router.post("/openai", async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== "string") {
    return res.status(400).json({ error: "API key is required" });
  }

  try {
    const client = new OpenAI({ apiKey });
    const models = await client.models.list();

    // Extract org info from first page if available
    const org = null; // OpenAI SDK doesn't expose org from models.list

    req.session!.apiKey = apiKey;
    req.session!.org = org;

    res.json({ authenticated: true, method: "apikey", org });
  } catch (err: any) {
    const message =
      err?.status === 401
        ? "Invalid API key"
        : err?.message ?? "Failed to validate key";
    res.status(401).json({ error: message });
  }
});

// POST /api/auth/chatgpt/start — start device-code OAuth flow
router.post("/chatgpt/start", (_req, res) => {
  let output = "";
  let sent = false;

  const proc = spawn("npx", ["@openai/codex", "login", "--device-auth"], {
    shell: true,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const timeout = setTimeout(() => {
    if (!sent) {
      sent = true;
      proc.kill();
      res.status(504).json({
        error: "Timed out waiting for device code. Try running 'codex login --device-auth' manually.",
      });
    }
  }, 30000);

  const handleOutput = (data: Buffer) => {
    output += data.toString();
    // Look for the verification URL and user code in the output
    const urlMatch = output.match(
      /https?:\/\/[^\s]+/
    );
    const codeMatch = output.match(
      /code[:\s]+([A-Z0-9-]{4,})/i
    );

    if (urlMatch && codeMatch && !sent) {
      sent = true;
      clearTimeout(timeout);
      res.json({
        verificationUrl: urlMatch[0],
        userCode: codeMatch[1],
      });
      // Keep the process running — user needs to complete the flow in browser
    }
  };

  proc.stdout.on("data", handleOutput);
  proc.stderr.on("data", handleOutput);

  proc.on("error", (err) => {
    if (!sent) {
      sent = true;
      clearTimeout(timeout);
      res.status(500).json({
        error: `Failed to start Codex login: ${err.message}`,
      });
    }
  });

  proc.on("close", () => {
    clearTimeout(timeout);
    if (!sent) {
      sent = true;
      // Process ended without us finding a URL — maybe auth completed immediately
      const chatgpt = getChatGPTAuth();
      if (chatgpt.valid) {
        res.json({ authenticated: true, method: "chatgpt" });
      } else {
        res.status(500).json({
          error: "Login process ended without providing device code. Output: " + output.slice(0, 200),
        });
      }
    }
  });
});

// POST /api/auth/chatgpt/check — poll to see if OAuth completed
router.post("/chatgpt/check", (_req, res) => {
  const chatgpt = getChatGPTAuth();
  res.json({ authenticated: chatgpt.valid, method: chatgpt.valid ? "chatgpt" : null });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  req.session?.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to logout" });
    }
    res.json({ success: true });
  });
});

export default router;
