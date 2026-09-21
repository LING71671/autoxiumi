#!/usr/bin/env node
/**
 * api.mjs — 全量接口入口（skill 内的「任意方法都能调」通道）
 *
 * 为什么单独有这个脚本：
 *   `create.mjs` 只覆盖「从 Markdown/JSON 造作品」这条创作链路。
 *   但客户端封装的是**整个站点的接口面**，只用 create.mjs 等于把大部分能力锁起来。
 *   这个脚本把客户端的方法原样暴露出来，让 AI/人可以直接调任意一个。
 *
 * 与 xiumi-api 的 `scripts/cli.mjs` 的关系：
 *   同一个思路，但这边只依赖已就位的客户端两个文件（不要求 clone 整个仓库），
 *   走 `lib/config.mjs` 的路径解析，所以放在任意目录、任意 cwd 下都能跑。
 *   逐方法的**验证状态**（跑了没、通没通）在 xiumi-api 的 docs/COVERAGE.md，这里不重复。
 *
 * 用法：
 *   node scripts/api.mjs list                    列出全部方法（按 读 / 写 分组）
 *   node scripts/api.mjs list --write --json     只看写操作，输出 JSON
 *   node scripts/api.mjs describe renameShow     签名 + 注释 + 风险提示
 *   node scripts/api.mjs call listShows '{"type":"paper","limit":5}'
 *   node scripts/api.mjs call deleteShow 123456  位置参数按 JSON 解析，失败当字符串
 *   node scripts/api.mjs raw GET /api/sys_info
 *   node scripts/api.mjs me
 *
 * 通用选项：--client <路径>   --session <路径>   --args '<json 数组>'
 */
import fs from 'node:fs';
import { resolveAll, importClient } from './lib/config.mjs';

const VALUE_FLAGS = new Set(['client', 'session', 'args', 'query', 'body']);
const BOOL_FLAGS = new Set(['json', 'write', 'md', 'help', 'h']);

/** 命名启发式：只是提示，不做任何拦截 */
const RISK_RULES = [
  [/^(delete|clear|remove|reset|destroy)/i, '删除/清空'],
  [/(withdraw|pay|recharge|transfer|refund|brokerage)/i, '资金'],
  [/(password|unbind|bind[A-Z]|apikey|secret|phone|email)/i, '账号凭据'],
  [/^(set|update|change)/, '修改'],
];

function parseArgv(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const name = a.slice(2);
    if (BOOL_FLAGS.has(name)) flags[name] = true;
    else if (VALUE_FLAGS.has(name)) {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`--${name} 需要一个值`);
      flags[name] = flags[name] === undefined ? v : [].concat(flags[name], v);
      i++;
    } else throw new Error(`未知选项：--${name}`);
  }
  return { flags, positional };
}

/** 位置参数：先试 JSON（`123` 得数字、`{"a":1}` 得对象），失败当字符串 */
function coerce(s) {
  try { return JSON.parse(s); } catch { return s; }
}

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/**
 * 静态扫一遍客户端源码：签名、JSDoc、是不是写操作。
 * 方法**全集**以运行时自省为准（见 loadMethods），这里只补元数据。
 */
