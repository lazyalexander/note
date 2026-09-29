/**
 * Command-bar completion (pure, no DOM). Sources in priority order:
 *   command names → folders → tags → post titles → history.
 * complete(line, ctx) → { items, ghost }
 *   ctx = { series:[{dir,no,slug,title,count}], tags:[string], posts:[{title,dir,stem}], history:[string] }
 *   item = { kind, label, hint, text, exec }   text = the whole new input line after accepting
 *   exec: Enter on this item also runs the resulting line (false → only fills the line in, e.g. "/tag " needs arguments)
 */
import { COMMANDS_LIST } from "./commands-list.mjs";

export const MAX_ITEMS = 12;
export const THEME_NAMES = ["auto", "paper", "tokyo", "ink"];

const low = (s) => String(s || "").toLowerCase();

function push(items, seen, item) {
  if (items.length >= MAX_ITEMS + 8) return;
  if (seen.has(item.text)) return;
  seen.add(item.text);
  items.push(item);
}

function historyItems(line, ctx, items, seen) {
  const L = low(line);
  for (const h of ctx.history || []) {
    if (!h || h === line) continue;
    if (L === "" || low(h).startsWith(L)) push(items, seen, { kind: "hist", label: h, hint: "history", text: h, exec: true });
  }
}

/** Split off the token being typed at the end of a /tag expression. */
export function currentTagToken(rest) {
  let i = rest.length;
  while (i > 0 && !/[\s()&|（）｜＆]/.test(rest[i - 1])) i--;
  const before = rest.slice(0, i);
  let tok = rest.slice(i);
  let prefix = "";
  while (/^[!！]/.test(tok)) {
    prefix += tok[0];
    tok = tok.slice(1);
  }
  return { before, prefix, tok };
}

