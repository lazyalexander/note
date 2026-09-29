/** Command catalogue shared by the engine (help text) and completion. /find is the only real search command. */
export const COMMANDS_LIST = [
  { name: "/find", args: true, desc: "搜索 · 词 / tag: / grep: / about:（语义）· & | ! ( )" },
  { name: "/tag", args: true, desc: "= /find（/tag js → tag:js）" },
  { name: "/about", args: true, desc: "= /find about:…（语义，可加 :top-N）" },
  { name: "/grep", args: true, desc: "= /find grep:…（按行匹配）" },
  { name: "/theme", args: true, desc: "auto | paper | tokyo | ink" },
  { name: "/help", args: false, desc: "打开命令说明" },
  { name: "/clear", args: false, desc: "清空输入与提示" },
];
