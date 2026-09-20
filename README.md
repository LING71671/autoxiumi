# autoxiumi

秀米（`xiumi.us`）图文创作自动化。Markdown 或 JSON 进去，账号里一篇真实图文出来。

给 Agent 用的操作指引在 `SKILL.md`；本文件只讲安装、配置与目录约定。

## 布局

```
autoxiumi/
├── SKILL.md                     Agent 入口（规范要求的唯一必需文件）
├── scripts/
│   ├── install.mjs              一键安装
│   ├── create.mjs               创作 CLI
│   ├── verify-render.mjs        浏览器渲染验证
│   ├── doctor.mjs               环境自检
│   └── lib/                     config / templates / builder / browser
├── references/                  按需加载的参考资料
│   ├── blocks.md                输入格式与组件映射
│   ├── components.md            组件字段名与已知 miss
│   └── troubleshooting.md       故障对照表
└── assets/
    ├── config.example.json      配置样例
    └── examples/                Markdown 与 JSON 输入样例
```

## 安装

无需构建、无需 `npm install`、无需 clone 整个 xiumi-api。

### 一键安装

```bash
git clone --depth 1 https://github.com/LING71671/autoxiumi.git
node autoxiumi/scripts/install.mjs
```

它会装到 `~/.workbuddy/skills/autoxiumi`，并把客户端两个文件放到同级的
`xiumi-api/client/`，最后跑一次自检。常用选项：

| 选项 | 用途 |
|---|---|
| `--dir <目录>` | 装到别处（项目级安装：`<repo>/.workbuddy/skills/autoxiumi`） |
| `--local <路径>` | 从本地已有的 xiumi-api 仓库取客户端（离线可用） |
| `--dry` | 只打印计划不落盘 |
| `--force` | 重新取客户端（忽略已存在的） |

重复运行是安全的：客户端已存在就跳过，你自己写的 `config.json` 不会被触碰。

### 让 AI 帮你装

不想手敲命令，把下面这段整段发给 AI 助手（WorkBuddy / Claude Code / Cursor 等）：

> 请帮我在本机安装 autoxiumi skill：
>
> 1. 把 `https://github.com/LING71671/autoxiumi` 克隆到临时目录
> 2. 运行 `node <临时目录>/scripts/install.mjs`
> 3. 把自检输出贴给我，确认里面有「API 客户端 ✓」
> 4. 装完删掉临时目录
> 5. 除 `~/.workbuddy/skills/autoxiumi` 与 `~/.workbuddy/skills/xiumi-api` 外，
>    不要改动我机器上的其它文件
>
> 如果这台机器连不上 GitHub，就先 `git clone https://github.com/LING71671/xiumi-api`，
> 再跑 `node <临时目录>/scripts/install.mjs --local <xiumi-api 路径>`。

### 手动安装

把整个目录复制到 skill 目录即可：

```
<用户级> ~/.workbuddy/skills/autoxiumi/
<项目级> <repo>/.workbuddy/skills/autoxiumi/
```

唯一的运行时依赖是 [**xiumi-api**](https://github.com/LING71671/xiumi-api) 客户端 ——
实际只需要其中 `client/xiumi.mjs` 与 `client/lz-string.mjs` **两个文件**（合计约 100 KB，
零依赖，Node 18+）。放到 skill 同级的 `xiumi-api/client/` 即可被自动发现。
`playwright-core` 只被 `verify-render.mjs` 用到，属可选依赖。

## 配置

不配置也能跑 —— 路径用分层解析：

```
显式参数 → 环境变量 → 配置文件 → 自动发现 → 安全默认值
```

自动发现会从**当前工作目录**和 **skill 的上级目录**分别向上找 `client/xiumi.mjs` 或
`xiumi-api/client/xiumi.mjs`，所以把 skill 放在 xiumi-api 同级即可零配置。

需要显式指定时，把 `assets/config.example.json` 复制成 `config.json` 放在 skill 根目录，
或放到 `$XIUMI_CONFIG` 指向的位置。配置内的相对路径按**配置文件所在目录**解析。

对应的环境变量：`XIUMI_CLIENT` / `XIUMI_SESSION` / `XIUMI_CACHE_DIR` / `XIUMI_CONFIG`。
登录：`XIUMI_USER` / `XIUMI_PASS`。

缓存默认写在平台缓存根下的 `autoxiumi/` —— 缓存根按
`$XDG_CACHE_HOME` → Windows `%LOCALAPPDATA%` → 其它平台 `~/.cache` → 系统临时目录
的顺序取第一个可用的。不写进 skill 目录，这样安装目录可以只读。

## 确认环境

```bash
node scripts/doctor.mjs
```

打印客户端、会话、缓存的实际解析结果并逐项判定，不需要登录。加了 `--json` 输出结构化结果。

## 验证过的能力

文本、三级标题、段落、引用块（布局型嵌套写入）、有序/无序列表、分隔线、图片、
两栏/三栏布局、多页 —— 全部经 Playwright 打开编辑器确认真实渲染。

图片的判据是浏览器解码成功（`naturalWidth > 0`），不是"HTML 里有 img 标签"。

## 许可

[Apache-2.0](LICENSE)

## 免责

本项目用于内容创作自动化，仅面向自己拥有或被明确授权的账号。
请遵守服务条款与所在地法律法规。
