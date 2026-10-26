# note

Minimal TUI static blog. One folder under `content/` = one series (a single post still gets its own folder); folders starting with `_` or `.` are not published. Each post is `NN-title.md` with an optional `NN-title.json` (tags). See `content/01-blog/01-how-to-write.md`.

## Browse & search

The home page has a persistent search form and collapsible folder contents. Expand a folder to open any article directly; article rows include estimated reading time. Search accepts a plain expression, `/find <expr>`, or `find <expr>` and uses the same result page as the command bar.

## Keyboard & search

On the home page, `j` / `k` move through folder headings and articles in expanded folders; `Enter` toggles a folder or opens an article. Focused buttons and folder headings retain native Enter / Space activation.

The command bar is hidden; `/` or `:` opens it, `Esc` closes it. `/find <expr>` is the single search command (`/tag`, `/about`, `/grep` are sugar that rewrite to it): words, phrases, regex, folders, `tag:`, `grep:` (line-oriented) and semantic `about:x[:top-N|:bottom-N]`, composable with `& | ! ( )` — grammar in `src/query.mjs`, `src/about.mjs` and `content/00-help/help.md`. Results render at `search.html?q=…` from `search-index.json` (generated at build time). `Space` is the leader key, `f` flash-jumps, `?` lists every key (`assets/nav.js`). `src/*.mjs` are bundled into `assets/term-engine.js` by `node src/build.mjs`.

## Themes

`/theme day` and `/theme tokyo` are the only themes. The toggle button and `Space T` switch between them. The browser remembers the selection; a new browser defaults to Tokyo. Legacy saved `paper` becomes `day`, while `ink` and `auto` become `tokyo`.
