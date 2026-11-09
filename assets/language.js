import { languages, formatMessage } from "./messages.mjs?v=49";

const picker = document.getElementById("ui-language");
const key = "note-language";
let current = "zh";

function apply(code) {
  current = Object.hasOwn(languages, code) ? code : "zh";
  document.documentElement.lang = current === "zh" ? "zh-CN" : current;
  picker.value = current;
  for (const el of document.querySelectorAll("[data-msg]")) {
    const values = el.dataset.values ? JSON.parse(el.dataset.values) : [];
    el.textContent = formatMessage(current, el.dataset.msg, ...values);
  }
  for (const name of ["aria-label", "placeholder", "title"]) {
    for (const el of document.querySelectorAll(`[data-msg-${name}]`)) {
      el.setAttribute(name, formatMessage(current, el.getAttribute("data-msg-" + name)));
    }
  }
  document.dispatchEvent(new Event("note:language"));
}
function restore() {
  let saved = current;
  try { saved = localStorage.getItem(key) || current; } catch {}
  apply(saved);
}
restore();
picker.addEventListener("change", () => {
  apply(picker.value);
  try { localStorage.setItem(key, current); } catch {}
});
window.addEventListener("pageshow", (event) => { if (event.persisted) restore(); });
window.addEventListener("storage", (event) => { if (event.key === key) apply(event.newValue); });
