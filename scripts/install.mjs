#!/usr/bin/env node
/**
 * autoxiumi · 安装
 *
 * 把本 skill 装到本机各个 AI harness 的技能目录，并把 xiumi-api 客户端一并就位。
 * 零依赖（只用 Node 内置模块），不需要 npm install。
 *
 * 客户端实际只有两个文件（`client/xiumi.mjs` 与 `client/lz-string.mjs`，合计约 100 KB），
 * 所以每个安装点各自带一份：装完的目录是**自包含**的，可以单独拷到别的机器，
 * 不需要拉整个 xiumi-api 仓库。
 *
 * 用法：
 *   node scripts/install.mjs                      # 探测本机已装的 harness，逐个安装
 *   node scripts/install.mjs --list               # 只看探测结果，不安装
 *   node scripts/install.mjs --target claude,codex
 *   node scripts/install.mjs --target all         # 12 种全装（不去探测）
 *   node scripts/install.mjs --project            # 装到当前项目的 harness 目录
 *   node scripts/install.mjs --dir <目录>          # 只装这一个目录
 *   node scripts/install.mjs --local <xiumi-api 路径>   # 从本地仓库取客户端（离线可用）
 *   node scripts/install.mjs --dry                # 只打印计划，不落盘
 *
 * 装完之后跑 `node <目标目录>/scripts/doctor.mjs` 确认路径解析结果。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * skill 的规范名 = `SKILL.md` frontmatter 里的 `name`（目录刚好同名时两者一致）。
 * 以 frontmatter 为准，这样 clone 到各种名字的目录里都不会装错位置。
 */
