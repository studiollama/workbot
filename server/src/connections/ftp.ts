import type { ConnectionServiceConfig } from "../services.js";

async function getClient(params: Record<string, string>) {
  const basicFtp = await import("basic-ftp");
  const client = new basicFtp.Client();
  client.ftp.verbose = false;
  await client.access({
    host: params.host,
    port: parseInt(params.port || "21", 10),
    user: params.user,
    password: params.password,
    secure: params.secure === "true" || params.secure === "implicit",
    secureOptions: params.secure === "true" ? { rejectUnauthorized: false } : undefined,
  });
  return client;
}

function parseCommand(raw: string): { cmd: string; args: string[] } {
  const parts = raw.trim().split(/\s+/);
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) };
}

export const ftpService: Omit<ConnectionServiceConfig, "kind" | "name" | "difficulty"> = {
  protocol: "ftp",
  defaultPort: 21,
  docsUrl: "https://en.wikipedia.org/wiki/File_Transfer_Protocol",
  tokenLabel: "Password",
  authNote: "Commands: ls, pwd, mkdir, rm, get, put, cd, size",
  connectionFields: [
    { key: "host", label: "Host", placeholder: "ftp.example.com", type: "text", required: true },
    { key: "port", label: "Port", placeholder: "21", type: "number", defaultValue: "21" },
    { key: "user", label: "Username", placeholder: "anonymous", type: "text", required: true },
    { key: "secure", label: "TLS/SSL", placeholder: "false | true | implicit", type: "text", defaultValue: "false" },
  ],

  validate: async (params) => {
    const client = await getClient(params);
    try {
      const pwd = await client.pwd();
      return { user: `${params.user}@${params.host} (${pwd})` };
    } finally {
      client.close();
    }
  },

  execute: async (params, command) => {
    const client = await getClient(params);
    try {
      const { cmd, args } = parseCommand(command);
      const path = args[0] || ".";

      switch (cmd) {
        case "ls":
        case "dir": {
          const list = await client.list(path);
          return list
            .map((f) => {
              const type = f.isDirectory ? "d" : f.isSymbolicLink ? "l" : "-";
              const size = f.size.toString().padStart(10);
              return `${type} ${size}  ${f.name}`;
            })
            .join("\n") || "(empty directory)";
        }
        case "pwd": {
          return await client.pwd();
        }
        case "cd": {
          await client.cd(path);
          return `Changed to: ${await client.pwd()}`;
        }
        case "mkdir": {
          await client.ensureDir(path);
          return `Created directory: ${path}`;
        }
        case "rm":
        case "delete": {
          await client.remove(path);
          return `Deleted: ${path}`;
        }
        case "rmdir": {
          await client.removeDir(path);
          return `Removed directory: ${path}`;
        }
        case "size": {
          const size = await client.size(path);
          return `${path}: ${size} bytes`;
        }
        case "get": {
          const { Writable } = await import("stream");
          const chunks: Buffer[] = [];
          let totalSize = 0;
          const writable = new Writable({
            write(chunk, _enc, cb) {
              totalSize += chunk.length;
              if (totalSize <= 1_000_000) chunks.push(chunk);
              cb();
            },
          });
          await client.downloadTo(writable, path);
          const content = Buffer.concat(chunks).toString("utf-8");
          return totalSize > 1_000_000
            ? content + `\n... (truncated at 1MB, total ${totalSize} bytes)`
            : content;
        }
        case "put": {
          const dest = args[0];
          const content = args.slice(1).join(" ");
          if (!dest || !content) return "Usage: put <remote-path> <content>";
          const { Readable } = await import("stream");
          const readable = Readable.from(Buffer.from(content));
          await client.uploadFrom(readable, dest);
          return `Written ${content.length} bytes to ${dest}`;
        }
        default:
          return `Unknown FTP command: ${cmd}. Available: ls, pwd, cd, mkdir, rm, rmdir, size, get, put`;
      }
    } finally {
      client.close();
    }
  },
};
