import { buildSearchSuggestions, normalizeSearchInput, parseQuery, describeQueryError } from "./term-engine.js?v=44";

const HISTORY_KEY = "note-search-history";
const posts = window.__POSTS__ || [];
const tags = [...new Set(posts.flatMap((p) => p.tags || []))];
function history() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(data) ? data.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch { return []; }
}

for (const form of document.querySelectorAll("form.home-search")) {
  const input = form.querySelector('input[name="q"]');
  const clear = form.querySelector(".search-clear");
  const feedback = document.getElementById(input.getAttribute("aria-describedby"));
  const list = document.createElement("ul");
  list.id = input.id + "-suggestions";
  list.className = "search-suggestions";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "搜索建议");
  list.hidden = true;
  form.querySelector(".home-search-field").after(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  let items = [], selected = -1, composing = false, compositionTimer = 0;

  function close() {
    list.hidden = true;
    selected = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function mark() {
    [...list.children].forEach((row, i) => {
      row.classList.toggle("active", i === selected);
      row.setAttribute("aria-selected", String(i === selected));
    });
    if (selected < 0) input.removeAttribute("aria-activedescendant");
    else {
      input.setAttribute("aria-activedescendant", list.children[selected].id);
      list.children[selected].scrollIntoView({ block: "nearest" });
    }
  }
  function choose(i) {
    if (composing || !items[i]) return;
    input.value = items[i].value;
    close();
    form.requestSubmit();
  }
  function refresh() {
    clear.hidden = !input.value;
    if (composing || document.activeElement !== input) return close();
    items = buildSearchSuggestions(normalizeSearchInput(input.value, tags), posts, history());
    selected = -1;
    list.replaceChildren();
    items.forEach((item, i) => {
      const row = document.createElement("li");
      row.id = list.id + "-" + i;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      const label = document.createElement("span"), hint = document.createElement("small");
      label.textContent = item.label;
      hint.textContent = item.hint;
      row.append(label, hint);
      row.addEventListener("mouseenter", () => { selected = i; mark(); });
      row.addEventListener("mousedown", (e) => e.preventDefault());
      row.addEventListener("click", () => choose(i));
      list.append(row);
    });
    list.hidden = !items.length;
    input.setAttribute("aria-expanded", String(!!items.length));
    input.removeAttribute("aria-activedescendant");
  }
  input.addEventListener("focus", refresh);
  input.addEventListener("input", (e) => {
    input.removeAttribute("aria-invalid");
    feedback.hidden = true;
    clear.hidden = !input.value;
    if (!e.isComposing && !composing) refresh();
  });
  input.addEventListener("compositionstart", () => {
    clearTimeout(compositionTimer);
    composing = true;
    close();
  });
  input.addEventListener("compositionend", () => {
    clearTimeout(compositionTimer);
    compositionTimer = setTimeout(() => { composing = false; refresh(); }, 0);
  });
  input.addEventListener("blur", () => {
    clearTimeout(compositionTimer);
    composing = false;
    close();
  });
  input.addEventListener("keydown", (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      if (!list.hidden) e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (list.hidden) refresh();
      if (!items.length) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      selected = step > 0
        ? (selected >= items.length - 1 ? -1 : selected + 1)
        : (selected < 0 ? items.length - 1 : selected - 1);
      mark();
    } else if (e.key === "Enter" && !list.hidden && selected >= 0) {
      e.preventDefault();
      choose(selected);
    }
  });
  clear.addEventListener("click", () => {
    input.value = "";
    input.removeAttribute("aria-invalid");
    feedback.hidden = true;
    input.focus();
    refresh();
  });
  form.addEventListener("submit", (e) => {
    if (composing) { e.preventDefault(); return; }
    close();
    const q = normalizeSearchInput(input.value, tags);
    const result = parseQuery(q);
    if (!result.ok || !q.trim()) {
      e.preventDefault();
      feedback.textContent = result.ok ? "先输入一个关键词，例如 find 心跳。" : describeQueryError(result.error);
      feedback.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.focus();
      close();
      return;
    }
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify([q, ...history().filter((x) => x !== q)].slice(0, 8))); } catch {}
  });
  clear.hidden = !input.value;
}
