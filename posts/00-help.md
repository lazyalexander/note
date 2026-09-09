# 命令说明

在首页终端输入命令。

## /welcome

打开欢迎页。

## /goto

按**标题 / 文件名 / 标签**跳转（标签在同名 `.json` 里）。↑↓ / Tab 选择，回车打开。无匹配则进彩蛋页。

```
/goto 欢迎
/goto wel
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

## /help

打开本页。输入 `/help` 后按回车跳转。
