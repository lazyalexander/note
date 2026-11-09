# note

Minimal TUI static blog. One folder under `content/` = one series (a single post still gets its own folder); folders starting with `_` or `.` are not published. Each post is `NN-title.md` with an optional `NN-title.json` (tags). See `content/01-blog/01-how-to-write.md`.

## Browse & search

The home page follows a cathedral ship in formation, past the twin towers and through the rose window into its archive cabin. Scroll to approach or follow the masthead links directly to the Blog, About, and Guide windows. Blog contains the search form and collapsible folder contents. Expand a folder to open any article directly; article rows include estimated reading time. Search accepts a plain expression, `/find <expr>`, or `find <expr>` and uses the same result page as the command bar.

## Keyboard & search

On the home page, `j` / `k` move through folder headings and articles in expanded folders; `Enter` toggles a folder or opens an article. Focused buttons and folder headings retain native Enter / Space activation.

The command bar is hidden; `/` or `:` opens it, `Esc` closes it. `/find <expr>` is the single search command (`/tag`, `/about`, `/grep` are sugar that rewrite to it): words, phrases, regex, folders, `tag:`, `grep:` (line-oriented) and semantic `about:x[:top-N|:bottom-N]`, composable with `& | ! ( )` — grammar in `src/query.mjs`, `src/about.mjs` and `content/00-help/help.md`. Results render at `search.html?q=…` from `search-index.json` (generated at build time). `Space` is the leader key, `f` flash-jumps, `?` lists every key (`assets/nav.js`). `src/*.mjs` are bundled into `assets/term-engine.js` by `node src/build.mjs`.

## Themes

`/theme day` and `/theme tokyo` are the only themes. The toggle button and `Space T` switch between them. The browser remembers the selection; a new browser defaults to Tokyo. Legacy saved `paper` becomes `day`, while `ink` and `auto` become `tokyo`.

## Home modules

Set `homeRole` in a folder’s `series.json` to `help` or `about` to show it in that home window; omitted or `blog` stays in the Blog directory. An individual post’s JSON metadata can override its folder’s `homeRole` (the publishing guide uses `help`, while design notes use `about`). This changes presentation only: existing post URLs, command navigation, and the global search index remain intact. The status bar independently remembers the interface language (Chinese, English, Japanese or Greek) and the day/night theme. Notes and search queries retain their original text. Day and night light the same cabin differently. The satellite has a four-minute fictional orbit synchronized with wall time. The camera uses SVG world coordinates from `src/archive-camera.mjs` and respects reduced motion.
