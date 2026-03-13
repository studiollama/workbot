import { ACCENT_COLORS, DEFAULT_ACCENT_ID } from "../constants/colors";

/** Apply an accent color by ID — sets CSS custom properties on :root */
export function applyAccentColor(colorId: string) {
  const color =
    ACCENT_COLORS.find((c) => c.id === colorId) ??
    ACCENT_COLORS.find((c) => c.id === DEFAULT_ACCENT_ID)!;

  const root = document.documentElement.style;
  root.setProperty("--accent-400", color.shades[400]);
  root.setProperty("--accent-500", color.shades[500]);
  root.setProperty("--accent-600", color.shades[600]);
  root.setProperty("--accent-700", color.shades[700]);
  root.setProperty("--accent-900", color.shades[900]);
}
