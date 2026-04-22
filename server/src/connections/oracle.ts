import type { ConnectionServiceConfig } from "../services.js";

let oracledb: any = null;

async function getOracleDb() {
  if (oracledb) return oracledb;
  try {
    const mod = (await import("oracledb")).default;
    // Enable thick mode for Oracle 11g compatibility
    // initOracleClient relies on ldconfig or LD_LIBRARY_PATH to find libclntsh.so
    try {
      mod.initOracleClient();
    } catch (e: any) {
      // If already in thick mode, that's fine; otherwise rethrow
      if (!e.message?.includes("already")) throw new Error(`initOracleClient failed: ${e.message}`);
    }
    oracledb = mod;
    return oracledb;
  } catch (err: any) {
    throw new Error(
      `Oracle client not available: ${err.message}. ` +
      "Oracle InstantClient (thick mode) must be installed for Oracle 11g connections."
    );
  }
}

export const oracleService: Omit<ConnectionServiceConfig, "kind" | "name" | "difficulty"> = {
  protocol: "database",
  defaultPort: 1521,
  docsUrl: "https://docs.oracle.com/en/database/",
  tokenLabel: "Password",
  authNote: "Requires Oracle InstantClient (thick mode) installed in the container.",
  connectionFields: [
    { key: "host", label: "Host", placeholder: "oracle.example.com", type: "text", required: true },
    { key: "port", label: "Port", placeholder: "1521", type: "number", defaultValue: "1521" },
    { key: "sid", label: "SID / Service Name", placeholder: "ORCL", type: "text", required: true },
    { key: "user", label: "Username", placeholder: "SYSTEM", type: "text", required: true },
    { key: "connectMode", label: "Connect As", placeholder: "normal | sysdba", type: "text", defaultValue: "normal" },
  ],

  validate: async (params) => {
    const ora = await getOracleDb();
    const connectString = `${params.host}:${params.port || "1521"}/${params.sid}`;
    const conn = await ora.getConnection({
      user: params.user,
      password: params.password,
      connectString,
      ...(params.connectMode === "sysdba" ? { privilege: ora.SYSDBA } : {}),
    });
    try {
      const result = await conn.execute("SELECT USER, banner FROM v$version WHERE ROWNUM = 1");
      const row = result.rows?.[0];
      return { user: row ? `${row[0]} — ${row[1]}` : `${params.user}@${params.sid}` };
    } finally {
      await conn.close();
    }
  },

  execute: async (params, command) => {
    const ora = await getOracleDb();
    const connectString = `${params.host}:${params.port || "1521"}/${params.sid}`;
    const conn = await ora.getConnection({
      user: params.user,
      password: params.password,
      connectString,
      ...(params.connectMode === "sysdba" ? { privilege: ora.SYSDBA } : {}),
    });
    try {
      const isQuery = /^\s*(SELECT|WITH|EXPLAIN)\b/i.test(command);
      if (isQuery) {
        const result = await conn.execute(command, [], { outFormat: ora.OUT_FORMAT_OBJECT, maxRows: 500 });
        const rows = result.rows ?? [];
        const truncated = (result.rows?.length ?? 0) >= 500 ? "\n... (result truncated at 500 rows)" : "";
        return JSON.stringify(rows, null, 2) + truncated;
      } else {
        const result = await conn.execute(command, [], { autoCommit: true });
        return `${result.rowsAffected ?? 0} row(s) affected`;
      }
    } finally {
      await conn.close();
    }
  },
};
