/** Command catalogue shared by the engine (help text) and completion. */
export const COMMANDS_LIST = [
  { name: "/tag", args: true, desc: "grep 搜索 · 标题 / 正文 / 标签 / 文件夹" },
  { name: "/about", args: true, desc: "语义搜索（e5 模型）" },
  { name: "/theme", args: true, desc: "auto | paper | tokyo | ink" },
  { name: "/help", args: false, desc: "打开命令说明" },
  { name: "/clear", args: false, desc: "清空输入与提示" },
];
