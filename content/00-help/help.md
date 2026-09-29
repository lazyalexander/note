# 命令说明

命令栏默认是**隐藏**的，不占版面。按 `/` 或 `:` 唤出，`Esc` 收起并回到阅读模式。底部的状态栏显示当前模式（NORMAL / COMMAND / LEADER / FLASH），按 `?` 随时查看全部快捷键。

## 命令栏

输入时光标后面会出现灰色的**预测补全**（ghost text），`→` 或 `Tab` 接受。候选来源按优先级：命令名 → 文件夹（slug / 编号 / 标题）→ 项前缀（`tag:` `grep:` `about:` `title:` `body:`）→ 标签 → 文章标题 → 你用过的历史命令；在 `about:词:` 之后还会提示 `top-N` / `bottom-N` / `>阈值` 选择器。

- `↑` `↓` 或 `Ctrl-n` `Ctrl-p`：在候选菜单里选择
- `Enter`：执行高亮的候选；没有高亮时直接执行输入的命令
- `Esc`：先关闭菜单，再按一次收起命令栏

## /find

**只有一个真正的搜索命令：`/find <表达式>`。** 完全在浏览器里计算，范围是**标题 + 正文 + 标签 + 文件夹**。每次搜索都会打开一个结果页（`search.html?q=表达式`），网址里带着表达式，可以收藏和分享。`/tag`、`/about`、`/grep` 只是语法糖：它们把参数改写成一条 `/find` 表达式，然后跳到同一个结果页。

| 写法 | 含义 |
| --- | --- |
| `心跳` | 词：标题或正文里包含（不区分大小写，中文按子串） |
| `"the raven"` | 短语：整段原样匹配 |
| `/rav.n/` `/rav.n/i` | 正则（可带 `i` `m` `s` `u` 标志） |
| `poe/` `02/` `02-poe/` | 文件夹范围：slug 片段、编号、完整目录名或标题 |
| `#meta` 或 `tag:meta` | 标签（精确匹配） |
| `title:猫` `body:猫` | 只在标题 / 只在正文里找 |
| `grep:raven` `grep:"a b"` `grep:/rav.n/i` | 按**行**匹配，默认不区分大小写；结果里显示匹配的行和行号（像 `grep -n`），标题算第 0 行 |
| `about:死亡` `about:"the raven"` | **语义**相似（e5 模型），可以是词、引号短语、中文句子 |
| `about:X:top-3` `about:X:bottom-2` | 选择器：最相似的 3 篇 / 最不相似的 2 篇 |
| `about:X:>0.85` | 阈值：相似度大于 0.85 |
| `A & B` | 交集 |
| `A \| B` | 并集 |
| `!A` | 排除（NOT），`grep -v` 就是 `!grep:…` |
| `( … )` | 分组 |

优先级：`!` 高于 `&` 高于 `|`。**项与项之间的空白等同于 `&`**，所以 `poe/ 心跳` 就是 poe 文件夹里包含“心跳”的文章。只写 `!#draft` 表示除了带 draft 标签之外的全部文章。所有项都可以自由组合。语法有误时会指出出错的位置（例如 `about:x:top-` 或 `top-0`），不会崩溃。

```
/find 心跳
/find "the raven"
/find poe/ & (酒窖 | 心跳) & !#draft
/find title:cat !tag:draft
/find grep:/rav.n/i & poe/
/find grep:raven & !grep:again
/find about:dark
/find about:"关于死亡的恐惧":top-3
/find poe/ & about:死亡:top-2
/find !about:war:top-1
/find about:a:top-3 | about:b:top-3
```

### 语法糖：/tag /about /grep

| 输入 | 等价于 |
| --- | --- |
| `/tag js` | `/find tag:js`（单个标签名） |
| `/tag poe/ 猫`、`/tag 心跳` | 原样当作 `/find` 表达式，旧的 `/tag` 写法与旧网址 `search.html?q=…` 全部继续有效 |
| `/about dark` | `/find about:dark` |
| `/about dark:top-3` | `/find about:dark:top-3` |
| `/about black cat guilt` | `/find about:"black cat guilt"`（多个词自动加引号） |
| `/grep pat` | `/find grep:pat` |
| `/grep /rav.n/i` | `/find grep:/rav.n/i` |

