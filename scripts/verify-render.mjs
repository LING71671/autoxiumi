#!/usr/bin/env node
/**
 * autoxiumi · 渲染验证
 *
 * 判据不是"接口返回 200"，而是**浏览器里真的渲染出来了**：
 *   1. 页面帧文本含写入的标记串
 *   2. 图片元素真的解码成功（naturalWidth > 0）—— 这是识别"静默降级成占位图"的唯一手段
 *
 * 需要 playwright；未安装时会给出可读提示并以非零码退出。
 *
 * 用法：
 *   node scripts/verify-render.mjs <show_id> <标记串> [--shot <目录>] [--json]
 *
 * 路径全部走 lib/config.mjs 解析，本文件不含绝对路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveAll, importClient } from './lib/config.mjs';
import { loadPlaywright, launchChromium } from './lib/browser.mjs';

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const shotIdx = argv.indexOf('--shot');
const shotDir = shotIdx !== -1 ? argv[shotIdx + 1] : null;
const positional = argv.filter((a, i) => !a.startsWith('--') && i !== shotIdx + 1);

const showId = positional[0];
const marker = positional[1] || '';
if (!showId) {
  console.error('用法：node scripts/verify-render.mjs <show_id> <标记串> [--shot <目录>] [--json]');
  process.exit(2);
}

const resolved = resolveAll({});
if (!fs.existsSync(resolved.session)) {
  console.error(`找不到会话文件：${resolved.session}\n先跑一次 scripts/create.mjs 完成登录。`);
  process.exit(2);
}

const Xiumi = await importClient(resolved.client);
const api = await Xiumi.loadSession(resolved.session);

const meta = await api.getShow(showId).catch((e) => {
  console.error(`读取作品 ${showId} 失败：${e.message}`);
  process.exit(1);
});

const base = (api.base || 'https://xiumi.us').replace(/\/$/, '');
const host = new URL(base).hostname;

const pv = await api.previewUri(`/shows/${showId}`).catch(() => null);
const previewUrl = typeof pv === 'string' ? pv : pv?.uri || pv?.url;

const abs = (u) => {
  if (!u) return null;
  if (/^https?:\/\//.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
};

const targets = [
  ['preview', previewUrl],
  ['edit', meta.edit_url],
  ['show', meta.show_url],
].filter(([, u]) => u);

if (!targets.length) {
  console.error('该作品没有可访问的预览/编辑/公开地址。');
  process.exit(1);
}

// ---------------------------------------------------------------- 浏览器

const { chromium } = await loadPlaywright({ client: resolved.client });

const browser = await launchChromium(chromium);
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
// sid 严格绑定单主机（无前导点），这里按客户端 base 的主机写
await ctx.addCookies([{ name: 'sid', value: api.sid, domain: host, path: '/', httpOnly: true, secure: true, sameSite: 'None' }]);

const report = [];

async function scan(url, label) {
  const page = await ctx.newPage();
  try {
    await page.goto(abs(url), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);

    let textHit = false;
    const frames = [];
    for (const f of page.frames()) {
      const t = await f.evaluate(() => document.body?.innerText || '').catch(() => '');
      const hit = !!marker && t.includes(marker);
      if (hit) textHit = true;
      frames.push({ frame: f.name() || f.url().slice(0, 60), len: t.length, hit });
    }

    // 图片解码情况：naturalWidth === 0 说明没加载成功（常见于 tplId 写错被降级成占位图）
    const imgs = await page.evaluate(() =>
      [...document.images].map((i) => ({
        src: (i.currentSrc || i.src || '').slice(0, 120),
        w: i.naturalWidth,
        h: i.naturalHeight,
      }))
    ).catch(() => []);

    const broken = imgs.filter((i) => !i.w);
    const shot = shotDir
      ? path.join(shotDir, `render-${showId}-${label}.png`)
      : path.join(resolved.cache, `render-${showId}-${label}.png`);
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

    const entry = {
      label,
      url: abs(url),
      frames: frames.length,
      textHit,
      images: imgs.length,
      imagesBroken: broken.length,
      screenshot: shot,
    };
    report.push(entry);
    return textHit;
  } catch (e) {
    report.push({ label, url: abs(url), error: e.message });
    return false;
  } finally {
    await page.close();
  }
}

let hit = false;
for (const [label, url] of targets) {
  if (await scan(url, label)) {
    hit = true;
    break;
  }
}

await browser.close();

// ---------------------------------------------------------------- 输出

if (asJson) {
  console.log(JSON.stringify({ show_id: Number(showId), marker, pass: hit && report.every((r) => !r.imagesBroken), report }, null, 2));
} else {
  console.log(`show_id=${showId}  title="${meta.title}"`);
  console.log(`标记串「${marker}」`);
  for (const r of report) {
    if (r.error) {
      console.log(`\n[${r.label}] 失败：${r.error}`);
      continue;
    }
    console.log(`\n[${r.label}] ${r.url}`);
    console.log(`  frames=${r.frames}  文本含标记=${r.textHit}`);
    console.log(`  图片 ${r.images} 张，未解码 ${r.imagesBroken} 张`);
    console.log(`  截图：${r.screenshot}`);
  }
  console.log(`\n渲染含写入文本 = ${hit}`);
  const broken = report.reduce((n, r) => n + (r.imagesBroken || 0), 0);
  if (broken) console.log(`提示：有 ${broken} 张图片未解码，通常是 tplId 不是模板库真值导致降级为占位图。`);
}

process.exit(hit ? 0 : 1);
