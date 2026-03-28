import { useState } from "react";
import { api } from "../api/client";

interface SetupPageProps {
  onSetup: () => void;
  hasEncryptedServices?: boolean;
}

export default function SetupPage({ onSetup, hasEncryptedServices }: SetupPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [showOldPassword, setShowOldPassword] = useState(!!hasEncryptedServices);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setBusy(true);
    try {
      await api.setup(username, password, showOldPassword ? oldPassword : undefined);
      onSetup();
    } catch (err: any) {
      if (err.needsOldPassword) {
        setShowOldPassword(true);
        setError("Existing encrypted services found. Enter your previous password to preserve them.");
      } else {
        setError(err.message || "Setup failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to Workbot</h1>
          <p className="text-theme-secondary text-sm mt-1">Create your dashboard credentials</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {showOldPassword && (
            <div className="p-3 rounded-lg bg-surface-card border border-theme text-xs text-theme-secondary space-y-2">
              <p>Existing encrypted services detected. Enter your previous password to preserve them, or leave blank to start fresh.</p>
              <label className="block text-xs text-theme-secondary mb-1">Previous Password</label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
                placeholder="Leave blank to reset services"
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
              required
              minLength={8}
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2 bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
          >
            {busy ? "Setting up..." : "Create Account"}
          </button>
        </form>

        <p className="text-xs text-theme-muted text-center">
          This password also encrypts your service tokens at rest.
        </p>
      </div>
    </div>
  );
}
