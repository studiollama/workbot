import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Project root storage for service tokens (gitignored via .workbot/)
// When running from server/, resolve up to project root
// When running standalone (MCP), use cwd
const PROJECT_ROOT = process.cwd().endsWith("server")
  ? join(process.cwd(), "..")
  : process.cwd();
const STORE_DIR = join(PROJECT_ROOT, ".workbot");
const STORE_PATH = join(STORE_DIR, "services.json");

export { PROJECT_ROOT, STORE_DIR, STORE_PATH };

export interface StoredService {
  token: string;
  user: string;
  extras?: Record<string, string>;
}

export function loadStore(): Record<string, StoredService> {
  try {
    if (!existsSync(STORE_PATH)) return {};
    return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectPath: string;
}

export interface ServiceConfig {
  name: string;
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
  difficulty?: string;
  preConnect?: (
    token: string,
    extras: Record<string, string>
  ) => Promise<{ resolvedToken: string }>;
  oauth?: OAuthConfig;
}

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
    name: "Airtable",
    validateUrl: "https://api.airtable.com/v0/meta/whoami",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => data.email ?? data.id,
    tokenUrl: "https://airtable.com/create/tokens",
    tokenPrefix: "pat",
    difficulty: "API Key",
  },
  asana: {
    name: "Asana",
    validateUrl: "https://app.asana.com/api/1.0/users/me",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => data.data?.name ?? data.data?.email ?? "Connected",
    tokenUrl: "https://app.asana.com/0/developer-console",
    tokenPrefix: "",
    difficulty: "API Key",
  },
  zendesk: {
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
  squarespace: {
    name: "Squarespace",
    validateUrl: "https://api.squarespace.com/1.0/authorization/website",
    authHeader: (token) => ({
      Authorization: `Bearer ${token}`,
      "User-Agent": "workbot",
    }),
    extractUser: (data) => data.website?.siteTitle ?? data.id ?? "Connected",
    tokenUrl: "https://developers.squarespace.com/",
    tokenPrefix: "",
    difficulty: "OAuth Token",
  },
  freshdesk: {
    name: "Freshdesk",
    validateUrl: (extras) =>
      `https://${extras.subdomain}.freshdesk.com/api/v2/agents/me`,
    authHeader: (token) => ({
      Authorization:
        "Basic " + Buffer.from(`${token}:X`).toString("base64"),
    }),
    extractUser: (data) =>
      data.contact?.name ?? data.contact?.email ?? "Connected",
    tokenUrl:
      "https://support.freshdesk.com/en/support/solutions/articles/215517",
    tokenPrefix: "",
    extraFields: [
      {
        key: "subdomain",
        label: "Freshdesk Subdomain",
        placeholder: "yourcompany",
      },
    ],
    difficulty: "API Key + Config",
  },
  quickbooks: {
    name: "QuickBooks",
    validateUrl: (extras) =>
      `https://quickbooks.api.intuit.com/v3/company/${extras.realmId}/companyinfo/${extras.realmId}`,
    authHeader: (token) => ({
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    }),
    extractUser: (data) => data.CompanyInfo?.CompanyName ?? "Connected",
    tokenUrl: "https://developer.intuit.com/app/developer/playground",
    tokenPrefix: "",
    authNote:
      "OAuth token — expires after ~1 hour. Re-connect when expired.",
    difficulty: "OAuth Token",
    extraFields: [
      {
        key: "realmId",
        label: "Company ID (Realm ID)",
        placeholder: "123456789",
      },
    ],
  },
  googleads: {
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
  canva: {
    name: "Canva",
    validateUrl: "https://api.canva.com/rest/v1/users/me",
    authHeader: (token) => ({
      Authorization: `Bearer ${token}`,
    }),
    extractUser: (data) =>
      data.display_name ?? data.email ?? "Connected",
    tokenUrl: "https://www.canva.dev/docs/connect/authentication/",
    tokenPrefix: "",
    authNote:
      "OAuth token — expires after ~4 hours. Re-connect when expired.",
    difficulty: "OAuth Token",
  },
  nanobanana: {
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
  gmail: {
    name: "Gmail",
    validateUrl:
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => data.emailAddress ?? "Connected",
    tokenUrl: "https://developers.google.com/oauthplayground/",
    tokenPrefix: "",
    tokenLabel: "Refresh Token",
    authNote:
      "Enter your OAuth credentials and click 'Sign in with Google', or paste a refresh token manually.",
    difficulty: "OAuth + Credentials",
    extraFields: [
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
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Gmail token refresh failed (${res.status}): ${text.slice(0, 200)}`
        );
      }
      const data = await res.json();
      return { resolvedToken: data.access_token };
    },
  },
  googleadmin: {
    name: "Google Admin Console",
    validateUrl:
      "https://admin.googleapis.com/admin/directory/v1/users?maxResults=1&customer=my_customer",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => {
      const users = data.users ?? [];
      return users.length > 0
        ? `${users[0].name?.fullName ?? users[0].primaryEmail ?? "Admin"}`
        : "Connected";
    },
    tokenUrl: "https://developers.google.com/oauthplayground/",
    tokenPrefix: "",
    authNote:
      "OAuth token — expires after ~1 hour. Re-connect when expired.",
    difficulty: "Admin + OAuth",
  },
  ticktick: {
    name: "TickTick",
    validateUrl: "https://api.ticktick.com/open/v1/user",
    authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
    extractUser: (data) => data.username ?? data.name ?? "Connected",
    tokenUrl: "https://developer.ticktick.com/",
    tokenPrefix: "",
    authNote: "OAuth token — may expire. Re-connect when expired.",
    difficulty: "OAuth Token",
  },
  readai: {
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
};
