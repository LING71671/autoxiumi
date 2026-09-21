# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.2.1] - 2026-09-21

### 新增

- `scripts/api.mjs` — **全量接口入口**。`create.mjs` 只覆盖创作链路，但客户端封装的是
  整个站点接口面；这个脚本把客户端方法原样暴露出来（`list` / `describe` / `call` /
  `raw` / `me`），打标签、改名、拷贝、删除、恢复、上传素材都能直接调，且仍然只依赖
  已就位的客户端两个文件，不要求 clone 整个 xiumi-api 仓库
- 「读 / 写」判定加了一层**传递闭包**：包装器本身不发请求、但调用了写方法
  （如 `renameShow` → `updateShow`）的，现在会被正确标成「写」，不再误导

### 变更

- 随附的客户端（`client/xiumi.mjs`）刷新到 xiumi-api v1.2.0：本轮端到端实测发现并修掉的
  一批接口封装错误随之生效 —— `addImageTag` / `deleteImageTag` / `removeImageTag` /
  `setShowReceiveType` / `setTagsOrder`（`order` 必须是字符串）/ `verifyHtmlCode` /
  `renameShow` / `forms` / `statisticsShow` / `myGoodsInfo` / `invitation` /
  `customDomains`，并删除了三个实测不存在的幻影方法（`setMuteLegacy`、
  `recoverableShows`、`formData`）。已安装的用户重新跑一次
  `node scripts/install.mjs`（或 `npm run setup`）即可刷新
- 逐方法的验证状态（有没有跑、通没通、证据是什么）在
  [xiumi-api 的 `docs/COVERAGE.md`](https://github.com/LING71671/xiumi-api/blob/main/docs/COVERAGE.md)，
  由脚本生成，本仓库不再重复维护一份

## [1.2.0] - 2026-09-21

### 新增

- `install.mjs` 支持**多 harness 自动探测**：内置 12 种主流 harness 的用户级/项目级技能目录
  路径表，只装到本机真实存在的那些，再补一份到跨 harness 的通用位置 `~/.agents/skills`。
  新增 harness 只需在文件顶部的 `HARNESSES` 表加一行
- 新选项：`--list`（只列探测结果）、`--target <id,...>`（含 `all`）、`--project`（项目级安装）
- 客户端改为**随 skill 自包含**：装到 `<skill>/client/`，每个安装点独立、可单独拷走；
  远端只下载一次，分发到所有安装点

### 变更

- README「一键安装」「让 AI 帮你装」「手动安装」三节改为 harness 中立：
  不再假定任何单一 harness 的目录，AI 提示词改为让 AI 先 `--list` 再自己选路径
- 会话文件默认位置改为**平台配置根**下的 `autoxiumi/session.json`（原先落到
  客户端仓库或 skill 目录）。同一个 skill 装进多个 harness 时共用一份登录态
- `config.mjs` 的自动发现把 **skill 目录自身**也纳入遍历起点，`<skill>/client/xiumi.mjs`
  因此零配置可用
- `package.json` 的 `scripts.install` 改名 `scripts.setup` —— `install` 是 npm 保留的
  生命周期钩子，会让 `npm install` 意外触发 skill 安装

## [1.1.0] - 2026-09-21

### 新增

- `scripts/install.mjs` —— 一键安装：装到 skill 目录、把客户端两个文件放到同级、
  跑自检。支持 `--dir` / `--local`（离线）/ `--dry` / `--force`，重复运行安全
- README 增加「一键安装」「让 AI 帮你装」「手动安装」三节

### 变更

- 明确运行时依赖的实际体量：只需要 `xiumi-api` 的 `client/xiumi.mjs` 与
  `client/lz-string.mjs` 两个文件（约 100 KB），**不需要 clone 整个仓库**

## [1.0.0] - 2026-09-20

首次开源发布。

### 新增

- `scripts/create.mjs` —— Markdown / JSON 规格 → 秀米图文，支持创建、更新（乐观锁）、干跑
- `scripts/lib/config.mjs` —— 路径分层解析：显式参数 → 环境变量 → 配置文件 → 自动发现 → 安全默认值
- `scripts/lib/templates.mjs` —— 官方组件取用层，含磁盘缓存与已知 miss 清单
- `scripts/lib/builder.mjs` —— blocks 编译成 showData，含极简 Markdown 解析与分页
- `scripts/lib/browser.mjs` —— playwright 动态解析（可选依赖）
- `scripts/verify-render.mjs` —— 浏览器渲染验证，判据含图片 `naturalWidth > 0`
- `scripts/doctor.mjs` —— 环境自检，打印各依赖的真实解析路径
- `references/` —— 输入格式、组件字段、故障对照表
- `assets/` —— 配置样例与输入样例

### 设计要点

- **不含任何绝对路径**：客户端、会话、缓存全部按分层规则解析，可放在任意位置
- **缓存不写进 skill 目录**：默认落在平台缓存根，安装目录可只读
- **组件必须来自站内模板库**：手写 `tplId` 会被服务端接受但静默渲染成占位图，
  `create.mjs` 提交前会拦住
- 符合 skill 规范：`name` 为 hyphen-case，结构为 `SKILL.md` + `scripts/` + `references/` + `assets/`

### 依赖

- [`xiumi-api`](https://github.com/LING71671/xiumi-api) —— API 客户端（零依赖，必需）
- `playwright-core` —— 仅渲染验证需要，可选

[1.2.0]: https://github.com/LING71671/autoxiumi/releases/tag/v1.2.0
[1.1.0]: https://github.com/LING71671/autoxiumi/releases/tag/v1.1.0
[1.0.0]: https://github.com/LING71671/autoxiumi/releases/tag/v1.0.0
