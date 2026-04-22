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
  timezone: string;
  loading: boolean;
  refresh: () => Promise<void>;
  setEnabledServices: (keys: string[]) => Promise<void>;
  updateSettings: (name: string, color: string, mode?: ThemeMode, timezone?: string) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
}

const BROWSER_TZ =
  typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC";

const ServicesContext = createContext<ServicesState>({
  services: {},
  config: {},
  enabledServices: [],
  allServiceKeys: [],
  workbotName: "Workbot",
  accentColor: DEFAULT_ACCENT_ID,
  themeMode: "dark",
  timezone: BROWSER_TZ,
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
  const [timezone, setTimezone] = useState<string>(BROWSER_TZ);
  const [loading, setLoading] = useState(true);

  const settingsRef = useRef({ workbotName, accentColor, themeMode, timezone });
  settingsRef.current = { workbotName, accentColor, themeMode, timezone };

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
      const tz = dashboard.timezone || BROWSER_TZ;
      setWorkbotName(name);
      setAccentColor(color);
      setThemeModeState(mode);
      setTimezone(tz);
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
      const { workbotName: n, accentColor: c, timezone: tz } = settingsRef.current;
      await api.saveDashboardConfig({ enabledServices: keys, workbotName: n, accentColor: c, timezone: tz });
    } catch {
      const dashboard = await api.getDashboardConfig();
      setEnabledServicesState(dashboard.enabledServices);
    }
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    applyAccentColor(settingsRef.current.accentColor, mode);
  }, []);

  const updateSettings = useCallback(async (name: string, color: string, mode?: ThemeMode, tz?: string) => {
    setWorkbotName(name);
    setAccentColor(color);
    const m = mode ?? settingsRef.current.themeMode;
    if (mode) setThemeModeState(m);
    const nextTz = tz ?? settingsRef.current.timezone;
    if (tz) setTimezone(tz);
    applyAccentColor(color, m);
    try {
      await api.saveDashboardConfig({ enabledServices: enabledRef.current, workbotName: name, accentColor: color, timezone: nextTz });
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <ServicesContext.Provider
      value={{
        services, config, enabledServices, allServiceKeys,
        workbotName, accentColor, themeMode, timezone, loading,
        refresh, setEnabledServices, updateSettings, setThemeMode,
      }}
    >
      {children}
    </ServicesContext.Provider>
  );
}

export const useServices = () => useContext(ServicesContext);
