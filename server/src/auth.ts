import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { STORE_DIR } from "./paths.js";

const AUTH_PATH = join(STORE_DIR, "auth.json");

interface AdminData {
  username: string;
  passwordHash: string;
  pbkdf2Salt: string;
}

interface SubagentUser {
  username: string;
  passwordHash: string;
  subagentId: string;
  /** If true, this user can unlock the service store on login */
  keyHolder?: boolean;
  /** PBKDF2 salt for key derivation (only for key holders) */
  pbkdf2Salt?: string;
  /** Master key encrypted under this user's derived key (only for key holders) */
  wrappedMasterKey?: string;
}

interface AuthFile {
  admin: AdminData;
  users?: SubagentUser[];
}

/** Read auth file with backward compatibility */
function readAuth(): AuthFile | null {
  if (!existsSync(AUTH_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
    // Backward compat: old format had { username, passwordHash, pbkdf2Salt } at top level
    if (raw.username && !raw.admin) {
      return { admin: { username: raw.username, passwordHash: raw.passwordHash, pbkdf2Salt: raw.pbkdf2Salt }, users: raw.users ?? [] };
    }
    return raw as AuthFile;
  } catch {
    return null;
  }
}

function writeAuth(data: AuthFile): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2));
}

// ── Admin functions (backward compatible) ──────────────────────────────

export function isSetupComplete(): boolean {
  const auth = readAuth();
  return !!(auth?.admin?.username && auth.admin.passwordHash && auth.admin.pbkdf2Salt);
}

export async function createCredentials(
  username: string,
  password: string
): Promise<{ pbkdf2Salt: string }> {
  const passwordHash = await bcrypt.hash(password, 12);
  const pbkdf2Salt = randomBytes(32).toString("hex");
  const existing = readAuth();
  const data: AuthFile = {
    admin: { username, passwordHash, pbkdf2Salt },
    users: existing?.users ?? [],
  };
  writeAuth(data);
  return { pbkdf2Salt };
}

export interface VerifyResult {
  valid: boolean;
  role?: "admin" | "subagent";
  username?: string;
  subagentId?: string;
  keyHolder?: boolean;
}

export async function verifyCredentials(
  username: string,
  password: string
): Promise<VerifyResult> {
  const auth = readAuth();
  if (!auth) return { valid: false };

  // Check admin first (admin is always a key holder)
  if (auth.admin.username === username) {
    const match = await bcrypt.compare(password, auth.admin.passwordHash);
    if (match) return { valid: true, role: "admin", username, keyHolder: true };
    return { valid: false };
  }

  // Check subagent users
  for (const user of auth.users ?? []) {
    if (user.username === username) {
      const match = await bcrypt.compare(password, user.passwordHash);
      if (match) return {
        valid: true,
        role: "subagent",
        username,
        subagentId: user.subagentId,
        keyHolder: !!user.keyHolder,
      };
      return { valid: false };
    }
  }

  return { valid: false };
}

export function getAuthSalt(): Buffer | null {
  const auth = readAuth();
  if (!auth?.admin?.pbkdf2Salt) return null;
  return Buffer.from(auth.admin.pbkdf2Salt, "hex");
}

/** Get a key holder user's salt and wrapped master key for unwrapping on login */
export function getKeyHolderData(username: string): { salt: Buffer; wrappedKey: string } | null {
  const auth = readAuth();
  if (!auth) return null;

  // Admin uses the main salt (master key derived directly from password)
  if (auth.admin.username === username) {
    return null; // admin path handled separately
  }

  for (const user of auth.users ?? []) {
    if (user.username === username && user.keyHolder && user.pbkdf2Salt && user.wrappedMasterKey) {
      return {
        salt: Buffer.from(user.pbkdf2Salt, "hex"),
        wrappedKey: user.wrappedMasterKey,
      };
    }
  }
  return null;
}

// ── Subagent user management ───────────────────────────────────────────

export interface SubagentUserInfo {
  username: string;
  subagentId: string;
  keyHolder: boolean;
}

export function listSubagentUsers(): SubagentUserInfo[] {
  const auth = readAuth();
  return (auth?.users ?? []).map((u) => ({
    username: u.username,
    subagentId: u.subagentId,
    keyHolder: !!u.keyHolder,
  }));
}

/**
 * Create a subagent user. If keyHolder=true, wraps the master key under the user's password.
 * masterKeyHex must be provided when keyHolder=true (read from active-key file).
 */
export async function createSubagentUser(
  username: string,
  password: string,
  subagentId: string,
  keyHolder: boolean,
  wrapKey?: (password: string) => { salt: string; wrappedKey: string }
): Promise<void> {
  const auth = readAuth();
  if (!auth) throw new Error("Admin setup required first");

  if (auth.admin.username === username) {
    throw new Error("Username already taken by admin");
  }
  const users = auth.users ?? [];
  if (users.some((u) => u.username === username)) {
    throw new Error("Username already exists");
  }
  if (users.some((u) => u.subagentId === subagentId)) {
    throw new Error(`Subagent "${subagentId}" already has a user assigned`);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const entry: SubagentUser = { username, passwordHash, subagentId };

  if (keyHolder) {
    if (!wrapKey) throw new Error("Key wrapping function required for key holders");
    const { salt, wrappedKey } = wrapKey(password);
    entry.keyHolder = true;
    entry.pbkdf2Salt = salt;
    entry.wrappedMasterKey = wrappedKey;
  }

  users.push(entry);
  auth.users = users;
  writeAuth(auth);
}

/** Toggle key holder status for an existing user */
export function setKeyHolder(
  username: string,
  keyHolder: boolean,
  wrapKey?: (password?: string) => { salt: string; wrappedKey: string }
): void {
  const auth = readAuth();
  if (!auth) throw new Error("Admin setup required first");

  const user = (auth.users ?? []).find((u) => u.username === username);
  if (!user) throw new Error("User not found");

  if (keyHolder && !user.keyHolder) {
    // Can't wrap without the user's password — this is handled at the route level
    // by requiring the user's password when granting key holder
    if (!wrapKey) throw new Error("Key wrapping function required");
    const { salt, wrappedKey } = wrapKey();
    user.keyHolder = true;
    user.pbkdf2Salt = salt;
    user.wrappedMasterKey = wrappedKey;
  } else if (!keyHolder && user.keyHolder) {
    user.keyHolder = false;
    delete user.pbkdf2Salt;
    delete user.wrappedMasterKey;
  }

  writeAuth(auth);
}

export function deleteSubagentUser(username: string): boolean {
  const auth = readAuth();
  if (!auth) return false;

  const users = auth.users ?? [];
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) return false;

  users.splice(idx, 1);
  auth.users = users;
  writeAuth(auth);
  return true;
}
