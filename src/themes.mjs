export const THEME_NAMES = ["day", "tokyo"];
export const THEME_HINTS = { day: "白天 · 紫白", tokyo: "夜间 · 夜紫" };

export function localTheme(hour) {
  return hour >= 6 && hour < 18 ? "day" : "tokyo";
}

// Runs in the page head before the stylesheet is loaded.
export function installTheme(localTheme) {
  let override, timer;
  const key = "note-theme-period";
  try { override = JSON.parse(sessionStorage.getItem(key)); } catch {}

  function apply(choice) {
    const now = new Date();
    const scheduled = localTheme(now.getHours());
    const next = new Date(now);
    const hour = now.getHours();
    next.setHours(hour < 6 ? 6 : hour < 18 ? 18 : 30, 0, 0, 0);
    if (choice === "day" || choice === "tokyo") {
      override = { theme: choice, until: next.getTime() };
      try { sessionStorage.setItem(key, JSON.stringify(override)); } catch {}
    }
    const valid = override?.until === next.getTime() && ["day", "tokyo"].includes(override.theme);
    const theme = valid ? override.theme : scheduled;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = theme;
    clearTimeout(timer);
    timer = setTimeout(apply, Math.max(1, next - now));
    return { mode: theme, theme };
  }
  window.__applyTheme = apply;
  window.addEventListener("pageshow", () => {
    try { override = JSON.parse(sessionStorage.getItem(key)); } catch {}
    apply();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) apply(); });
  apply();
}
