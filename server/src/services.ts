import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import {
  readActiveKey,
  encryptStore,
  decryptStore,
  getStoreSalt,
} from "./crypto.js";
import { PROJECT_ROOT, STORE_DIR, STORE_PATH } from "./paths.js";
import type { StoredService } from "./paths.js";
import { postgresqlService } from "./connections/postgresql.js";
import { oracleService } from "./connections/oracle.js";
import { sshService } from "./connections/ssh.js";
import { sftpService } from "./connections/sftp.js";
import { ftpService } from "./connections/ftp.js";
import { telnetService } from "./connections/telnet.js";

export { PROJECT_ROOT, STORE_DIR, STORE_PATH };
export type { StoredService };

const QBO_AIRTABLE_BASE = "appHHMEcznh7jG3aC";
const QBO_AIRTABLE_TABLE = "tblcWybeCnP8UX819";
const QBO_AIRTABLE_RECORD = "recH9CoDcIGAwnJHk";

function getAirtableToken(): string | null {
  const store = loadStore();
  const airtable = Object.entries(store).find(([k]) => k === "airtable" || k.startsWith("airtable:"));
  return airtable?.[1]?.token ?? null;
}

async function readQboRefreshFromAirtable(): Promise<string | null> {
  const atToken = getAirtableToken();
  if (!atToken) return null;

  const res = await fetch(
    `https://api.airtable.com/v0/${QBO_AIRTABLE_BASE}/${QBO_AIRTABLE_TABLE}/${QBO_AIRTABLE_RECORD}`,
    { headers: { Authorization: `Bearer ${atToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.fields?.Key ?? null;
}

async function syncQboRefreshToAirtable(newRefreshToken: string): Promise<void> {
  const atToken = getAirtableToken();
  if (!atToken) return;

  await fetch(
    `https://api.airtable.com/v0/${QBO_AIRTABLE_BASE}/${QBO_AIRTABLE_TABLE}/${QBO_AIRTABLE_RECORD}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${atToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: { Key: newRefreshToken } }),
    }
  );
  console.log("[QBO] Refresh token synced to Airtable");
}

export function loadStore(): Record<string, StoredService> {
  try {
    if (!existsSync(STORE_PATH)) return {};
    const raw = JSON.parse(readFileSync(STORE_PATH, "utf-8"));

    let data: Record<string, StoredService>;

    // Encrypted store — need active key to decrypt
    if (raw._encrypted === true) {
      const key = readActiveKey();
      if (!key) {
        console.warn("Encrypted services.json but no active key — returning empty store");
        return {};
      }
      data = decryptStore(raw, key);
    } else {
      // Legacy plaintext store
      data = raw;
    }

    // Auto-migrate bare keys to instance format
    const { store: migrated, changed } = migrateToInstances(data);
    if (changed) {
      try { saveStore(migrated); } catch { /* save might fail if no active key */ }
    }
    return migrated;
  } catch {
    return {};
  }
}

/** Migrate bare service keys (e.g. "github") to instance keys ("github:default").
 *  Runs automatically on loadStore — idempotent, only writes if changes were made. */
function migrateToInstances(store: Record<string, StoredService>): { store: Record<string, StoredService>; changed: boolean } {
  let changed = false;
  const migrated: Record<string, StoredService> = {};

  for (const [key, value] of Object.entries(store)) {
    const { slug } = parseInstanceId(key);
    if (slug === "default" && key === parseInstanceId(key).serviceType) {
      // Bare key like "github" → migrate to "github:default"
      const newKey = makeInstanceId(key, "default");
      migrated[newKey] = { ...value, _instanceName: value._instanceName || "Default" };
      changed = true;
    } else {
      // Already an instance key — ensure it has a name
      if (!value._instanceName) {
        migrated[key] = { ...value, _instanceName: slug === "default" ? "Default" : slug };
        changed = true;
      } else {
        migrated[key] = value;
      }
    }
  }

  return { store: migrated, changed };
}

export function saveStore(data: Record<string, StoredService>): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });

  // If we have an active key, encrypt before saving
  const key = readActiveKey();
  const salt = getStoreSalt();
  if (key && salt) {
    const encrypted = encryptStore(data, key, salt);
    writeFileSync(STORE_PATH, JSON.stringify(encrypted, null, 2));
  } else {
    writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
  }
}

