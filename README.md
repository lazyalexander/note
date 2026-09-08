# note

Minimal TUI static blog.

## Tags

After the H1, the first non-empty line may be space-separated `@tags` (Chinese tags OK). Optional blank line between H1 and tags. Tag line is stripped from body and shown under the title.

```md
# Welcome

@intro @meta

body...
```

## Commands

- `/goto <title>` fuzzy title jump
- `/tag <tag>` filter posts by tag (substring, case-insensitive)

Example: `/tag intro`

## Build

```bash
npm run build
```

## 中文说明

- 标题下第一个非空行可写 `@tag`（空格分隔）
- 首页：`/goto <title>` 跳转；`/tag <tag>` 按标签筛选
- 示例：`/tag intro`、`/tag tui`
