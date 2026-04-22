import { Router } from "express";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  SERVICES,
  loadStore,
  saveStore,
  STORE_DIR,
  STORE_PATH,
  type StoredService,
  parseInstanceId,
  makeInstanceId,
  slugifyInstance,
} from "../services.js";
import { loadMcpConfig } from "../mcp-config.js";

const router = Router();

// In-memory store for pending OAuth flows (state → credentials)
const pendingOAuth = new Map<
  string,
  { service: string; clientId: string; clientSecret: string; redirectUri: string; extras?: Record<string, string>; instanceName?: string }
>();

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
  const result: Record<string, {
    connected: boolean;
    user?: string;
    extras?: Record<string, string>;
    serviceType?: string;
    instanceName?: string;
  }> = {};

  // Add all connected instances (already migrated by loadStore)
  for (const [key, saved] of Object.entries(store)) {
    const { serviceType } = parseInstanceId(key);
    if (!SERVICES[serviceType]) continue;

    const safeExtras: Record<string, string> = {};
    if (saved.extras) {
      for (const [k, v] of Object.entries(saved.extras)) {
        safeExtras[k] = k.includes("secret") ? "" : v;
      }
    }
    result[key] = {
      connected: true,
      user: saved.user,
      serviceType,
      instanceName: saved._instanceName || "Default",
      ...(Object.keys(safeExtras).length > 0 ? { extras: safeExtras } : {}),
    };
  }

  // Add disconnected service types (only if no instances exist for that type)
  for (const key of Object.keys(SERVICES)) {
    if (!result[key] && !Object.keys(result).some((k) => parseInstanceId(k).serviceType === key)) {
      result[key] = { connected: false, serviceType: key };
    }
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
  if (!result.codex) result.codex = { connected: codexConnected, serviceType: "codex" };

  res.json(result);
});

// POST /api/services/:service/connect
// Accepts optional `instanceName` in body to create a named instance
router.post("/:service/connect", async (req, res) => {
  const { service } = req.params;
  const { token, instanceName, ...extras } = req.body;

  const config = SERVICES[service];
  if (!config) {
    return res.status(400).json({ error: `Unknown service: ${service}` });
  }

  // All connections are instances — name defaults to "Default" if not provided
  const resolvedName = instanceName?.trim() || "Default";
  const storeKey = makeInstanceId(service, slugifyInstance(resolvedName));

  // Connection-based services: token = password, extras = connection params
  if (config.kind === "connection") {
    // Validate required connection fields
    for (const field of config.connectionFields) {
      if (field.required && !extras[field.key]?.trim()) {
        return res.status(400).json({ error: `${field.label} is required` });
      }
    }

    try {
      const allParams: Record<string, string> = { ...extras, password: token || "" };
      // Fill default values for missing optional fields
      for (const field of config.connectionFields) {
        if (!allParams[field.key] && field.defaultValue) {
          allParams[field.key] = field.defaultValue;
        }
      }

      const result = await config.validate(allParams);

      // Persist connection params
      const store = loadStore();
      const savedExtras: Record<string, string> = {};
      for (const field of config.connectionFields) {
        if (allParams[field.key]) savedExtras[field.key] = allParams[field.key];
      }
      store[storeKey] = {
        token: token || "",
        user: result.user,
        extras: savedExtras,
        _instanceName: resolvedName,
      };
      saveStore(store);

      return res.json({ connected: true, user: result.user, instanceId: storeKey });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? "Connection failed" });
    }
  }

  // REST services: existing flow
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
    let persistToken = token;
    if (config.preConnect) {
      try {
        const result = await config.preConnect(token, extras);
        validationToken = result.resolvedToken;
        if (result.updatedToken) persistToken = result.updatedToken;
      } catch (err: any) {
        console.error(`[services] preConnect failed for ${service}:`, err.message);
        return res.status(422).json({ error: err.message ?? "Authentication failed" });
      }
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
      return res.status(422).json({
        error:
          response.status === 401 || response.status === 403
            ? "Invalid token"
            : `Validation failed (${response.status}): ${text.slice(0, 100)}`,
      });
    }

    const data = await response.json();
    const user = config.extractUser(data, extras);

    // Persist to disk (include extras so we can rebuild auth headers later)
    const store = loadStore();
    const savedExtras: Record<string, string> = {};
    if (config.extraFields) {
      for (const field of config.extraFields) {
        savedExtras[field.key] = extras[field.key];
      }
    }
    store[storeKey] = {
      token: persistToken,
      user,
      ...(Object.keys(savedExtras).length > 0 ? { extras: savedExtras } : {}),
      _instanceName: resolvedName,
    };
    saveStore(store);

    res.json({ connected: true, user, instanceId: storeKey });
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

