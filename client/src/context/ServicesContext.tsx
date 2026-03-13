import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api, type ServiceStatus, type ServiceConfig } from "../api/client";

interface ServicesState {
  services: Record<string, ServiceStatus>;
  config: Record<string, ServiceConfig>;
  enabledServices: string[];
  allServiceKeys: string[];
  loading: boolean;
  refresh: () => Promise<void>;
  setEnabledServices: (keys: string[]) => Promise<void>;
}

const ServicesContext = createContext<ServicesState>({
  services: {},
  config: {},
  enabledServices: [],
  allServiceKeys: [],
  loading: true,
  refresh: async () => {},
  setEnabledServices: async () => {},
});

export function ServicesProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<Record<string, ServiceStatus>>({});
  const [config, setConfig] = useState<Record<string, ServiceConfig>>({});
  const [enabledServices, setEnabledServicesState] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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
    } catch {
      // keep existing state on error
    } finally {
      setLoading(false);
    }
  }, []);

  const setEnabledServices = useCallback(async (keys: string[]) => {
    setEnabledServicesState(keys);
    try {
      await api.saveDashboardConfig(keys);
    } catch {
      // revert on failure
      const dashboard = await api.getDashboardConfig();
      setEnabledServicesState(dashboard.enabledServices);
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
        loading,
        refresh,
        setEnabledServices,
      }}
    >
      {children}
    </ServicesContext.Provider>
  );
}

export const useServices = () => useContext(ServicesContext);
