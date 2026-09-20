/**
 * autoxiumi · 内容 → 作品数据
 *
 * 输入是「块列表」，输出是可直接 POST /api/shows/v5/{type} 的 showData。
 * 所有组件的 matrix 都从官方模板库来，本模块只负责改内容字段。
 */

import {
  TPL, loadTemplates, clone, setText, normalizeMatrix, ensureUuid, uuid,
} from './templates.mjs';

/** 收集一份 spec 里用到的全部模板 id，一次性拉取 */
function collectIds(spec) {
  const ids = new Set([TPL.text, TPL.divider]);
  for (const b of spec.blocks || []) {
    if (b.h1) ids.add(TPL.h1);
    if (b.h2) ids.add(TPL.h2);
    if (b.h3) ids.add(TPL.h3);
    if (b.p || b.paragraph) ids.add(TPL.text);
    if (b.quote) { ids.add(TPL.quote); ids.add(TPL.text); }
    if (b.list) { ids.add(b.ordered ? TPL.ol1 : TPL.ul1); ids.add(TPL.text); }
    if (b.img || b.image) ids.add(TPL.image);
    if (b.video) ids.add(TPL.video);
    if (b.divider) ids.add(TPL.divider);
    if (b.cols) {
      ids.add(b.cols.length >= 3 ? TPL.row1c3 : b.cols.length === 2 ? TPL.row1c2 : TPL.row1);
      ids.add(TPL.text);
      ids.add(TPL.image);
    }
  }
  return [...ids];
}

/** HTML 转义 + 段落包裹 */
export function toHtml(text) {
  if (text == null) return '';
  const s = String(text);
  if (/<[a-z][\s\S]*>/i.test(s)) return s;              // 已经是 HTML，原样保留
  return s.split(/\n{2,}/).filter(Boolean).map((para) => `<p>${para.trim()}</p>`).join('');
}

/**
 * 把 spec.blocks 编译成组件数组。
 * @returns {Promise<object[]>} 组件列表（每个都带合法 _$uuid）
 */
async function compileBlocks(api, spec, { refreshTemplates = false, cacheDir } = {}) {
  const ids = collectIds(spec);
  const tpl = await loadTemplates(api, ids, { refresh: refreshTemplates, cacheDir });
  const mk = (id) => {
    const t = tpl[id];
    if (!t) throw new Error(`模板未加载：${id}`);
    const c = normalizeMatrix(t.matrix);
    if (t.renderer_accelerate) c._comp = { ...c._comp, _$raHTML: t.renderer_accelerate };
    return c;
  };

  const comps = [];
  /** 往一个 group 容器里塞内容（cols 用） */
  const fillCol = (container, colIdx, value) => {
    const col = container[`col${colIdx}`];
    if (!col) return;
    col.items = col.items || [];
    if (typeof value === 'string' && /^https?:\/\/|^\/\//.test(value)) {
      const im = mk(TPL.image);
      im.img1.src = value;
      col.items.push(ensureUuid(im));
    } else {
      const tx = mk(TPL.text);
      setText(tx, toHtml(value));
      col.items.push(ensureUuid(tx));
    }
  };

  for (const b of spec.blocks || []) {
    if (b.page) { comps.push({ __pageBreak: true }); continue; }

    if (b.h1 || b.h2 || b.h3) {
      const [level, text] = b.h1 ? [1, b.h1] : b.h2 ? [2, b.h2] : [3, b.h3];
      const c = mk(level === 1 ? TPL.h1 : level === 2 ? TPL.h2 : TPL.h3);
      setText(c, toHtml(text));
      comps.push(ensureUuid(c));
      continue;
    }

    if (b.p || b.paragraph) {
      const c = mk(TPL.text);
      setText(c, toHtml(b.p || b.paragraph));
      comps.push(ensureUuid(c));
      continue;
    }

    if (b.quote) {
      const c = mk(TPL.quote);
      // quot 是布局型：文本嵌在 col1.items[0].txt1
      setText(c, toHtml(b.quote));
      comps.push(ensureUuid(c));
      continue;
    }

    if (b.divider) {
      comps.push(ensureUuid(mk(TPL.divider)));
      continue;
    }

    if (b.img || b.image) {
      const v = b.img || b.image;
      const src = typeof v === 'string' ? v : (v.src || '');
      const c = mk(TPL.image);
      c.img1.src = src;
      if (typeof v === 'object' && v.alt) c.img1.alt = v.alt;
      if (typeof v === 'object' && v.width) {
        c._comp.pose = { ...(c._comp.pose || {}), width: `${v.width}%` };
      }
      comps.push(ensureUuid(c));
      continue;
    }

    if (b.video) {
      const c = mk(TPL.video);
      c.vid1.src = b.video;
      comps.push(ensureUuid(c));
      continue;
    }

    if (b.list) {
      const c = mk(b.ordered ? TPL.ol1 : TPL.ul1);
      const html = b.list.map((li) => `<p>${li}</p>`).join('');
      setText(c, html);
      comps.push(ensureUuid(c));
      continue;
    }

    if (b.cols) {
      const c = mk(b.cols.length >= 3 ? TPL.row1c3 : b.cols.length === 2 ? TPL.row1c2 : TPL.row1);
      b.cols.forEach((v, i) => fillCol(c, i + 1, v));
      comps.push(ensureUuid(c));
      continue;
    }

    if (b.html) {
      const c = mk(TPL.text);
      setText(c, b.html);
      comps.push(ensureUuid(c));
      continue;
    }

    throw new Error(`不认识的 block：${JSON.stringify(b).slice(0, 120)}`);
  }
  return comps;
}