function readSkillName() {
  try {
    const head = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8').slice(0, 2000);
    const m = head.match(/^\s*name:\s*([^\s#]+)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  } catch {
    /* 读不到就退回目录名 */
  }
  return path.basename(SKILL_DIR);
}
const SKILL_NAME = readSkillName();

const DEFAULT_OWNER_REPO = 'LING71671/xiumi-api';
const CLIENT_FILES = ['xiumi.mjs', 'lz-string.mjs'];
const COPY_EXCLUDE = new Set(['.git', 'node_modules', '.github', 'cache', '.audit', 'config.json']);

const home = os.homedir();

/**
 * 本机各 AI harness 的技能目录。
 *
 *   user     用户级技能目录（相对 home）
 *   project  项目级技能目录（相对仓库根）
 *   marker   探测标记（相对 home，可多个）：存在即认为本机装了该 harness
 *
 * 新增一个 harness 只需要在这里加一行，其它地方都不用改。
 * 路径若有出入，用 `--dir` 直接指定，或按本文件的规律补上。
 */
const HARNESSES = [
  { id: 'claude',      name: 'Claude Code',    user: '.claude/skills',          project: '.claude/skills',      marker: ['.claude'] },
  { id: 'codex',       name: 'Codex CLI',      user: '.codex/skills',           project: '.codex/skills',       marker: ['.codex'] },
  { id: 'cursor',      name: 'Cursor',         user: '.cursor/skills',          project: '.cursor/skills',      marker: ['.cursor'] },
  { id: 'gemini',      name: 'Gemini CLI',     user: '.gemini/skills',          project: '.gemini/skills',      marker: ['.gemini'] },
  { id: 'copilot',     name: 'GitHub Copilot', user: '.copilot/skills',         project: '.github/skills',      marker: ['.copilot', '.config/github-copilot'] },
  { id: 'opencode',    name: 'OpenCode',       user: '.config/opencode/skills', project: '.opencode/skills',    marker: ['.config/opencode'] },
  { id: 'windsurf',    name: 'Windsurf',       user: '.windsurf/skills',        project: '.windsurf/skills',    marker: ['.windsurf'] },
  { id: 'kiro',        name: 'Kiro',           user: '.kiro/skills',            project: '.kiro/skills',        marker: ['.kiro'] },
  { id: 'openclaw',    name: 'OpenClaw',       user: '.openclaw/skills',        project: '.openclaw/skills',    marker: ['.openclaw'] },
  { id: 'antigravity', name: 'Antigravity',    user: '.antigravity/skills',     project: '.antigravity/skills', marker: ['.antigravity'] },
  { id: 'warp',        name: 'Warp',           user: '.warp/skills',            project: '.warp/skills',        marker: ['.warp'] },
  { id: 'workbuddy',   name: 'WorkBuddy',      user: '.workbuddy/skills',       project: '.workbuddy/skills',   marker: ['.workbuddy'] },
];

/** 跨 harness 的通用位置：多数客户端都把它当兜底扫描，装了至少能被一部分 harness 看到 */
const UNIVERSAL = {
  id: 'agents',
  name: '通用（.agents）',
  user: '.agents/skills',
  project: '.agents/skills',
  marker: ['.agents'],
};

const POOL = HARNESSES.concat([UNIVERSAL]);

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const detected = (h) => h.marker.some((m) => isDir(path.join(home, m)));

/** harness 的技能根目录（相对 home 或仓库根） */
const skillsRoot = (h, project) => path.join(project ? process.cwd() : home, project ? h.project : h.user);

/** 安装点 = 技能根下的以 skill 名命名的子目录，绝不是技能根本身 */
const skillPathIn = (h, project) => path.join(skillsRoot(h, project), SKILL_NAME);

// ---------------------------------------------------------------- 参数

function parseArgs(argv) {
  const flags = {};
  const VALUE = new Set(['dir', 'target', 'local', 'from', 'ref']);
  const BOOL = new Set(['dry', 'no-check', 'force', 'project', 'list', 'help', 'h']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    if (BOOL.has(name)) flags[name] = true;
    else if (VALUE.has(name)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`--${name} 需要一个值`);
      flags[name] = v;
      i++;
    } else throw new Error(`未知选项：--${name}`);
  }
  return flags;
}

const USAGE = `autoxiumi 安装

用法：node scripts/install.mjs [选项]

默认行为：探测本机装了哪些 AI harness，把 skill 装进它们的技能目录；
再补一份到跨 harness 的通用位置（~/.agents/skills）。

选项：
  --list                只列出探测结果，不安装
  --target <id,...>     指定 harness（${HARNESSES.map((h) => h.id).join(' / ')} / all）
  --project             装到当前项目的 harness 目录，而不是用户级
  --dir <目录>          只装到这一个目录（等价于手动指定，跳过探测）
  --local <路径>        从本地已有的 xiumi-api 仓库取客户端（离线可用）
  --from <owner/repo>   远端来源（默认 ${DEFAULT_OWNER_REPO}）
  --ref <分支>          远端分支（默认 main）
  --dry                 只打印计划，不落盘
  --no-check            装完不跑自检
  --force               重新取客户端（忽略已存在的）
  -h, --help            显示本帮助
`;

let flags;
try {
  flags = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(e.message + '\n\n' + USAGE);
  process.exit(2);
}
if (flags.help || flags.h) {
  console.log(USAGE);
  process.exit(0);
}

const dry = !!flags.dry;
const project = !!flags.project;

// ---------------------------------------------------------------- 探测

if (flags.list) {
  console.log(`已装的 harness（探测 ${path.join(home, '<配置目录>')}）：\n`);
  for (const h of HARNESSES) {
    const on = detected(h);
    console.log(`  ${on ? '✓' : '·'} ${h.id.padEnd(12)} ${h.name.padEnd(16)} ${skillPathIn(h, project)}`);
  }
  console.log(`\n  通用位置永远会装：${skillPathIn(UNIVERSAL, project)}`);
  process.exit(0);
}

// ---------------------------------------------------------------- 计划

function planTargets() {
  if (flags.dir) {
    return [{ id: 'custom', name: '指定目录', dir: path.resolve(flags.dir) }];
  }
  if (flags.target) {
    const ids = flags.target.split(',').map((s) => s.trim()).filter(Boolean);
    const picked = ids.includes('all') ? POOL : ids.map((id) => {
      const h = POOL.find((x) => x.id === id);
      if (!h) throw new Error(`未知 harness：${id}（可选 ${POOL.map((x) => x.id).join(' / ')} / all）`);
      return h;
    });
    return [...new Set(picked)].map((h) => ({ id: h.id, name: h.name, dir: skillPathIn(h, project) }));
  }
  const hits = HARNESSES.filter(detected).concat([UNIVERSAL]);
  return [...new Set(hits)].map((h) => ({ id: h.id, name: h.name, dir: skillPathIn(h, project) }));
}

let plan;
try {
  plan = planTargets();
} catch (e) {
  console.error(e.message + '\n\n' + USAGE);
  process.exit(2);
}

const ownerRepo = flags.from || DEFAULT_OWNER_REPO;
const ref = flags.ref || 'main';
const noneDetected = !flags.dir && !flags.target && plan.length === 1 && plan[0].id === UNIVERSAL.id;

console.log(`autoxiumi 安装${dry ? '（预览）' : ''}${project ? ' [项目级]' : ''}`);
console.log('─'.repeat(66));
console.log(`  来源      ${SKILL_DIR}`);
console.log(`  来源方式  ${flags.local ? `本地 ${path.resolve(flags.local)}` : `远端 ${ownerRepo}@${ref}`}`);
console.log(`  安装点    ${plan.length} 处`);
for (const t of plan) {
  const same = path.resolve(t.dir) === path.resolve(SKILL_DIR);
  console.log(`    · ${t.name.padEnd(16)} ${t.dir}${same ? '   （已是当前位置，跳过复制）' : ''}`);
}
console.log(`  自检      ${dry || flags['no-check'] ? '跳过' : `跑一次（${plan[0].dir}）`}`);
console.log('─'.repeat(66));
if (noneDetected) {
  console.log('  ! 没探测到已装的 harness，只装通用位置。用 --target / --dir 指定具体位置。\n');
}

// ---------------------------------------------------------------- 复制 skill

const results = [];

for (const t of plan) {
  const target = path.resolve(t.dir);
  const sameDir = target === path.resolve(SKILL_DIR);
  const clientDir = path.join(target, 'client');

  if (!sameDir) {
    if (dry) {
      console.log(`  [预览] 复制 skill → ${target}`);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(SKILL_DIR, target, {
        recursive: true,
        filter: (src) => {
          const rel = path.relative(SKILL_DIR, src);
          if (!rel) return true;
          return !COPY_EXCLUDE.has(rel.split(path.sep)[0]);
        },
      });
      console.log(`  ✓ skill 已就位（${target}）`);
    }
  }

  // 保护：config.json 是用户自己的配置；源目录里不含它（.gitignore 排除），复制时也显式排除，
  // 所以已装好的配置不会被安装覆盖。
  if (!dry && fs.existsSync(path.join(target, 'config.json'))) {
    console.log('    · 已存在 config.json，保留不动（安装不会触碰它）');
  }

  results.push({ target, clientDir });
}

// ---------------------------------------------------------------- 客户端就位

const clientOK = (dir) => CLIENT_FILES.every((f) => isFile(path.join(dir, f)));

async function download(file) {
  const url = `https://raw.githubusercontent.com/${ownerRepo}/${ref}/client/${file}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 ${res.status}：${url}`);
  const text = await res.text();
  if (!text.includes('export')) throw new Error(`内容不像模块：${url}`);
  return text;
}

function localClientDir() {
  const src = path.resolve(flags.local, 'client');
  if (!clientOK(src)) throw new Error(`本地路径下找不到客户端文件：${src}`);
  return src;
}

// 远端只下一次，装到所有安装点
let fetched = null;
async function fetchClient() {
  if (!fetched) {
    fetched = {};
    for (const f of CLIENT_FILES) fetched[f] = await download(f);
  }
  return fetched;
}

for (const r of results) {
  if (clientOK(r.clientDir) && !flags.force) {
    console.log(`  · 客户端已存在，跳过（${r.clientDir}，--force 可重新取）`);
    continue;
  }
  if (dry) {
    console.log(`  [预览] 放客户端两个文件 → ${r.clientDir}`);
    continue;
  }
  fs.mkdirSync(r.clientDir, { recursive: true });
  try {
    const src = flags.local ? localClientDir() : null;
    for (const f of CLIENT_FILES) {
      if (src) fs.copyFileSync(path.join(src, f), path.join(r.clientDir, f));
      else fs.writeFileSync(path.join(r.clientDir, f), (await fetchClient())[f], 'utf8');
      console.log(`  ✓ ${f}${src ? '（本地）' : ''} → ${r.clientDir}`);
    }
  } catch (e) {
    console.error(
      `  ✗ ${e.message}\n` +
        `    网络不通时改用离线方式：\n` +
        `      git clone --depth 1 https://github.com/${ownerRepo}.git\n` +
        `      node scripts/install.mjs --local ./xiumi-api`
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------- 自检

if (dry) {
  console.log('\n预览结束，去掉 --dry 实际安装。');
  process.exit(0);
}

const primary = results[0];
const primarySkill = primary.target === path.resolve(SKILL_DIR) ? SKILL_DIR : primary.target;

for (const f of CLIENT_FILES) {
  const r = spawnSync(process.execPath, ['--check', path.join(primary.clientDir, f)], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`  ✗ 客户端语法校验失败：${f}\n${r.stderr}`);
    process.exit(1);
  }
}
console.log(`  ✓ 客户端语法校验通过（${CLIENT_FILES.length} 个文件 × ${results.length} 处）`);

if (!flags['no-check']) {
  console.log('');
  spawnSync(process.execPath, [path.join(primarySkill, 'scripts', 'doctor.mjs')], {
    stdio: 'inherit',
    cwd: home,
  });
}

console.log(`
安装完成。下一步：

  1. 确认自检输出里「API 客户端 ✓」
     node "${path.join(primarySkill, 'scripts', 'doctor.mjs')}"

  2. 首次登录（会话会自动落盘到平台配置根，跨 harness 共用，之后复用）
     XIUMI_USER=你的账号 XIUMI_PASS=你的密码 \\
       node "${path.join(primarySkill, 'scripts', 'create.mjs')}" "${path.join(primarySkill, 'assets', 'examples', 'article.example.md')}"

  3. 之后只需
     node "${path.join(primarySkill, 'scripts', 'create.mjs')}" <你的文章.md>

客户端位置不对时：--client <路径> / XIUMI_CLIENT=<路径> / skill 目录下的 config.json。
渲染验证（可选，需要 playwright）见 references/troubleshooting.md。
`);
