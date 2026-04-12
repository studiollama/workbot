import { execSync } from "child_process";
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

const WG_DIR = "/etc/wireguard";
const WG_CONF = join(WG_DIR, "wg0.conf");

function ensureWireGuardInstalled(): void {
  try {
    execSync("sudo which wg-quick", { stdio: "pipe" });
  } catch {
    // Install wireguard-tools if not present
    console.log("[wireguard] Installing wireguard-tools...");
    execSync("sudo apt-get update -qq && sudo apt-get install -y -qq wireguard-tools iproute2 iptables 2>&1", {
      timeout: 60000,
      stdio: "pipe",
    });
  }
}

export const wireguardService = {
  protocol: "vpn" as const,
  defaultPort: 51820,
  docsUrl: "https://www.wireguard.com/quickstart/",
  tokenLabel: "Config",
  authNote: "Paste your WireGuard .conf file contents. The config will be written to /etc/wireguard/wg0.conf and the VPN will connect.",
  connectionFields: [
    {
      key: "config",
      label: "WireGuard Config (.conf)",
      placeholder: "[Interface]\nPrivateKey = YOUR_PRIVATE_KEY\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = SERVER_PUBLIC_KEY\nEndpoint = vpn.example.com:51820\nAllowedIPs = 0.0.0.0/0",
      type: "textarea" as const,
      required: true,
    },
    {
      key: "autoConnect",
      label: "Auto-connect on container start",
      placeholder: "true or false",
      type: "text" as const,
      defaultValue: "true",
    },
  ],
  validate: async (params: Record<string, string>) => {
    const config = params.config;
    if (!config || !config.includes("[Interface]") || !config.includes("[Peer]")) {
      throw new Error("Invalid WireGuard config — must contain [Interface] and [Peer] sections");
    }

    // Install wireguard if needed
    ensureWireGuardInstalled();

    // Write config
    execSync(`sudo mkdir -p ${WG_DIR}`, { stdio: "pipe" });
    execSync(`sudo bash -c 'cat > ${WG_CONF} && chmod 600 ${WG_CONF}'`, { input: config, stdio: ["pipe", "pipe", "pipe"] });

    try {
      // Bring up the interface — strip PostUp/PreDown sysctl commands that fail in containers
      // and handle the sysctl issue by setting it before wg-quick runs
      try { execSync("sudo sysctl -q -w net.ipv4.conf.all.src_valid_mark=1 2>/dev/null", { stdio: "pipe" }); } catch {}

      // Strip sysctl lines from config to prevent wg-quick from trying to set them
      const cleanedConfig = config.replace(/^PostUp\s*=.*sysctl.*$/gm, "").replace(/^PreDown\s*=.*sysctl.*$/gm, "");
      execSync(`sudo bash -c 'cat > ${WG_CONF} && chmod 600 ${WG_CONF}'`, { input: cleanedConfig, stdio: ["pipe", "pipe", "pipe"] });

      execSync("sudo wg-quick up wg0", { timeout: 15000, stdio: "pipe" });
      const status = execSync("sudo wg show wg0", { timeout: 5000 }).toString().trim();

      // Extract peer endpoint for display
      const endpointMatch = status.match(/endpoint:\s+(\S+)/);
      const endpoint = endpointMatch ? endpointMatch[1] : "connected";

      return { user: `VPN: ${endpoint}` };
    } catch (err: any) {
      try { execSync("sudo wg-quick down wg0", { stdio: "pipe" }); } catch {}
      throw new Error(`WireGuard connect failed: ${err.stderr?.toString() || err.message}`);
    }
  },
  execute: async (params: Record<string, string>, command: string) => {
    switch (command) {
      case "status": {
        try {
          const status = execSync("sudo wg show wg0", { timeout: 5000 }).toString().trim();
          return status || "Interface wg0 not found";
        } catch {
          return "WireGuard not connected";
        }
      }
      case "up": {
        ensureWireGuardInstalled();
        if (!existsSync(WG_CONF)) throw new Error("No WireGuard config found. Connect first.");
        execSync("sudo wg-quick up wg0", { timeout: 15000, stdio: "pipe" });
        return "WireGuard connected";
      }
      case "down": {
        try { execSync("sudo wg-quick down wg0", { timeout: 10000, stdio: "pipe" }); } catch {}
        return "WireGuard disconnected";
      }
      case "disconnect": {
        try { execSync("sudo wg-quick down wg0", { stdio: "pipe" }); } catch {}
        try { execSync(`sudo rm -f ${WG_CONF}`, { stdio: "pipe" }); } catch {}
        return "WireGuard disconnected and config removed";
      }
      default:
        return `Unknown command: ${command}`;
    }
  },
};
