#!/usr/bin/env node
/**
 * autoxiumi · 一键安装
 *
 * 把本 skill 装到 skills 目录，并把 xiumi-api 的客户端就位。
 * 零依赖（只用 Node 内置模块），不需要 npm install。
 *
 * 客户端其实只有两个文件（`client/xiumi.mjs` 与 `client/lz-string.mjs`），
 * 所以这里只需要它们，不拉整个 xiumi-api 仓库。
 *
 * 用法：
 *   node scripts/install.mjs                          # 装到用户级 skills 目录
 *   node scripts/install.mjs --dir <目标目录>          # 指定位置（项目级安装用）
 *   node scripts/install.mjs --local <xiumi-api 路径>  # 从本地已有仓库取客户端（离线可用）
 *   node scripts/install.mjs --dry                    # 只打印计划，不落盘
 *
 * 装完之后跑 `node <目标目录>/scripts/doctor.mjs` 确认解析结果。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_NAME = path.basename(SKILL_DIR);

const DEFAULT_OWNER_REPO = 'LING71671/xiumi-api';
const CLIENT_FILES = ['xiumi.mjs', 'lz-string.mjs'];
const COPY_EXCLUDE = new Set(['.git', 'node_modules', '.github', 'cache', 'config.json']);

// ---------------------------------------------------------------- 参数

function parseArgs(argv) {
  const flags = {};
  const VALUE = new Set(['dir', 'client-dir', 'local', 'from', 'ref']);
  const BOOL = new Set(['dry', 'no-check', 'force', 'help', 'h']);
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

选项：
  --dir <目录>          skill 安装位置（默认 ~/.workbuddy/skills/${SKILL_NAME}）
  --client-dir <目录>   客户端放置位置（默认 <skill 的上级>/xiumi-api/client）
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
const home = os.homedir();
const target = path.resolve(flags.dir || path.join(home, '.workbuddy', 'skills', SKILL_NAME));
const clientDir = path.resolve(
  flags['client-dir'] || path.join(path.dirname(target), 'xiumi-api', 'client')
);
const ownerRepo = flags.from || DEFAULT_OWNER_REPO;
const ref = flags.ref || 'main';

const sameDir = path.resolve(target) === path.resolve(SKILL_DIR);

console.log(`autoxiumi 安装${dry ? '（预览）' : ''}`);
console.log('─'.repeat(60));
console.log(`  来源      ${SKILL_DIR}`);
console.log(`  装到      ${target}${sameDir ? '   （已是当前位置，跳过复制）' : ''}`);
console.log(`  客户端    ${clientDir}`);
console.log(`  来源方式  ${flags.local ? `本地 ${path.resolve(flags.local)}` : `远端 ${ownerRepo}@${ref}`}`);
console.log('─'.repeat(60));

// ---------------------------------------------------------------- 1. 复制 skill

if (!sameDir) {
  if (dry) {
    console.log('  [预览] 复制 skill 文件');
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

// 保护：config.json 是用户自己的配置。源目录里不含它（已被 .gitignore 排除），
// 复制时也显式排除，所以已装好的配置不会被安装覆盖。
const targetConfig = path.join(target, 'config.json');
if (!dry && fs.existsSync(targetConfig)) {
  console.log('  · 已存在 config.json，保留不动（安装不会触碰它）');
}

// ---------------------------------------------------------------- 2. 客户端就位

fs.mkdirSync(clientDir, { recursive: true });

function clientOK(dir) {
  return CLIENT_FILES.every((f) => fs.existsSync(path.join(dir, f)));
}

async function download(file) {
  const url = `https://raw.githubusercontent.com/${ownerRepo}/${ref}/client/${file}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 ${res.status}：${url}`);
  const text = await res.text();
  if (!text.includes('export')) throw new Error(`内容不像模块：${url}`);
  return text;
}

if (clientOK(clientDir) && !flags.force) {
  console.log(`  · 客户端已存在，跳过（--force 可重新取）`);
} else if (flags.local) {
  const src = path.resolve(flags.local, 'client');
  if (!clientOK(src)) {
    console.error(`  ✗ 本地路径下找不到客户端文件：${src}`);
    process.exit(1);
  }
  if (!dry) {
    for (const f of CLIENT_FILES) fs.copyFileSync(path.join(src, f), path.join(clientDir, f));
  }
  console.log(`  ✓ 客户端已从本地复制（${clientDir}）`);
} else {
  if (dry) {
    console.log('  [预览] 下载客户端两个文件');
  } else {
    try {
      for (const f of CLIENT_FILES) {
        fs.writeFileSync(path.join(clientDir, f), await download(f), 'utf8');
        console.log(`  ✓ ${f}`);
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
}

// ---------------------------------------------------------------- 3. 自检

if (dry) {
  console.log('\n预览结束，去掉 --dry 实际安装。');
  process.exit(0);
}

// 客户端语法自检：不执行业务逻辑，只确认是能加载的模块
for (const f of CLIENT_FILES) {
  const r = spawnSync(process.execPath, ['--check', path.join(clientDir, f)], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`  ✗ 客户端语法校验失败：${f}\n${r.stderr}`);
    process.exit(1);
  }
}
console.log('  ✓ 客户端语法校验通过');

if (!flags['no-check']) {
  console.log('');
  spawnSync(process.execPath, [path.join(target, 'scripts', 'doctor.mjs')], {
    stdio: 'inherit',
    cwd: home,
  });
}

console.log(`
安装完成。下一步：

  1. 确认自检输出里「API 客户端 ✓」
     node "${path.join(target, 'scripts', 'doctor.mjs')}"

  2. 首次登录（会话会自动落盘，之后复用）
     XIUMI_USER=你的账号 XIUMI_PASS=你的密码 \\
       node "${path.join(target, 'scripts', 'create.mjs')}" "${path.join(target, 'assets', 'examples', 'article.example.md')}"

  3. 之后只需
     node "${path.join(target, 'scripts', 'create.mjs')}" <你的文章.md>

客户端位置不对时：--client <路径> / XIUMI_CLIENT=<路径> / skill 目录下的 config.json。
渲染验证（可选，需要 playwright）见 references/troubleshooting.md。
`);