命令栏会在下方回显改写后的 `/find` 表达式；语法糖不能加 `&`、`|` 组合，需要组合时直接写 `/find`。

### 语义项 about:

`about:X` 用浏览器里的 multilingual-e5 模型把 `X` 变成向量，和每篇文章的段落向量比较，**文章得分 = 它最相似那一段的余弦相似度**，那一段（连同分数）会作为片段显示在结果里。首次使用需要加载模型，结果页会显示“正在理解…”；查询向量会缓存（内存 + localStorage），重复查询是瞬时的。模型加载失败时会给出提示，表达式里的其他条件照常工作。

- **`:top-N`**：最相似的 N 篇（不足 N 篇则全部）；**`:bottom-N`**：最不相似的 N 篇；它们是普通集合，可以自由用 `&` `|` `!` 组合。
- **`:>0.85`**（`:>=0.85`）：相似度阈值，与范围无关。
- **不写选择器**：集合大小由分数分布自适应决定，而不是固定阈值——保留高出平均值 0.75 个标准差以上的“离群”高分文章，至少 1 篇、至多 ⌈N/2⌉ 篇（并且 N ≥ 2 时不会返回全部）；分数几乎一样（区分度不足）时只返回最相似的 1 篇。

**范围规则（top-N 在哪个集合里排名）**：选择器在与它用 `&`（或空白）相连的**字面条件**（文件夹、词、标签、grep……）筛出的候选集里排名；没有这样的条件时在**全部文章**里排名。所以 `poe/ & about:死亡:top-2` 是“poe 文件夹里最相似的 2 篇”，而不是“全站前 2 名再与 poe 取交集”。`|` 和 `!` 不改变范围：`!about:war:top-1` 是“全站最相似的那一篇之外的所有文章”，`about:a:top-3 | about:b:top-3` 是两个各自 top-3 的并集。

**排序**：只要表达式里有 `about:` 项，结果就按（组合）相似度从高到低排成一个列表；`&` 取两边分数的较小值，`|` 取较大值，字面项得分为 1，`!` 不贡献分数。没有 `about:` 时保持按文件夹分组、文件夹内原顺序。

## /about

`/find about:…` 的语法糖，支持中文自然语言查询：

```
/about 心跳 谋杀
/about black cat guilt
/about 酒窖 复仇:top-2
```

## /grep

`/find grep:…` 的语法糖：字面量或正则的逐行匹配，默认不区分大小写。结果里显示匹配的行和行号：

```
/grep raven
/grep /rav.n/i
/grep two words
```

## /theme

切换配色，选择会记在浏览器里；状态栏右侧的 ◐ 按钮或 `Space T` 可循环切换：

```
/theme auto    白天 paper（6–18 点），晚上 tokyo（默认）
/theme tokyo   终端风
/theme paper   浅色阅读
/theme ink     深色阅读
```

## /help

打开本页。

## 键盘操作

在命令栏之外的任何地方都可以用（在输入框里打字时不会触发；按住 Ctrl / Alt / Cmd 的浏览器快捷键不受影响）。

### Leader 键：Space

按下 `Space` 后底部会弹出 which-key 提示，再按一个键执行，`Esc` 取消。

- `Space f`：模糊查找文章（输入过滤，`↑` `↓` / `Ctrl-n` `Ctrl-p` 选择，`Enter` 打开）
- `Space s`：打开命令栏并预填 `/find `
- `Space t`：标签 / 文件夹选择器，选中后跳到对应的搜索结果
- `Space o`：当前文章的标题列表，选中后跳转
- `Space a`：打开命令栏并预填 `/find about:`
- `Space h`：回首页
- `Space T`：循环切换主题
- `Space ?`：快捷键帮助

### 跳转

- `f`：flash 跳转。给当前文章的每个标题（首页和搜索结果页则是每个列表项）标上字母，按对应字母跳过去，`Esc` 取消
- `]]` `[[`：下一个 / 上一个标题
- `H` `L`：同一文件夹里的上一篇 / 下一篇

### 滚动

- `j` `k`：向下 / 向上滚动约 3 行
- `Ctrl-d` `Ctrl-u`：半页
- `gg` `G`：顶部 / 底部
- 首页和搜索结果页：`j` `k` 移动选中项，`Enter` 打开，`gg` `G` 跳到首 / 尾

`?` 显示同样的速查表，`Esc` 关闭任何浮层。
