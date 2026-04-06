import { ACCENT_COLORS, DEFAULT_ACCENT_ID, generateTheme } from "../constants/colors";

export type ThemeMode = "dark" | "light" | "system";

/** Get the effective mode (resolves "system" to actual preference) */
function resolveMode(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

/** Apply theme mode (dark/light class on <html>) */
export function applyThemeMode(mode: ThemeMode) {
  const resolved = resolveMode(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  localStorage.setItem("workbot-theme-mode", mode);
}

/** Apply a full theme by color ID + mode — sets all CSS custom properties on :root */
export function applyAccentColor(colorId: string, mode: ThemeMode = "dark") {
  const color =
    ACCENT_COLORS.find((c) => c.id === colorId) ??
    ACCENT_COLORS.find((c) => c.id === DEFAULT_ACCENT_ID)!;

  const resolved = resolveMode(mode);
  const theme = generateTheme(color, resolved);
  const root = document.documentElement.style;

  // Accent
  root.setProperty("--accent-400", color.shades[400]);
  root.setProperty("--accent-500", color.shades[500]);
  root.setProperty("--accent-600", color.shades[600]);
  root.setProperty("--accent-700", color.shades[700]);
  root.setProperty("--accent-900", color.shades[900]);

  // Surfaces
  root.setProperty("--surface-page", theme.surfaces.page);
  root.setProperty("--surface-card", theme.surfaces.card);
  root.setProperty("--surface-input", theme.surfaces.input);
  root.setProperty("--surface-hover", theme.surfaces.hover);

  // Borders
  root.setProperty("--border-default", theme.borders.default);
  root.setProperty("--border-input", theme.borders.input);

  // Text
  root.setProperty("--text-primary", theme.text.primary);
  root.setProperty("--text-secondary", theme.text.secondary);
  root.setProperty("--text-muted", theme.text.muted);

  // Apply dark/light class
  applyThemeMode(mode);
}

/** Get saved theme mode from localStorage (for instant load) */
export function getSavedThemeMode(): ThemeMode {
  return (localStorage.getItem("workbot-theme-mode") as ThemeMode) || "dark";
}
