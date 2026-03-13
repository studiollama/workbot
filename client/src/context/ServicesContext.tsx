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
import { applyAccentColor } from "../utils/applyAccentColor";
import { DEFAULT_ACCENT_ID } from "../constants/colors";

interface ServicesState {
  services: Record<string, ServiceStatus>;
  config: Record<string, ServiceConfig>;
  enabledServices: string[];
  allServiceKeys: string[];
  workbotName: string;
  accentColor: string;
  loading: boolean;
  refresh: () => Promise<void>;
  setEnabledServices: (keys: string[]) => Promise<void>;
  updateSettings: (name: string, color: string) => Promise<void>;
}

const ServicesContext = createContext<ServicesState>({
  services: {},
  config: {},
  enabledServices: [],
  allServiceKeys: [],
  workbotName: "Workbot",
  accentColor: DEFAULT_ACCENT_ID,
  loading: true,
  refresh: async () => {},
  setEnabledServices: async () => {},
  updateSettings: async () => {},
});

export function ServicesProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<Record<string, ServiceStatus>>({});
  const [config, setConfig] = useState<Record<string, ServiceConfig>>({});
  const [enabledServices, setEnabledServicesState] = useState<string[]>([]);
  const [workbotName, setWorkbotName] = useState("Workbot");
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_ID);
  const [loading, setLoading] = useState(true);

  // Keep refs for current values so callbacks don't need deps
  const settingsRef = useRef({ workbotName, accentColor });
  settingsRef.current = { workbotName, accentColor };

  const enabledRef = useRef(enabledServices);
  enabledRef.current = enabledServices;

  const allServiceKeys = Object.keys(config);

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
      setWorkbotName(name);
      setAccentColor(color);
      applyAccentColor(color);
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
      await api.saveDashboardConfig({
        enabledServices: keys,
        workbotName: n,
        accentColor: c,
      });
    } catch {
      // revert on failure
      const dashboard = await api.getDashboardConfig();
      setEnabledServicesState(dashboard.enabledServices);
    }
  }, []);

  const updateSettings = useCallback(async (name: string, color: string) => {
    setWorkbotName(name);
    setAccentColor(color);
    applyAccentColor(color);
    try {
      await api.saveDashboardConfig({
        enabledServices: enabledRef.current,
        workbotName: name,
        accentColor: color,
      });
    } catch {
      // settings are best-effort; keep local state
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ServicesContext.Provider
      value={{
        services,
        config,
        enabledServices,
        allServiceKeys,
        workbotName,
        accentColor,
        loading,
        refresh,
        setEnabledServices,
        updateSettings,
      }}
    >
      {children}
    </ServicesContext.Provider>
  );
}

export const useServices = () => useContext(ServicesContext);
