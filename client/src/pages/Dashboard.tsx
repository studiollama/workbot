import { useState } from "react";
import { api } from "../api/client";
import { useServices } from "../context/ServicesContext";
import ServiceDrawer from "../components/ServiceDrawer";

const SERVICE_ICONS: Record<string, string> = {
  github: "GH",
  airtable: "AT",
  asana: "AS",
  zendesk: "ZD",
  codex: "CX",
  squarespace: "SQ",
  freshdesk: "FD",
  quickbooks: "QB",
  googleads: "GA",
  entra: "EN",
  intune: "IN",
  security: "SC",
  canva: "CV",
  nanobanana: "NB",
  jules: "JL",
  sharepoint: "SP",
  outlook: "OL",
  gmail: "GM",
  googleadmin: "GC",
  ticktick: "TT",
  readai: "RA",
};

export default function Dashboard() {
  const { services, config, enabledServices, loading, refresh } = useServices();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Workbot</h1>
            <p className="text-gray-400 text-sm mt-1">Service Connections</p>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition"
            title="Configure services"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
              <path d="M16.2 12.8a1.3 1.3 0 00.26 1.43l.05.05a1.575 1.575 0 11-2.23 2.23l-.05-.05a1.3 1.3 0 00-1.43-.26 1.3 1.3 0 00-.79 1.19v.14a1.575 1.575 0 11-3.15 0v-.07a1.3 1.3 0 00-.85-1.19 1.3 1.3 0 00-1.43.26l-.05.05a1.575 1.575 0 11-2.23-2.23l.05-.05a1.3 1.3 0 00.26-1.43 1.3 1.3 0 00-1.19-.79h-.14a1.575 1.575 0 110-3.15h.07a1.3 1.3 0 001.19-.85 1.3 1.3 0 00-.26-1.43l-.05-.05a1.575 1.575 0 112.23-2.23l.05.05a1.3 1.3 0 001.43.26h.06a1.3 1.3 0 00.79-1.19v-.14a1.575 1.575 0 013.15 0v.07a1.3 1.3 0 00.79 1.19 1.3 1.3 0 001.43-.26l.05-.05a1.575 1.575 0 112.23 2.23l-.05.05a1.3 1.3 0 00-.26 1.43v.06a1.3 1.3 0 001.19.79h.14a1.575 1.575 0 010 3.15h-.07a1.3 1.3 0 00-1.19.79z" />
            </svg>
          </button>
        </div>

        {(() => {
          const connected = enabledServices.filter(
            (key) => services[key]?.connected
          );
          const disconnected = enabledServices.filter(
            (key) => !services[key]?.connected
          );

          const renderCard = (key: string) => (
            <ServiceCard
              key={key}
              serviceKey={key}
              name={config[key]?.name ?? key}
              tokenUrl={config[key]?.tokenUrl ?? ""}
              tokenPrefix={config[key]?.tokenPrefix ?? ""}
              tokenLabel={config[key]?.tokenLabel}
              authNote={config[key]?.authNote}
              difficulty={config[key]?.difficulty}
              extraFields={config[key]?.extraFields}
              status={services[key] ?? { connected: false }}
              onUpdate={refresh}
            />
          );

          return (
            <>
              {connected.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">
                    Connected ({connected.length})
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {connected.map(renderCard)}
                  </div>
                </div>
              )}

              {disconnected.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">
                    Available ({disconnected.length})
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {disconnected.map(renderCard)}
                  </div>
                </div>
              )}

              {enabledServices.length === 0 && (
                <div className="bg-gray-900/50 border border-gray-800 border-dashed rounded-xl p-8 text-center text-gray-500">
                  No services enabled. Click the gear icon to add services.
                </div>
              )}
            </>
          );
        })()}

        <div className="bg-gray-900/50 border border-gray-800 border-dashed rounded-xl p-8 text-center text-gray-500">
          Orchestration workspace coming soon
        </div>
      </div>

      <ServiceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

const DIFFICULTY_STYLES: Record<string, { bg: string; text: string }> = {
  "API Key": { bg: "bg-green-900/40", text: "text-green-400" },
  "API Key + Config": { bg: "bg-blue-900/40", text: "text-blue-400" },
  "OAuth Token": { bg: "bg-yellow-900/40", text: "text-yellow-400" },
  "Admin + OAuth": { bg: "bg-orange-900/40", text: "text-orange-400" },
  "Enterprise App": { bg: "bg-purple-900/40", text: "text-purple-400" },
  "Device Login": { bg: "bg-gray-800/60", text: "text-gray-400" },
};