// PUT /api/services/:instanceId/rename — rename an instance
router.put("/:service/rename", (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });

  const store = loadStore();
  const old = store[req.params.service];
  if (!old) return res.status(404).json({ error: "Instance not found" });

  const { serviceType } = parseInstanceId(req.params.service);
  const newKey = makeInstanceId(serviceType, slugifyInstance(name));

  // If key changed, move the entry
  if (newKey !== req.params.service) {
    store[newKey] = { ...old, _instanceName: name.trim() };
    delete store[req.params.service];
  } else {
    store[req.params.service]._instanceName = name.trim();
  }

  saveStore(store);
  res.json({ ok: true, newInstanceId: newKey, name: name.trim() });
});

// POST /api/services/:service/oauth/start — initiate OAuth flow
router.post("/:service/oauth/start", (req, res) => {
  const { service } = req.params;
  const config = SERVICES[service];
  if (!config || config.kind !== "rest" || !config.oauth) {
    return res.status(400).json({ error: `Service "${service}" does not support OAuth.` });
  }

  const { client_id, client_secret, ...oauthExtras } = req.body;
  console.log(`[OAuth start] ${service} body keys:`, Object.keys(req.body), 'oauthExtras:', Object.keys(oauthExtras));
  if (!client_id || !client_secret) {
    return res.status(400).json({ error: "client_id and client_secret are required." });
  }

  // Collect any additional extra fields (e.g. developerToken for Google Ads)
  const extraFields: Record<string, string> = {};
  if (config.extraFields) {
    for (const field of config.extraFields) {
      if (field.key !== "client_id" && field.key !== "client_secret" && oauthExtras[field.key]) {
        extraFields[field.key] = oauthExtras[field.key];
      }
    }
  }
  console.log(`[OAuth start] ${service} extraFields:`, extraFields);

  const state = randomUUID();
  // Derive redirect host from the browser's origin (handles Docker port mapping)
  const origin = req.headers.origin || req.headers.referer;
  const host = origin ? new URL(origin).host : req.headers.host || `localhost:${loadMcpConfig().serverPort}`;
  const redirectUri = `https://${host}${config.oauth.redirectPath}`;

  pendingOAuth.set(state, { service, clientId: client_id, clientSecret: client_secret, redirectUri, ...(Object.keys(extraFields).length > 0 ? { extras: extraFields } : {}) });
  // Auto-expire after 10 minutes
  setTimeout(() => pendingOAuth.delete(state), 600_000);

  const params = new URLSearchParams({
    client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.oauth.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  res.json({ authUrl: `${config.oauth.authUrl}?${params.toString()}` });
});

// POST /api/services/:service/oauth/reauth — re-authorize using stored credentials
router.post("/:service/oauth/reauth", (req, res) => {
  const { service } = req.params;
  const config = SERVICES[service];
  if (!config || config.kind !== "rest" || !config.oauth) {
    return res.status(400).json({ error: `Service "${service}" does not support OAuth.` });
  }

  const store = loadStore();
  const saved = store[service];
  if (!saved?.extras?.client_id || !saved?.extras?.client_secret) {
    return res.status(400).json({ error: "No stored OAuth credentials. Connect manually first." });
  }

  const state = randomUUID();
  // Derive redirect host from the browser's origin (handles Docker port mapping)
  const origin = req.headers.origin || req.headers.referer;
  const host = origin ? new URL(origin).host : req.headers.host || `localhost:${loadMcpConfig().serverPort}`;
  const redirectUri = `https://${host}${config.oauth.redirectPath}`;

  // Carry forward any service-specific extras (e.g. developerToken)
  const savedExtras: Record<string, string> = {};
  if (config.extraFields) {
    for (const field of config.extraFields) {
      if (field.key !== "client_id" && field.key !== "client_secret" && saved.extras[field.key]) {
        savedExtras[field.key] = saved.extras[field.key];
      }
    }
  }

  pendingOAuth.set(state, {
    service,
    clientId: saved.extras.client_id,
    clientSecret: saved.extras.client_secret,
    redirectUri,
    ...(Object.keys(savedExtras).length > 0 ? { extras: savedExtras } : {}),
  });
  setTimeout(() => pendingOAuth.delete(state), 600_000);

  const params = new URLSearchParams({
    client_id: saved.extras.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.oauth.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  res.json({ authUrl: `${config.oauth.authUrl}?${params.toString()}` });
});

// GET /api/services/:service/oauth/callback — Google redirects here
router.get("/:service/oauth/callback", async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.send(oauthResultPage(false, `Authorization denied: ${oauthError}`));
  }

  if (!state || !code) {
    return res.send(oauthResultPage(false, "Missing authorization code or state."));
  }

  const pending = pendingOAuth.get(state as string);
  if (!pending) {
    return res.send(oauthResultPage(false, "OAuth session expired. Please try again from the dashboard."));
  }
  pendingOAuth.delete(state as string);

  const { service } = req.params;
  const config = SERVICES[service];
  if (!config || config.kind !== "rest" || !config.oauth) {
    return res.send(oauthResultPage(false, `Service "${service}" does not support OAuth.`));
  }

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch(config.oauth.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: pending.clientId,
        client_secret: pending.clientSecret,
        redirect_uri: pending.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return res.send(oauthResultPage(false, `Token exchange failed: ${text.slice(0, 200)}`));
    }

    const tokenData = await tokenRes.json();
    const refreshToken = tokenData.refresh_token;
    const accessToken = tokenData.access_token;

    if (!refreshToken) {
      return res.send(oauthResultPage(false, "No refresh token returned. Revoke access at myaccount.google.com/permissions and try again."));
    }

    // Validate by calling the service's validation endpoint
    // Include any service-specific extras (e.g. developerToken for Google Ads)
    const allExtras = { client_id: pending.clientId, client_secret: pending.clientSecret, ...(pending.extras ?? {}) };
    const validateUrl =
      typeof config.validateUrl === "function"
        ? config.validateUrl(allExtras)
        : config.validateUrl;

    let user = "Connected";
    const validateRes = await fetch(validateUrl, {
      headers: config.authHeader(accessToken, allExtras),
    });

    if (validateRes.ok) {
      const userData = await validateRes.json();
      user = config.extractUser(userData);
    } else {
      // OAuth token exchange succeeded, so credentials are valid.
      // Validation may fail for API-version or access-level reasons (e.g. Google Ads basic access).
      // Store credentials anyway — preConnect will handle token refresh on actual API calls.
      console.warn(`[OAuth callback] ${service} validation failed (${validateRes.status}), storing credentials anyway`);
    }

    // Persist refresh token + client credentials + any service-specific extras
    const store = loadStore();
    const oauthName = pending.instanceName?.trim() || "Default";
    const oauthStoreKey = makeInstanceId(service, slugifyInstance(oauthName));
    store[oauthStoreKey] = {
      token: refreshToken,
      user,
      extras: {
        client_id: pending.clientId,
        client_secret: pending.clientSecret,
        ...(pending.extras ?? {}),
      },
      _instanceName: oauthName,
    };
    saveStore(store);

    return res.send(oauthResultPage(true, user));
  } catch (err: any) {
    return res.send(oauthResultPage(false, err.message));
  }
});

function oauthResultPage(success: boolean, detail: string): string {
  const icon = success ? "&#10003;" : "&#10007;";
  const color = success ? "#22c55e" : "#ef4444";
  const title = success ? "Connected!" : "Connection Failed";
  const subtitle = success ? `Signed in as ${detail}` : detail;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OAuth - ${title}</title>
<style>
  body { margin:0; display:flex; align-items:center; justify-content:center; min-height:100vh;
    background:#0f0f0f; font-family:-apple-system,Arial,sans-serif; color:#e5e5e5; }
  .card { text-align:center; padding:48px; }
  .icon { font-size:48px; color:${color}; margin-bottom:16px; }
  h1 { font-size:24px; margin:0 0 8px; color:${color}; }
  p { font-size:14px; color:#999; margin:0 0 24px; max-width:360px; word-break:break-word; }
  button { background:#333; color:#fff; border:none; padding:10px 24px; border-radius:8px;
    cursor:pointer; font-size:14px; }
  button:hover { background:#444; }
</style></head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${subtitle}</p>
    <button onclick="window.close()">Close</button>
  </div>
  <script>
    ${success ? `window.opener?.postMessage({ type: "oauth-success" }, "*");` : ""}
    ${success ? "setTimeout(() => window.close(), 2000);" : ""}
  </script>
</body></html>`;
}

// GET /api/services/config — returns token URLs and display info (no secrets)
router.get("/config", (_req, res) => {
  const config: Record<string, any> = {};
  for (const [key, svc] of Object.entries(SERVICES)) {
    if (svc.kind === "connection") {
      config[key] = {
        name: svc.name,
        kind: "connection",
        protocol: svc.protocol,
        connectionFields: svc.connectionFields,
        defaultPort: svc.defaultPort,
        docsUrl: svc.docsUrl,
        ...(svc.tokenLabel ? { tokenLabel: svc.tokenLabel } : {}),
        ...(svc.authNote ? { authNote: svc.authNote } : {}),
        ...(svc.difficulty ? { difficulty: svc.difficulty } : {}),
      };
    } else {
      config[key] = {
        name: svc.name,
        kind: "rest",
        tokenUrl: svc.tokenUrl,
        tokenPrefix: svc.tokenPrefix,
        ...(svc.extraFields ? { extraFields: svc.extraFields } : {}),
        ...(svc.tokenLabel ? { tokenLabel: svc.tokenLabel } : {}),
        ...(svc.authNote ? { authNote: svc.authNote } : {}),
        ...(svc.difficulty ? { difficulty: svc.difficulty } : {}),
        ...(svc.oauth ? { oauth: { scopes: svc.oauth.scopes, redirectPath: svc.oauth.redirectPath } } : {}),
      };
    }
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
