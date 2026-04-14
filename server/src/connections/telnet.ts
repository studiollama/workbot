import type { ConnectionServiceConfig } from "../services.js";

async function createConnection(params: Record<string, string>) {
  const { Telnet } = await import("telnet-client");
  const conn = new Telnet();
  await conn.connect({
    host: params.host,
    port: parseInt(params.port || "23", 10),
    timeout: 10000,
    shellPrompt: params.prompt || /[$#>]\s*$/,
    loginPrompt: /login[: ]*$/i,
    passwordPrompt: /password[: ]*$/i,
    username: params.user || "",
    password: params.password || "",
    negotiationMandatory: false,
    irs: "\r\n",
    ors: "\r\n",
  });
  return conn;
}

export const telnetService: Omit<ConnectionServiceConfig, "kind" | "name" | "difficulty"> = {
  protocol: "telnet",
  defaultPort: 23,
  docsUrl: "https://en.wikipedia.org/wiki/Telnet",
  tokenLabel: "Password (optional)",
  authNote: "For unauthenticated services (e.g. network equipment banners), leave user/password blank.",
  connectionFields: [
    { key: "host", label: "Host", placeholder: "switch.example.com", type: "text", required: true },
    { key: "port", label: "Port", placeholder: "23", type: "number", defaultValue: "23" },
    { key: "user", label: "Username (optional)", placeholder: "admin", type: "text" },
    { key: "prompt", label: "Shell Prompt Regex (optional)", placeholder: "[$#>]\\s*$", type: "text" },
  ],

  validate: async (params) => {
    const conn = await createConnection(params);
    try {
      // Try to get a response — some devices just show a banner
      let output = "";
      try { output = await conn.exec(""); } catch { /* no prompt match */ }
      return { user: `${params.user || "anonymous"}@${params.host}:${params.port || "23"}` };
    } finally {
      try { await conn.end(); } catch { /* ignore */ }
    }
  },

  execute: async (params, command) => {
    const conn = await createConnection(params);
    try {
      const output = await conn.exec(command);
      return output.trim();
    } finally {
      try { await conn.end(); } catch { /* ignore */ }
    }
  },
};
