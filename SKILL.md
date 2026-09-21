---
name: autoxiumi
description: 秀米（xiumi.us / xiumius.cn）图文创作自动化——把 Markdown 或结构化 JSON 变成账号里真实存在的图文作品，并验证编辑器真的渲染出来。当需要「用 AI 在秀米上写图文」「批量生成秀米排版」「把文章发到秀米」「自动创建或更新秀米作品」「排查秀米组件渲染成占位图」时使用。覆盖组件取用、分页、本地图片上传、提交与渲染校验。
agent_created: true
---

# autoxiumi

把内容变成秀米作品：Markdown 或 JSON 进，账号里一篇真实图文出。

## 什么时候用

- 要把一篇文章或一份结构化内容自动排版成秀米图文
- 要批量生成秀米作品，或改写已有作品
- 秀米作品里的图片渲染成灰色占位图，需要定位原因

## 前置条件

需要一个已登录的会话，以及 **xiumi-api 客户端**（`client/xiumi.mjs`，零依赖）。

还没装的话跑 `node scripts/install.mjs` —— 它会探测本机装了哪些 AI harness，把 skill 装进
各自的技能目录，每个安装点自带一份客户端（`client/xiumi.mjs` + `client/lz-string.mjs`）。
先看探测结果加 `--list`，指定位置用 `--dir <目录>`，离线用 `--local <已 clone 的 xiumi-api 路径>`。
装完再回到本节。

两者都用分层解析，**不假设任何固定位置**：

```
显式参数 → 环境变量 → 配置文件 → 自动发现 → 安全默认值
```

先跑自检确认解析结果，不需要登录：

```bash
node scripts/doctor.mjs
```

它打印 skill 目录、客户端、会话、缓存的真实路径并逐项判定。报错时按输出里的提示用
`--client` / `XIUMI_CLIENT` / `autoxiumi.config.json` 指定。配置样例见 `assets/config.example.json`。

首次登录用环境变量 `XIUMI_USER` / `XIUMI_PASS`，成功后会话写回解析到的会话路径。

## 用法

```bash
# Markdown → 图文
node scripts/create.mjs assets/examples/article.example.md --title "我的图文"

# JSON → 图文
node scripts/create.mjs assets/examples/article.example.json

# 只构建，不提交
node scripts/create.mjs <spec> --dry

# 改写已有作品（走乐观锁，客户端自动重试）
node scripts/create.mjs <spec> --update <show_id>

# 另一种作品类型
node scripts/create.mjs <spec> --type booklet
```

`--help` 列出全部选项。成功后打印 `show_id` 与编辑器链接。

## 输入格式

Markdown 支持 `#`/`##`/`###` 标题、空行分隔段落、`>` 引用、`-`/`1.` 列表、`---` 分隔线、
`![alt](src)` 图片，以及单独一行的换页符分页。

JSON 用 `blocks` 数组表达同样的结构。完整字段表、每个 block 编译成哪个组件、分页与多栏的写法，
见 `references/blocks.md`。

`img` 给本地路径时会自动调 `uploadImageBase64` 换成站内地址再写入；相对路径按 **spec 文件所在目录**
解析，不依赖当前工作目录。外链（`http(s)://` 或 `//`）直接写。

## 唯一硬约束：组件必须来自站内模板库

手写 `tplId` 服务端会 **200 接受、回读数据完全正确**，但编辑器渲染成占位图 —— 不报错，只静默降级。

```
对：从 GET /api/templates/items 取 matrix，只改内容字段
错：{ _comp: { tplId: 'paper-cp:img/1-img-normal' }, img1: { src } }   ← 凭想象拼 id
```

`scripts/lib/templates.mjs` 已封装正确做法（含磁盘缓存与已知 miss 清单）。
`create.mjs` 提交前会校验每个组件的 `_comp.tplId` 形如 `<type>-cp:`，不合规直接中止。

推论：**接口回读正常 ≠ 渲染正常。**

## 数据完整性要求

- `cubes[0].pages[]` 与 `cubes[0].grounds[]` 是**平行数组**，追加页必须同步追加背景层。
  builder 已自动处理，`create.mjs` 提交前校验长度一致。
- 每个组件与子项都要带 `_$uuid`。

## 完成判据

不是看接口返回，是看这三样：

1. `create.mjs` 打印 `✓ 全部组件均来自站内模板库`
2. `pages` 与 `grounds` 长度一致
3. 浏览器打开编辑或预览页，帧文本含写入的标记串，**且图片 `naturalWidth > 0`**

第 3 步用自带脚本（需要 playwright，未装会给出提示）：

```bash
node scripts/verify-render.mjs <show_id> <标记串>
```

它在缓存目录留截图，并单独报告"未解码的图片数"—— 这是识别静默降级为占位图的唯一手段。

## 排错

`references/troubleshooting.md` 按现象列表。最高频的两条：图片变占位图（tplId 不是模板库真值）、
`Camus:Failed_ShowSavedTimeNotMatch`（乐观锁，`updateShow` 会自动重取重试）。

## 附带资源

- `scripts/lib/config.mjs` — 路径解析；要支持新的目录布局改这里
- `scripts/lib/templates.mjs` — 组件取用层 + 磁盘缓存 + `TPL` 语义名表
- `scripts/lib/builder.mjs` — blocks → showData，含 `markdownToBlocks`
- `scripts/lib/browser.mjs` — playwright 动态解析（可选依赖）
- `scripts/install.mjs` — 安装到各 harness 技能目录；harness 路径表在文件顶部的 `HARNESSES`
- `scripts/create.mjs` — CLI 入口
- `scripts/verify-render.mjs` — 渲染验证
- `scripts/doctor.mjs` — 环境自检
- `references/blocks.md` — 输入格式与组件映射
- `references/components.md` — 组件字段名、matrix 形状、已知 miss
- `references/troubleshooting.md` — 故障对照表
- `assets/config.example.json` — 配置样例
- `assets/examples/` — Markdown 与 JSON 输入样例
