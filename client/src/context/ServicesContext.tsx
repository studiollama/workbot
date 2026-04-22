import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { api, type ServiceStatus, type ServiceConfig } from "../api/client";
import { applyAccentColor, applyThemeMode, getSavedThemeMode, type ThemeMode } from "../utils/applyAccentColor";
import { DEFAULT_ACCENT_ID } from "../constants/colors";

interface ServicesState {
  services: Record<string, ServiceStatus>;
  config: Record<string, ServiceConfig>;
  enabledServices: string[];
  allServiceKeys: string[];
  workbotName: string;
  accentColor: string;
  themeMode: ThemeMode;
  loading: boolean;
  refresh: () => Promise<void>;
  setEnabledServices: (keys: string[]) => Promise<void>;
  updateSettings: (name: string, color: string, mode?: ThemeMode) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
}

const ServicesContext = createContext<ServicesState>({
  services: {},
  config: {},
  enabledServices: [],
  allServiceKeys: [],
  workbotName: "Workbot",
  accentColor: DEFAULT_ACCENT_ID,
  themeMode: "dark",
  loading: true,
  refresh: async () => {},
  setEnabledServices: async () => {},
  updateSettings: async () => {},
  setThemeMode: () => {},
});

export function ServicesProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<Record<string, ServiceStatus>>({});
  const [config, setConfig] = useState<Record<string, ServiceConfig>>({});
  const [enabledServices, setEnabledServicesState] = useState<string[]>([]);
  const [workbotName, setWorkbotName] = useState("Workbot");
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_ID);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getSavedThemeMode());
  const [loading, setLoading] = useState(true);

  const settingsRef = useRef({ workbotName, accentColor, themeMode });
  settingsRef.current = { workbotName, accentColor, themeMode };

  const enabledRef = useRef(enabledServices);
  enabledRef.current = enabledServices;

  const allServiceKeys = Object.keys(config);

  // Apply theme on mount (before first render completes)
  useEffect(() => {
    const saved = getSavedThemeMode();
    applyThemeMode(saved);
  }, []);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyAccentColor(settingsRef.current.accentColor, "system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeMode]);

  const refresh = useCallback(async () => {
    try {
      const [status, cfg, dashboard] = await Promise.all([
        api.getServicesStatus(),
        api.getServicesConfig(),
        api.getDashboardConfig(),
      ]);
      setServices(status);
      setConfig(cfg);
      setEnabledServicesState(dashboard.enabledServices);

      const name = dashboard.workbotName || "Workbot";
      const color = dashboard.accentColor || DEFAULT_ACCENT_ID;
      const mode = getSavedThemeMode();
      setWorkbotName(name);
      setAccentColor(color);
      setThemeModeState(mode);
      applyAccentColor(color, mode);
    } catch {
      // keep existing state on error
    } finally {
      setLoading(false);
    }
  }, []);

  const setEnabledServices = useCallback(async (keys: string[]) => {
    setEnabledServicesState(keys);
    try {
      const { workbotName: n, accentColor: c } = settingsRef.current;
      await api.saveDashboardConfig({ enabledServices: keys, workbotName: n, accentColor: c });
    } catch {
      const dashboard = await api.getDashboardConfig();
      setEnabledServicesState(dashboard.enabledServices);
    }
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    applyAccentColor(settingsRef.current.accentColor, mode);
  }, []);

  const updateSettings = useCallback(async (name: string, color: string, mode?: ThemeMode) => {
    setWorkbotName(name);
    setAccentColor(color);
    const m = mode ?? settingsRef.current.themeMode;
    if (mode) setThemeModeState(m);
    applyAccentColor(color, m);
    try {
      await api.saveDashboardConfig({ enabledServices: enabledRef.current, workbotName: name, accentColor: color });
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <ServicesContext.Provider
      value={{
        services, config, enabledServices, allServiceKeys,
        workbotName, accentColor, themeMode, loading,
        refresh, setEnabledServices, updateSettings, setThemeMode,
      }}
    >
      {children}
    </ServicesContext.Provider>
  );
}

export const useServices = () => useContext(ServicesContext);
