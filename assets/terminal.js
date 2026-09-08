(function () {
  "use strict";

  const posts = Array.isArray(window.__POSTS__) ? window.__POSTS__ : [];
  const input = document.getElementById("term-input");
  const suggest = document.getElementById("suggest");
  const echo = document.getElementById("term-echo");
  if (!input || !suggest) return;

  const TAG_EXPR_MAX = 64;
  let matches = [];
  let selected = 0;
  let navigating = false;

  function parseLine(raw) {
    const line = String(raw || "").trim();
    if (/^\/?help$/i.test(line)) return { kind: "help" };
    if (/^\/?welcome$/i.test(line)) return { kind: "welcome" };
    let m = line.match(/^\/?goto(?:\s+(.*))?$/i);
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

  function normalizeTag(t) {
    return String(t || "")
      .trim()
      .toLowerCase()
      .replace(/^@/, "");
  }

  function postHasTag(p, atom) {
    const want = normalizeTag(atom);
    if (!want) return false;
    return postTags(p).some(function (t) {
      return normalizeTag(t) === want;
    });
  }

  function postHasTagFuzzy(p, atom) {
    const want = normalizeTag(atom);
    if (!want) return false;
    return postTags(p).some(function (t) {
      return normalizeTag(t).indexOf(want) !== -1;
    });
  }

  function tokenizeTagExpr(src) {
    const s = String(src || "");
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      if (/\s/.test(s[i])) {
        i++;
        continue;
      }
      if (s[i] === "(" || s[i] === ")") {
        tokens.push({ type: s[i] });
        i++;
        continue;
      }
      if (s[i] === "&") {
        tokens.push({ type: "&" });
        i++;
        continue;
      }
      if (s[i] === "|" && s[i + 1] === "|") {
        tokens.push({ type: "||" });
        i += 2;
        continue;
      }
      const m = s.slice(i).match(/^@?[\w\-\u4e00-\u9fff]+/);
      if (m) {
        tokens.push({ type: "tag", value: m[0] });
        i += m[0].length;
        continue;
      }
      throw new Error("bad token near: " + s.slice(i, i + 8));
    }
    return tokens;
  }

  function parseTagExpr(src) {
    const tokens = tokenizeTagExpr(src);
    let pos = 0;

    function peek() {
      return tokens[pos] || null;
    }
    function take(type) {
      const t = peek();
      if (!t || (type && t.type !== type)) return null;
      pos++;
      return t;
    }

    function parsePrimary() {
      if (take("(")) {
        const node = parseOr();
        if (!take(")")) throw new Error("missing )");
        return node;
      }
      const t = take("tag");
      if (!t) throw new Error("expected tag");
      return { type: "tag", value: t.value };
    }

    function parseAnd() {
      let node = parsePrimary();
      while (peek() && peek().type === "&") {
        take("&");
        node = { type: "&", left: node, right: parsePrimary() };
      }
      return node;
    }

    function parseOr() {
      let node = parseAnd();
      while (peek() && peek().type === "||") {
        take("||");
        node = { type: "||", left: node, right: parseAnd() };
      }
      return node;
    }

    if (!tokens.length) throw new Error("empty");
    const tree = parseOr();
    if (pos !== tokens.length) throw new Error("trailing input");
    return tree;
  }

  function evalTagNode(node, p, fuzzy) {
    if (!node) return false;
    if (node.type === "tag") {
      return fuzzy ? postHasTagFuzzy(p, node.value) : postHasTag(p, node.value);
    }
    if (node.type === "&") {
      return evalTagNode(node.left, p, fuzzy) && evalTagNode(node.right, p, fuzzy);
    }
    if (node.type === "||") {
      return evalTagNode(node.left, p, fuzzy) || evalTagNode(node.right, p, fuzzy);
    }
    return false;
  }

  function exprHasOps(node) {
    if (!node) return false;
    if (node.type === "tag") return false;
    return true;
  }

  function filterPostsByTag(query) {
    const q = String(query || "").trim();
    if (!q) {
      return posts.filter(function (p) {
        return postTags(p).length > 0;
      });
    }
    if (q.length > TAG_EXPR_MAX) {
      setEcho("tag expr max " + TAG_EXPR_MAX + " chars", true);
      return [];
    }
    try {
      const tree = parseTagExpr(q);
      const fuzzy = !exprHasOps(tree);
      return posts.filter(function (p) {
        return evalTagNode(tree, p, fuzzy);
      });
    } catch (err) {
      setEcho("tag parse: " + (err && err.message ? err.message : "error"), true);
      return [];
    }
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

  function goTo(post) {
    if (!post || !post.href || navigating) return;
    navigating = true;
    var a = document.createElement("a");
    a.href = post.href;
    window.location.assign(a.href);
  }

  function findPostByStem(stem) {
    var want = String(stem || "").toLowerCase();
    var hit = posts.filter(function (p) {
      return String(p.stem).toLowerCase() === want;
    });
    if (hit.length) return hit[0];
    hit = posts.filter(function (p) {
      return String(p.stem).toLowerCase().indexOf(want) !== -1;
    });
    return hit[0] || null;
  }

  function findHelpPost() {
    return (
      findPostByStem("00-help") ||
      posts.filter(function (p) {
        return postTags(p).some(function (t) {
          return normalizeTag(t) === "help";
        });
      })[0] ||
      null
    );
  }

  function findWelcomePost() {
    return (
      findPostByStem("01-welcome") ||
      posts.filter(function (p) {
        return postTags(p).some(function (t) {
          return normalizeTag(t) === "welcome";
        });
      })[0] ||
      null
    );
  }

  function openHelp() {
    var post = findHelpPost();
    if (!post) {
      setEcho("help post not found", true);
      return false;
    }
    goTo(post);
    return true;
  }

  function openWelcome() {
    var post = findWelcomePost();
    if (!post) {
      setEcho("welcome post not found", true);
      return false;
    }
    goTo(post);
    return true;
  }

  function tryAutoCommand() {
    if (navigating) return true;
    if (input.composing || input.isComposing) return false;
    var parsed = parseLine(input.value);
    if (parsed.kind === "help") {
      matches = [];
      selected = 0;
      renderSuggest();
      openHelp();
      return true;
    }
    if (parsed.kind === "welcome") {
      matches = [];
      selected = 0;
      renderSuggest();
      openWelcome();
      return true;
    }
    return false;
  }

  function refresh() {
    if (tryAutoCommand()) return;

    const parsed = parseLine(input.value);
    setEcho("");

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
  input.addEventListener("keyup", function () {
    tryAutoCommand();
  });
  input.addEventListener("compositionend", function () {
    refresh();
  });

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
      openHelp();
      return;
    }
    if (parsed.kind === "welcome") {
      openWelcome();
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
