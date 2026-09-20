/**
 * autoxiumi · 浏览器（可选依赖）
 *
 * 仅渲染验证需要浏览器，创建/更新作品不需要。因此 playwright **不是硬依赖**：
 * 这里做动态解析，解析不到就抛可读错误，由调用方降级。
 *
 * 解析顺序：$XIUMI_PLAYWRIGHT → 自身依赖 → 沿 cwd / 客户端仓库向上找 node_modules/playwright(-core)
 * Chromium 可执行文件优先交给 playwright 自己解析；失败时退回扫描标准缓存根，并支持 $XIUMI_CHROME 覆盖。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const isWin = process.platform === 'win32';
const exists = (p) => {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
};

function* ancestors(start) {
  let cur = path.resolve(start);
  for (;;) {
    yield cur;
    const up = path.dirname(cur);
    if (up === cur) return;
    cur = up;
  }
}

const PACKAGES = ['playwright', 'playwright-core'];

/** 从某个 node_modules 里取包的入口文件 */
function entryOf(nodeModules, pkg) {
  const dir = path.join(nodeModules, pkg);
  const pj = path.join(dir, 'package.json');
  if (!fs.existsSync(pj)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(pj, 'utf8'));
    const main = typeof meta.main === 'string' ? meta.main : 'index.js';
    const hit = [main, 'index.js', 'index.mjs', 'index.cjs']
      .map((f) => path.join(dir, f))
      .find((f) => fs.existsSync(f));
    return hit || null;
  } catch {
    return null;
  }
}

/**
 * 加载 playwright 模块。
 * @param {{client?:string, explicit?:string}} [opts] client 用于额外搜索客户端仓库的 node_modules
 * @returns {Promise<{chromium:any, _from:string}>}
 */
export async function loadPlaywright({ client, explicit } = {}) {
  const spec = explicit || process.env.XIUMI_PLAYWRIGHT;
  if (spec) {
    const mod = await import(isWin || spec.startsWith('/') ? pathToFileURL(path.resolve(spec)).href : spec);
    return { chromium: mod.chromium || mod.default?.chromium, _from: spec };
  }

  const roots = [process.cwd()];
  if (client) roots.push(path.dirname(path.dirname(path.resolve(client))));

  const tried = [];
  for (const root of roots) {
    for (const dir of ancestors(root)) {
      const nm = path.join(dir, 'node_modules');
      if (!exists(nm)) continue;
      for (const pkg of PACKAGES) {
        const entry = entryOf(nm, pkg);
        if (!entry) continue;
        tried.push(entry);
        try {
          const mod = await import(pathToFileURL(entry).href);
          const chromium = mod.chromium || mod.default?.chromium;
          if (chromium) return { chromium, _from: path.dirname(entry) };
        } catch {
          /* 这个安装不可用，继续找 */
        }
      }
    }
  }

  try {
    const mod = await import('playwright');
    if (mod.chromium) return { chromium: mod.chromium, _from: 'playwright' };
  } catch {
    /* 忽略 */
  }

  throw new Error(
    [
      '未找到 playwright（渲染验证需要浏览器，创建作品不需要）。',
      '',
      '任选一种方式：',
      '  npm i playwright            # 装在任意会被搜索到的目录',
      '  设置 XIUMI_PLAYWRIGHT=<playwright 安装目录或入口文件>',
      '',
      tried.length ? `已尝试：\n${tried.map((p) => `  ${p}`).join('\n')}` : '（未发现任何 node_modules 安装）',
    ].join('\n')
  );
}

/** 扫描标准浏览器缓存根，找可用的 Chromium 可执行文件 */
function findChromium() {
  if (process.env.XIUMI_CHROME) return process.env.XIUMI_CHROME;

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    isWin ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright') : null,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);

  const inner = [
    path.join('chrome-win64', 'chrome.exe'),
    path.join('chrome-win', 'chrome.exe'),
    path.join('chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
    path.join('chrome-linux', 'chrome'),
    path.join('chrome-headless-shell-linux64', 'chrome-headless-shell'),
    path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  ];

  for (const r of roots) {
    if (!exists(r)) continue;
    for (const d of fs.readdirSync(r)) {
      if (!/^chromium/.test(d)) continue;
      for (const rel of inner) {
        const p = path.join(r, d, rel);
        if (exists(p)) return p;
      }
    }
  }
  return null;
}

/**
 * 启动 Chromium。先让 playwright 自己解析（最可靠），失败再用手动扫描结果。
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchChromium(chromium, opts = {}) {
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  try {
    return await chromium.launch({ args, ...opts });
  } catch (e) {
    const exe = findChromium();
    if (!exe) throw e;
    return await chromium.launch({ args, ...opts, executablePath: exe });
  }
}
