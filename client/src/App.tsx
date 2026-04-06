import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { api } from "./api/client";
import { ServicesProvider } from "./context/ServicesContext";
import Dashboard from "./pages/Dashboard";
import LoginPage from "./pages/LoginPage";
import SetupPage from "./pages/SetupPage";
import SubagentDashboard from "./pages/SubagentDashboard";

type AuthState = "loading" | "setup" | "login" | "authenticated";

interface UserInfo {
  role: "admin" | "subagent";
  username: string;
  subagentId?: string;
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [hasEncryptedServices, setHasEncryptedServices] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    checkAuth();
    const handler = () => { setAuthState("login"); setUser(null); };
    window.addEventListener("workbot-auth-expired", handler);
    return () => window.removeEventListener("workbot-auth-expired", handler);
  }, []);

  async function checkAuth() {
    try {
      const status = await api.checkSetupStatus();
      if (!status.setupComplete) {
        setHasEncryptedServices(!!status.hasEncryptedServices);
        setAuthState("setup");
        return;
      }
      const session = await api.checkSession();
      if (session.authenticated && session.role) {
        setUser({ role: session.role as "admin" | "subagent", username: session.username ?? "", subagentId: session.subagentId ?? undefined });
        setAuthState("authenticated");
      } else {
        setAuthState("login");
      }
    } catch { setAuthState("login"); }
  }

  function handleLogin(loginUser: UserInfo) { setUser(loginUser); setAuthState("authenticated"); }
  function handleLogout() { setUser(null); setAuthState("login"); }

  if (authState === "loading") {
    return <div className="min-h-screen flex items-center justify-center"><div className="w-6 h-6 border-2 border-surface-hover border-t-accent-600 rounded-full animate-spin" /></div>;
  }
  if (authState === "setup") {
    return <SetupPage onSetup={() => { setUser({ role: "admin", username: "" }); setAuthState("authenticated"); }} hasEncryptedServices={hasEncryptedServices} />;
  }
  if (authState === "login") {
    return <LoginPage onLogin={handleLogin} />;
  }

  // Subagent user: only their dashboard
  if (user?.role === "subagent" && user.subagentId) {
    return (
      <Routes>
        <Route path="/subagent/:id/:tab?" element={<SubagentDashboard onLogout={handleLogout} isSubagentUser />} />
        <Route path="*" element={<Navigate to={`/subagent/${user.subagentId}`} replace />} />
      </Routes>
    );
  }

  // Admin: full access with tab routes
  return (
    <Routes>
      <Route path="/:tab?/*" element={
        <ServicesProvider>
          <Dashboard onLogout={handleLogout} />
        </ServicesProvider>
      } />
      <Route path="/subagent/:id/:tab?" element={<SubagentDashboard onLogout={handleLogout} />} />
    </Routes>
  );
}
