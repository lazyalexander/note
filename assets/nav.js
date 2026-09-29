/**
 * LazyVim-style keyboard navigation: modes, leader key + which-key, flash jumps,
 * pickers, scrolling, list cursor, help overlay, statusline. Works on reader, home and search pages.
 * Key handling is inactive while typing in any input (command bar / pickers own their keys).
 */
(function () {
  "use strict";

  const posts = Array.isArray(window.__POSTS__) ? window.__POSTS__ : [];
  const seriesInfo = Array.isArray(window.__SERIES__) ? window.__SERIES__ : [];
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const modeEl = document.getElementById("sl-mode");
  const pendingEl = document.getElementById("sl-pending");
  const html = document.documentElement;
  const isReader = !!document.querySelector(".reader-grid");
  const term = function () { return window.__term; };

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function notify(msg, err) { if (term()) term().notify(msg, err); }
  function go(href) {
    const a = document.createElement("a");
    a.href = href;
    window.location.assign(a.href);
  }

  // ------------------------------------------------------------------ mode / statusline
  let mode = "NORMAL"; // NORMAL | COMMAND | LEADER | FLASH | PICK | HELP
  function setMode(m) {
    mode = m;
    if (modeEl) { modeEl.textContent = m; modeEl.setAttribute("data-mode", m); }
    html.setAttribute("data-mode", m.toLowerCase());
  }
  function setPending(t) { if (pendingEl) pendingEl.textContent = t || ""; }
  document.addEventListener("note:term", function (e) {
    if (e.detail && e.detail.open) { cancelAll(true); setMode("COMMAND"); }
    else if (mode === "COMMAND") setMode("NORMAL");
  });

  // ------------------------------------------------------------------ scrolling
  let aim = null, raf = 0;
  function maxScroll() { return Math.max(0, document.documentElement.scrollHeight - window.innerHeight); }
  function clampY(y) { return Math.max(0, Math.min(y, maxScroll())); }
  function step() {
    const cur = window.scrollY;
    const d = aim - cur;
    if (Math.abs(d) < 1) { window.scrollTo({ top: aim, behavior: "instant" }); aim = null; raf = 0; return; }
    const mv = Math.sign(d) * Math.max(1, Math.abs(d) * 0.3);
    window.scrollTo({ top: cur + mv, behavior: "instant" });
    if (Math.abs(window.scrollY - cur) < 0.5 && Math.abs(d) < 2) { aim = null; raf = 0; return; }
    raf = requestAnimationFrame(step);
  }
  function scrollToY(y, additive) {
    const base = additive && aim != null ? aim : window.scrollY;
    const target = clampY(additive ? base + y : y);
    if (reduce) { window.scrollTo({ top: target, behavior: "instant" }); return; }
    aim = target;
    if (!raf) raf = requestAnimationFrame(step);
  }
  function lineH() {
    const el = document.querySelector(".prose") || document.body;
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return isFinite(lh) && lh > 0 ? lh : 28;
  }
  const scrollBy = function (dy) { scrollToY(dy, true); };

  // ------------------------------------------------------------------ list pages (home / search results)
  function listItems() { return Array.prototype.slice.call(document.querySelectorAll("[data-nav]")); }
  let cursor = -1;
  function setCursor(i) {
    const items = listItems();
    if (!items.length) return;
    cursor = Math.max(0, Math.min(items.length - 1, i));
    items.forEach(function (el, k) {
      el.classList.toggle("nav-cursor", k === cursor);
      if (k === cursor) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
    });
    const el = items[cursor];
    const r = el.getBoundingClientRect();
    const slh = slHeight();
    if (r.top < 24 || r.bottom > window.innerHeight - slh - 8) {
      scrollToY(window.scrollY + r.top - Math.max(24, (window.innerHeight - r.height) / 3));
    }
  }
  function slHeight() { const s = document.getElementById("statusline"); return s ? s.getBoundingClientRect().height : 0; }
  function openCursor() {
    const items = listItems();
    if (cursor < 0 || !items[cursor]) return false;
    go(items[cursor].getAttribute("href"));
    return true;
  }
  const hasList = function () { return listItems().length > 0; };

  // ------------------------------------------------------------------ headings (reader)
  function headings() {
    return Array.prototype.slice.call(document.querySelectorAll(".prose h2[id], .prose h3[id]"));
  }
  function restY() { return window.__reader ? window.__reader.restY() : 28; }
  function jumpHeading(el) {
    if (!el) return;
    if (window.__reader && el.id) window.__reader.goTo(el.id);
    else scrollToY(el.getBoundingClientRect().top + window.scrollY - restY());
  }
  function nextHeading(dir) {
    const hs = headings();
    if (!hs.length) { notify("no headings on this page", true); return; }
    const rest = restY();
    if (dir > 0) {
      const h = hs.find(function (e) { return e.getBoundingClientRect().top > rest + 4; });
      if (h) jumpHeading(h); else notify("last heading");
    } else {
      let h = null;
      hs.forEach(function (e) { if (e.getBoundingClientRect().top < rest - 4) h = e; });
      if (h) jumpHeading(h); else { scrollToY(0); notify("top"); }
    }
  }
  function goPager(cls) {
    const a = document.querySelector(".pager a." + cls);
    if (a) go(a.getAttribute("href"));
    else notify(cls === "prev" ? "no previous article in this folder" : "no next article in this folder", true);
  }

  // ------------------------------------------------------------------ overlays: picker
  let pickerEl = null, pickerState = null;
  function fuzzyScore(q, text) {
    q = q.toLowerCase(); text = text.toLowerCase();
    if (!q) return 0;
    const at = text.indexOf(q);
    if (at !== -1) return 1000 - at - text.length * 0.01;
    let ti = 0, score = 0, last = -2;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (c === " ") continue;
      const f = text.indexOf(c, ti);
      if (f === -1) return -1;
      score += f === last + 1 ? 8 : 1;
      last = f; ti = f + 1;
    }
    return score;
  }
  function filterItems(items, q) {
    const toks = q.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return items.map(function (it) { return { it: it, s: 0 }; });
    const out = [];
    items.forEach(function (it) {
      let total = 0;
      for (const t of toks) {
        const s = fuzzyScore(t, it.search || it.label);
        if (s < 0) return;
        total += s;
      }
      out.push({ it: it, s: total });
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out;
  }
  function openPicker(title, items, emptyMsg) {
    cancelAll(true);
    if (!items.length) { notify(emptyMsg || "nothing to pick", true); return; }
    setMode("PICK");
    pickerEl = document.createElement("div");
    pickerEl.className = "overlay picker";
    pickerEl.id = "picker";
    pickerEl.innerHTML =
      '<div class="picker-box" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="picker-title">' + esc(title) + "</div>" +
      '<input class="picker-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="filter…">' +
      '<ul class="picker-list" role="listbox"></ul>' +
      '<div class="picker-foot"><span><kbd>↑</kbd><kbd>↓</kbd> / <kbd>^n</kbd><kbd>^p</kbd> 选择</span><span><kbd>Enter</kbd> 确认</span><span><kbd>Esc</kbd> 关闭</span></div>' +
      "</div>";
    document.body.appendChild(pickerEl);
    const input = pickerEl.querySelector(".picker-input");
    const list = pickerEl.querySelector(".picker-list");
    pickerState = { items: items, shown: [], sel: 0 };
    function render() {
      pickerState.shown = filterItems(items, input.value).slice(0, 60).map(function (x) { return x.it; });
      if (pickerState.sel >= pickerState.shown.length) pickerState.sel = Math.max(0, pickerState.shown.length - 1);
      list.innerHTML = "";
      if (!pickerState.shown.length) { list.innerHTML = '<li class="picker-empty">no match</li>'; return; }
      pickerState.shown.forEach(function (it, i) {
        const li = document.createElement("li");
        li.className = "picker-item" + (i === pickerState.sel ? " active" : "");
        li.setAttribute("role", "option");
        li.innerHTML = '<span class="pi-marker">' + (i === pickerState.sel ? "▸" : " ") + '</span><span class="pi-label" style="padding-left:' + ((it.indent || 0) * 1.1) + 'em">' + esc(it.label) + "</span>" + (it.hint ? '<span class="pi-hint">' + esc(it.hint) + "</span>" : "");
        li.addEventListener("mousedown", function (e) { e.preventDefault(); pickerState.sel = i; choose(); });
        li.addEventListener("mousemove", function () { if (pickerState.sel !== i) { pickerState.sel = i; paint(); } });
        list.appendChild(li);
      });
    }
    function paint() {
      list.querySelectorAll(".picker-item").forEach(function (li, i) {
        const on = i === pickerState.sel;
        li.classList.toggle("active", on);
        li.querySelector(".pi-marker").textContent = on ? "▸" : " ";
        if (on) li.scrollIntoView({ block: "nearest" });
      });
    }
    function move(d) {
      const n = pickerState.shown.length;
      if (!n) return;
      pickerState.sel = (pickerState.sel + d + n) % n;
      paint();
    }
    function choose() {
      const it = pickerState.shown[pickerState.sel];
      if (!it) return;
      closePicker();
      it.run();
    }
    input.addEventListener("input", function () { pickerState.sel = 0; render(); });
    input.addEventListener("keydown", function (e) {
      if (e.isComposing) return;
      const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
      if (e.key === "Escape") { e.preventDefault(); closePicker(); return; }
      if (e.key === "ArrowDown" || (ctrl && (e.key === "n" || e.key === "N")) || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); move(1); return; }
      if (e.key === "ArrowUp" || (ctrl && (e.key === "p" || e.key === "P")) || (e.key === "Tab" && e.shiftKey)) { e.preventDefault(); move(-1); return; }
      if (e.key === "Enter") { e.preventDefault(); choose(); return; }
    });
    pickerEl.addEventListener("mousedown", function (e) { if (e.target === pickerEl) closePicker(); });
    render();
    input.focus();
  }
  function closePicker() {
    if (pickerEl) { pickerEl.remove(); pickerEl = null; pickerState = null; }
    if (mode === "PICK") setMode("NORMAL");
  }

  function pickArticle() {
    openPicker("Find article", posts.map(function (p) {
      return { label: (p.n ? p.n + "  " : "") + p.title, hint: (p.dir || "") + "/", search: p.title + " " + (p.dir || "") + " " + (p.tags || []).join(" "), run: function () { go(p.href); } };
    }));
  }
  function pickTag() {
    const counts = {};
    posts.forEach(function (p) { (p.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    const items = [];
    seriesInfo.forEach(function (s) {
      items.push({ label: s.slug + "/", hint: s.title + " · " + s.count + " 篇", search: s.dir + " " + s.title, run: function () { go("search.html?q=" + encodeURIComponent(s.slug + "/")); } });
    });
    Object.keys(counts).sort().forEach(function (t) {
      items.push({ label: "#" + t, hint: counts[t] + " 篇", search: "tag " + t, run: function () { go("search.html?q=" + encodeURIComponent("#" + t)); } });
    });
    openPicker("Tags & folders  →  /tag", items);
  }
  function pickHeading() {
    const hs = headings();
    const items = [];
    const h1 = document.querySelector(".chapter-heading h1");
    if (h1) items.push({ label: h1.textContent.trim(), hint: "top", run: function () { scrollToY(0); } });
    hs.forEach(function (h) {
      items.push({ label: h.textContent.trim(), indent: h.tagName === "H3" ? 1 : 0, hint: h.tagName.toLowerCase(), run: function () { jumpHeading(h); } });
    });
    if (hs.length === 0) { notify("no headings in this page", true); return; }
    openPicker("Headings", items);
  }

  // ------------------------------------------------------------------ overlays: help
  let helpEl = null;
  const HELP = [
    ["Command bar", [["/  or  :", "open command bar"], ["Esc", "close menu, then bar"], ["Tab  or  →", "accept ghost completion"], ["↑ ↓  ^n ^p", "pick candidate"], ["Enter", "run line / chosen candidate"]]],
    ["Leader  (Space)", [["Space f", "find article (fuzzy)"], ["Space s", "search:  /tag …"], ["Space t", "tags & folders picker"], ["Space o", "headings of this article"], ["Space a", "/about semantic search"], ["Space h", "home"], ["Space T", "cycle theme"], ["Space ?", "this help"]]],
    ["Jump", [["f", "flash: letter labels on headings / list items"], ["]]  [[", "next / previous heading"], ["H  L", "previous / next article in folder"]]],
    ["Scroll", [["j  k", "down / up ~3 lines (list pages: move cursor)"], ["^d  ^u", "half page down / up"], ["gg  G", "top / bottom"], ["Enter", "open item under cursor (list pages)"]]],
    ["Misc", [["?", "toggle this help"], ["Esc", "cancel / close overlay"]]],
  ];
  function showHelp() {
    if (helpEl) { closeHelp(); return; }
    cancelAll(true);
    setMode("HELP");
    helpEl = document.createElement("div");
    helpEl.className = "overlay help";
    helpEl.id = "help";
    helpEl.innerHTML =
      '<div class="help-box" role="dialog" aria-modal="true" aria-label="Keys"><div class="picker-title">Keys · press Esc or ? to close</div><div class="help-cols">' +
      HELP.map(function (g) {
        return '<section><h3>' + esc(g[0]) + "</h3><dl>" + g[1].map(function (r) {
          return "<dt>" + r[0].split(/\s{2,}|\s+or\s+/).map(function (k) { return "<kbd>" + esc(k.trim()) + "</kbd>"; }).join(" ") + "</dt><dd>" + esc(r[1]) + "</dd>";
        }).join("") + "</dl></section>";
      }).join("") + "</div></div>";
    helpEl.addEventListener("mousedown", function (e) { if (e.target === helpEl) closeHelp(); });
    document.body.appendChild(helpEl);
  }
  function closeHelp() {
    if (helpEl) { helpEl.remove(); helpEl = null; }
    if (mode === "HELP") setMode("NORMAL");
  }

  // ------------------------------------------------------------------ leader + which-key
  const LEADER = {
    f: ["find article", pickArticle],
    s: ["search  /tag", function () { term().open("/tag "); }],
    t: ["tags & folders", pickTag],
    o: ["headings (outline)", pickHeading],
    a: ["/about semantic", function () { term().open("/about "); }],
    h: ["home", function () { go(document.querySelector(".sl-brand").getAttribute("href")); }],
    T: ["cycle theme", function () { term().cycleTheme(); }],
    "?": ["help", showHelp],
  };
  let wkEl = null, wkTimer = 0;
  function startLeader() {
    cancelAll(true);
    setMode("LEADER");
    setPending("SPC");
    clearTimeout(wkTimer);
    wkTimer = setTimeout(showWhichKey, 220);
  }
  function showWhichKey() {
    if (mode !== "LEADER" || wkEl) return;
    wkEl = document.createElement("div");
    wkEl.className = "whichkey";
    wkEl.id = "whichkey";
    wkEl.setAttribute("role", "status");
    wkEl.innerHTML = '<div class="wk-title">SPC <span>leader</span></div><div class="wk-grid">' +
      Object.keys(LEADER).map(function (k) {
        return '<div class="wk-item"><kbd>' + esc(k) + '</kbd><span class="wk-arrow">➜</span><span>' + esc(LEADER[k][0]) + "</span></div>";
      }).join("") + "</div>";
    document.body.appendChild(wkEl);
  }
  function endLeader() {
    clearTimeout(wkTimer);
    if (wkEl) { wkEl.remove(); wkEl = null; }
    setPending("");
    if (mode === "LEADER") setMode("NORMAL");
  }

  // ------------------------------------------------------------------ flash
  const FLASH_KEYS = "asdfghjklqwertyuiopzxcvbnm".split("");
  let flash = null;
  function inView(r) { return r.height > 0 && r.top >= 4 && r.bottom <= window.innerHeight - slHeight() - 2 && r.left < window.innerWidth; }
  function startFlash() {
    cancelAll(true);
    const targets = [];
    if (isReader) {
      const h1 = document.querySelector(".chapter-heading h1");
      if (h1) targets.push({ el: h1, alt: null, run: function () { scrollToY(0); } });
      headings().forEach(function (h) {
        const a = document.querySelector('.outline-rail .section-outline a[data-target="' + h.id + '"]');
        targets.push({ el: h, alt: a, run: function () { jumpHeading(h); } });
      });
    } else {
      listItems().forEach(function (a) { targets.push({ el: a, alt: null, run: function () { go(a.getAttribute("href")); } }); });
    }
    const layer = document.createElement("div");
    layer.className = "flash-layer";
    layer.id = "flash-layer";
    const labels = [];
    targets.forEach(function (t) {
      if (labels.length >= FLASH_KEYS.length) return;
      const where = placeFor(t);
      if (!where) return;
      const el = document.createElement("span");
      el.className = "flash-label";
      el.textContent = FLASH_KEYS[labels.length];
      layer.appendChild(el);
      labels.push({ key: FLASH_KEYS[labels.length], el: el, t: t });
    });
    if (!labels.length) { notify("nothing to jump to here", true); return; }
    document.body.appendChild(layer);
    flash = { layer: layer, labels: labels };
    layoutFlash();
    setMode("FLASH");
    setPending("f");
  }
  function placeFor(t) {
    const r = t.el.getBoundingClientRect();
    if (inView(r)) return { r: r, alt: false };
    if (t.alt) {
      const ar = t.alt.getBoundingClientRect();
      if (ar.width > 0 && inView(ar)) return { r: ar, alt: true };
    }
    return null;
  }
  function layoutFlash() {
    if (!flash) return;
    flash.labels.forEach(function (l) {
      const w = placeFor(l.t);
      if (!w) { l.el.style.display = "none"; return; }
      l.el.style.display = "";
      const size = 20;
      const left = Math.max(4, Math.min(w.r.left - size - 8, window.innerWidth - size - 4));
      const top = Math.max(2, Math.min(w.r.top + Math.min(w.r.height, 40) / 2 - size / 2, window.innerHeight - size - 2));
      l.el.style.left = left + "px";
      l.el.style.top = top + "px";
    });
  }
  function endFlash() {
    if (flash) { flash.layer.remove(); flash = null; }
    setPending("");
    if (mode === "FLASH") setMode("NORMAL");
  }
  window.addEventListener("scroll", layoutFlash, { passive: true });
  window.addEventListener("resize", layoutFlash);

  // ------------------------------------------------------------------ cancel
  function cancelAll(silent) {
    endLeader(); endFlash(); closePicker(); closeHelp();
    pending = ""; clearTimeout(pendingTimer); setPending("");
    if (!silent && mode !== "COMMAND") setMode("NORMAL");
  }

  // ------------------------------------------------------------------ key dispatch
  let pending = "", pendingTimer = 0;
  function setPendingKey(k) {
    pending = k; setPending(k);
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () { pending = ""; setPending(""); }, 900);
  }
  function typing(t) {
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  }

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.isComposing) return;
    if (typing(e.target)) return;
    if (term() && term().isOpen()) return;
    if (e.metaKey || e.altKey) return;
    const k = e.key;
    const ctrl = e.ctrlKey;
    if (ctrl && !((k === "d" || k === "u") && !e.shiftKey)) return;

    // --- overlays own Esc
    if (k === "Escape") {
      if (mode !== "NORMAL" || pending) { e.preventDefault(); cancelAll(); }
      return;
    }
    if (mode === "HELP") {
      if (k === "?") { e.preventDefault(); closeHelp(); }
      return;
    }
    if (mode === "PICK") return;

    if (mode === "LEADER") {
      e.preventDefault();
      if (k === "Shift" || k === "Control") return;
      const hit = LEADER[k];
      endLeader();
      if (hit) hit[1](); else notify("SPC " + k + " is not bound", true);
      return;
    }
    if (mode === "FLASH") {
      if (k === "Shift") return;
      e.preventDefault();
      const l = flash && flash.labels.find(function (x) { return x.key === k.toLowerCase(); });
      if (l) { const run = l.t.run; endFlash(); run(); }
      return;
    }

    // --- normal mode
    if (ctrl) {
      e.preventDefault();
      const half = window.innerHeight / 2;
      if (hasList() && !isReader) { setCursor((cursor < 0 ? 0 : cursor) + (k === "d" ? 3 : -3)); return; }
      scrollBy(k === "d" ? half : -half);
      return;
    }
    if (pending) {
      const p = pending;
      pending = ""; clearTimeout(pendingTimer); setPending("");
      if (p === "g" && k === "g") { e.preventDefault(); toTop(); return; }
      if (p === "]" && k === "]") { e.preventDefault(); nextHeading(1); return; }
      if (p === "[" && k === "[") { e.preventDefault(); nextHeading(-1); return; }
    }
    // A focused link/button keeps its native Enter / Space behaviour only for Enter; Space is our leader.
    if (k === "Enter" && e.target && e.target !== document.body && e.target !== document.documentElement && /^(A|BUTTON|SUMMARY)$/.test(e.target.tagName)) return;

    switch (k) {
      case "/": case ":":
        e.preventDefault(); term().open("/"); return;
      case " ":
        e.preventDefault(); startLeader(); return;
      case "?":
        e.preventDefault(); showHelp(); return;
      case "f":
        e.preventDefault(); startFlash(); return;
      case "j":
        e.preventDefault();
        if (hasList() && !isReader) setCursor(cursor + 1); else scrollBy(lineH() * 3);
        return;
      case "k":
        e.preventDefault();
        if (hasList() && !isReader) setCursor(cursor < 0 ? listItems().length - 1 : cursor - 1); else scrollBy(-lineH() * 3);
        return;
      case "g":
        e.preventDefault(); setPendingKey("g"); return;
      case "G":
        e.preventDefault(); toBottom(); return;
      case "]": case "[":
        if (isReader) { e.preventDefault(); setPendingKey(k); }
        return;
      case "H":
        if (isReader) { e.preventDefault(); goPager("prev"); }
        return;
      case "L":
        if (isReader) { e.preventDefault(); goPager("next"); }
        return;
      case "Enter":
        if (hasList() && !isReader && openCursor()) e.preventDefault();
        return;
    }
  });
  function toTop() { if (hasList() && !isReader) { setCursor(0); scrollToY(0); } else scrollToY(0); }
  function toBottom() { if (hasList() && !isReader) { setCursor(listItems().length - 1); } else scrollToY(maxScroll()); }

  window.addEventListener("pageshow", function () { cancelAll(); });
  window.__nav = { help: showHelp, mode: function () { return mode; }, cancel: cancelAll };
  setMode("NORMAL");
})();
