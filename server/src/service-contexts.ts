import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { STORE_DIR } from "./paths.js";
import { BRAIN_ROOT } from "./brain-utils.js";

const CONTEXTS_PATH = join(STORE_DIR, "service-contexts.json");

// Maps service key → array of brain note paths
interface ServiceContexts {
  [serviceKey: string]: string[];
}

export function loadServiceContexts(): ServiceContexts {
  try {
    if (!existsSync(CONTEXTS_PATH)) return {};
    return JSON.parse(readFileSync(CONTEXTS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function saveServiceContexts(contexts: ServiceContexts): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(CONTEXTS_PATH, JSON.stringify(contexts, null, 2));
}

export function addServiceContext(serviceKey: string, notePath: string): void {
  const contexts = loadServiceContexts();
  if (!contexts[serviceKey]) contexts[serviceKey] = [];
  if (!contexts[serviceKey].includes(notePath)) {
    contexts[serviceKey].push(notePath);
  }
  saveServiceContexts(contexts);
}

export function removeServiceContext(serviceKey: string, notePath: string): void {
  const contexts = loadServiceContexts();
  if (!contexts[serviceKey]) return;
  contexts[serviceKey] = contexts[serviceKey].filter((p) => p !== notePath);
  if (contexts[serviceKey].length === 0) delete contexts[serviceKey];
  saveServiceContexts(contexts);
}

export function getServiceContext(serviceKey: string): string[] {
  return loadServiceContexts()[serviceKey] ?? [];
}

/** Load and concatenate all context notes for a service */
export function resolveServiceContext(serviceKey: string): string | null {
  const paths = getServiceContext(serviceKey);
  if (paths.length === 0) return null;

  const sections: string[] = [];
  for (const notePath of paths) {
    const fullPath = join(BRAIN_ROOT, notePath);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, "utf-8");
      // Strip frontmatter for cleaner context
      const stripped = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
      sections.push(`[${notePath}]\n${stripped}`);
    }
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}
