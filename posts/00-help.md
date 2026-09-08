# 命令说明

@help @meta

在首页终端输入命令。

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

支持 `&`（且）与 `||`（或），`&` 优先：

```
/tag intro
/tag meta&intro
/tag tui||design
/tag meta&guide||tui
```

## /help

打开本页（输入 `/help` 后自动跳转）。
