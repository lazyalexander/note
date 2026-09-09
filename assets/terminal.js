import { createTermEngine } from "./term-engine.mjs?v=22";

(function () {
  "use strict";

  const posts = Array.isArray(window.__POSTS__) ? window.__POSTS__ : [];
  const input = document.getElementById("term-input");
  const suggest = document.getElementById("suggest");
  const echo = document.getElementById("term-echo");
  if (!input || !suggest) return;

  const engine = createTermEngine({ posts });
  let matches = [];
  let selected = 0;
  let composing = false;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function activeTagQuery() {
    var parsed = engine.parseLine(input.value);
    if (parsed.kind !== "tag" || parsed.query == null) return "";
    return String(parsed.query).trim();
  }

  function tagMatchesQuery(tag, q) {
    if (!q) return false;
    var atom = String(q).trim().replace(/^@+/, "").toLowerCase();
    if (!atom) return false;
    var t = String(tag || "").toLowerCase();
    return t === atom || t.startsWith(atom);
  }

  function formatTags(p) {
    const tags = Array.isArray(p.tags) ? p.tags : [];
    if (!tags.length) return "";
    var q = activeTagQuery();
    return tags
      .map(function (tg) {
        var cls = "suggest-tag" + (tagMatchesQuery(tg, q) ? " match" : "");
        return '<span class="' + cls + '">@' + escapeHtml(tg) + "</span>";
      })
      .join(" ");
  }

  function setEcho(msg, isErr) {
    if (!echo) return;
    echo.textContent = msg || "";
    echo.classList.toggle("err", !!isErr);
    echo.hidden = !msg;
  }

  function renderSuggest() {
    suggest.innerHTML = "";
    if (!matches.length) {
      suggest.hidden = true;
      suggest.classList.remove("open");
      return;
    }
    suggest.hidden = false;
    suggest.classList.add("open");
    matches.forEach(function (p, i) {
      const li = document.createElement("li");
      li.className = "suggest-item" + (i === selected ? " active" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === selected ? "true" : "false");
      const tagsHtml = formatTags(p);
      li.innerHTML =
        '<span class="suggest-marker">' +
        (i === selected ? "\u25B8" : " ") +
        '</span><span class="suggest-title">' +
        escapeHtml(p.title) +
        "</span>" +
        (p.scoreLabel
          ? '<span class="suggest-score">' + escapeHtml(p.scoreLabel) + "</span>"
          : "") +
        (tagsHtml ? '<span class="suggest-tags">' + tagsHtml + "</span>" : "") +
        '<span class="suggest-stem">' +
        escapeHtml(p.stem) +
        "</span>";
      li.addEventListener("mouseenter", function () {
        selected = i;
        highlightOnly();
      });
      li.addEventListener("mousedown", function (e) {
        e.preventDefault();
        selected = i;
        navigate(matches[selected]);
      });
      suggest.appendChild(li);
    });
  }

  function highlightOnly() {
    const items = suggest.querySelectorAll(".suggest-item");
    items.forEach(function (el, i) {
      const on = i === selected;
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
      const marker = el.querySelector(".suggest-marker");
      if (marker) marker.textContent = on ? "\u25B8" : " ";
    });
  }

  function navigate(post) {
    if (!post || !post.href) return;
    if (!engine.beginNavigate()) return;
    var a = document.createElement("a");
    a.href = post.href;
    window.location.assign(a.href);
  }

  let aboutBusy = false;

  async function runAbout(query) {
    if (aboutBusy) return;
    aboutBusy = true;
    matches = [];
    selected = 0;
    renderSuggest();
    setEcho("about: searching…");
    try {
      const mod = await import("./about-search.js?v=22");
      const result = await mod.aboutSearch(query, 5, function (msg) {
        setEcho("about: " + msg);
      });
      matches = result.hits || [];
      selected = 0;
      renderSuggest();
      if (!matches.length) {
        setEcho(
          "about: no hits · load " +
            result.loadMs +
            "ms · query " +
            result.queryMs +
            "ms",
          true
        );
      } else {
        setEcho(
          "about: " +
            matches.length +
            " hits · load " +
            result.loadMs +
            "ms · query " +
            result.queryMs +
            "ms · total " +
            result.totalMs +
            "ms"
        );
      }
    } catch (err) {
      setEcho(
        "about error: " + (err && err.message ? err.message : String(err)),
        true
      );
    } finally {
      aboutBusy = false;
    }
  }

  function applyAction(action) {
    if (!action) return;
    if (action.type === "navigate") {
      navigate(action.post);
      return;
    }
    if (action.type === "echo") {
      setEcho(action.message, !!action.err);
      return;
    }
    if (action.type === "clear") {
      input.value = "";
      setEcho("");
      matches = [];
      selected = 0;
      renderSuggest();
      return;
    }
    if (action.type === "about") {
      runAbout(action.query);
      return;
    }
    if (action.type === "suggest") {
      matches = action.matches || [];
      selected = 0;
      renderSuggest();
    }
  }

  function refresh() {
    if (composing) return;
    const result = engine.suggest(input.value);
    matches = result.matches || [];
    if (selected >= matches.length) selected = Math.max(0, matches.length - 1);
    if (result.error) {
      setEcho(result.error, true);
    } else if (
      result.parsed &&
      (result.parsed.kind === "tag" || result.parsed.kind === "goto") &&
      result.parsed.query != null &&
      String(result.parsed.query).trim() !== ""
    ) {
      if (matches.length) {
        setEcho(matches.length + " match(es) · v22");
      } else {
        // Show raw codepoints so IME invisible chars are diagnosable.
        var q = String(result.parsed.query);
        var hex = Array.prototype.map
          .call(q, function (ch) {
            return ch.codePointAt(0).toString(16);
          })
          .join(" ");
        setEcho("no match · v22 · cp " + hex, true);
      }
    } else {
      setEcho("");
    }
    renderSuggest();
  }

  function cycle(delta) {
    if (!matches.length) return;
    selected = (selected + delta + matches.length) % matches.length;
    highlightOnly();
  }

  function isImeBusy(e) {
    // Real IME busy = browser says so. Sticky `composing` alone must NOT
    // block forever (compositionend can be missed). Never gate on keyCode 229.
    if (e && e.isComposing) return true;
    if (composing && e && e.key !== "Enter") return true;
    return false;
  }

  function clearComposing() {
    composing = false;
  }

  function reviveAfterHistory() {
    engine.resetNavigation();
  }
  window.addEventListener("pageshow", reviveAfterHistory);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") reviveAfterHistory();
  });

  input.addEventListener("compositionstart", function () {
    composing = true;
  });
  input.addEventListener("compositionend", function () {
    // Defer one tick so the committed characters are in input.value (Safari).
    setTimeout(function () {
      clearComposing();
      refresh();
    }, 0);
  });
  input.addEventListener("blur", clearComposing);

  input.addEventListener("input", function (e) {
    // If browser is not composing, sticky flag is stale — clear it.
    if (e && e.isComposing) return;
    if (composing) clearComposing();
    refresh();
  });

  input.addEventListener("keydown", function (e) {
    if (isImeBusy(e)) return;

    if (e.key === "ArrowDown") {
      if (matches.length) {
        e.preventDefault();
        cycle(1);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (matches.length) {
        e.preventDefault();
        cycle(-1);
      }
      return;
    }
    if (e.key === "Tab") {
      if (matches.length) {
        e.preventDefault();
        cycle(e.shiftKey ? -1 : 1);
      }
      return;
    }
    if (e.key === "Escape") {
      matches = [];
      selected = 0;
      renderSuggest();
      setEcho("");
      return;
    }
    if (e.key !== "Enter") return;
    // Sticky composing without isComposing = missed compositionend; clear it.
    if (composing && !(e && e.isComposing)) clearComposing();
    e.preventDefault();
    applyAction(engine.submit(input.value, selected));
  });

  document.addEventListener("keydown", function (e) {
    if (e.target === input) return;
    if (composing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1 || e.key === "Backspace") input.focus();
  });

  // Warm /about index + e5 model in the background so first /about is snappy.
  // Failures stay quiet — /about will surface errors on demand.
  import("./about-search.js?v=22")
    .then(function (mod) {
      if (mod && typeof mod.ensureAboutReady === "function") {
        return mod.ensureAboutReady(null);
      }
    })
    .catch(function () {});

  reviveAfterHistory();
  input.focus();
  refresh();
})();
