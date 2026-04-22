import type { ConnectionServiceConfig } from "../services.js";

async function executeCommand(
  params: Record<string, string>,
  command: string,
  usePowershell: boolean = false
): Promise<string> {
  const { runCommand, runPowershell } = await import("winrm-client");
  const useHttps = params.transport === "HTTPS";
  const host = params.host;
  const port = parseInt(params.port || (useHttps ? "5986" : "5985"), 10);
  // Domain format (DOMAIN\user) triggers NTLM auth automatically
  const user = params.domain
    ? `${params.domain}\\${params.user}`
    : params.user;
  const password = params.password;
  // Self-signed certs: skip verification (traffic already encrypted by WireGuard + TLS)
  const rejectUnauthorized = false;

  if (usePowershell) {
    const result = await runPowershell(command, host, user, password, port, useHttps, rejectUnauthorized);
    return typeof result === "string" ? result.trim() : String(result).trim();
  } else {
    const result = await runCommand(command, host, user, password, port, false, useHttps, rejectUnauthorized);
    return typeof result === "string" ? result.trim() : String(result).trim();
  }
}

export const winrmService: Omit<ConnectionServiceConfig, "kind" | "name" | "difficulty"> = {
  protocol: "winrm",
  defaultPort: 5986,
  docsUrl: "https://learn.microsoft.com/en-us/windows/win32/winrm/portal",
  tokenLabel: "Password",
  authNote:
    "For domain accounts, enter the domain separately (e.g. SACSDOM). " +
    "NTLM authentication is used automatically for domain accounts. " +
    "Transport: HTTPS (port 5986, recommended) or HTTP (port 5985, requires AllowUnencrypted=true). " +
    "The remote host must have WinRM enabled (Enable-PSRemoting -SkipNetworkProfileCheck -Force).",
  connectionFields: [
    { key: "host", label: "Host", placeholder: "10.10.60.251", type: "text", required: true },
    { key: "port", label: "Port", placeholder: "5986", type: "number", defaultValue: "5986" },
    { key: "transport", label: "Transport (HTTP or HTTPS)", placeholder: "HTTPS", type: "text", defaultValue: "HTTPS" },
    { key: "domain", label: "Domain (optional)", placeholder: "SACSDOM", type: "text" },
    { key: "user", label: "Username", placeholder: "Administrator", type: "text", required: true },
    { key: "password", label: "Password", placeholder: "Password", type: "password", required: true },
  ],

  validate: async (params) => {
    const output = await executeCommand(params, "whoami", false);
    const hostname = await executeCommand(params, "hostname", false);
    return { user: `${output.trim()}@${hostname.trim()}` };
  },

  execute: async (params, command) => {
    // Use PowerShell for all commands — this is a PowerShell remoting service
    return await executeCommand(params, command, true);
  },
};
