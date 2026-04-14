import { join } from "path";

// Project root storage for service tokens (gitignored via .workbot/)
// When running from server/, resolve up to project root
// When running standalone (MCP), use cwd
export const PROJECT_ROOT = process.cwd().endsWith("server")
  ? join(process.cwd(), "..")
  : process.cwd();
export const STORE_DIR = join(PROJECT_ROOT, ".workbot");
export const STORE_PATH = join(STORE_DIR, "services.json");

export interface StoredService {
  token: string;
  user: string;
  extras?: Record<string, string>;
  _instanceName?: string; // User-facing name for multi-instance services
}
