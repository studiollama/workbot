import { Router } from "express";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  SERVICES,
  loadStore,
  STORE_DIR,
  STORE_PATH,
  type StoredService,
} from "../services.js";

const router = Router();

function saveStore(data: Record<string, StoredService>) {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

// Dashboard layout persistence
const DASHBOARD_PATH = join(STORE_DIR, "dashboard.json");

interface DashboardConfig {
  enabledServices: string[];
  workbotName?: string;
  accentColor?: string;
}

function loadDashboardConfig(): DashboardConfig | null {
  try {
    if (!existsSync(DASHBOARD_PATH)) return null;
    return JSON.parse(readFileSync(DASHBOARD_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function saveDashboardConfig(config: DashboardConfig) {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(DASHBOARD_PATH, JSON.stringify(config, null, 2));
}

// GET /api/services/status
router.get("/status", (_req, res) => {
  const store = loadStore();
  const result: Record<string, { connected: boolean; user?: string }> = {};

  for (const key of Object.keys(SERVICES)) {
    const saved = store[key];
    result[key] = saved
      ? { connected: true, user: saved.user }
      : { connected: false };
  }

  // Codex (ChatGPT) — check for auth file (optional service)
  const codexAuthPath = join(STORE_DIR, "codex-auth.json");
  let codexConnected = false;
  try {
    if (existsSync(codexAuthPath)) {
      const data = JSON.parse(readFileSync(codexAuthPath, "utf-8"));
      codexConnected = !!data.tokens || !!data.OPENAI_API_KEY || !!data.access_token;
    }
  } catch {}
  result.codex = { connected: codexConnected };

  res.json(result);
});

// POST /api/services/:service/connect
router.post("/:service/connect", async (req, res) => {
  const { service } = req.params;
  const { token, ...extras } = req.body;

  const config = SERVICES[service];
  if (!config) {
    return res.status(400).json({ error: `Unknown service: ${service}` });
  }

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Token is required" });
  }

  // Validate required extra fields
  if (config.extraFields) {
    for (const field of config.extraFields) {
      if (!extras[field.key] || typeof extras[field.key] !== "string") {
        return res.status(400).json({ error: `${field.label} is required` });
      }
    }
  }

  try {
    // If service has a preConnect hook (e.g., Azure AD token exchange),
    // resolve the actual bearer token from the user's credentials
    let validationToken = token;
    if (config.preConnect) {
      const result = await config.preConnect(token, extras);
      validationToken = result.resolvedToken;
    }

    const validateUrl =
      typeof config.validateUrl === "function"
        ? config.validateUrl(extras)
        : config.validateUrl;

    const response = await fetch(validateUrl, {
      headers: config.authHeader(validationToken, extras),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(401).json({
        error:
          response.status === 401 || response.status === 403
            ? "Invalid token"
            : `Validation failed (${response.status}): ${text.slice(0, 100)}`,
      });
    }

    const data = await response.json();
    const user = config.extractUser(data);

    // Persist to disk (include extras so we can rebuild auth headers later)
    const store = loadStore();
    const savedExtras: Record<string, string> = {};
    if (config.extraFields) {
      for (const field of config.extraFields) {
        savedExtras[field.key] = extras[field.key];
      }
    }
    store[service] = {
      token,
      user,
      ...(Object.keys(savedExtras).length > 0 ? { extras: savedExtras } : {}),
    };
    saveStore(store);

    res.json({ connected: true, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Connection failed" });
  }
});

// POST /api/services/:service/disconnect
router.post("/:service/disconnect", (req, res) => {
  const store = loadStore();
  delete store[req.params.service];
  saveStore(store);
  res.json({ disconnected: true });
});

// GET /api/services/config — returns token URLs and display info (no secrets)
router.get("/config", (_req, res) => {
  const config: Record<
    string,
    {
      name: string;
      tokenUrl: string;
      tokenPrefix: string;
      extraFields?: { key: string; label: string; placeholder: string }[];
      tokenLabel?: string;
      authNote?: string;
      difficulty?: string;
    }
  > = {};
  for (const [key, svc] of Object.entries(SERVICES)) {
    config[key] = {
      name: svc.name,
      tokenUrl: svc.tokenUrl,
      tokenPrefix: svc.tokenPrefix,
      ...(svc.extraFields ? { extraFields: svc.extraFields } : {}),
      ...(svc.tokenLabel ? { tokenLabel: svc.tokenLabel } : {}),
      ...(svc.authNote ? { authNote: svc.authNote } : {}),
      ...(svc.difficulty ? { difficulty: svc.difficulty } : {}),
    };
  }
  config.codex = {
    name: "Codex (ChatGPT)",
    tokenUrl: "",
    tokenPrefix: "",
    difficulty: "Device Login",
  };
  res.json(config);
});

// GET /api/services/dashboard — returns enabled services + order
router.get("/dashboard", (_req, res) => {
  const saved = loadDashboardConfig();
  if (saved) {
    res.json(saved);
  } else {
    // Default: all services enabled in definition order
    const allKeys = [...Object.keys(SERVICES), "codex"];
    res.json({ enabledServices: allKeys });
  }
});

// PUT /api/services/dashboard — saves enabled services list + settings
router.put("/dashboard", (req, res) => {
  const { enabledServices, workbotName, accentColor } = req.body;
  if (!Array.isArray(enabledServices)) {
    return res.status(400).json({ error: "enabledServices must be an array" });
  }
  const config: DashboardConfig = { enabledServices };
  if (typeof workbotName === "string") config.workbotName = workbotName;
  if (typeof accentColor === "string") config.accentColor = accentColor;
  saveDashboardConfig(config);
  res.json({ ok: true });
});

export default router;