/**
 * 由 spec 生成 showData。
 *
 * @param {object} api  Xiumi 客户端实例（已登录）
 * @param {object} spec {type, title, blocks:[{...}]}
 * @param {{refreshTemplates?:boolean, cacheDir?:string}} [opts]
 * @returns {Promise<object>} showData，可直接 createShow / updateShow
 */
export async function buildFromSpec(api, spec, opts = {}) {
  const type = spec.type || 'paper';
  const title = spec.title || '无标题';
  const comps = await compileBlocks(api, spec, opts);

  const show = api.buildShow(type, title);
  const cube = show.cubes[0];
  const firstLayer = cube.pages[0].layers[0];
  firstLayer.comps.items = [];

  // 按 __pageBreak 分页
  const groups = [[]];
  for (const c of comps) {
    if (c.__pageBreak) groups.push([]);
    else groups[groups.length - 1].push(c);
  }
  // 丢掉末尾的空页
  while (groups.length > 1 && !groups[groups.length - 1].length) groups.pop();

  firstLayer.comps.items = groups[0];
  for (let i = 1; i < groups.length; i++) {
    // 追加页 + 平行追加 ground
    const page = clone(cube.pages[0]);
    page.layers[0].comps.items = groups[i];
    page._comp = { ...(page._comp || {}), _$uuid: uuid() };
    delete page._comp._$raHTML;
    cube.pages.push(page);
    cube.grounds.push(clone(cube.grounds[0]));
  }

  return show;
}

/**
 * 极简 Markdown → blocks。
 * 支持：# / ## / ### 标题，`> ` 引用，`- ` 无序列表，`1. ` 有序列表，
 *      `![alt](src)` 图片，`---` 分隔线，`\f`（form feed）分页，其余当段落。
 */
export function markdownToBlocks(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let buf = [];
  let list = null;
  let listOrdered = false;

  const flush = () => {
    if (buf.length) {
      blocks.push({ p: buf.join('\n').trim() });
      buf = [];
    }
    if (list && list.length) {
      blocks.push({ list, ordered: listOrdered });
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line)) { flush(); blocks.push({ h1: line.replace(/^#\s+/, '') }); continue; }
    if (/^##\s+/.test(line)) { flush(); blocks.push({ h2: line.replace(/^##\s+/, '') }); continue; }
    if (/^###\s+/.test(line)) { flush(); blocks.push({ h3: line.replace(/^###\s+/, '') }); continue; }
    if (/^>\s?/.test(line)) { flush(); blocks.push({ quote: line.replace(/^>\s?/, '') }); continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!list || listOrdered) { flush(); list = []; listOrdered = false; }
      list.push(line.replace(/^\s*[-*]\s+/, ''));
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (!list || !listOrdered) { flush(); list = []; listOrdered = true; }
      list.push(line.replace(/^\s*\d+\.\s+/, ''));
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flush(); blocks.push({ divider: true }); continue; }
    const img = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) { flush(); blocks.push({ img: { src: img[2], alt: img[1] } }); continue; }
    if (line.trim() === '\f') { flush(); blocks.push({ page: true }); continue; }
    if (line.trim() === '') { flush(); continue; }
    buf.push(line);
  }
  flush();
  return blocks;
}