// ── Multi-instance helpers ─────────────────────────────────────────────

/** Parse "github:read-only" → { serviceType: "github", slug: "read-only" } */
export function parseInstanceId(instanceId: string): { serviceType: string; slug: string } {
  const colonIdx = instanceId.indexOf(":");
  if (colonIdx === -1) return { serviceType: instanceId, slug: "default" };
  return { serviceType: instanceId.slice(0, colonIdx), slug: instanceId.slice(colonIdx + 1) };
}

/** Build instance ID from type + slug */
export function makeInstanceId(serviceType: string, slug: string): string {
  return slug === "default" ? serviceType : `${serviceType}:${slug}`;
}

/** Slugify a user-facing instance name */
export function slugifyInstance(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";
}

/** Get all instance IDs in the store for a given service type */
export function getInstancesForType(store: Record<string, StoredService>, serviceType: string): string[] {
  return Object.keys(store).filter((key) => parseInstanceId(key).serviceType === serviceType);
}

/** Resolve an instance ID to its ServiceConfig (looks up by type) */
export function resolveServiceConfig(instanceId: string): ServiceConfig | undefined {
  const { serviceType } = parseInstanceId(instanceId);
  return SERVICES[serviceType];
}

/** Check if a subagent's allowedServices list permits an instance ID */
export function isServiceAllowed(instanceId: string, allowedServices: string[]): boolean {
  const { serviceType } = parseInstanceId(instanceId);
  // Exact instance match
  if (allowedServices.includes(instanceId)) return true;
  // Bare type match (grants access to all instances of that type)
  if (allowedServices.includes(serviceType)) return true;
  return false;
}

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectPath: string;
}

// ── Discriminated union: REST vs Connection services ──────────────────

interface ServiceConfigBase {
  name: string;
  difficulty?: string;
}

export interface RestServiceConfig extends ServiceConfigBase {
  kind: "rest";
  validateUrl: string | ((extras: Record<string, string>) => string);
  authHeader: (
    token: string,
    extras?: Record<string, string>
  ) => Record<string, string>;
  extractUser: (data: any) => string;
  tokenUrl: string;
  tokenPrefix: string;
  extraFields?: { key: string; label: string; placeholder: string }[];
  tokenLabel?: string;
  authNote?: string;
  preConnect?: (
    token: string,
    extras: Record<string, string>
  ) => Promise<{ resolvedToken: string; updatedToken?: string }>;
  oauth?: OAuthConfig;
}

export interface ConnectionField {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password" | "textarea" | "number";
  required?: boolean;
  defaultValue?: string;
}

export interface ConnectionServiceConfig extends ServiceConfigBase {
  kind: "connection";
  protocol: "database" | "ssh" | "sftp" | "ftp" | "telnet";
  connectionFields: ConnectionField[];
  validate: (params: Record<string, string>) => Promise<{ user: string }>;
  execute: (params: Record<string, string>, command: string) => Promise<string>;
  defaultPort: number;
  docsUrl: string;
  tokenLabel?: string;
  authNote?: string;
}

export type ServiceConfig = RestServiceConfig | ConnectionServiceConfig;

