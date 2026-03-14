import { ACCENT_COLORS, DEFAULT_ACCENT_ID, generateTheme } from "../constants/colors";

/** Apply a full theme by color ID — sets all CSS custom properties on :root */
export function applyAccentColor(colorId: string) {
  const color =
    ACCENT_COLORS.find((c) => c.id === colorId) ??
    ACCENT_COLORS.find((c) => c.id === DEFAULT_ACCENT_ID)!;

  const theme = generateTheme(color);
  const root = document.documentElement.style;

  // Accent (buttons, links, focus rings)
  root.setProperty("--accent-400", color.shades[400]);
  root.setProperty("--accent-500", color.shades[500]);
  root.setProperty("--accent-600", color.shades[600]);
  root.setProperty("--accent-700", color.shades[700]);
  root.setProperty("--accent-900", color.shades[900]);

  // Surfaces (backgrounds)
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
}
