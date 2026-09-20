/**
 * autoxiumi · 路径与配置解析
 *
 * 这是本 skill 可复用的关键：**本文件及所有调用方不得出现任何绝对路径或目录名假设**。
 * 外部依赖（API 客户端、会话文件、缓存目录、浏览器）统一按分层规则解析：
 *
 *   显式入参（CLI flag） → 环境变量 → 配置文件 → 自动发现 → 安全默认值
 *
 * 于是同一份 skill 可以放在任意目录、被任意 cwd 调用、与 xiumi-api 处于任意相对位置。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 本文件在 <skill>/scripts/lib/ 下，向上两级即 skill 根 */
export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** skill 的目录名即规范要求的 name */
export const SKILL_NAME = path.basename(SKILL_DIR);

const isWin = process.platform === 'win32';

const exists = (p) => {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
};
const isFile = (p) => exists(p) && fs.statSync(p).isFile();

/** 从 start 起逐级向上产出目录（含 start 自身，含盘符根） */
function* ancestors(start) {
  let cur = path.resolve(start);
  for (;;) {
    yield cur;
    const up = path.dirname(cur);
    if (up === cur) return;
    cur = up;
  }
}

/** 平台缓存根 */
export function cacheRoot() {
  return (
    process.env.XDG_CACHE_HOME ||
    (isWin ? process.env.LOCALAPPDATA : path.join(os.homedir(), '.cache')) ||
    os.tmpdir()
  );
}

/** 平台配置根 */
export function configRoot() {
  return (
    process.env.XDG_CONFIG_HOME ||
    (isWin ? process.env.APPDATA : path.join(os.homedir(), '.config')) ||
    os.homedir()
  );
}

/** 把配置里的相对路径按配置文件所在目录解析成绝对路径 */
function absolutize(data, baseDir) {
  for (const key of ['client', 'session', 'cache']) {
    const v = data[key];
    if (typeof v === 'string' && v) {
      data[key] = path.isAbsolute(v) ? path.normalize(v) : path.resolve(baseDir, v);
    }
  }
  return data;
}

/**
 * 读取配置文件。候选顺序（先命中先用）：
 *   1. 显式 --config
 *   2. $XIUMI_CONFIG
 *   3. <cwd>/autoxiumi.config.json
 *   4. <skill>/config.json
 *   5. <平台配置根>/autoxiumi/config.json
 *
 * 配置内的相对路径按**配置文件所在目录**解析，不依赖 cwd。
 * @returns {{path: string|null, data: object}}
 */
export function loadConfig(explicit) {
  const cands = [
    explicit,
    process.env.XIUMI_CONFIG,
    path.join(process.cwd(), 'autoxiumi.config.json'),
    path.join(SKILL_DIR, 'config.json'),
    path.join(configRoot(), 'autoxiumi', 'config.json'),
  ].filter(Boolean);

  for (const c of cands) {
    if (!isFile(c)) continue;
    const abs = path.resolve(c);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      throw new Error(`配置文件无法解析：${abs}\n  ${e.message}`);
    }
    return { path: abs, data: absolutize(raw, path.dirname(abs)) };
  }
  return { path: null, data: {} };
}

/** 客户端相对仓库根的候选位置（覆盖 `client/xiumi.mjs` 与 `xiumi-api/client/xiumi.mjs` 两种布局） */
const CLIENT_REL = [
  path.join('client', 'xiumi.mjs'),
  path.join('xiumi-api', 'client', 'xiumi.mjs'),
];

/**
 * 解析 API 客户端文件位置。
 * 顺序：--client → $XIUMI_CLIENT → config.client → 自动发现（cwd 与 skill 上级各自向上找）
 * @returns {string} 绝对路径
 */
export function resolveClient({ explicit, config = {} } = {}) {
  const direct = [explicit, process.env.XIUMI_CLIENT, config.client].find((p) => isFile(p));
  if (direct) return path.resolve(direct);

  // 自动发现：从 cwd 和 skill 的上级目录分别向上遍历
  const tried = new Set();
  for (const start of [process.cwd(), path.resolve(SKILL_DIR, '..')]) {
    for (const dir of ancestors(start)) {
      for (const rel of CLIENT_REL) {
        const p = path.join(dir, rel);
        if (tried.has(p)) continue;
        tried.add(p);
        if (isFile(p)) return p;
      }
    }
  }

  throw new Error(
    [
      '找不到 xiumi-api 客户端文件（client/xiumi.mjs）。',
      '',
      '任选一种方式指定：',
      '  node scripts/create.mjs <spec> --client <路径>',
      '  设置环境变量 XIUMI_CLIENT=<路径>',
      '  在 autoxiumi.config.json 里写 {"client": "<路径>"}',
      '',
      '已尝试过的位置：',
      ...[...tried].slice(0, 12).map((p) => `  ${p}`),
    ].join('\n')
  );
}

/**
 * 解析会话文件位置（不必存在，会在首次登录后写入）。
 * 顺序：--session → $XIUMI_SESSION → config.session → 客户端仓库内的 capture/ → cwd 向上 → 平台配置根
 * @returns {string} 绝对路径（即便当前不存在）
 */
export function resolveSession({ explicit, config = {}, client } = {}) {
  const direct = explicit || process.env.XIUMI_SESSION || config.session;
  if (direct) return path.resolve(direct);

  const cands = [];
  if (client) {
    const repo = path.dirname(path.dirname(path.resolve(client)));
    cands.push(path.join(repo, 'capture', 'client-session.json'));
    cands.push(path.join(repo, 'session.json'));
  }
  for (const dir of ancestors(process.cwd())) {
    cands.push(path.join(dir, 'capture', 'client-session.json'));
    cands.push(path.join(dir, 'client-session.json'));
  }
  cands.push(path.join(configRoot(), 'autoxiumi', 'session.json'));

  return cands.find(isFile) || cands[0];
}

/**
 * 解析缓存目录。默认落在平台缓存根，避免写入可能只读的 skill 安装目录。
 * 顺序：--cache → $XIUMI_CACHE_DIR → config.cache → <平台缓存根>/<skill 名>
 */
export function resolveCache({ explicit, config = {} } = {}) {
  const dir = explicit || process.env.XIUMI_CACHE_DIR || config.cache ||
    path.join(cacheRoot(), SKILL_NAME);
  return path.resolve(dir);
}

/** 动态导入解析出的客户端，返回其导出的门面 */
export async function importClient(clientPath) {
  const mod = await import(pathToFileURL(clientPath).href);
  const Xiumi = mod.Xiumi || mod.default?.Xiumi || mod.default;
  if (!Xiumi) throw new Error(`客户端未导出 Xiumi：${clientPath}`);
  return Xiumi;
}

/**
 * 一次性解析全部路径。CLI 与其它脚本统一走这里，保证行为一致。
 * @returns {{skillDir:string, configPath:string|null, config:object,
 *            client:string, session:string, cache:string}}
 */
export function resolveAll({ client, session, cache, config } = {}) {
  const cfg = loadConfig(config);
  const clientPath = resolveClient({ explicit: client, config: cfg.data });
  return {
    skillDir: SKILL_DIR,
    configPath: cfg.path,
    config: cfg.data,
    client: clientPath,
    session: resolveSession({ explicit: session, config: cfg.data, client: clientPath }),
    cache: resolveCache({ explicit: cache, config: cfg.data }),
  };
}
