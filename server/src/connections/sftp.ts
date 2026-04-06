import type { ConnectionServiceConfig } from "../services.js";
import { Client as SSHClient } from "ssh2";
import type { SFTPWrapper } from "ssh2";

function connectSftp(params: Record<string, string>): Promise<{ conn: SSHClient; sftp: SFTPWrapper }> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    const isKey = params.password.includes("-----BEGIN");
    conn
      .on("ready", () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); return reject(err); }
          resolve({ conn, sftp });
        });
      })
      .on("error", (err) => reject(err))
      .connect({
        host: params.host,
        port: parseInt(params.port || "22", 10),
        username: params.user,
        ...(isKey ? { privateKey: params.password } : { password: params.password }),
        readyTimeout: 10000,
        hostVerifier: () => true,
      } as any);
  });
}

function parseCommand(raw: string): { cmd: string; args: string[] } {
  const parts = raw.trim().split(/\s+/);
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) };
}

export const sftpService: Omit<ConnectionServiceConfig, "kind" | "name" | "difficulty"> = {
  protocol: "sftp",
  defaultPort: 22,
  docsUrl: "https://man.openbsd.org/sftp",
  tokenLabel: "Password or Private Key",
  authNote: "Paste a password or a PEM private key. Commands: ls, get, put, mkdir, rm, stat, pwd",
  connectionFields: [
    { key: "host", label: "Host", placeholder: "server.example.com", type: "text", required: true },
    { key: "port", label: "Port", placeholder: "22", type: "number", defaultValue: "22" },
    { key: "user", label: "Username", placeholder: "sftpuser", type: "text", required: true },
  ],

  validate: async (params) => {
    const { conn, sftp } = await connectSftp(params);
    try {
      const cwd = await new Promise<string>((resolve, reject) => {
        sftp.realpath(".", (err, path) => err ? reject(err) : resolve(path));
      });
      return { user: `${params.user}@${params.host} (${cwd})` };
    } finally {
      conn.end();
    }
  },

  execute: async (params, command) => {
    const { conn, sftp } = await connectSftp(params);
    try {
      const { cmd, args } = parseCommand(command);
      const path = args[0] || ".";

      switch (cmd) {
        case "ls": {
          const list = await new Promise<any[]>((resolve, reject) => {
            sftp.readdir(path, (err, items) => err ? reject(err) : resolve(items));
          });
          return list
            .map((f) => {
              const type = f.attrs.isDirectory() ? "d" : f.attrs.isSymbolicLink?.() ? "l" : "-";
              const size = f.attrs.size?.toString().padStart(10) ?? "         ?";
              return `${type} ${size}  ${f.filename}`;
            })
            .join("\n");
        }
        case "pwd": {
          return new Promise<string>((resolve, reject) => {
            sftp.realpath(".", (err, p) => err ? reject(err) : resolve(p));
          });
        }
        case "stat": {
          const stats = await new Promise<any>((resolve, reject) => {
            sftp.stat(path, (err, s) => err ? reject(err) : resolve(s));
          });
          return JSON.stringify({ size: stats.size, uid: stats.uid, gid: stats.gid, mode: stats.mode?.toString(8), atime: stats.atime, mtime: stats.mtime }, null, 2);
        }
        case "mkdir": {
          await new Promise<void>((resolve, reject) => {
            sftp.mkdir(path, (err) => err ? reject(err) : resolve());
          });
          return `Created directory: ${path}`;
        }
        case "rm":
        case "delete": {
          await new Promise<void>((resolve, reject) => {
            sftp.unlink(path, (err) => err ? reject(err) : resolve());
          });
          return `Deleted: ${path}`;
        }
        case "get":
        case "cat": {
          const chunks: Buffer[] = [];
          const stream = sftp.createReadStream(path);
          return new Promise<string>((resolve, reject) => {
            let size = 0;
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size <= 1_000_000) chunks.push(chunk);
            });
            stream.on("end", () => {
              const content = Buffer.concat(chunks).toString("utf-8");
              resolve(size > 1_000_000 ? content + `\n... (truncated at 1MB, total ${size} bytes)` : content);
            });
            stream.on("error", reject);
          });
        }
        case "put": {
          const dest = args[0];
          const content = args.slice(1).join(" ");
          if (!dest || !content) return "Usage: put <remote-path> <content>";
          const stream = sftp.createWriteStream(dest);
          return new Promise<string>((resolve, reject) => {
            stream.on("close", () => resolve(`Written ${content.length} bytes to ${dest}`));
            stream.on("error", reject);
            stream.end(content);
          });
        }
        default:
          return `Unknown SFTP command: ${cmd}. Available: ls, pwd, stat, mkdir, rm, get, cat, put`;
      }
    } finally {
      conn.end();
    }
  },
};
