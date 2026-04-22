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
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm">
        {/* Card */}
        <div className="glass-card p-6 sm:p-8 shadow-xl border border-theme/30">
          {/* Logo / Brand */}
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-accent-600 rounded-xl mx-auto mb-4 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-xl font-bold">Welcome to Workbot</h1>
            <p className="text-theme-muted text-sm mt-1">Create your dashboard credentials</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {showOldPassword && (
              <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-700/30 text-xs text-yellow-300/80 space-y-2">
                <p>Existing encrypted services detected. Enter your previous password to preserve them, or leave blank to start fresh.</p>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent-500/50 transition"
                  placeholder="Previous password (or leave blank)"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-theme-secondary mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent-500/50 focus:border-accent-500 transition"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-secondary mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent-500/50 focus:border-accent-500 transition"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-secondary mb-1.5">Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2.5 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent-500/50 focus:border-accent-500 transition"
                required
                minLength={8}
              />
            </div>

            {error && (
              <div className="bg-status-error border rounded-lg px-3 py-2">
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 bg-accent-600 hover:bg-accent-700 active:bg-accent-800 text-white text-sm font-medium rounded-lg transition disabled:opacity-50 mt-2"
            >
              {busy ? "Setting up..." : "Create Account"}
            </button>
          </form>

          <p className="text-[11px] text-theme-muted text-center mt-4">
            This password encrypts your service tokens at rest.
          </p>
        </div>
      </div>
    </div>
  );
}
