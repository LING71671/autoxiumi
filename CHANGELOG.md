# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

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

[1.0.0]: https://github.com/LING71671/autoxiumi/releases/tag/v1.0.0
