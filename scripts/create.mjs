#!/usr/bin/env node
/**
 * autoxiumi · 创作 CLI
 *
 * 把 Markdown 或 JSON 规格变成账号里的真实图文作品。
 * 本文件不含任何绝对路径 —— 客户端、会话、缓存都由 lib/config.mjs 分层解析。
 *
 * 用法：
 *   node scripts/create.mjs <spec.json|spec.md> [选项]
 *
 * 运行 `node scripts/create.mjs --help` 看完整选项，
 * 运行 `node scripts/doctor.mjs` 查看当前解析到的各项目路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveAll, importClient } from './lib/config.mjs';

// ---------------------------------------------------------------- 参数

const VALUE_FLAGS = new Set(['title', 'type', 'session', 'client', 'cache', 'config', 'update']);
const BOOL_FLAGS = new Set(['dry', 'refresh-templates', 'help', 'h']);

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positionals.push(a);
      continue;
    }
    const name = a.slice(2);
    if (BOOL_FLAGS.has(name)) {
      flags[name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`--${name} 需要一个值`);
      flags[name] = v;
      i++;
    } else {
      throw new Error(`未知选项：--${name}`);
    }
  }
  return { flags, positionals };
}

const USAGE = `autoxiumi — Markdown/JSON → 秀米图文

用法：node scripts/create.mjs <spec.json|spec.md> [选项]

选项：
  --title <文字>          覆盖标题
  --type <paper|booklet|tablet|placard>   作品类型（默认 paper）
  --update <show_id>      改写已有作品（走乐观锁，客户端自动重试）
  --dry                   只构建不提交
  --refresh-templates     强制重拉组件缓存
  --client <路径>         xiumi-api 客户端位置（默认自动发现）
  --session <路径>        会话文件位置（默认自动发现）
  --cache <目录>          缓存目录（默认平台缓存根）
  --config <路径>         配置文件
  -h, --help              显示本帮助

环境变量：XIUMI_CLIENT / XIUMI_SESSION / XIUMI_CACHE_DIR / XIUMI_CONFIG /
         XIUMI_USER / XIUMI_PASS / AUTOXIUMI_VERBOSE
`;

let flags;
let positionals;
try {
  ({ flags, positionals } = parseArgs(process.argv.slice(2)));
} catch (e) {
  console.error(e.message);
  console.error(`\n${USAGE}`);
  process.exit(2);
}

if (flags.help || flags.h) {
  console.log(USAGE);
  process.exit(0);
}

const input = positionals[0];
if (!input) {
  console.error(USAGE);
  process.exit(2);
}
if (positionals.length > 1) {
  console.error(`只接受一个输入文件，收到 ${positionals.length} 个：${positionals.join(', ')}`);
  process.exit(2);
}
if (!fs.existsSync(input)) {
  console.error(`输入文件不存在：${input}`);
  process.exit(2);
}

const dry = !!flags.dry;
const updateId = flags.update || null;
const refreshTemplates = !!flags['refresh-templates'];

// ---------------------------------------------------------------- 路径解析

const resolved = resolveAll({
  client: flags.client,
  session: flags.session,
  cache: flags.cache,
  config: flags.config,
});

if (process.env.AUTOXIUMI_VERBOSE) {
  console.log(`客户端：${resolved.client}`);
  console.log(`会话  ：${resolved.session}`);
  console.log(`缓存  ：${resolved.cache}`);
}

const { buildFromSpec, markdownToBlocks } = await import('./lib/builder.mjs');

// ---------------------------------------------------------------- 读 spec

const specDir = path.dirname(path.resolve(input));
const raw = fs.readFileSync(input, 'utf8');
let spec;
if (/\.md$/i.test(input)) {
  spec = {
    title: flags.title || path.basename(input, path.extname(input)),
    blocks: markdownToBlocks(raw),
  };
} else {
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    console.error(`JSON 解析失败：${input}\n  ${e.message}`);
    process.exit(2);
  }
}
if (flags.title) spec.title = flags.title;
if (flags.type) spec.type = flags.type;
spec.type = spec.type || 'paper';

if (!Array.isArray(spec.blocks)) {
  console.error('spec.blocks 必须是数组');
  process.exit(2);
}

// ---------------------------------------------------------------- 登录

const Xiumi = await importClient(resolved.client);

let api = fs.existsSync(resolved.session) ? await Xiumi.loadSession(resolved.session) : null;
if (!api) {
  const user = process.env.XIUMI_USER;
  const pass = process.env.XIUMI_PASS;
  if (!user || !pass) {
    console.error(
      `找不到可用会话（${resolved.session}），且未设置 XIUMI_USER / XIUMI_PASS。\n` +
      `用 --session 指定会话文件，或先登录一次把会话落盘。`
    );
    process.exit(2);
  }
  api = await Xiumi.login({ user, password: pass });
  fs.mkdirSync(path.dirname(resolved.session), { recursive: true });
  await api.saveSession(resolved.session);
  console.log(`已登录并保存会话 -> ${resolved.session}`);
}

const me = await api.me();
console.log(`账号：${me.nickname}（${String(me.unique_uid).slice(0, 8)}…）`);

// ---------------------------------------------------------------- 本地图上传

const UPLOADABLE = /\.(png|jpe?g|gif|webp|svg)$/i;
const isRemote = (s) => /^https?:\/\/|^\/\//.test(s);

/** 相对路径按 spec 文件所在目录解析，而不是 cwd —— 否则换个地方跑就找不到图 */
const resolveLocal = (p) => path.resolve(specDir, p);

