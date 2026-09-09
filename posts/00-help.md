# 命令说明

@help @meta @说明

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

按标签筛选。标签写在标题下第一行：

```
# 标题

@intro @meta
```

标签按**前缀**匹配（支持中文）。可用 `&`（且）、`||`（或）、括号；最长 64 字符：

```
/tag intro
/tag meta&intro
/tag tui||design
/tag (meta&guide)||tui
/tag ((tui||design)&meta)
```

## /help

打开本页。输入 `/help` 后按回车跳转。
