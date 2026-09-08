(function () {
  "use strict";

  const posts = Array.isArray(window.__POSTS__) ? window.__POSTS__ : [];
  const input = document.getElementById("term-input");
  const suggest = document.getElementById("suggest");
  const echo = document.getElementById("term-echo");
  if (!input || !suggest) return;

  let matches = [];
  let selected = 0;

  function parseLine(raw) {
    const line = String(raw || "").trimStart();
    const m = line.match(/^\/?goto(?:\s+(.*))?$/i);
    if (!m) return { kind: "other", text: line };
    return { kind: "goto", query: m[1] == null ? null : m[1] };
  }

  function filterPosts(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return posts.slice();
    return posts.filter(function (p) {
      return (
        String(p.title).toLowerCase().indexOf(q) !== -1 ||
        String(p.stem).toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
      li.innerHTML =
        '<span class="suggest-marker">' +
        (i === selected ? "\u25B8" : " ") +
        '</span><span class="suggest-title">' +
        escapeHtml(p.title) +
        '</span><span class="suggest-stem">' +
        escapeHtml(p.stem) +
        "</span>";
      li.addEventListener("mouseenter", function () {
        selected = i;
        highlightOnly();
      });
      li.addEventListener("mousedown", function (e) {
        e.preventDefault();
        selected = i;
        goTo(matches[selected]);
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

  function setEcho(msg, isErr) {
    if (!echo) return;
    echo.textContent = msg || "";
    echo.classList.toggle("err", !!isErr);
    echo.hidden = !msg;
  }

  function refresh() {
    const parsed = parseLine(input.value);
    if (parsed.kind !== "goto" || parsed.query === null) {
      matches = [];
      selected = 0;
      renderSuggest();
      return;
    }
    matches = filterPosts(parsed.query);
    if (selected >= matches.length) selected = Math.max(0, matches.length - 1);
    renderSuggest();
  }

  function goTo(post) {
    if (!post || !post.href) return;
    var base = typeof window.__BASE__ === "string" ? window.__BASE__ : "";
    var rel = String(post.href).replace(/^\//, "");
    window.location.href = (base || "") + "/" + rel;
  }

  function cycle(delta) {
    if (!matches.length) return;
    selected = (selected + delta + matches.length) % matches.length;
    highlightOnly();
  }

  input.addEventListener("input", refresh);

  input.addEventListener("keydown", function (e) {
    const parsed = parseLine(input.value);

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

    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;

    if (parsed.kind === "goto") {
      if (parsed.query === null) {
        setEcho("usage: /goto <title>", true);
        matches = [];
        renderSuggest();
        return;
      }
      if (matches.length === 0) {
        setEcho("no match: " + parsed.query, true);
        return;
      }
      const q = parsed.query.trim().toLowerCase();
      const exact = matches.filter(function (p) {
        return (
          p.title.toLowerCase() === q ||
          p.stem.toLowerCase() === q
        );
      });
      if (exact.length === 1) {
        goTo(exact[0]);
        return;
      }
      goTo(matches[selected] || matches[0]);
      return;
    }

    if (/^help$/i.test(raw) || raw === "?") {
      setEcho("commands: /goto <title>  ·  ↑↓/Tab cycle  ·  Enter open", false);
      return;
    }
    if (/^ls$/i.test(raw) || /^ls\s+posts\/?$/i.test(raw)) {
      setEcho(
        posts.map(function (p, i) {
          return String(i + 1).padStart(2, "0") + "  " + p.title;
        }).join("\n") || "(empty)",
        false
      );
      return;
    }
    if (/^clear$/i.test(raw)) {
      input.value = "";
      setEcho("");
      matches = [];
      renderSuggest();
      return;
    }

    setEcho("command not found: " + raw + "  (try /goto)", true);
  });

  document.addEventListener("keydown", function (e) {
    if (e.target === input) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1 || e.key === "Backspace") {
      input.focus();
    }
  });

  input.focus();
  refresh();
})();
