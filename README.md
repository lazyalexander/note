# note

Minimal TUI static blog. One folder under `content/` = one series (a single post still gets its own folder); folders starting with `_` or `.` are not published. Each post is `NN-title.md` with an optional `NN-title.json` (tags). See `content/01-blog/01-how-to-write.md`.

## Keyboard & search

The command bar is hidden; `/` or `:` opens it, `Esc` closes it. `/tag <expr>` is a client-side grep over titles, bodies, tags and folders (`poe/ & (乌鸦 | 死亡) & !#draft`, grammar in `src/query.mjs` and in `content/00-help/help.md`). Results render at `search.html?q=…` from `search-index.json` (generated at build time). `Space` is the leader key, `f` flash-jumps, `?` lists every key (`assets/nav.js`). `src/*.mjs` are bundled into `assets/term-engine.js` by `node src/build.mjs`.
