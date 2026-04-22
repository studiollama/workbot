import type { ConnectionServiceConfig } from "../services.js";
import { Client as SSHClient } from "ssh2";


function connect(params: Record<string, string>): Promise<SSHClient> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    const isKey = params.password.includes("-----BEGIN");

    conn
      .on("ready", () => resolve(conn))
      .on("error", (err) => reject(err))
      .connect({
        host: params.host,
        port: parseInt(params.port || "22", 10),
        username: params.user,
        ...(isKey ? { privateKey: params.password } : { password: params.password }),
        readyTimeout: 10000,
        // Accept unknown host keys (agent use case — not interactive)
        hostVerifier: () => true,
      } as any);
  });
}

function exec(conn: SSHClient, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      stream
        .on("data", (data: Buffer) => { stdout += data.toString(); })
        .stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
      stream.on("close", (code: number) => {
        const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
        if (code !== 0 && !stdout) {
          reject(new Error(`Exit code ${code}: ${stderr || "unknown error"}`));
        } else {
          resolve(output.trim() + (code !== 0 ? `\n[exit code: ${code}]` : ""));
        }
      });
    });
  });
}

export const sshService: Omit<ConnectionServiceConfig, "kind" | "name" | "difficulty"> = {
  protocol: "ssh",
  defaultPort: 22,
  docsUrl: "https://man.openbsd.org/ssh",
  tokenLabel: "Password or Private Key",
  authNote: "Paste a password or a PEM private key (-----BEGIN ... -----END).",
  connectionFields: [
    { key: "host", label: "Host", placeholder: "server.example.com", type: "text", required: true },
    { key: "port", label: "Port", placeholder: "22", type: "number", defaultValue: "22" },
    { key: "user", label: "Username", placeholder: "root", type: "text", required: true },
  ],

  validate: async (params) => {
    const conn = await connect(params);
    try {
      const output = await exec(conn, "whoami && hostname");
      const lines = output.split("\n").filter(Boolean);
      return { user: `${lines[0]}@${lines[1] || params.host}` };
    } finally {
      conn.end();
    }
  },

  execute: async (params, command) => {
    const conn = await connect(params);
    try {
      return await exec(conn, command);
    } finally {
      conn.end();
    }
  },
};
