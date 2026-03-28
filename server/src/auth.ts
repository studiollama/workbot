import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { STORE_DIR } from "./paths.js";

const AUTH_PATH = join(STORE_DIR, "auth.json");

interface AuthData {
  username: string;
  passwordHash: string;
  pbkdf2Salt: string; // hex-encoded 32-byte salt for key derivation
}

export function isSetupComplete(): boolean {
  if (!existsSync(AUTH_PATH)) return false;
  try {
    const data: AuthData = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
    return !!(data.username && data.passwordHash && data.pbkdf2Salt);
  } catch {
    return false;
  }
}

export async function createCredentials(
  username: string,
  password: string
): Promise<{ pbkdf2Salt: string }> {
  const passwordHash = await bcrypt.hash(password, 12);
  const pbkdf2Salt = randomBytes(32).toString("hex");
  const data: AuthData = { username, passwordHash, pbkdf2Salt };
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2));
  return { pbkdf2Salt };
}

export async function verifyCredentials(
  username: string,
  password: string
): Promise<boolean> {
  if (!existsSync(AUTH_PATH)) return false;
  try {
    const data: AuthData = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
    if (data.username !== username) return false;
    return bcrypt.compare(password, data.passwordHash);
  } catch {
    return false;
  }
}

export function getAuthSalt(): Buffer | null {
  if (!existsSync(AUTH_PATH)) return null;
  try {
    const data: AuthData = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
    return Buffer.from(data.pbkdf2Salt, "hex");
  } catch {
    return null;
  }
}