function inOpenQuote(rest) {
  return (rest.match(/"/g) || []).length % 2 === 1;
}

export function complete(line, ctx = {}) {
  const items = [];
  const seen = new Set([line]); // never offer the line the user already has
  const m = line.match(/^(\/?)(\S*)(\s*)([\s\S]*)$/);
  const word = m[2];
  const slash = m[1] || (word === "" ? "/" : "");
  const hasSpace = m[3].length > 0;

  if (!hasSpace) {
    // ---- command names
    const w = low(word);
    for (const c of COMMANDS_LIST) {
      const bare = c.name.slice(1);
      if (w === "" || bare.startsWith(w)) {
        push(items, seen, {
          kind: "cmd",
          label: slash + bare,
          hint: c.desc,
          text: slash + bare + (c.args ? " " : ""),
          exec: !c.args, // commands that need arguments are only filled in
        });
      }
    }
    historyItems(line, ctx, items, seen);
  } else {
    const cmd = low(word);
    const argStart = line.length - m[4].length;
    const head = line.slice(0, argStart);
    const rest = m[4];
    if (cmd === "tag") {
      tagItems(head, rest, ctx, items, seen);
    } else if (cmd === "theme") {
      const w = low(rest.trim());
      for (const t of THEME_NAMES) {
        if (t.startsWith(w) && !/\s/.test(rest.trim())) {
          push(items, seen, { kind: "theme", label: t, hint: "theme", text: head + t, exec: true });
        }
      }
    }
    historyItems(line, ctx, items, seen);
  }

  // keep room for history entries at the end of the menu (they are the lowest priority, not invisible)
  const hist = items.filter((i) => i.kind === "hist").slice(0, 3);
  const rest = items.filter((i) => i.kind !== "hist");
  const out = rest.slice(0, MAX_ITEMS - hist.length).concat(hist);
  const gi = ghostIndex(line, out);
  // auto = item pre-selected in the menu (the one the ghost text shows); -1 = none, Enter runs the typed line
  return { items: out, ghost: gi >= 0 ? out[gi].text.slice(line.length) : "", auto: gi };
}

function tagItems(head, rest, ctx, items, seen) {
  const series = ctx.series || [];
  const tags = ctx.tags || [];
  const posts = ctx.posts || [];

  if (inOpenQuote(rest)) {
    // inside "phrase": complete a post title (closing the quote)
    const qi = rest.lastIndexOf('"');
    const partial = rest.slice(qi + 1);
    const before = rest.slice(0, qi + 1);
    const P = low(partial);
    if (!P) return;
    for (const p of posts) {
      if (low(p.title).startsWith(P) && low(p.title) !== P) {
        push(items, seen, { kind: "post", label: p.title, hint: p.dir + "/", text: head + before + p.title + '"', exec: true });
      }
    }
    return;
  }

  const { before, prefix, tok } = currentTagToken(rest);
  if (/^\//.test(tok)) return; // regex in progress
  const base = head + before + prefix;
  const T = low(tok);

  // qualifier value: title:xxx / tag:xxx / folder:xxx
  const q = tok.match(/^(title|body|tag|folder|dir):(.*)$/i);
  if (q) {
    const qual = low(q[1]);
    const V = low(q[2]);
    if (qual === "tag") {
      for (const t of tags) if (low(t).startsWith(V)) push(items, seen, { kind: "tag", label: "#" + t, hint: "tag", text: base + q[1] + ":" + t, exec: true });
    } else if (qual === "folder" || qual === "dir") {
      for (const s of series) if (V === "" || low(s.slug).startsWith(V) || low(s.dir).startsWith(V)) push(items, seen, { kind: "folder", label: s.dir + "/", hint: folderHint(s), text: base + q[1] + ":" + s.slug, exec: true });
    } else if (qual === "title") {
      for (const p of posts) if (V && low(p.title).startsWith(V) && !/\s/.test(p.title)) push(items, seen, { kind: "post", label: p.title, hint: p.dir + "/", text: base + q[1] + ":" + p.title, exec: true });
    }
    return;
  }

  const tagMode = T.startsWith("#") || T.startsWith("@");
  const hashPfx = tagMode ? tok[0] : "";
  const name = tagMode ? T.slice(1) : T;

  // 1. folders (prefix first, then contains)
  if (!tagMode) {
    const digits = /^\d/.test(T);
    const strong = [];
    const weak = [];
    for (const s of series) {
      const forms = digits ? [s.dir + "/", s.no + "/"] : [s.slug + "/", s.dir + "/", s.title + "/"];
      const hit = T === "" ? forms[0] : forms.find((f) => low(f).startsWith(T));
      if (hit) strong.push({ s, form: hit });
      else if (T && (low(s.slug).includes(T) || low(s.title).includes(T))) weak.push({ s, form: s.slug + "/" });
    }
    for (const { s, form } of strong.concat(weak)) {
      push(items, seen, { kind: "folder", label: form, hint: folderHint(s), text: base + form, exec: true });
    }
  }
  // 2. tags
  for (const t of tags) {
    const L = low(t);
    if (tagMode ? L.startsWith(name) : L.startsWith(T)) {
      push(items, seen, { kind: "tag", label: "#" + t, hint: "tag", text: base + (hashPfx || "#") + t, exec: true });
    }
  }
  // 3. post titles (bare title if it is one word, otherwise a quoted phrase)
  if (!tagMode && T !== "") {
    for (const p of posts) {
      const L = low(p.title);
      if (L.startsWith(T) || (T.length >= 2 && L.includes(T))) {
        const lit = /[\s()&|"]/.test(p.title) ? '"' + p.title + '"' : p.title;
        push(items, seen, { kind: "post", label: p.title, hint: p.dir + "/", text: base + lit, exec: true });
      }
    }
  }
}

function folderHint(s) {
  return `${s.title} · ${s.count} 篇`;
}

/** Index of the first candidate that literally continues what was typed (its remainder is the ghost text). */
export function ghostIndex(line, items) {
  if (!line || /\s$/.test(line)) return -1;
  const L = low(line);
  return items.findIndex((it) => it.text.length > line.length && low(it.text).startsWith(L) && it.text.slice(line.length).trim() !== "");
}
