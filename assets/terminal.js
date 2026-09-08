import { createTermEngine } from "./term-engine.js";

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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTags(p) {
    const tags = Array.isArray(p.tags) ? p.tags : [];
    if (!tags.length) return "";
    return tags
      .map(function (t) {
        return '<span class="suggest-tag">@' + escapeHtml(t) + "</span>";
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
    if (action.type === "suggest") {
      matches = action.matches || [];
      selected = 0;
      renderSuggest();
    }
  }

  function refresh() {
    if (input.isComposing) return;
    const result = engine.suggest(input.value);
    if (result.error) setEcho(result.error, true);
    else setEcho("");
    matches = result.matches || [];
    if (selected >= matches.length) selected = Math.max(0, matches.length - 1);
    renderSuggest();
  }

  function cycle(delta) {
    if (!matches.length) return;
    selected = (selected + delta + matches.length) % matches.length;
    highlightOnly();
  }

  function reviveAfterHistory() {
    engine.resetNavigation();
  }
  window.addEventListener("pageshow", reviveAfterHistory);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") reviveAfterHistory();
  });

  input.addEventListener("input", refresh);
  input.addEventListener("compositionend", refresh);

  input.addEventListener("keydown", function (e) {
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
    applyAction(engine.submit(input.value, selected));
  });

  document.addEventListener("keydown", function (e) {
    if (e.target === input) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1 || e.key === "Backspace") input.focus();
  });

  reviveAfterHistory();
  input.focus();
  refresh();
})();
