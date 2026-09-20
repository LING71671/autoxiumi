#!/usr/bin/env node
/**
 * autoxiumi · 环境自检
 *
 * 打印各依赖的实际解析结果，并逐项判定可用性。
 * 换了机器、换了目录、怀疑"找不到客户端/会话"时先跑这个 —— 它不需要登录。
 *
 * 用法：node scripts/doctor.mjs [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveAll, cacheRoot, configRoot, SKILL_DIR, SKILL_NAME } from './lib/config.mjs';

const asJson = process.argv.includes('--json');

const ok = (b) => (b ? '✓' : '✗');
const exists = (p) => {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
};

const resolved = resolveAll({});

const rows = [];
const push = (label, value, note) => rows.push({ label, value, note: note ?? '' });

push('skill 目录', SKILL_DIR, `name=${SKILL_NAME}`);
push('配置文件', resolved.configPath || '(无，使用默认值)', resolved.configPath ? '' : '可选');
push('API 客户端', resolved.client, ok(exists(resolved.client)));
push('会话文件', resolved.session, exists(resolved.session) ? '✓ 已存在' : '· 尚不存在（首次登录会写入）');
push('缓存目录', resolved.cache, fs.existsSync(path.join(resolved.cache, 'templates.json')) ? '✓ 已有组件缓存' : '· 首次运行会生成');
push('cwd', process.cwd(), '');
push('缓存根', cacheRoot(), '');
push('配置根', configRoot(), '');

// 可选依赖：浏览器
let pw = '· 未安装（仅渲染验证需要）';
try {
  const { loadPlaywright } = await import('./lib/browser.mjs');
  const got = await loadPlaywright({ client: resolved.client });
  pw = `✓ ${got._from}`;
} catch {
  /* 保持默认文案 */
}

// 账号来源
const hasEnvLogin = !!(process.env.XIUMI_USER && process.env.XIUMI_PASS);
push('登录方式', exists(resolved.session) ? '复用会话文件' : hasEnvLogin ? 'XIUMI_USER / XIUMI_PASS' : '(无)',
  exists(resolved.session) || hasEnvLogin ? '' : '需要其一才能提交作品');
push('playwright', pw, '');

if (asJson) {
  console.log(JSON.stringify({ skillDir: SKILL_DIR, skillName: SKILL_NAME, ...resolved, playwright: pw }, null, 2));
  process.exit(0);
}

const w = Math.max(...rows.map((r) => r.label.length));
console.log(`autoxiumi 环境自检\n${'─'.repeat(60)}`);
for (const r of rows) {
  console.log(`${r.label.padEnd(w)}  ${r.value}${r.note ? `   ${r.note}` : ''}`);
}
console.log(`${'─'.repeat(60)}`);

const hardFail = [resolved.client].filter((p) => !exists(p));
if (hardFail.length) {
  console.log('\n阻断项：');
  for (const p of hardFail) console.log(`  ✗ ${p}`);
  console.log('\n用 --client / XIUMI_CLIENT / autoxiumi.config.json 指定客户端位置。');
  process.exit(1);
}
console.log('\n路径解析正常。');
