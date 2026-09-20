# 故障对照表

## 先跑自检

路径类问题一律先跑 `node scripts/doctor.mjs` —— 它打印真实解析结果并标出阻断项，不需要登录。

## 路径与依赖

| 现象 | 原因 | 处理 |
|---|---|---|
| `找不到 xiumi-api 客户端文件` | 自动发现没覆盖你的目录布局 | `--client <路径>`，或设 `XIUMI_CLIENT`，或写进 `autoxiumi.config.json` |
| `找不到可用会话，且未设置 XIUMI_USER / XIUMI_PASS` | 会话不存在且无账号 | 设 `XIUMI_USER` / `XIUMI_PASS` 跑一次；或 `--session` 指向已有会话 |
| `未找到 playwright` | 渲染验证的可选依赖缺失 | 仅验证需要，创建作品不受影响。`npm i playwright` 或设 `XIUMI_PLAYWRIGHT` |
| 缓存想在固定位置 | 默认在平台缓存根 | `--cache <目录>` 或 `XIUMI_CACHE_DIR` |

自动发现的搜索范围：**从当前工作目录**以及 **skill 的上级目录**分别向上遍历，
在每一级找 `client/xiumi.mjs` 与 `xiumi-api/client/xiumi.mjs`。把 skill 放在仓库内即可零配置。

## 渲染

| 现象 | 原因 | 处理 |
|---|---|---|
| 图片渲染成灰色占位图 | `tplId` 不是模板库真值 | 从 `GET /api/templates/items` 取 matrix，别手写。见 `components.md` |
| 接口回读数据完全正确但编辑器空白 | 同上 —— 静默降级不报错 | 用 `scripts/verify-render.mjs` 检查图片 `naturalWidth`，或跑一次 `doctor` 确认客户端版本 |
| `模板不存在或没有 matrix：X` | `atom_tpl_id` 拼错，或误用实例化后的 `tplId` | 查 `components.md` 的对照表；`TPL_KNOWN_MISS` 列了已知不存在项 |
| 编辑器打开是空白 | 组件塞进了 `grounds` 而不是 `pages[].layers[0].comps.items` | 检查层路径；用 `page: true` 分页让 builder 处理 |
| 公开页 403 | 未过审（`Failed_ShowReleaseNotApplied`） | 编辑器预览页始终可看；公开需要过审 |

## 提交

| 现象 | 原因 | 处理 |
|---|---|---|
| `pages 与 grounds 长度不一致` | 手动改过页数 | 用 `page: true` 分页，让 builder 补 `grounds` |
| `Camus:Failed_ShowSavedTimeNotMatch` | 乐观锁，`lastSavedAt` 过期 | `updateShow` 已自动重取重试；仍失败就重新 `getShow` 再改 |
| `有组件不是站内模板形态` | 传入的 `tplId` 不形如 `<type>-cp:` | 这通常意味着绕过 builder 手拼了组件 |
| `不认识的 block：…` | `blocks` 里有未知键 | 查 `references/blocks.md` 的字段表 |

## 数据完整性（站内硬要求）

- `cubes[0].pages[]` 与 `cubes[0].grounds[]` **必须等长**
- 每个组件、子项、`_comp` 都要带 `_$uuid`（`8-4-4-4-12` 形态）
- 落库时**原样使用** `templateItems` 返回的 matrix，只改内容字段

## 判断"接口坏了"还是"账号没这功能"

被拦写操作时先分清是 `Failed_NotLogin`（会话问题）、`Failed_*NotMatch`（乐观锁）、
还是业务规则拒绝。不要把所有非 200 都当成接口问题。
