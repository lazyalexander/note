export const THEME_NAMES = ["day", "tokyo"];
export const THEME_HINTS = { day: "白天 · 冷纸蓝", tokyo: "夜间 · 深海蓝" };

// Migrate saved preferences; removed modes never remain active.
export function resolveTheme(value) {
  return value === "day" || value === "paper" ? "day" : "tokyo";
}