function ServiceCard({
  serviceKey,
  name,
  tokenUrl,
  tokenPrefix,
  tokenLabel,
  authNote,
  difficulty,
  extraFields,
  status,
  onUpdate,
}: {
  serviceKey: string;
  name: string;
  tokenUrl: string;
  tokenPrefix: string;
  tokenLabel?: string;
  authNote?: string;
  difficulty?: string;
  extraFields?: { key: string; label: string; placeholder: string }[];
  status: { connected: boolean; user?: string };
  onUpdate: () => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Codex device code flow state
  const [deviceCode, setDeviceCode] = useState<{
    url: string;
    code: string;
  } | null>(null);
  const [polling, setPolling] = useState(false);

  const isCodex = serviceKey === "codex";

  async function handleConnect(e?: React.FormEvent) {
    e?.preventDefault();
    if (!token.trim()) return;
    // Validate extra fields
    if (extraFields) {
      for (const field of extraFields) {
        if (!extras[field.key]?.trim()) {
          setError(`${field.label} is required`);
          return;
        }
      }
    }
    setError("");
    setBusy(true);
    try {
      await api.connectService(serviceKey, token, extraFields ? extras : undefined);
      setToken("");
      setExtras({});
      setShowForm(false);
      await onUpdate();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCodexLogin() {
    setError("");
    setBusy(true);
    try {
      const res = await api.startChatGPTLogin();
      if (res.authenticated) {
        await onUpdate();
        return;
      }
      if (res.verificationUrl && res.userCode) {
        setDeviceCode({ url: res.verificationUrl, code: res.userCode });
        setPolling(true);
        const interval = setInterval(async () => {
          try {
            const check = await api.checkChatGPTLogin();
            if (check.authenticated) {
              clearInterval(interval);
              setPolling(false);
              setDeviceCode(null);
              await onUpdate();
            }
          } catch {
            // keep polling
          }
        }, 3000);
        setTimeout(() => {
          clearInterval(interval);
          setPolling(false);
        }, 300000);
      } else if (res.error) {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await api.disconnectService(serviceKey);
      await onUpdate();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Determine the placeholder for the token input
  const tokenPlaceholder = tokenLabel
    ? tokenLabel
    : tokenPrefix
      ? `${tokenPrefix}...`
      : "API Token";

  return (
    <div className="bg-gray-900 rounded-xl p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-sm font-bold text-gray-400">
            {SERVICE_ICONS[serviceKey] ?? "?"}
          </div>
          <div>
            <h3 className="font-medium">{name}</h3>
            {status.connected && status.user && (
              <p className="text-xs text-gray-400">{status.user}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {difficulty && (() => {
            const style = DIFFICULTY_STYLES[difficulty] ?? DIFFICULTY_STYLES["API Key"];
            return (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${style.bg} ${style.text}`}>
                {difficulty}
              </span>
            );
          })()}
          <span
            className={`w-3 h-3 rounded-full ${
              status.connected ? "bg-green-500" : "bg-gray-600"
            }`}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* Connected state */}
      {status.connected && (
        <button
          onClick={handleDisconnect}
          disabled={busy}
          className="text-sm text-gray-400 hover:text-red-400 transition"
        >
          Disconnect
        </button>
      )}

      {/* Disconnected state — PAT services */}
      {!status.connected && !isCodex && (
        <>
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
            >
              Connect
            </button>
          ) : (
            <form onSubmit={handleConnect} className="space-y-2">
              {extraFields?.map((field) => (
                <input
                  key={field.key}
                  type="text"
                  placeholder={field.placeholder}
                  value={extras[field.key] ?? ""}
                  onChange={(e) =>
                    setExtras((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ))}
              <input
                type="password"
                placeholder={tokenPlaceholder}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {authNote && (
                <p className="text-xs text-yellow-400">{authNote}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy || !token.trim()}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
                >
                  {busy ? "Validating..." : "Connect"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setToken("");
                    setExtras({});
                    setError("");
                  }}
                  className="text-sm text-gray-400 hover:text-gray-200 px-3"
                >
                  Cancel
                </button>
              </div>
              {tokenUrl && (
                <a
                  href={tokenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-blue-400 hover:underline"
                >
                  Get a token →
                </a>
              )}
            </form>
          )}
        </>
      )}

      {/* Disconnected state — Codex (ChatGPT device code flow) */}
      {!status.connected && isCodex && (
        <>
          {deviceCode ? (
            <div className="space-y-2">
              <p className="text-xs">
                Go to{" "}
                <a
                  href={deviceCode.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline"
                >
                  {deviceCode.url}
                </a>{" "}
                and enter:
              </p>
              <div className="bg-gray-800 rounded-lg p-3 text-center">
                <span className="text-lg font-mono font-bold tracking-widest">
                  {deviceCode.code}
                </span>
              </div>
              {polling && (
                <p className="text-xs text-gray-400 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                  Waiting for login...
                </p>
              )}
            </div>
          ) : (
            <button
              onClick={handleCodexLogin}
              disabled={busy}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
            >
              {busy ? "Connecting..." : "Connect with ChatGPT"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
