import { normalizeSearchInput, describeQueryError, searchDocs, searchDocsAsync, hasAbout, makeResultView, highlightParts, formatQueryError } from "./term-engine.js?v=44";

/**
 * Client-rendered /find result page: search.html?q=<expr>, grouped by folder.
 * Old /tag URLs keep working (same grammar). about: terms are scored in the browser (e5 model, lazy-loaded);
 * the page shows "正在理解…" while the model / embeddings load, and literal parts still work if it fails.
 */
(function () {
  "use strict";
  const root = document.getElementById("sr-root");
  const exprEl = document.getElementById("sr-expr");
  const sumEl = document.getElementById("sr-summary");
  const notesEl = document.getElementById("sr-notes");
  if (!root) return;

  const rawQuery = new URLSearchParams(location.search).get("q") || "";
  const knownTags = [...new Set((window.__POSTS__ || []).flatMap((p) => p.tags || []))];
  const q = normalizeSearchInput(rawQuery, knownTags);
  if (q !== rawQuery) {
    const url = new URL(location.href);
    url.searchParams.set("q", q);
    history.replaceState(null, "", url);
  }
  const queryInput = document.getElementById("search-query");
  const feedback = document.getElementById("search-feedback");
  queryInput.value = rawQuery;
  queryInput.addEventListener("input", function () {
    queryInput.removeAttribute("aria-invalid");
    feedback.hidden = true;
  });
  exprEl.textContent = q;
  document.title = q ? "/find " + q + " · note" : "search · note";
  root.dataset.state = "loading";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function partsHtml(parts) {
    return parts.map(function (p) { return p.hit ? "<mark>" + esc(p.text) + "</mark>" : esc(p.text); }).join("");
  }
  function setState(s) { root.dataset.state = s; }
  function note(html) { if (notesEl) notesEl.innerHTML = html || ""; }

  function fail() {
    sumEl.textContent = "搜索暂时不可用";
    setState("error");
    root.innerHTML = '<div class="search-recovery"><h2>暂时没能读取笔记</h2><p>输入已保留，请检查连接后重试。</p><a href="search.html?q=' + encodeURIComponent(rawQuery) + '">重新搜索 ↗</a> · <a href="./">返回目录</a></div>';
  }

  function loading(text) {
    setState("loading");
    sumEl.textContent = text;
    root.innerHTML = '<div class="sr-empty sr-loading" role="status"><span class="sr-spin" aria-hidden="true"></span>' + esc(text) + "</div>";
  }

  let aboutMod = null;
  function loadAbout() {
    if (!aboutMod) aboutMod = import("./about-search.js?v=44");
    return aboutMod;
  }

  function stateText(msg) {
    // the phase names of about-search.js status callbacks → a short Chinese label
    if (/model/i.test(msg)) return "正在理解… 加载语义模型（首次需要下载，之后走浏览器缓存）";
    return "正在理解… 加载向量索引";
  }

  function render(index, res) {
    const n = res.results.length;
    const groups = [];
    if (res.ordered) {
      // similarity order across folders: one flat ranked list
      groups.push({ s: null, items: res.results });
    } else {
      index.series.forEach(function (s) {
        const items = res.results.filter(function (d) { return d.dir === s.dir; });
        if (items.length) groups.push({ s: s, items: items });
      });
    }
    const seriesOf = {};
    index.series.forEach(function (s) { seriesOf[s.dir] = s; });
    const rep = (res.aboutReport || []).map(function (r) {
      const sel = r.sel ? (r.sel.mode === "gt" ? (r.sel.inclusive ? ">=" : ">") + r.sel.min : r.sel.mode + "-" + r.sel.n) : "auto";
      return "about:" + r.query + " [" + sel + "] → " + r.picked + "/" + r.candidates;
    });
    sumEl.textContent = n === 0 ? "0 篇匹配" : n + " 篇匹配" + (res.ordered ? " · 按相似度排序" : " · " + groups.length + " 个文件夹");
    let notes = "";
    if (rep.length) notes += '<span class="sr-note-about">' + esc(rep.join("   ")) + "</span>";
    (res.aboutErrors || []).forEach(function (e) {
      notes += '<span class="sr-note-err">语义搜索不可用（' + esc(e.message) + "）— about:" + esc(e.query) + " 被当作无匹配；其余条件照常计算。</span>";
    });
    note(notes);
    if (!n) {
      setState("done");
      root.dataset.count = "0";
      root.innerHTML = '<div class="sr-empty"><p>没有匹配的文章。<br>在上方换个关键词试试，或用 <code>|</code> 放宽条件。</p></div>';
      return;
    }
    function itemHtml(d) {
      const info = res.info.get(d.stem) || {};
      const view = makeResultView(d, info, res.terms);
      const tags = (d.tags || []).map(function (t) {
        const hit = res.tagTerms.some(function (x) { return x.value.toLowerCase() === String(t).toLowerCase(); });
        return '<span class="sr-tag' + (hit ? " hit" : "") + '">#' + esc(t) + "</span>";
      }).join(" ");
      let detail = "";
      if (view.kind === "grep") {
        detail = '<span class="sr-lines">' + view.lines.map(function (l) {
          return '<span class="sr-line"><span class="sr-ln">' + (l.n === 0 ? "title" : l.n) + '</span><span class="sr-lt">' + partsHtml(l.parts) + "</span></span>";
        }).join("") + (view.more ? '<span class="sr-line sr-more">… +' + view.more + " 行</span>" : "") + "</span>";
      } else if (view.parts.length) {
        detail = '<span class="sr-snippet">' + partsHtml(view.parts) + "</span>";
      }
      const score = info.about ? '<span class="sr-score" title="about:' + esc(info.about.query) + ' 相似度 (cosine)">' + info.about.score.toFixed(3) + "</span>" : "";
      const folder = res.ordered ? '<span class="sr-inline-dir">' + esc(d.dir) + "/</span>" : "";
      return '<li><a class="sr-item" data-nav data-stem="' + esc(d.stem) + '" href="' + esc(d.href) + '">' +
        '<span class="sr-num">' + esc(d.n) + "</span>" +
        '<span class="sr-body"><span class="sr-titleline"><span class="sr-title">' + partsHtml(highlight(d.title)) + "</span>" + folder + score + "</span>" +
        detail + (tags ? '<span class="sr-tags">' + tags + "</span>" : "") +
        "</span></a></li>";
    }
    function highlight(title) { return highlightParts(title, res.terms, "title"); }
    root.innerHTML = '<ul class="folders sr-list">' + groups.map(function (g) {
      const head = g.s
        ? '<div class="sr-folder"><span class="sr-folder-name">' + esc(g.s.title) + '</span><span class="sr-folder-dir">' + esc(g.s.dir) + "/</span>" +
          '<span class="sr-folder-count">' + g.items.length + " / " + g.s.count + " 篇</span></div>"
        : "";
      return '<li class="sr-group">' + head + '<ul class="sr-items">' + g.items.map(itemHtml).join("") + "</ul></li>";
    }).join("") + "</ul>";
    root.dataset.count = String(n);
    setState("done");
    if (window.__nav && window.__nav.refreshList) window.__nav.refreshList();
  }

  function run(index) {
    const docs = index.docs || [];
    const first = searchDocs(docs, q);
    if (!first.ok) {
      sumEl.textContent = "修改一下条件，再试一次";
      setState("invalid");
      feedback.textContent = describeQueryError(first.error);
      feedback.hidden = false;
      queryInput.setAttribute("aria-invalid", "true");
      root.innerHTML = '<div class="search-recovery"><h2>搜索条件还差一点</h2><p>在上方直接修改，原来的输入会为你保留。</p><details><summary>查看具体位置</summary><pre>' + esc(formatQueryError(q, first.error)) + '</pre></details><a href="./">返回笔记目录 ↗</a></div>';
      return Promise.resolve();
    }
    if (first.empty) {
      sumEl.textContent = "输入关键词，开始查找笔记";
      setState("done");
      root.innerHTML = '<div class="sr-empty"><p>在上方输入关键词，例如 <code>find 心跳</code> 或 <code>tag:poe</code>。</p></div>';
      return Promise.resolve();
    }
    const finish = function (res) { render(index, res); };
    if (!hasAbout(first.ast)) return Promise.resolve(finish(first));
    loading("正在理解…");
    const status = function (m) { if (root.dataset.state === "loading") { const t = stateText(m); sumEl.textContent = t; const el = root.querySelector(".sr-loading"); if (el) el.lastChild.textContent = t; } };
    return searchDocsAsync(docs, q, {
      scoreAbout: function (query) {
        return loadAbout().then(function (m) { return m.scoreAbout(query, status); });
      },
    }).then(finish);
  }

  fetch("search-index.json")
    .then(function (r) { if (!r.ok) throw new Error("search-index.json HTTP " + r.status); return r.json(); })
    .then(run)
    .catch(fail);
})();
