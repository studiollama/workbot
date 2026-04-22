import {
  pbkdf2Sync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { STORE_DIR, STORE_PATH } from "./paths.js";
import type { StoredService } from "./paths.js";

const ACTIVE_KEY_PATH = join(STORE_DIR, ".active-key");

// --- Key derivation ---

export function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, 100_000, 32, "sha256");
}

// --- AES-256-GCM encrypt/decrypt ---

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(encrypted: string, key: Buffer): string {
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

// --- Active key file (ephemeral, lives only while dashboard is logged in) ---

export function writeActiveKey(key: Buffer): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(ACTIVE_KEY_PATH, key.toString("hex"), { mode: 0o600 });
}

export function readActiveKey(): Buffer | null {
  try {
    if (!existsSync(ACTIVE_KEY_PATH)) return null;
    const hex = readFileSync(ACTIVE_KEY_PATH, "utf-8").trim();
    if (hex.length !== 64) return null; // 32 bytes = 64 hex chars
    return Buffer.from(hex, "hex");
  } catch {
    return null;
  }
}

export function deleteActiveKey(): void {
  try {
    if (existsSync(ACTIVE_KEY_PATH)) unlinkSync(ACTIVE_KEY_PATH);
  } catch {
    // Ignore — may already be deleted
  }
}

// --- Encrypt/decrypt the service store ---

interface EncryptedStore {
  _encrypted: true;
  _salt: string; // hex-encoded PBKDF2 salt — stored here so re-keying works even if auth.json is deleted
  [service: string]: any;
}

export function encryptStore(
  store: Record<string, StoredService>,
  key: Buffer,
  salt: Buffer
): EncryptedStore {
  const encrypted: EncryptedStore = { _encrypted: true, _salt: salt.toString("hex") };
  for (const [svc, data] of Object.entries(store)) {
    encrypted[svc] = {
      token: encrypt(data.token, key),
      user: data.user, // display name stays plaintext
      ...(data.extras
        ? { extras: encryptExtras(data.extras, key) }
        : {}),
    };
  }
  return encrypted;
}

export function decryptStore(
  raw: EncryptedStore,
  key: Buffer
): Record<string, StoredService> {
  const decrypted: Record<string, StoredService> = {};
  for (const [svc, data] of Object.entries(raw)) {
    if (svc.startsWith("_")) continue;
    try {
      decrypted[svc] = {
        token: decrypt(data.token, key),
        user: data.user,
        ...(data.extras
          ? { extras: decryptExtras(data.extras, key) }
          : {}),
      };
    } catch {
      console.error(`Failed to decrypt service "${svc}" — skipping`);
    }
  }
  return decrypted;
}

function encryptExtras(
  extras: Record<string, string>,
  key: Buffer
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(extras)) {
    result[k] = encrypt(v, key);
  }
  return result;
}

function decryptExtras(
  extras: Record<string, string>,
  key: Buffer
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(extras)) {
    try {
      result[k] = decrypt(v, key);
    } catch {
      result[k] = v; // If it's not encrypted (e.g. was added later), keep as-is
    }
  }
  return result;
}

export function migrateToEncrypted(key: Buffer, salt: Buffer): void {
  if (!existsSync(STORE_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    if (raw._encrypted) return; // Already encrypted
    const encrypted = encryptStore(raw, key, salt);
    writeFileSync(STORE_PATH, JSON.stringify(encrypted, null, 2));
    console.log("Migrated services.json to encrypted format");
  } catch (err) {
    console.error("Failed to migrate services.json to encrypted format:", err);
  }
}

export function isStoreEncrypted(): boolean {
  try {
    if (!existsSync(STORE_PATH)) return false;
    const raw = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    return raw._encrypted === true;
  } catch {
    return false;
  }
}

/** Read the PBKDF2 salt stored inside services.json (survives auth.json deletion) */
export function getStoreSalt(): Buffer | null {
  try {
    if (!existsSync(STORE_PATH)) return null;
    const raw = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    if (raw._salt) return Buffer.from(raw._salt, "hex");
    return null;
  } catch {
    return null;
  }
}

/** Re-key: decrypt with old key, re-encrypt with new key + new salt */
export function rekeyStore(oldKey: Buffer, newKey: Buffer, newSalt: Buffer): void {
  if (!existsSync(STORE_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    if (!raw._encrypted) return; // Not encrypted, nothing to re-key
    const decrypted = decryptStore(raw, oldKey);
    const reEncrypted = encryptStore(decrypted, newKey, newSalt);
    writeFileSync(STORE_PATH, JSON.stringify(reEncrypted, null, 2));
    console.log("Re-keyed services.json with new credentials");
  } catch (err) {
    console.error("Failed to re-key services.json:", err);
    throw new Error("Failed to re-key encrypted services. Is the old password correct?");
  }
}
