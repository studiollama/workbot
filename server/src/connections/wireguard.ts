import { execSync } from "child_process";
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

const WG_DIR = "/etc/wireguard";
const WG_CONF = join(WG_DIR, "wg0.conf");

export const wireguardService = {
  protocol: "vpn" as const,
  fields: [
    {
      key: "config",
      label: "WireGuard Config",
      placeholder: "[Interface]\nPrivateKey = ...\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = ...\nEndpoint = vpn.example.com:51820\nAllowedIPs = 0.0.0.0/0",
      type: "textarea" as const,
    },
    {
      key: "autoConnect",
      label: "Auto-connect on container start",
      placeholder: "true",
      type: "text" as const,
    },
  ],
  validate: async (params: Record<string, string>) => {
    const config = params.config;
    if (!config || !config.includes("[Interface]") || !config.includes("[Peer]")) {
      throw new Error("Invalid WireGuard config — must contain [Interface] and [Peer] sections");
    }

    // Write config and try to bring up the interface
    mkdirSync(WG_DIR, { recursive: true });
    writeFileSync(WG_CONF, config, { mode: 0o600 });

    try {
      execSync("wg-quick up wg0", { timeout: 15000, stdio: "pipe" });
      const status = execSync("wg show wg0", { timeout: 5000 }).toString().trim();

      // Extract peer endpoint for display
      const endpointMatch = status.match(/endpoint:\s+(\S+)/);
      const endpoint = endpointMatch ? endpointMatch[1] : "connected";

      return { user: `VPN: ${endpoint}` };
    } catch (err: any) {
      // Clean up on failure
      try { execSync("wg-quick down wg0", { stdio: "pipe" }); } catch {}
      throw new Error(`WireGuard connect failed: ${err.message}`);
    }
  },
  execute: async (params: Record<string, string>, command: string) => {
    switch (command) {
      case "status": {
        try {
          const status = execSync("wg show wg0", { timeout: 5000 }).toString().trim();
          return status || "Interface wg0 not found";
        } catch {
          return "WireGuard not connected";
        }
      }
      case "up": {
        if (!existsSync(WG_CONF)) {
          throw new Error("No WireGuard config found. Connect first.");
        }
        execSync("wg-quick up wg0", { timeout: 15000, stdio: "pipe" });
        return "WireGuard connected";
      }
      case "down": {
        try {
          execSync("wg-quick down wg0", { timeout: 10000, stdio: "pipe" });
        } catch {}
        return "WireGuard disconnected";
      }
      case "disconnect": {
        try { execSync("wg-quick down wg0", { stdio: "pipe" }); } catch {}
        if (existsSync(WG_CONF)) unlinkSync(WG_CONF);
        return "WireGuard disconnected and config removed";
      }
      default:
        return `Unknown command: ${command}`;
    }
  },
};
