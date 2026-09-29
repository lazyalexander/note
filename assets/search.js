import { searchDocs, makeSnippet, highlightParts, formatQueryError, cleanExpr } from "./term-engine.js?v=36";

/** Client-rendered /tag result page: search.html?q=<expr>, grouped by folder. */
(function () {
  "use strict";
  const root = document.getElementById("sr-root");
  const exprEl = document.getElementById("sr-expr");
  const sumEl = document.getElementById("sr-summary");
  if (!root) return;

  const q = new URLSearchParams(location.search).get("q") || "";
  exprEl.textContent = q;
  document.title = q ? "/tag " + q + " · note" : "search · note";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function partsHtml(parts) {
    return parts.map(function (p) { return p.hit ? "<mark>" + esc(p.text) + "</mark>" : esc(p.text); }).join("");
  }

  function fail(msg) {
    sumEl.textContent = "";
    root.innerHTML = '<div class="sr-empty sr-err"><pre>' + esc(msg) + "</pre></div>";
  }

  function render(index) {
    const docs = index.docs || [];
    const res = searchDocs(docs, q);
    if (!res.ok) {
      sumEl.textContent = "syntax error";
      root.innerHTML = '<div class="sr-empty sr-err"><pre>' + esc(formatQueryError(q, res.error)) + '</pre><p>按 <kbd>/</kbd> 修改表达式，<kbd>?</kbd> 查看语法与快捷键。</p></div>';
      return;
    }
    if (res.empty) {
      sumEl.textContent = "empty expression";
      root.innerHTML = '<div class="sr-empty"><p>还没有表达式。按 <kbd>/</kbd> 输入 <code>/tag 关键字</code>，例如 <code>/tag poe/ &amp; (乌鸦 | 死亡) &amp; !#draft</code>。</p></div>';
      return;
    }
    const n = res.results.length;
    const groups = [];
    index.series.forEach(function (s) {
      const items = res.results.filter(function (d) { return d.dir === s.dir; });
      if (items.length) groups.push({ s: s, items: items });
    });
    sumEl.textContent = n === 0 ? "0 篇匹配" : n + " 篇匹配 · " + groups.length + " 个文件夹";
    if (!n) {
      root.innerHTML = '<div class="sr-empty"><p>没有匹配的文章。<br>换个关键字试试，或用 <code>|</code> 放宽条件；<kbd>/</kbd> 重新输入。</p></div>';
      return;
    }
    root.innerHTML = '<ul class="folders sr-list">' + groups.map(function (g) {
      return '<li class="sr-group"><div class="sr-folder"><span class="sr-folder-name">' + esc(g.s.title) + '</span><span class="sr-folder-dir">' + esc(g.s.dir) + "/</span>" +
        '<span class="sr-folder-count">' + g.items.length + " / " + g.s.count + " 篇</span></div>" +
        '<ul class="sr-items">' + g.items.map(function (d) {
          const snip = makeSnippet(d, res.terms);
          const tags = (d.tags || []).map(function (t) {
            const hit = res.tagTerms.some(function (x) { return x.value.toLowerCase() === String(t).toLowerCase(); });
            return '<span class="sr-tag' + (hit ? " hit" : "") + '">#' + esc(t) + "</span>";
          }).join(" ");
          return '<li><a class="sr-item" data-nav href="' + esc(d.href) + '">' +
            '<span class="sr-num">' + esc(d.n) + "</span>" +
            '<span class="sr-body"><span class="sr-title">' + partsHtml(highlightParts(d.title, res.terms, "title")) + "</span>" +
            (snip.parts.length ? '<span class="sr-snippet">' + partsHtml(snip.parts) + "</span>" : "") +
            (tags ? '<span class="sr-tags">' + tags + "</span>" : "") +
            "</span></a></li>";
        }).join("") + "</ul></li>";
    }).join("") + "</ul>";
    root.dataset.count = String(n);
    if (window.__nav && window.__nav.refreshList) window.__nav.refreshList();
  }

  fetch("search-index.json")
    .then(function (r) { if (!r.ok) throw new Error("search-index.json HTTP " + r.status); return r.json(); })
    .then(render)
    .catch(function (e) { fail("cannot load search index: " + (e && e.message ? e.message : e)); });
})();
