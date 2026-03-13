# Workbot Dashboard & MCP Services

> Reference doc. Do NOT load at boot. Read when you need to interact with external services.

## What It Is

The dashboard is a React + Express web app (`client/` + `server/`) that manages connections to external MCP services. It validates tokens, persists them to disk, and provides a UI for connecting/disconnecting.

## Running the Dashboard

```bash
npm run dev          # starts client (:5173) + server (:3001)
```

Vite proxies `/api` → Express. Preview launch.json uses `node node_modules/vite/bin/vite.js` (npx broken on Windows).

## Available Services

| Service | Auth Type | Token Source | API |
|---------|-----------|-------------|-----|
| GitHub | PAT | [github.com/settings/tokens](https://github.com/settings/tokens) | `api.github.com/user` |
| Airtable | PAT | [airtable.com/create/tokens](https://airtable.com/create/tokens) | `api.airtable.com/v0/meta/whoami` |
| Asana | PAT | [app.asana.com/0/developer-console](https://app.asana.com/0/developer-console) | `app.asana.com/api/1.0/users/me` |
| Zendesk | API Token + Basic Auth | Admin Center → API Tokens | `{subdomain}.zendesk.com/api/v2/users/me` |
| Squarespace | Bearer | [developers.squarespace.com](https://developers.squarespace.com/) | `api.squarespace.com/1.0/authorization/website` |
| Freshdesk | Basic (key:X) | Freshdesk profile → API key | `{subdomain}.freshdesk.com/api/v2/agents/me` |
| QuickBooks | Bearer (OAuth, expires ~1hr) | [Intuit developer playground](https://developer.intuit.com/app/developer/playground) | `quickbooks.api.intuit.com/v3/company/{realmId}/companyinfo/{realmId}` |
| Google Ads | Bearer + dev token (expires ~1hr) | Google OAuth + developer token | `googleads.googleapis.com/v17/customers:listAccessibleCustomers` |
| Entra (Azure AD) | Client credentials → Bearer | [Azure app registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps) | `graph.microsoft.com/v1.0/organization` |
| Intune | Client credentials → Bearer | Same Azure app registration | `graph.microsoft.com/v1.0/deviceManagement/managedDevices` |
| Security Center/XDR | Client credentials → Bearer | Same Azure app registration | `graph.microsoft.com/v1.0/security/alerts_v2` |
| Canva | Bearer (OAuth, expires ~4hr) | [Canva Connect API](https://www.canva.dev/docs/connect/authentication/) | `api.canva.com/rest/v1/users/me` |
| Nano Banana (Gemini) | API Key | [Google AI Studio](https://aistudio.google.com/apikey) | `generativelanguage.googleapis.com/v1beta/models` |
| Jules | API Key | [Jules API docs](https://developers.google.com/jules/api) | `jules.googleapis.com/v1alpha/sessions` |
| SharePoint | Client credentials → Bearer | [Azure app registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps) | `{site_host}/_api/web` |
| Outlook (Microsoft 365) | Client credentials → Bearer | [Azure app registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps) | `graph.microsoft.com/v1.0/users` |
| Gmail | Bearer (OAuth, expires ~1hr) | [Google OAuth Playground](https://developers.google.com/oauthplayground/) | `gmail.googleapis.com/gmail/v1/users/me/profile` |
| Google Admin Console | Bearer (OAuth, expires ~1hr) | [Google OAuth Playground](https://developers.google.com/oauthplayground/) | `admin.googleapis.com/admin/directory/v1/users` |
| TickTick | Bearer (OAuth) | [TickTick Developer](https://developer.ticktick.com/) | `api.ticktick.com/open/v1/user` |
| Read.ai | Bearer (OAuth, expires ~10min) | [Read.ai API Keys](https://support.read.ai/hc/en-us/articles/49380809380371) | `api.read.ai/v1/meetings` |
| Dagster Cloud | User Token + Org Name | [Dagster Tokens Docs](https://docs.dagster.io/deployment/dagster-plus/management/tokens) | `{org}.dagster.cloud/prod/report_asset_materialization/` |
| Render | Bearer (API Key) | [Render API Docs](https://render.com/docs/api#creating-an-api-key) | `api.render.com/v1/owners` |
| Supabase | Bearer (API Key) | [Supabase Tokens](https://supabase.com/dashboard/account/tokens) | `api.supabase.com/v1/projects` |
| Codex (ChatGPT) | Device-code OAuth | Via dashboard UI flow | Optional — ChatGPT subscription auth |

## How Tokens Work

- Tokens persist in `.workbot/services.json` (gitignored, project root)
- On connect: token is validated against the service's API, then stored
- On disconnect: token is removed from the store
- Azure services (Entra, Intune, Security): user provides client credentials; backend exchanges for bearer token via `preConnect` hook, validates, then stores credentials (not the ephemeral token)
- QuickBooks/Google Ads: OAuth tokens expire after ~1 hour — `authNote` warning shown in UI
- Codex (optional) uses `.workbot/codex-auth.json` via `CODEX_HOME` env var
- Tokens survive server restarts (disk-backed, not session-only)

## Dashboard Customization

- Dashboard layout persists in `.workbot/dashboard.json` (gitignored)
- Click the gear icon to open the service drawer
- Toggle services on/off with +/- buttons
- Drag enabled services to reorder
- Default: all services enabled if no dashboard config exists

## Adding a New Service

Edit `server/src/routes/services.ts` and add to the `SERVICES` record:

```typescript
newservice: {
  name: "Display Name",
  validateUrl: "https://api.service.com/validate-endpoint",
  authHeader: (token) => ({ Authorization: `Bearer ${token}` }),
  extractUser: (data) => data.username,
  tokenUrl: "https://service.com/create-token",
  tokenPrefix: "prefix_",
},
```

Then add a card in `client/src/pages/Dashboard.tsx`. The `ServiceCard` component handles both PAT input and device-code flows.

For Azure AD services, add a `preConnect` hook that exchanges client credentials for a bearer token. For services with expiring tokens, add `authNote` to show a warning in the UI.

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/services/status` | All services connection state |
| GET | `/api/services/config` | Service display info (no secrets) |
| GET | `/api/services/dashboard` | Enabled services + order |
| PUT | `/api/services/dashboard` | Save enabled services list |
| POST | `/api/services/:id/connect` | Validate + store token |
| POST | `/api/services/:id/disconnect` | Remove stored token |
| POST | `/api/auth/chatgpt/start` | Start Codex device-code flow (optional) |
| GET | `/api/auth/chatgpt/check` | Poll device-code completion |

## Using Service Tokens in Automation

When a scheduled task or Claude session needs to call an external API:

```bash
# Read the stored token for a service
cat .workbot/services.json | jq -r '.github.token'
```

Or programmatically in Node:
```typescript
import { readFileSync } from "fs";
import { join } from "path";
const storePath = join(process.cwd(), ".workbot", "services.json");
const store = JSON.parse(readFileSync(storePath, "utf-8"));
const githubToken = store.github?.token;
```

## Key Architecture Files

| File | Purpose |
|------|---------|
| `server/src/routes/services.ts` | Service connection/validation/storage |
| `server/src/routes/auth.ts` | Codex ChatGPT device-code OAuth (optional) |
| `client/src/context/ServicesContext.tsx` | React state for service connections |
| `client/src/pages/Dashboard.tsx` | Service cards UI |
| `client/src/api/client.ts` | Frontend API layer |
| `client/src/components/ServiceDrawer.tsx` | Drawer with dnd-kit sortable + toggles |
| `.workbot/services.json` | Token store (gitignored, project root) |
| `.workbot/dashboard.json` | Dashboard layout config (gitignored, project root) |
