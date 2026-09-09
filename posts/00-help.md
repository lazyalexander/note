# 命令说明


在首页终端输入命令。

## /welcome

打开欢迎页。

## /goto

按标题跳转。`/goto` 后加关键字，列出匹配标题；↑↓ / Tab 选择，回车打开。

```
/goto 欢迎
/goto wel
```

## /tag

按标签筛选。标签写在同名 JSON 元数据里（不进正文）：

```
posts/02-how-to-write.md
posts/02-how-to-write.json  →  { "tags": ["guide", "meta"] }
```

标签按**前缀**匹配（支持中文），最长 64 字符：

```
/tag intro
/tag meta
/tag 欢
/tag poe
```

## /about

全文语义检索（multilingual-e5）。支持中文自然语言查询；首次会加载模型，回车后显示耗时：

```
/about 心跳 谋杀
/about black cat guilt
/about 酒窖 复仇
```

结果按相似度排序，终端回显 `load / query / total` 毫秒。

## /help

打开本页。输入 `/help` 后按回车跳转。
