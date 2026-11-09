import assert from "node:assert/strict";
import test from "node:test";
import { languages, messages, formatMessage } from "../assets/messages.mjs";

test("all interface messages provide four translations with the same substitutions", () => {
  const seen = new Set();
  for (const row of messages) {
    assert.equal(row.length, Object.keys(languages).length);
    const slots = (text) => (text.match(/\{\d+\}/g) || []).sort();
    for (const text of row) {
      assert.ok(text.trim());
      assert.deepEqual(slots(text), slots(row[0]), row[0]);
    }
    for (const source of new Set(row.slice(0, 2))) {
      assert.ok(!seen.has(source), source);
      seen.add(source);
    }
  }
});
test("changing language preserves query text and accepts regional language tags", () => {
  for (const locale of Object.keys(languages)) {
    const value = '<note> 心跳 {0}';
    assert.ok(formatMessage(locale, "未知命令：{0}", value).endsWith(value));
  }
  assert.equal(formatMessage("ja-JP", "进入档案舱"), "資料室に入る");
  assert.equal(formatMessage("el", "搜索建议"), "Προτάσεις αναζήτησης");
});
