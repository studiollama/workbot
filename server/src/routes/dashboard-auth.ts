import { Router } from "express";
import {
  isSetupComplete,
  createCredentials,
  verifyCredentials,
  getAuthSalt,
} from "../auth.js";
import {
  deriveKey,
  writeActiveKey,
  deleteActiveKey,
  migrateToEncrypted,
  isStoreEncrypted,
  getStoreSalt,
  rekeyStore,
} from "../crypto.js";

const router = Router();

// Public — check if initial setup has been done
router.get("/setup-status", (_req, res) => {
  res.json({
    setupComplete: isSetupComplete(),
    hasEncryptedServices: isStoreEncrypted(),
  });
});

// Public — first-run credential creation
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
      // Re-key: decrypt with old password, re-encrypt with new
      const oldSalt = getStoreSalt();
      if (!oldSalt) {
        return res.status(500).json({ error: "Cannot read encryption salt from services.json" });
      }
      const oldKey = deriveKey(oldPassword, oldSalt);
      rekeyStore(oldKey, newKey, newSalt);
    } else if (storeEncrypted && !oldPassword) {
      // No old password provided — reset the encrypted store (services will need to be reconnected)
      const { writeFileSync } = await import("fs");
      const { STORE_PATH } = await import("../paths.js");
      writeFileSync(STORE_PATH, JSON.stringify({ _encrypted: true, _salt: newSalt.toString("hex") }, null, 2));
      console.log("Reset encrypted services.json (no old password provided)");
    }

    writeActiveKey(newKey);

    // Migrate plaintext services.json if present (first-time setup)
    if (!isStoreEncrypted()) {
      migrateToEncrypted(newKey, newSalt);
    }

    req.session!.authenticated = true;
    req.session!.username = username;
    res.json({ ok: true, username });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public — login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const valid = await verifyCredentials(username, password);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Derive encryption key and activate it
  const salt = getAuthSalt();
  if (salt) {
    const key = deriveKey(password, salt);
    writeActiveKey(key);

    // Migrate on first login after upgrade
    if (!isStoreEncrypted()) {
      migrateToEncrypted(key, salt);
    }
  }

  req.session!.authenticated = true;
  req.session!.username = username;
  res.json({ ok: true, username });
});

// Authenticated — logout
router.post("/logout", (req, res) => {
  deleteActiveKey();
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
  });
});

export default router;
