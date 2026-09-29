# How to write a new post

内容按“文件夹 = 系列”组织，放在 `content/` 下：

```
content/
  01-blog/              一个系列（文件夹名的数字前缀决定顺序）
    series.json         可选：{ "title": "系列名", "description": "简介" }
    01-how-to-write.md  文章，首行 `# 标题`
    01-how-to-write.json 可选：{ "tags": ["guide"] }
  03-my-note/           只有一篇也要单独建文件夹
    01-hello.md
  _drafts/              以 _ 或 . 开头的文件夹不会发布
```

1. 在 `content/` 里新建（或选一个）系列文件夹。
2. 在里面添加 `NN-title.md`，数字前缀决定系列内的顺序。
3. 不想展示的内容，放在 `content/` 之外，或者文件夹名以 `_` / `.` 开头。
4. 推送到 `main`，GitHub Actions 会自动构建并发布。
