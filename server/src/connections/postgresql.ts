import type { ConnectionServiceConfig } from "../services.js";

async function getClient(params: Record<string, string>) {
  const pg = await import("pg");
  const client = new pg.default.Client({
    host: params.host,
    port: parseInt(params.port || "5432", 10),
    database: params.database,
    user: params.user,
    password: params.password,
    ssl: params.ssl === "disable" ? false : params.ssl === "require" ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
  await client.connect();
  return client;
}

export const postgresqlService: Omit<ConnectionServiceConfig, "kind" | "name" | "difficulty"> = {
  protocol: "database",
  defaultPort: 5432,
  docsUrl: "https://www.postgresql.org/docs/current/",
  tokenLabel: "Password",
  connectionFields: [
    { key: "host", label: "Host", placeholder: "db.example.com", type: "text", required: true },
    { key: "port", label: "Port", placeholder: "5432", type: "number", defaultValue: "5432" },
    { key: "database", label: "Database", placeholder: "mydb", type: "text", required: true },
    { key: "user", label: "Username", placeholder: "postgres", type: "text", required: true },
    { key: "ssl", label: "SSL Mode", placeholder: "prefer | require | disable", type: "text", defaultValue: "prefer" },
  ],

  validate: async (params) => {
    const client = await getClient(params);
    try {
      const res = await client.query("SELECT current_user AS usr, version() AS ver");
      const row = res.rows[0];
      return { user: `${row.usr} — ${(row.ver as string).split(",")[0]}` };
    } finally {
      await client.end();
    }
  },

  execute: async (params, command) => {
    const client = await getClient(params);
    try {
      const res = await client.query(command);
      if (res.command === "SELECT" || res.rows?.length > 0) {
        const preview = res.rows.slice(0, 500);
        const truncated = res.rows.length > 500 ? `\n... (${res.rows.length - 500} more rows)` : "";
        return JSON.stringify(preview, null, 2) + truncated;
      }
      return `${res.command} — ${res.rowCount ?? 0} row(s) affected`;
    } finally {
      await client.end();
    }
  },
};