// Azure AD client credentials → bearer token exchange
export async function getAzureADToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  scope = "https://graph.microsoft.com/.default"
): Promise<string> {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Azure AD token exchange failed (${res.status}): ${text.slice(0, 200)}`
    );
  }
  const data = await res.json();
  return data.access_token;
}

export const SERVICES: Record<string, ServiceConfig> = {
  github: {
    kind: "rest",
    name: "GitHub",
    validateUrl: "https://api.github.com/user",
    authHeader: (token) => ({
      Authorization: `Bearer ${token}`,
      "User-Agent": "workbot",
    }),
    extractUser: (data) => data.login,
    tokenUrl: "https://github.com/settings/tokens",
    tokenPrefix: "ghp_",
    difficulty: "API Key",
  },
  airtable: {
    kind: "rest",
    name: "Airtable",
    validateUrl: "https://api.airtable.com/v0/meta/whoami",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => data.email ?? data.id,
    tokenUrl: "https://airtable.com/create/tokens",
    tokenPrefix: "pat",
    difficulty: "API Key",
  },
  asana: {
    kind: "rest",
    name: "Asana",
    validateUrl: "https://app.asana.com/api/1.0/users/me",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => data.data?.name ?? data.data?.email ?? "Connected",
    tokenUrl: "https://app.asana.com/0/developer-console",
    tokenPrefix: "",
    difficulty: "API Key",
  },
  zendesk: {
    kind: "rest",
    name: "Zendesk",
    validateUrl: (extras) =>
      `https://${extras.subdomain}.zendesk.com/api/v2/users/me.json`,
    authHeader: (token, extras) => ({
      Authorization:
        "Basic " +
        Buffer.from(`${extras?.email}/token:${token}`).toString("base64"),
    }),
    extractUser: (data) => data.user?.name ?? data.user?.email ?? "Connected",
    tokenUrl:
      "https://support.zendesk.com/hc/en-us/articles/4408889192858",
    tokenPrefix: "",
    extraFields: [
      {
        key: "subdomain",
        label: "Zendesk Subdomain",
        placeholder: "yourcompany",
      },
      {
        key: "email",
        label: "Agent Email",
        placeholder: "you@company.com",
      },
    ],
    difficulty: "API Key + Config",
  },
  googleads: {
    kind: "rest",
    name: "Google Ads",
    validateUrl:
      "https://googleads.googleapis.com/v20/customers:listAccessibleCustomers",
    authHeader: (token, extras) => ({
      Authorization: `Bearer ${token}`,
      "developer-token": extras?.developerToken ?? "",
    }),
    extractUser: (data) => {
      const customers = data.resourceNames ?? [];
      return customers.length > 0
        ? `${customers.length} account(s)`
        : "Connected";
    },
    tokenUrl:
      "https://developers.google.com/google-ads/api/docs/get-started/oauth-cloud-project",
    tokenPrefix: "",
    tokenLabel: "Refresh Token",
    authNote:
      "Enter your OAuth credentials and click 'Sign in with Google', or paste a refresh token manually.",
    difficulty: "OAuth + Credentials",
    extraFields: [
      {
        key: "developerToken",
        label: "Developer Token",
        placeholder: "xxxxxxxxxxxxxxx",
      },
      {
        key: "client_id",
        label: "OAuth Client ID",
        placeholder: "xxxxx.apps.googleusercontent.com",
      },
      {
        key: "client_secret",
        label: "OAuth Client Secret",
        placeholder: "GOCSPX-xxxxx",
      },
    ],
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/adwords"],
      redirectPath: "/api/services/googleads/oauth/callback",
    },
    preConnect: async (refreshToken, extras) => {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: extras.client_id,
          client_secret: extras.client_secret,
          refresh_token: refreshToken,
        }).toString(),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Google Ads token refresh failed (${res.status}): ${text.slice(0, 200)}`
        );
      }
      const data = await res.json();
      return { resolvedToken: data.access_token };
    },
  },
  entra: {
    kind: "rest",
    name: "Entra (Azure AD)",
    validateUrl: "https://graph.microsoft.com/v1.0/organization",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => {
      const org = data.value?.[0];
      return org?.displayName ?? org?.id ?? "Connected";
    },
    tokenUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps",
    tokenPrefix: "",
    tokenLabel: "Client Secret",
    difficulty: "Enterprise App",
    extraFields: [
      {
        key: "tenant_id",
        label: "Tenant ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
      {
        key: "client_id",
        label: "Client ID (App ID)",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
    ],
    preConnect: async (clientSecret, extras) => {
      const resolvedToken = await getAzureADToken(
        extras.tenant_id,
        extras.client_id,
        clientSecret
      );
      return { resolvedToken };
    },
  },
  intune: {
    kind: "rest",
    name: "Intune",
    validateUrl:
      "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=1",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) =>
      data.value
        ? `${data["@odata.count"] ?? data.value.length} device(s)`
        : "Connected",
    tokenUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps",
    tokenPrefix: "",
    tokenLabel: "Client Secret",
    difficulty: "Enterprise App",
    extraFields: [
      {
        key: "tenant_id",
        label: "Tenant ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
      {
        key: "client_id",
        label: "Client ID (App ID)",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
    ],
    preConnect: async (clientSecret, extras) => {
      const resolvedToken = await getAzureADToken(
        extras.tenant_id,
        extras.client_id,
        clientSecret
      );
      return { resolvedToken };
    },
  },
  security: {
    kind: "rest",
    name: "Security Center / XDR",
    validateUrl:
      "https://graph.microsoft.com/v1.0/security/alerts_v2?$top=1",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) =>
      data.value
        ? `${data["@odata.count"] ?? data.value.length} alert(s)`
        : "Connected",
    tokenUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps",
    tokenPrefix: "",
    tokenLabel: "Client Secret",
    difficulty: "Enterprise App",
    extraFields: [
      {
        key: "tenant_id",
        label: "Tenant ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
      {
        key: "client_id",
        label: "Client ID (App ID)",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
    ],
    preConnect: async (clientSecret, extras) => {
      const resolvedToken = await getAzureADToken(
        extras.tenant_id,
        extras.client_id,
        clientSecret
      );
      return { resolvedToken };
    },
  },
  nanobanana: {
    kind: "rest",
    name: "Nano Banana (Gemini)",
    validateUrl:
      "https://generativelanguage.googleapis.com/v1beta/models",
    authHeader: (token) => ({
      "x-goog-api-key": token,
    }),
    extractUser: (data) => {
      const models = data.models ?? [];
      return models.length > 0
        ? `${models.length} model(s) available`
        : "Connected";
    },
    tokenUrl: "https://aistudio.google.com/apikey",
    tokenPrefix: "AIza",
    difficulty: "API Key",
  },
  jules: {
    kind: "rest",
    name: "Jules",
    validateUrl: "https://jules.googleapis.com/v1alpha/sessions",
    authHeader: (token) => ({
      "X-Goog-Api-Key": token,
    }),
    extractUser: (data) => {
      const sessions = data.sessions ?? [];
      return sessions.length > 0
        ? `${sessions.length} session(s)`
        : "Connected";
    },
    tokenUrl: "https://developers.google.com/jules/api",
    tokenPrefix: "",
    difficulty: "API Key",
  },
  sharepoint: {
    kind: "rest",
    name: "SharePoint",
    validateUrl: (extras) =>
      `https://${extras.site_host}/_api/web`,
    authHeader: (token) => ({
      Authorization: `Bearer ${token}`,
      Accept: "application/json;odata=verbose",
    }),
    extractUser: (data) => data.d?.Title ?? data.Title ?? "Connected",
    tokenUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps",
    tokenPrefix: "",
    tokenLabel: "Client Secret",
    difficulty: "Enterprise App",
    extraFields: [
      {
        key: "site_host",
        label: "SharePoint Host",
        placeholder: "yourcompany.sharepoint.com",
      },
      {
        key: "tenant_id",
        label: "Tenant ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
      {
        key: "client_id",
        label: "Client ID (App ID)",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
    ],
    preConnect: async (clientSecret, extras) => {
      const resolvedToken = await getAzureADToken(
        extras.tenant_id,
        extras.client_id,
        clientSecret,
        `https://${extras.site_host}/.default`
      );
      return { resolvedToken };
    },
  },
  outlook: {
    kind: "rest",
    name: "Outlook (Microsoft 365)",
    validateUrl:
      "https://graph.microsoft.com/v1.0/users?$top=1&$select=displayName,mail",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => {
      const user = data.value?.[0];
      return user?.displayName ?? user?.mail ?? "Connected";
    },
    tokenUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps",
    tokenPrefix: "",
    tokenLabel: "Client Secret",
    difficulty: "Enterprise App",
    extraFields: [
      {
        key: "tenant_id",
        label: "Tenant ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
      {
        key: "client_id",
        label: "Client ID (App ID)",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
    ],
    preConnect: async (clientSecret, extras) => {
      const resolvedToken = await getAzureADToken(
        extras.tenant_id,
        extras.client_id,
        clientSecret
      );
      return { resolvedToken };
    },
  },
  readai: {
    kind: "rest",
    name: "Read.ai",
    validateUrl: "https://api.read.ai/v1/meetings",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => {
      const meetings = data.meetings ?? data.data ?? [];
      return Array.isArray(meetings)
        ? `${meetings.length} meeting(s)`
        : "Connected";
    },
    tokenUrl:
      "https://support.freshdesk.com/en/support/solutions/articles/215517",
    tokenPrefix: "sk_",
    authNote:
      "OAuth token — expires after 10 minutes. Re-connect when expired.",
    difficulty: "OAuth Token",
  },
  dagster: {
    kind: "rest",
    name: "Dagster Cloud",
    validateUrl: (extras) =>
      `https://${extras.org_name}.dagster.cloud/prod/report_asset_materialization/`,
    authHeader: (token) => ({
      "Dagster-Cloud-Api-Token": token,
    }),
    extractUser: () => "Connected",
    tokenUrl:
      "https://docs.dagster.io/deployment/dagster-plus/management/tokens",
    tokenPrefix: "",
    tokenLabel: "User Token",
    extraFields: [
      {
        key: "org_name",
        label: "Organization Name",
        placeholder: "your-org-name",
      },
    ],
    difficulty: "API Key + Config",
  },
  render: {
    kind: "rest",
    name: "Render",
    validateUrl: "https://api.render.com/v1/owners",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => {
      const owners = Array.isArray(data) ? data : data?.owners ?? [];
      return (
        owners[0]?.owner?.name ?? owners[0]?.owner?.email ?? "Connected"
      );
    },
    tokenUrl: "https://render.com/docs/api#creating-an-api-key",
    tokenPrefix: "rnd_",
    difficulty: "API Key",
  },
  stripe: {
    kind: "rest",
    name: "Stripe",
    validateUrl: "https://api.stripe.com/v1/balance",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => {
      const available = data.available ?? [];
      if (available.length > 0) {
        const cur = available[0].currency?.toUpperCase() ?? "";
        const amt = (available[0].amount / 100).toFixed(2);
        return `${cur} ${amt} available`;
      }
      return "Connected";
    },
    tokenUrl: "https://dashboard.stripe.com/apikeys",
    tokenPrefix: "sk_",
    difficulty: "API Key",
  },
  supabase: {
    kind: "rest",
    name: "Supabase",
    validateUrl: "https://api.supabase.com/v1/projects",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => {
      const projects = Array.isArray(data) ? data : [];
      return projects.length > 0
        ? `${projects.length} project(s)`
        : "Connected";
    },
    tokenUrl: "https://supabase.com/dashboard/account/tokens",
    tokenPrefix: "sbp_",
    difficulty: "API Key",
  },

  // ── Restored services ──────────────────────────────────────────────

  squarespace: {
    kind: "rest",
    name: "Squarespace",
    validateUrl: "https://api.squarespace.com/1.0/authorization/website",
    authHeader: (token) => ({ Authorization: `Bearer ${token}`, "User-Agent": "workbot" }),
    extractUser: (data) => data.website?.siteTitle ?? data.id ?? "Connected",
    tokenUrl: "https://developers.squarespace.com/",
    tokenPrefix: "",
    difficulty: "OAuth Token",
  },
  freshdesk: {
    kind: "rest",
    name: "Freshdesk",
    validateUrl: (extras) => `https://${extras.subdomain}.freshdesk.com/api/v2/agents/me`,
    authHeader: (token) => ({ Authorization: "Basic " + Buffer.from(`${token}:X`).toString("base64") }),
    extractUser: (data) => data.contact?.name ?? data.contact?.email ?? "Connected",
    tokenUrl: "https://support.freshdesk.com/en/support/solutions/articles/215517",
    tokenPrefix: "",
    extraFields: [{ key: "subdomain", label: "Freshdesk Subdomain", placeholder: "yourcompany" }],
    difficulty: "API Key + Config",
  },
  quickbooks: {
    kind: "rest",
    name: "QuickBooks",
    validateUrl: (extras) => `https://quickbooks.api.intuit.com/v3/company/${extras.realmId}/companyinfo/${extras.realmId}`,
    authHeader: (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/json" }),
    extractUser: (data) => data.CompanyInfo?.CompanyName ?? "Connected",
    tokenUrl: "https://developer.intuit.com/app/developer/playground",
    tokenPrefix: "",
    authNote: "Paste refresh token. Access tokens are auto-refreshed via OAuth.",
    difficulty: "OAuth Token",
    extraFields: [
      { key: "realmId", label: "Company ID (Realm ID)", placeholder: "123456789" },
      { key: "client_id", label: "Client ID", placeholder: "ABc...from Intuit Developer" },
      { key: "client_secret", label: "Client Secret", placeholder: "ABc...from Intuit Developer" },
    ],
    preConnect: async (_storedToken, extras) => {
      // Airtable is the single source of truth for the refresh token
      const atRefresh = await readQboRefreshFromAirtable();
      const refreshToken = atRefresh ?? _storedToken;

      const basicAuth = Buffer.from(`${extras.client_id}:${extras.client_secret}`).toString("base64");
      const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`QuickBooks token refresh failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      const newRefreshToken: string | undefined = data.refresh_token;

      // Write rotated refresh token back to Airtable and local store
      if (newRefreshToken) {
        if (newRefreshToken !== refreshToken) {
          syncQboRefreshToAirtable(newRefreshToken).catch((err) =>
            console.warn("[QBO] Airtable refresh token sync failed:", err.message)
          );
        }
        // Always update local store to stay in sync with Airtable
        if (newRefreshToken !== _storedToken) {
          return { resolvedToken: data.access_token, updatedToken: newRefreshToken };
        }
      }

      return { resolvedToken: data.access_token };
    },
  },
  canva: {
    kind: "rest",
    name: "Canva",
    validateUrl: "https://api.canva.com/rest/v1/users/me",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => data.display_name ?? data.email ?? "Connected",
    tokenUrl: "https://www.canva.dev/docs/connect/authentication/",
    tokenPrefix: "",
    authNote: "OAuth token — expires after ~4 hours. Re-connect when expired.",
    difficulty: "OAuth Token",
  },
  gmail: {
    kind: "rest",
    name: "Gmail",
    validateUrl: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => data.emailAddress ?? "Connected",
    tokenUrl: "https://developers.google.com/oauthplayground/",
    tokenPrefix: "",
    tokenLabel: "Refresh Token",
    authNote: "Enter your OAuth credentials and click 'Sign in with Google', or paste a refresh token manually.",
    difficulty: "OAuth + Credentials",
    extraFields: [
      { key: "client_id", label: "OAuth Client ID", placeholder: "xxxxx.apps.googleusercontent.com" },
      { key: "client_secret", label: "OAuth Client Secret", placeholder: "GOCSPX-xxxxx" },
    ],
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.settings.basic",
        "https://www.googleapis.com/auth/gmail.labels",
      ],
      redirectPath: "/api/services/gmail/oauth/callback",
    },
    preConnect: async (refreshToken, extras) => {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: extras.client_id,
          client_secret: extras.client_secret,
          refresh_token: refreshToken,
        }).toString(),
      });
      if (!res.ok) { const t = await res.text(); throw new Error(`Gmail token refresh failed (${res.status}): ${t.slice(0, 200)}`); }
      const data = await res.json();
      return { resolvedToken: data.access_token };
    },
  },
  googleadmin: {
    kind: "rest",
    name: "Google Admin Console",
    validateUrl: "https://admin.googleapis.com/admin/directory/v1/users?maxResults=1&customer=my_customer",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => {
      const users = data.users ?? [];
      return users.length > 0 ? `${users[0].name?.fullName ?? users[0].primaryEmail ?? "Admin"}` : "Connected";
    },
    tokenUrl: "https://developers.google.com/oauthplayground/",
    tokenPrefix: "",
    authNote: "OAuth token — expires after ~1 hour. Re-connect when expired.",
    difficulty: "Admin + OAuth",
  },
  ticktick: {
    kind: "rest",
    name: "TickTick",
    validateUrl: "https://api.ticktick.com/open/v1/user",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => data.username ?? data.name ?? "Connected",
    tokenUrl: "https://developer.ticktick.com/",
    tokenPrefix: "",
    authNote: "OAuth token — may expire. Re-connect when expired.",
    difficulty: "OAuth Token",
  },

  // ── New REST services ───────────────────────────────────────────────

  hex: {
    kind: "rest",
    name: "Hex",
    validateUrl: "https://app.hex.tech/api/v1/user/me",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => data.email ?? data.name ?? "Connected",
    tokenUrl: "https://app.hex.tech/settings/tokens",
    tokenPrefix: "",
    difficulty: "API Key",
  },
  crowdstrike: {
    kind: "rest",
    name: "CrowdStrike",
    validateUrl: "https://api.crowdstrike.com/sensors/queries/installers/ccid/v1",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: () => "Connected",
    tokenUrl: "https://falcon.crowdstrike.com/api-clients-and-keys",
    tokenPrefix: "",
    tokenLabel: "Client Secret",
    authNote: "Uses OAuth2 client credentials flow. Token is exchanged automatically.",
    difficulty: "OAuth Client Credentials",
    extraFields: [
      { key: "base_url", label: "API Base URL", placeholder: "api.crowdstrike.com" },
      { key: "client_id", label: "Client ID", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    ],
    preConnect: async (clientSecret, extras) => {
      const baseUrl = extras.base_url || "api.crowdstrike.com";
      const res = await fetch(`https://${baseUrl}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: extras.client_id,
          client_secret: clientSecret,
        }).toString(),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`CrowdStrike token exchange failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      return { resolvedToken: data.access_token };
    },
  },
  filescom: {
    kind: "rest",
    name: "Files.com",
    validateUrl: "https://app.files.com/api/rest/v1/api_keys?per_page=1",
    authHeader: (token) => ({ "X-FilesAPI-Key": token }),
    extractUser: () => "Connected",
    tokenUrl: "https://www.files.com/docs/sdk-and-tools/api-keys",
    tokenPrefix: "",
    difficulty: "API Key",
  },

  // ── Connection services ─────────────────────────────────────────────

  postgresql: {
    kind: "connection",
    name: "PostgreSQL",
    difficulty: "Connection",
    ...postgresqlService,
  },
  oracle: {
    kind: "connection",
    name: "Oracle 11g",
    difficulty: "Connection + InstantClient",
    ...oracleService,
  },
  ssh: {
    kind: "connection",
    name: "SSH",
    difficulty: "Connection",
    ...sshService,
  },
  sftp: {
    kind: "connection",
    name: "SFTP",
    difficulty: "Connection",
    ...sftpService,
  },
  ftp: {
    kind: "connection",
    name: "FTP",
    difficulty: "Connection",
    ...ftpService,
  },
  telnet: {
    kind: "connection",
    name: "Telnet",
    difficulty: "Connection",
    ...telnetService,
  },
  betterstack: {
    kind: "rest",
    name: "Better Stack",
    validateUrl: "https://uptime.betterstack.com/api/v2/monitors?per_page=1",
    authHeader: (token) => ({
      Authorization: `Bearer ${token}`,
    }),
    extractUser: (data) => {
      const count = data?.pagination?.total ?? data?.data?.length ?? 0;
      return `${count} monitors`;
    },
    tokenUrl: "https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/",
    tokenPrefix: "",
    tokenLabel: "Uptime API Token",
    authNote: "Enter your Uptime API token as the main token. Add the Telemetry (Logs) source token below.",
    extraFields: [
      {
        key: "telemetry_token",
        label: "Telemetry Source Token",
        placeholder: "Your Better Stack Logs source token",
      },
    ],
    difficulty: "API Key + Config",
  },
  guru: {
    kind: "rest",
    name: "Guru",
    validateUrl: "https://api.getguru.com/api/v1/whoami",
    authHeader: (token, extras) => {
      // Basic auth: username:token
      const username = extras?.username || "";
      return {
        Authorization: "Basic " + Buffer.from(`${username}:${token}`).toString("base64"),
      };
    },
    extractUser: (data) => data.email ?? (data.firstName ? `${data.firstName} ${data.lastName}` : "Connected"),
    tokenUrl: "https://developer.getguru.com/docs/getting-started",
    tokenPrefix: "",
    tokenLabel: "API Token",
    authNote: "User Token: enter your email or Guru username. Collection Token: enter the Collection ID.",
    extraFields: [
      {
        key: "username",
        label: "User (email) or Collection ID",
        placeholder: "you@company.com or collection-id",
      },
    ],
    difficulty: "API Key + Config",
  },
};
