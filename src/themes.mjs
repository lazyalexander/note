export const THEME_NAMES = ["day", "tokyo"];
export const THEME_HINTS = { day: "白天 · 紫白", tokyo: "夜间 · 夜紫" };

// Migrate saved preferences; removed modes never remain active.
export function resolveTheme(value) {
  return value === "day" || value === "paper" ? "day" : "tokyo";
}
