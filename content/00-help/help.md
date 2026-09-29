# 命令说明

在顶部命令栏输入命令（按 `/` 键随时聚焦）。

## /goto

按**标题 / 系列文件夹 / 文件名 / 标签**跳转（标签在同名 `.json` 里）。↑↓ / Tab 选择，回车打开。无匹配则进彩蛋页。

```
/goto 命令
/goto tui
/goto meta
/goto poe
```

## /about

全文语义检索（multilingual-e5）。支持中文自然语言查询；首次会加载模型，回车后显示耗时：

```
/about 心跳 谋杀
/about black cat guilt
/about 酒窖 复仇
```

结果按相似度排序，终端回显 `load / query / total` 毫秒。

## /theme

切换配色，选择会记在浏览器里；右上角的 ◐ 按钮可循环切换：

```
/theme auto    白天 paper（6–18 点），晚上 tokyo（默认）
/theme tokyo   终端风
/theme paper   浅色阅读
/theme ink     深色阅读
```

## /help

打开本页。输入 `/help` 后按回车跳转。