function parseSource(clientPath) {
  const src = read(clientPath);
  const re = /^  (?:(static)\s+)?(?:(async)\s+)?(?:(get|set)\s+)?([a-zA-Z_$][\w$]*)\s*\(([\s\S]*?)\)\s*\{/gm;
  const raw = [];
  let m;
  while ((m = re.exec(src))) raw.push({ name: m[4], args: m[5].replace(/\s+/g, ' ').trim(), start: m.index, sigEnd: re.lastIndex });
  const out = new Map();
  const bodyOf = new Map();
  raw.forEach((h, i) => {
    const end = i + 1 < raw.length ? raw[i + 1].start : src.length;
    let body = src.slice(h.sigEnd, end);
    // 下一个方法的 JSDoc 会落进本块尾部，里面常写着 put("/api/...")，不裁掉会误判成写
    const tail = body.search(/\/\*\*[\s\S]*?\*\/\s*$/);
    if (tail >= 0) body = body.slice(0, tail);
    const before = src.slice(Math.max(0, h.start - 4000), h.start);
    const dm = before.match(/[\s\S]*\/\*\*([\s\S]*?)\*\/\s*$/);
    const clean = body.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    bodyOf.set(h.name, clean);
    out.set(h.name, {
      args: h.args,
      doc: (dm ? dm[1] : '').replace(/^\s*\*s?/gm, ' ').replace(/\s+/g, ' ').trim(),
      write: /this\.request\(\s*['"](POST|PUT|DELETE|PATCH)['"]/.test(clean),
    });
  });
  // 第二遍：包装器本身不发请求，但它调用的方法是写（如 renameShow → updateShow）
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const [name, body] of bodyOf) {
      const e = out.get(name);
      if (e.write) continue;
      for (const c of body.matchAll(/this\.([a-zA-Z_$][\w$]*)\s*\(/g)) {
        if (out.get(c[1])?.write) { e.write = true; changed = true; break; }
      }
    }
    if (!changed) break;
  }
  return out;
}

async function loadMethods(paths) {
  const Xiumi = await importClient(paths.client);
  const names = [
    ...Object.getOwnPropertyNames(Xiumi.prototype).filter((n) => n !== 'constructor' && typeof Xiumi.prototype[n] === 'function'),
    ...Object.getOwnPropertyNames(Xiumi).filter((n) => typeof Xiumi[n] === 'function'),
  ];
  const parsed = parseSource(paths.client);
  return [...new Set(names)].map((name) => {
    const meta = parsed.get(name) || { args: '', doc: '', write: false };
    return { name, ...meta, risks: RISK_RULES.filter(([rx]) => rx.test(name)).map(([, l]) => l) };
  });
}

const riskTag = (m) => [m.write ? '写' : '读', ...m.risks].join(' · ');
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

const USAGE = `xiumi skill — 全量接口入口

  node scripts/api.mjs list [--write] [--json] [--md]
  node scripts/api.mjs describe <方法名>
  node scripts/api.mjs call <方法名> [参数...] [--args '<json 数组>']
  node scripts/api.mjs raw <HTTP方法> <路径> [--query k=v] [--body '<json>']
  node scripts/api.mjs me

通用：--client <客户端路径>  --session <会话文件>
「读 / 写」是源码静态推断出的**提示**，不拦截任何调用。
逐方法的验证状态见 xiumi-api 的 docs/COVERAGE.md。`;

async function main() {
  const { flags, positional } = parseArgv(process.argv.slice(2));
  const cmd = positional.shift();
  if (!cmd || flags.help || flags.h) { console.log(USAGE); return 0; }

  const paths = resolveAll({ client: flags.client, session: flags.session });

  if (cmd === 'list') {
    const methods = (await loadMethods(paths)).filter((m) => (flags.write ? m.write : true));
    if (flags.json) { out(methods); return 0; }
    if (flags.md) {
      const cell = (s) => String(s || '').replace(/\|/g, '\\|');
      const rows = methods.slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => `| \`${m.name}\` | \`${cell(m.args) || '—'}\` | ${riskTag(m)} | ${cell(m.doc.split(/。|\.\s/)[0].replace(/^\[[^\]]*\]\s*/, '').slice(0, 72))} |`);
      console.log(['| 方法 | 签名 | 类型 | 说明 |', '|---|---|---|---|', ...rows].join('\n'));
      return 0;
    }
    const groups = new Map([['读', []], ['写', []]]);
    for (const m of methods) groups.get(m.write ? '写' : '读').push(m);
    console.log(`${methods.length} 个方法${flags.write ? '（仅写操作）' : ''}\n`);
    for (const g of ['读', '写']) {
      const ms = groups.get(g);
      if (!ms.length) continue;
      console.log(`--- ${g}（${ms.length}）`);
      for (const m of ms) console.log(`  ${m.name.padEnd(34)} ${riskTag(m)}`);
      console.log('');
    }
    console.log('详情：node scripts/api.mjs describe <方法名>');
    return 0;
  }

  if (cmd === 'describe') {
    const name = positional[0];
    if (!name) throw new Error('用法：node scripts/api.mjs describe <方法名>');
    const methods = await loadMethods(paths);
    const m = methods.find((x) => x.name === name);
    if (!m) {
      const near = methods.filter((x) => x.name.toLowerCase().includes(name.toLowerCase())).slice(0, 8);
      throw new Error(`没有这个方法：${name}` + (near.length ? `\n你是不是要找：${near.map((x) => x.name).join(', ')}` : ''));
    }
    console.log(m.name);
    console.log('─'.repeat(60));
    console.log(`签名   ${m.args || '(无参数)'}`);
    console.log(`类型   ${riskTag(m)}`);
    if (m.doc) console.log(`说明   ${m.doc.slice(0, 500)}`);
    console.log('─'.repeat(60));
    const sample = positional.slice(1);
    console.log(`调用   node scripts/api.mjs call ${m.name}${sample.length || flags.args ? ' ' + (sample.join(' ') || "<--args '[...]'>") : ''}`);
    return 0;
  }

  if (cmd === 'call' || cmd === 'raw') {
    const name = positional.shift();
    if (!name) throw new Error(`用法：node scripts/api.mjs ${cmd} <方法名|HTTP方法> [参数...]`);
    const args = flags.args !== undefined ? JSON.parse(flags.args) : positional.map(coerce);
    const Xiumi = await importClient(paths.client);
    const api = await Xiumi.loadSession(paths.session);

    if (cmd === 'raw') {
      const query = {};
      for (const kv of [].concat(flags.query || [])) {
        const i = kv.indexOf('=');
        if (i < 0) throw new Error(`--query 需要 k=v 形式：${kv}`);
        query[kv.slice(0, i)] = kv.slice(i + 1);
      }
      out(await api.request(name.toUpperCase(), args[0], { query, body: flags.body ? JSON.parse(flags.body) : undefined }));
      return 0;
    }

    if (typeof api[name] !== 'function') throw new Error(`没有这个方法：${name}（list 看全部）`);
    const m = (await loadMethods(paths)).find((x) => x.name === name);
    if (m?.risks.length) console.error(`[${riskTag(m)}] ${name} —— 风险标注仅是提示，请自行确认操作对象。`);
    out(await api[name](...args));
    return 0;
  }

  if (cmd === 'me') {
    const Xiumi = await importClient(paths.client);
    const api = await Xiumi.loadSession(paths.session);
    const me = await api.me();
    out({ user_sid: me.user_sid, unique_uid: me.unique_uid, nickname: me.nickname, level: me.level });
    return 0;
  }

  throw new Error(`未知子命令：${cmd}\n\n${USAGE}`);
}

main().then(
  (code) => process.exit(code || 0),
  (e) => { console.error(`错误：${e.message}`); process.exit(1); }
);
