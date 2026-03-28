import { useState, useEffect } from "react";
import { api } from "./api/client";
import { ServicesProvider } from "./context/ServicesContext";
import Dashboard from "./pages/Dashboard";
import LoginPage from "./pages/LoginPage";
import SetupPage from "./pages/SetupPage";

type AuthState = "loading" | "setup" | "login" | "authenticated";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [hasEncryptedServices, setHasEncryptedServices] = useState(false);

  useEffect(() => {
    checkAuth();

    // Listen for 401 events from the API client
    const handler = () => setAuthState("login");
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
      const { authenticated } = await api.checkSession();
      setAuthState(authenticated ? "authenticated" : "login");
    } catch {
      setAuthState("login");
    }
  }

  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
      </div>
    );
  }

  if (authState === "setup") {
    return <SetupPage onSetup={() => setAuthState("authenticated")} hasEncryptedServices={hasEncryptedServices} />;
  }

  if (authState === "login") {
    return <LoginPage onLogin={() => setAuthState("authenticated")} />;
  }

  return (
    <ServicesProvider>
      <Dashboard onLogout={() => setAuthState("login")} />
    </ServicesProvider>
  );
}