async function localizeImages(blocks) {
  let n = 0;
  for (const b of blocks || []) {
    for (const key of ['img', 'image']) {
      const v = b[key];
      if (typeof v === 'string' && !isRemote(v)) {
        const file = resolveLocal(v);
        if (!fs.existsSync(file)) {
          console.warn(`  图片不存在，原样写入：${v}`);
          continue;
        }
        if (!UPLOADABLE.test(file)) {
          console.warn(`  不是可上传的图片扩展名，原样写入：${v}`);
          continue;
        }
        const up = await api.uploadImageBase64(fs.readFileSync(file), path.basename(file));
        const uri = up.target_uri || up.uri || up.url;
        console.log(`  上传 ${path.basename(file)} -> ${uri}`);
        b[key] = uri;
        n++;
      } else if (v && typeof v === 'object' && typeof v.src === 'string' && !isRemote(v.src)) {
        const file = resolveLocal(v.src);
        if (!fs.existsSync(file)) {
          console.warn(`  图片不存在，原样写入：${v.src}`);
          continue;
        }
        const up = await api.uploadImageBase64(fs.readFileSync(file), path.basename(file));
        console.log(`  上传 ${path.basename(file)} -> ${up.target_uri}`);
        v.src = up.target_uri;
        n++;
      }
    }
    if (b.cols) {
      await localizeImages(b.cols.filter((x) => x && typeof x === 'object').map((x) => ({ img: x })));
    }
  }
  return n;
}

const uploaded = await localizeImages(spec.blocks);
if (uploaded) console.log(`本地图片已转站内地址：${uploaded} 张`);

// ---------------------------------------------------------------- 构建

console.log(`构建作品：type=${spec.type} title=${JSON.stringify(spec.title)} blocks=${spec.blocks.length}`);
const show = await buildFromSpec(api, spec, { refreshTemplates, cacheDir: resolved.cache });

const cube = show.cubes[0];
const pageCount = cube.pages.length;
const itemCounts = cube.pages.map((p) => p.layers[0].comps.items.length);
console.log(`  页数=${pageCount}  每页组件数=[${itemCounts.join(', ')}]  grounds=${cube.grounds.length}`);

// pages 与 grounds 必须等长：站内数据完整性要求
if (cube.grounds.length !== pageCount) {
  console.error('  ✗ pages 与 grounds 长度不一致 —— 数据结构不完整，中止');
  process.exit(1);
}

// 每个组件都要能追到站内模板，防止手写 tplId 被静默降级成占位图
const suspicious = [];
for (const p of cube.pages) {
  for (const it of p.layers[0].comps.items) {
    const id = it?._comp?.tplId;
    if (!id) suspicious.push('(无 _comp.tplId)');
    else if (!/^[a-z]+-cp:/.test(id)) suspicious.push(id);
  }
}
if (suspicious.length) {
  console.error(`  ✗ 有组件不是站内模板形态，会被渲染成占位图：${[...new Set(suspicious)].join(', ')}`);
  process.exit(1);
}
console.log('  ✓ 全部组件均来自站内模板库');

// 构建产物落盘（缓存目录，不是 skill 目录）
fs.mkdirSync(resolved.cache, { recursive: true });
const outPath = path.join(resolved.cache, `last-build-${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify(show, null, 2), 'utf8');
if (process.env.AUTOXIUMI_VERBOSE) console.log(`  构建产物：${outPath}`);

if (dry) {
  console.log('\n--dry：未提交。');
  process.exit(0);
}

// ---------------------------------------------------------------- 提交

/** show_url / edit_url 可能是绝对地址、协议相对地址或站内路径，统一成绝对 URL */
function absUrl(u) {
  if (!u) return null;
  if (/^https?:\/\//.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  const base = api.base || 'https://xiumi.us';
  return `${base.replace(/\/$/, '')}${u.startsWith('/') ? '' : '/'}${u}`;
}

if (updateId) {
  const meta = await api.getShow(updateId);
  await api.updateShow(meta, show);
  console.log(`\n已更新作品 ${updateId}`);
  console.log(`  编辑器：${absUrl(`/studio/v5#/${spec.type}/for/${updateId}`)}`);
} else {
  const created = await api.createShow(spec.type, show);
  const sid = created.show_id;
  console.log('\n已创建作品');
  console.log(`  show_id  ：${sid}`);
  console.log(`  编辑器   ：${absUrl(created.edit_url || `/studio/v5#/${spec.type}/for/${sid}`)}`);
  if (created.show_url) console.log(`  公开页   ：${absUrl(created.show_url)}（未过审会 403）`);
}
