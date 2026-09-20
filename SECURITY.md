# 安全说明

## 报告问题

发现安全问题时请**不要**开公开 issue。走仓库的 Security → Report a vulnerability 私有渠道。

## 本项目的注意事项

### 凭据

- 账号密码只从环境变量（`XIUMI_USER` / `XIUMI_PASS`）读取
- 会话文件路径由 `scripts/lib/config.mjs` 解析，通常指向 xiumi-api 仓库的 `capture/` 下，
  内含有效 `sid`，等价于登录态
- **提交前请确认没有被 git 跟踪的本地配置**：`config.json` / `autoxiumi.config.json` /
  `*.local.json` 已在 `.gitignore` 中

### 使用边界

- 只操作自己拥有或被明确授权的账号
- 本项目用于内容创作自动化，不用于绕过访问控制、批量抓取他人数据或规避平台风控
- 请遵守服务条款与所在地法律法规

### 组件来源

本 skill 不内置任何组件模板，运行时从站内模板库拉取并缓存到平台缓存目录。
缓存内容属于站内数据，不应提交到仓库。
