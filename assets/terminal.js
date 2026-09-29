import {
  createTermEngine,
  complete,
  searchDocs,
  scrubInvisible,
} from "./term-engine.js?v=36";

/**
 * Command bar. Hidden by default; nav.js (or the statusline button) opens it with "/" or ":".
 * Exposes window.__term = { open, close, isOpen, cycleTheme, notify }.
 */
(function () {
  "use strict";

  const posts = Array.isArray(window.__POSTS__) ? window.__POSTS__ : [];
  const seriesInfo = Array.isArray(window.__SERIES__) ? window.__SERIES__ : [];
  const bar = document.getElementById("term-bar");
  const input = document.getElementById("term-input");
  const suggest = document.getElementById("suggest");
  const echo = document.getElementById("term-echo");
  const ghostEl = document.getElementById("term-ghost");
  if (!bar || !input || !suggest) return;
  const ghostTyped = ghostEl.querySelector(".term-ghost-typed");
  const ghostRest = ghostEl.querySelector(".term-ghost-rest");
  const slMsg = document.getElementById("sl-msg");

  const engine = createTermEngine({ posts });
  const HISTORY_KEY = "note-cmd-history";
  const THEME_ORDER = ["auto", "paper", "tokyo", "ink"];

  let items = [];          // menu entries
  let selected = -1;       // -1 = nothing chosen: Enter runs the typed line
  let auto = -1;           // index of the entry that the ghost text continues
  let ghost = "";
  let menuClosed = false;  // first Esc closes the menu only
  let composing = false;
  let isOpen = false;
  let aboutBusy = false;
  let msgTimer = 0;
  let indexPromise = null;
  let docs = null;

  const ctx = {
    series: seriesInfo,
    tags: Array.from(new Set(posts.reduce(function (a, p) { return a.concat(p.tags || []); }, []))).sort(),
    posts: posts.map(function (p) { return { title: p.title, dir: p.dir || "", stem: p.stem }; }),
    history: loadHistory(),
  };

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------- history
  function loadHistory() {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(h) ? h.filter(function (x) { return typeof x === "string"; }).slice(0, 40) : [];
    } catch (e) { return []; }
  }
  function remember(line) {
    line = String(line || "").trim();
    if (!line) return;
    ctx.history = [line].concat(ctx.history.filter(function (h) { return h !== line; })).slice(0, 40);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(ctx.history)); } catch (e) {}
  }

  // ---------------------------------------------------------------- messages
  function setEcho(msg, isErr) {
    echo.textContent = msg || "";
    echo.classList.toggle("err", !!isErr);
    echo.hidden = !msg;
  }
  /** Feedback that survives the bar being hidden: statusline message (+ echo when the bar is open). */
  function notify(msg, isErr) {
    if (slMsg) {
      slMsg.textContent = msg || "";
      slMsg.classList.toggle("err", !!isErr);
      clearTimeout(msgTimer);
      if (msg) msgTimer = setTimeout(function () { slMsg.textContent = ""; }, 3200);
    }
    if (isOpen) setEcho(msg, isErr);
  }

  // ---------------------------------------------------------------- menu
  function renderGhost() {
    const showGhost = ghost && !composing && isOpen && input.selectionStart === input.value.length && input.scrollWidth <= input.clientWidth + 1;
    ghostTyped.textContent = showGhost ? input.value : "";
    ghostRest.textContent = showGhost ? ghost : "";
  }

  function renderMenu() {
    suggest.innerHTML = "";
    const show = items.length && !menuClosed && isOpen;
    suggest.hidden = !show;
    suggest.classList.toggle("open", !!show);
    input.setAttribute("aria-expanded", show ? "true" : "false");
    if (!show) { input.removeAttribute("aria-activedescendant"); return; }
    items.forEach(function (it, i) {
      const li = document.createElement("li");
      li.id = "suggest-" + i;
      li.className = "suggest-item" + (i === selected ? " active" : "") + (i === auto && selected < 0 ? " ghosted" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === selected ? "true" : "false");
      li.innerHTML =
        '<span class="suggest-marker">' + (i === selected ? "\u25B8" : " ") + "</span>" +
        '<span class="suggest-kind k-' + it.kind + '">' + kindLabel(it.kind) + "</span>" +
        '<span class="suggest-title">' + escapeHtml(it.label) + "</span>" +
        (it.hint ? '<span class="suggest-stem">' + escapeHtml(it.hint) + "</span>" : "");
      li.addEventListener("mouseenter", function () { selected = i; markActive(); });
      li.addEventListener("mousedown", function (e) { e.preventDefault(); selected = i; activate(); });
      suggest.appendChild(li);
    });
    markActive();
  }
  function kindLabel(k) {
    return { cmd: "cmd", folder: "dir", tag: "tag", post: "doc", hist: "hist", theme: "theme" }[k] || k;
  }
  function markActive() {
    suggest.querySelectorAll(".suggest-item").forEach(function (el, i) {
      const on = i === selected;
      el.classList.toggle("active", on);
      el.classList.toggle("ghosted", i === auto && selected < 0);
      el.setAttribute("aria-selected", on ? "true" : "false");
      const mk = el.querySelector(".suggest-marker");
      if (mk) mk.textContent = on ? "\u25B8" : " ";
    });
    const act = selected >= 0 ? document.getElementById("suggest-" + selected) : null;
    if (act) { input.setAttribute("aria-activedescendant", act.id); act.scrollIntoView({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  }

  function cycle(delta) {
    if (!items.length) return;
    if (menuClosed) { menuClosed = false; renderMenu(); }
    if (selected < 0) selected = delta > 0 ? 0 : items.length - 1;
    else selected = (selected + delta + items.length) % items.length;
    markActive();
  }

  // ---------------------------------------------------------------- live status for /tag
  function ensureIndex() {
    if (!indexPromise) {
      indexPromise = fetch("search-index.json")
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (j) { docs = j.docs || []; refreshLive(); return docs; })
        .catch(function () { indexPromise = null; });
    }
    return indexPromise;
  }
  function refreshLive() {
    if (!isOpen || aboutBusy) return;
    const p = engine.parseLine(input.value);
    if (p.kind === "tag" && p.query) {
      if (!docs) { ensureIndex(); return; }
      const r = searchDocs(docs, p.query);
      if (r.ok && !r.empty) setEcho(r.results.length + " 篇匹配 · Enter 查看结果页");
      else setEcho("");
    } else if (echo.dataset.live === "1") setEcho("");
  }

  function refresh() {
    if (composing) return;
    // the bar opens with "/" pre-typed; typing "/tag" on top of it must not give "//tag"
    if (/^\/\/+/.test(input.value)) input.value = input.value.replace(/^\/+/, "/");
    const res = complete(input.value, ctx);
    items = res.items;
    ghost = res.ghost;
    auto = res.auto;
    selected = -1;
    menuClosed = false;
    echo.dataset.live = "0";
    setEcho("");
    if (engine.parseLine(input.value).kind === "tag") { echo.dataset.live = "1"; refreshLive(); }
    renderMenu();
    renderGhost();
  }

  // ---------------------------------------------------------------- actions
  function go(href) {
    if (!engine.beginNavigate()) return;
    const a = document.createElement("a");
    a.href = href;
    window.location.assign(a.href);
  }

  async function runAbout(query) {
    if (aboutBusy) return;
    aboutBusy = true;
    items = []; ghost = ""; selected = -1;
    renderMenu(); renderGhost();
    setEcho("about: searching…");
    try {
      const mod = await import("./about-search.js?v=36");
      const result = await mod.aboutSearch(query, 5, function (msg) { setEcho("about: " + msg); });
      const hits = result.hits || [];
      items = hits.map(function (h) {
        return { kind: "post", label: h.title, hint: (h.scoreLabel || "") + "  " + h.stem, href: h.href, text: "", exec: true };
      });
      selected = items.length ? 0 : -1;
      auto = -1; ghost = "";
      renderMenu(); renderGhost();
      echo.dataset.live = "0";
      if (!hits.length) {
        setEcho("about: no hits · load " + result.loadMs + "ms · query " + result.queryMs + "ms", true);
      } else {
        setEcho("about: " + hits.length + " hits · load " + result.loadMs + "ms · query " + result.queryMs + "ms · total " + result.totalMs + "ms · ↑↓ Enter");
      }
    } catch (err) {
      setEcho("about error: " + (err && err.message ? err.message : String(err)), true);
    } finally {
      aboutBusy = false;
    }
  }

  function setTheme(name) {
    try { localStorage.setItem("note-theme", name); } catch (e) {}
    if (window.__applyTheme) window.__applyTheme();
    notify("theme · " + name);
  }
  function cycleTheme() {
    let cur = "auto";
    try { cur = localStorage.getItem("note-theme") || "auto"; } catch (e) {}
    setTheme(THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length]);
  }

  function applyAction(action, line) {
    if (!action || action.type === "noop") return;
    if (action.type === "echo") { setEcho(action.message, !!action.err); return; }
    if (action.type === "clear") { input.value = ""; refresh(); return; }
    if (action.type === "theme") {
      remember(line);
      setTheme(action.name);
      input.value = "";
      refresh();
      setEcho("theme · " + action.name);
      return;
    }
    if (action.type === "about") { remember(line); runAbout(action.query); return; }
    if (action.type === "search") { remember(line); go(action.href); return; }
    if (action.type === "navigate") { if (!action.egg) remember(line); go(action.post.href); return; }
  }

  function submitLine() {
    if (composing && !input.isComposing) composing = false;
    const line = input.value;
    applyAction(engine.submit(line), line.trim());
  }

  /** Apply the highlighted menu entry: fill the line in and (if it is runnable) execute it. */
  function activate() {
    const it = items[selected];
    if (!it) return submitLine();
    if (it.href) { go(it.href); return; }
    input.value = it.text;
    input.setSelectionRange(it.text.length, it.text.length);
    if (it.exec) submitLine();
    else refresh();
  }

  /** Tab / →: accept the ghost text (or the highlighted / first entry). */
  function accept() {
    if (selected >= 0 && items[selected] && !items[selected].href) {
      const t = items[selected].text;
      input.value = t;
      input.setSelectionRange(t.length, t.length);
      refresh();
      return true;
    }
    if (ghost) {
      input.value = input.value + ghost;
      input.setSelectionRange(input.value.length, input.value.length);
      refresh();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- open / close
  function announce() {
    document.dispatchEvent(new CustomEvent("note:term", { detail: { open: isOpen } }));
  }
  function open(prefill) {
    const fresh = !isOpen;
    isOpen = true;
    bar.classList.add("open");
    bar.removeAttribute("inert");
    bar.setAttribute("aria-hidden", "false");
    if (fresh || typeof prefill === "string") input.value = typeof prefill === "string" ? prefill : "";
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    ensureIndex();
    refresh();
    if (fresh) announce();
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    bar.classList.remove("open");
    bar.setAttribute("inert", "");
    bar.setAttribute("aria-hidden", "true");
    input.blur();
    input.value = "";
    items = []; ghost = ""; selected = -1; auto = -1;
    setEcho("");
    renderMenu(); renderGhost();
    announce();
  }
  window.__term = { open: open, close: close, isOpen: function () { return isOpen; }, cycleTheme: cycleTheme, notify: notify };

  // ---------------------------------------------------------------- wiring
  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) themeBtn.addEventListener("click", function () { cycleTheme(); themeBtn.blur(); });
  const cmdBtn = document.getElementById("sl-cmd");
  if (cmdBtn) cmdBtn.addEventListener("click", function () { cmdBtn.blur(); isOpen ? close() : open("/"); });
  const helpBtn = document.getElementById("sl-help");
  if (helpBtn) helpBtn.addEventListener("click", function () { helpBtn.blur(); if (window.__nav) window.__nav.help(); });
  document.addEventListener("mousedown", function (e) {
    if (isOpen && !bar.contains(e.target) && !(e.target.closest && e.target.closest("#sl-cmd"))) close();
  });

  function reviveAfterHistory() { engine.resetNavigation(); }
  window.addEventListener("pageshow", reviveAfterHistory);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") reviveAfterHistory();
  });

  input.addEventListener("compositionstart", function () { composing = true; renderGhost(); });
  input.addEventListener("compositionend", function () {
    // Defer one tick so the committed characters are in input.value (Safari).
    setTimeout(function () { composing = false; refresh(); }, 0);
  });
  input.addEventListener("blur", function () { composing = false; });
  input.addEventListener("input", function (e) {
    if (e && e.isComposing) return;
    composing = false;
    refresh();
  });
  input.addEventListener("click", renderGhost);
  input.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") renderGhost();
  });

  input.addEventListener("keydown", function (e) {
    // Real IME busy = browser says so; never gate on keyCode 229 or a sticky flag.
    if (e.isComposing || (composing && e.key !== "Enter")) return;
    const k = e.key;
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;

    if (k === "ArrowDown" || (ctrl && (k === "n" || k === "N"))) { e.preventDefault(); cycle(1); return; }
    if (k === "ArrowUp" || (ctrl && (k === "p" || k === "P"))) { e.preventDefault(); cycle(-1); return; }
    if (k === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!accept() && items.length) cycle(e.shiftKey ? -1 : 1);
      return;
    }
    if (k === "ArrowRight" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
      if (ghost) { e.preventDefault(); accept(); }
      return;
    }
    if (k === "Escape") {
      e.preventDefault();
      if (items.length && !menuClosed && !suggest.hidden) { menuClosed = true; selected = -1; renderMenu(); return; }
      close();
      return;
    }
    if (k !== "Enter") return;
    e.preventDefault();
    if (selected >= 0) { activate(); return; }
    // typed a command name prefix (e.g. "/ab") → complete it instead of erroring
    if (auto >= 0 && items[auto] && (items[auto].kind === "cmd" || items[auto].kind === "theme")) {
      const it = items[auto];
      input.value = it.text;
      if (it.exec) submitLine(); else refresh();
      return;
    }
    submitLine();
  });

  // Warm /about index + e5 model in the background so first /about is snappy.
  import("./about-search.js?v=36")
    .then(function (mod) { if (mod && typeof mod.ensureAboutReady === "function") return mod.ensureAboutReady(null); })
    .catch(function () {});

  reviveAfterHistory();
})();
