# note

极简 TUI 风格静态博客，部署在 GitHub Pages。

## 添加文章

1. 在 `posts/` 下新建 Markdown，例如 `04-hello.md`
2. 文件名用数字前缀排序（小的在前）
3. 第一个 H1 作为标题
4. commit 并 push 到 `main`，Actions 会自动构建

## 编号约定

- `01-foo.md` → 排序键 1
- `02-bar.md` → 排序键 2
- 无数字前缀的排在最后；也可从 H1 中的数字回退

## 本地预览

```bash
npm install
BASE_PATH= npm run build   # 根路径预览
# 或默认 BASE_PATH=/note（与 Pages 一致）
npx serve dist
```

## 启用 GitHub Pages

1. 仓库 Settings → Pages
2. Source 选 **GitHub Actions**
3. push 到 `main` 后等待 workflow 完成

站点：https://lazyalexander.github.io/note/

## BASE_PATH

- Pages 项目站：`BASE_PATH=/note`（CI 默认）
- 本地根路径：`BASE_PATH=`（空字符串）

## 结构

- `posts/` Markdown 文章
- `src/build.mjs` 构建脚本
- `assets/style.css` 样式
- `dist/` 构建产物（不提交）

## 部署工作流（重要）

当前 OAuth token 缺少 `workflow` 权限，无法直推 `.github/workflows/`。Pages 已设为 Actions，请手动添加工作流：

1. 打开：https://github.com/lazyalexander/note/new/main?filename=.github/workflows/pages.yml
2. 把仓库根目录 `pages.workflow.yml` 的全部内容粘贴进去
3. Commit 到 `main`

或本地：`gh auth refresh -h github.com -s workflow` 后把 `pages.workflow.yml` 复制为 `.github/workflows/pages.yml` 再 push。
