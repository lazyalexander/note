(function () {
  "use strict";

  const posts = Array.isArray(window.__POSTS__) ? window.__POSTS__ : [];
  const input = document.getElementById("term-input");
  const suggest = document.getElementById("suggest");
  const echo = document.getElementById("term-echo");
  if (!input || !suggest) return;

  let matches = [];
  let selected = 0;
  let mode = null; // "goto" | "tag" | null

  function parseLine(raw) {
    const line = String(raw || "").trimStart();
    let m = line.match(/^\/?help(?:\s+.*)?$/i);
    if (m) return { kind: "help" };
    m = line.match(/^\/?goto(?:\s+(.*))?$/i);
    if (m) return { kind: "goto", query: m[1] == null ? null : m[1] };
    m = line.match(/^\/?tag(?:\s+(.*))?$/i);
    if (m) return { kind: "tag", query: m[1] == null ? null : m[1] };
    return { kind: "other", text: line };
  }

  function filterPostsByTitle(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return posts.slice();
    return posts.filter(function (p) {
      return (
        String(p.title).toLowerCase().indexOf(q) !== -1 ||
        String(p.stem).toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function postTags(p) {
    return Array.isArray(p.tags) ? p.tags : [];
  }

  function filterPostsByTag(query) {
    const q = String(query || "").trim().toLowerCase().replace(/^@/, "");
    if (!q) {
      return posts.filter(function (p) {
        return postTags(p).length > 0;
      });
    }
    return posts.filter(function (p) {
      return postTags(p).some(function (t) {
        return String(t).toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTags(p) {
    const tags = postTags(p);
    if (!tags.length) return "";
    return tags
      .map(function (t) {
        return '<span class="suggest-tag">@' + escapeHtml(t) + "</span>";
      })
      .join(" ");
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
        (tagsHtml
          ? '<span class="suggest-tags">' + tagsHtml + "</span>"
          : "") +
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
    mode = parsed.kind === "goto" || parsed.kind === "tag" ? parsed.kind : null;

    if (parsed.kind === "goto") {
      if (parsed.query === null) {
        matches = [];
        selected = 0;
        renderSuggest();
        return;
      }
      matches = filterPostsByTitle(parsed.query);
    } else if (parsed.kind === "tag") {
      if (parsed.query === null) {
        matches = [];
        selected = 0;
        renderSuggest();
        return;
      }
      matches = filterPostsByTag(parsed.query);
    } else {
      matches = [];
      selected = 0;
      renderSuggest();
      return;
    }

    if (selected >= matches.length) selected = Math.max(0, matches.length - 1);
    renderSuggest();
  }

  function goTo(post) {
    if (!post || !post.href) return;
    var base = typeof window.__BASE__ === "string" ? window.__BASE__ : "";
    var rel = String(post.href).replace(/^\//, "");
    window.location.href = (base || "") + "/" + rel;
  }

  function findHelpPost() {
    var byStem = posts.filter(function (p) {
      return String(p.stem).toLowerCase() === "00-help";
    });
    if (byStem.length) return byStem[0];
    var byTag = posts.filter(function (p) {
      return postTags(p).some(function (t) {
        return String(t).toLowerCase() === "help";
      });
    });
    return byTag[0] || null;
  }

  function cycle(delta) {
    if (!matches.length) return;
    selected = (selected + delta + matches.length) % matches.length;
    highlightOnly();
  }

  function openFromMatches(parsed) {
    if (matches.length === 0) {
      setEcho("no match: " + (parsed.query || ""), true);
      return;
    }
    if (parsed.kind === "goto") {
      const q = parsed.query.trim().toLowerCase();
      const exact = matches.filter(function (p) {
        return p.title.toLowerCase() === q || p.stem.toLowerCase() === q;
      });
      if (exact.length === 1) {
        goTo(exact[0]);
        return;
      }
    }
    goTo(matches[selected] || matches[0]);
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

    if (parsed.kind === "help") {
      var helpPost = findHelpPost();
      if (!helpPost) {
        setEcho("help post not found", true);
        return;
      }
      goTo(helpPost);
      return;
    }

    if (parsed.kind === "goto") {
      if (parsed.query === null) {
        matches = [];
        renderSuggest();
        return;
      }
      openFromMatches(parsed);
      return;
    }

    if (parsed.kind === "tag") {
      if (parsed.query === null) {
        matches = filterPostsByTag("");
        selected = 0;
        renderSuggest();
        return;
      }
      openFromMatches(parsed);
      return;
    }

    if (/^clear$/i.test(raw)) {
      input.value = "";
      setEcho("");
      matches = [];
      renderSuggest();
      return;
    }

    setEcho("command not found: " + raw, true);
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
