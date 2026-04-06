import { Router } from "express";
import {
  isSetupComplete,
  createCredentials,
  verifyCredentials,
  getAuthSalt,
  getKeyHolderData,
  listSubagentUsers,
  createSubagentUser,
  deleteSubagentUser,
} from "../auth.js";
import {
  deriveKey,
  encrypt,
  decrypt,
  writeActiveKey,
  readActiveKey,
  deleteActiveKey,
  migrateToEncrypted,
  isStoreEncrypted,
  getStoreSalt,
  rekeyStore,
} from "../crypto.js";
import { requireAdmin } from "../middleware/requireAuth.js";

const router = Router();

// Public — check if initial setup has been done
router.get("/setup-status", (_req, res) => {
  res.json({
    setupComplete: isSetupComplete(),
    hasEncryptedServices: isStoreEncrypted(),
  });
});

// Public — first-run credential creation (admin only)
router.post("/setup", async (req, res) => {
  if (isSetupComplete()) {
    return res.status(409).json({ error: "Setup already complete" });
  }

  const { username, password, oldPassword } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const storeEncrypted = isStoreEncrypted();

  try {
    const { pbkdf2Salt } = await createCredentials(username, password);
    const newSalt = Buffer.from(pbkdf2Salt, "hex");
    const newKey = deriveKey(password, newSalt);

    if (storeEncrypted && oldPassword) {
      const oldSalt = getStoreSalt();
      if (!oldSalt) {
        return res.status(500).json({ error: "Cannot read encryption salt from services.json" });
      }
      const oldKey = deriveKey(oldPassword, oldSalt);
      rekeyStore(oldKey, newKey, newSalt);
    } else if (storeEncrypted && !oldPassword) {
      const { writeFileSync } = await import("fs");
      const { STORE_PATH } = await import("../paths.js");
      writeFileSync(STORE_PATH, JSON.stringify({ _encrypted: true, _salt: newSalt.toString("hex") }, null, 2));
      console.log("Reset encrypted services.json (no old password provided)");
    }

    writeActiveKey(newKey);

    if (!isStoreEncrypted()) {
      migrateToEncrypted(newKey, newSalt);
    }

    req.session!.authenticated = true;
    req.session!.username = username;
    req.session!.role = "admin";
    res.json({ ok: true, username, role: "admin" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public — login (admin or subagent user)
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const result = await verifyCredentials(username, password);
  if (!result.valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Derive encryption key for key holders (admin or key-holder subagent users)
  if (result.role === "admin") {
    const salt = getAuthSalt();
    if (salt) {
      const key = deriveKey(password, salt);
      writeActiveKey(key);

      if (!isStoreEncrypted()) {
        migrateToEncrypted(key, salt);
      }
    }
  } else if (result.keyHolder) {
    // Key holder subagent user — unwrap the master key
    const khData = getKeyHolderData(username);
    if (khData) {
      try {
        const userKey = deriveKey(password, khData.salt);
        const masterKeyHex = decrypt(khData.wrappedKey, userKey);
        writeActiveKey(Buffer.from(masterKeyHex, "hex"));
      } catch {
        // Wrapped key decryption failed — don't block login, just skip unlock
        console.warn(`[auth] Key holder ${username} failed to unwrap master key`);
      }
    }
  }

  req.session!.authenticated = true;
  req.session!.username = result.username;
  req.session!.role = result.role;
  if (result.subagentId) {
    req.session!.subagentId = result.subagentId;
  }

  res.json({
    ok: true,
    username: result.username,
    role: result.role,
    subagentId: result.subagentId ?? null,
  });
});

// Authenticated — logout
router.post("/logout", (req, res) => {
  // Only delete active-key if admin is logging out
  if (req.session?.role === "admin") {
    deleteActiveKey();
  }
  req.session?.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.json({ ok: true });
  });
});

// Public — check current session
router.get("/session", (req, res) => {
  res.json({
    authenticated: !!req.session?.authenticated,
    username: req.session?.username ?? null,
    role: req.session?.role ?? null,
    subagentId: req.session?.subagentId ?? null,
  });
});

// ── Subagent user management (admin only) ─────────────────────────────

router.get("/users", requireAdmin, (_req, res) => {
  res.json(listSubagentUsers());
});

router.post("/users", requireAdmin, async (req, res) => {
  const { username, password, subagentId, keyHolder } = req.body;
  if (!username || !password || !subagentId) {
    return res.status(400).json({ error: "username, password, and subagentId required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  // Key holder needs the master key to be unlocked (admin must be logged in)
  let wrapFn: ((pw: string) => { salt: string; wrappedKey: string }) | undefined;
  if (keyHolder) {
    const masterKey = readActiveKey();
    if (!masterKey) {
      return res.status(400).json({ error: "Cannot create key holder — service store is locked. Log in as admin first." });
    }
    const masterKeyHex = masterKey.toString("hex");
    wrapFn = (pw: string) => {
      const salt = require("crypto").randomBytes(32);
      const userKey = deriveKey(pw, salt);
      const wrappedKey = encrypt(masterKeyHex, userKey);
      return { salt: salt.toString("hex"), wrappedKey };
    };
  }

  try {
    await createSubagentUser(username, password, subagentId, !!keyHolder, wrapFn);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/users/:username", requireAdmin, (req, res) => {
  const deleted = deleteSubagentUser(req.params.username as string);
  if (!deleted) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});

export default router;
