import test from "node:test";
import assert from "node:assert/strict";
import { loadContent } from "../src/content.mjs";
import { partitionHomeSeries } from "../src/home-content.mjs";
import { buildSearchIndex } from "../src/search-index.mjs";

test("home windows partition existing content without moving posts or losing global search", async () => {
  const series = await loadContent(new URL("../content", import.meta.url).pathname);
  const groups = partitionHomeSeries(series);
  assert.deepEqual(groups.help.map((s) => s.dir), ["00-help", "01-blog"]);
  assert.deepEqual(groups.about.map((s) => s.dir), ["01-blog"]);
  assert.deepEqual(groups.blog.map((s) => s.dir), ["02-poe"]);
  assert.deepEqual(groups.about.flatMap((s) => s.posts.map((p) => p.name)), ["02-tui-notes"]);
  assert.ok(groups.help.flatMap((s) => s.posts).some((p) => p.name === "01-how-to-write"));
  assert.equal(groups.blog.flatMap((s) => s.posts).length, 3);
  const all = Object.values(groups).flat().flatMap((s) => s.posts);
  assert.equal(new Set(all.map((p) => p.stem)).size, 6);
  assert.ok(all.some((p) => p.stem === "00-help/help"));
  const indexedPosts = series.flatMap((folder) => folder.posts.map((post, index) => ({
    ...post, title: post.md.match(/^# (.+)/m)[1], htmlBody: "", outName: post.stem + ".html",
    series: folder, index, tags: post.meta.tags || [],
  })));
  const index = buildSearchIndex(series, indexedPosts);
  assert.equal(index.series.length, 3);
  assert.equal(index.docs.length, 6);
  assert.ok(index.docs.some((p) => p.href === "posts/00-help/help.html"));
  assert.ok(index.docs.some((p) => p.href === "posts/01-blog/02-tui-notes.html"));
});
test("new folders default to Blog; content grouping never depends on folder names", () => {
  const folders = [{ dir: "notes", posts: [] }, { dir: "other", homeRole: "about", posts: [] }, { dir: "00-help", homeRole: "unknown", posts: [] }];
  const groups = partitionHomeSeries(folders);
  assert.deepEqual(groups.blog, [folders[0], folders[2]]);
  assert.deepEqual(groups.about, [folders[1]]);
  assert.deepEqual(groups.help, []);
});

test("a post can override its folder role without mutating its original series", () => {
  const folder = { homeRole: "about", posts: [{ name: "writing", meta: { homeRole: "help" } }, { name: "design", meta: {} }] };
  const groups = partitionHomeSeries([folder]);
  assert.deepEqual(groups.help[0].posts.map((p) => p.name), ["writing"]);
  assert.deepEqual(groups.about[0].posts.map((p) => p.name), ["design"]);
  assert.equal(folder.posts.length, 2);
});
