/**
 * autoxiumi · 官方组件取用层
 *
 * 唯一硬约束：**组件必须来自站内模板库**（GET /api/templates/items 的 matrix）。
 * 手写 tplId 不会报错，只会静默渲染成占位图 —— 这是这个平台最坑的失败模式。
 *
 * 两个容易搞混的 id：
 *   - atom_tpl_id：模板库里的身份，用来请求 matrix（如 paper-cp:basic/h1）
 *   - matrix._comp.tplId：实例化后的 id（如 paper-cp:header/1-txt-normal）
 *   落库时**原样使用 matrix**，不要改 tplId。
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveCache } from './config.mjs';

/** 组件缓存的默认目录（分层解析，不写死路径） */
export const defaultCacheDir = () => resolveCache();

/** 语义名 → atom_tpl_id。全部经 /api/templates/items 实测命中。 */
export const TPL = {
  // 文本
  text: 'paper-cp:header/1-txt-normal',
  h1: 'paper-cp:basic/h1',
  h2: 'paper-cp:basic/h2',
  h3: 'paper-cp:basic/h3',
  h4: 'paper-cp:basic/h4',
  h5: 'paper-cp:basic/h5',
  // 列表
  ul1: 'paper-cp:basic/ul-1',
  ul2: 'paper-cp:basic/ul-2',
  ol1: 'paper-cp:basic/ol-1',
  ol2: 'paper-cp:basic/ol-2',
  ol3: 'paper-cp:basic/ol-3',
  // 装饰
  quote: 'paper-cp:basic/quot',
  divider: 'paper-cp:basic/split-line',
  // 媒体
  image: 'paper-cp:image/001-img-center',
  video: 'paper-cp:video/video-xm',
  // 布局
  row1: 'paper-cp:layout/row1-r1c1',
  row1c2: 'paper-cp:layout/row1-r1c2',
  row1c3: 'paper-cp:layout/row1-r1c3',
  horizontal: 'paper-cp:layout/horizontal',
  vertical: 'paper-cp:layout/vertical',
  carousel: 'paper-cp:layout/carousel',
  overlap: 'paper-cp:layout/overlap',
  freeCanvas: 'paper-cp:layout/free-canvas',
  flowCanvas: 'paper-cp:layout/flow-canvas',
  // 册子
  bookletText: 'booklet-cp:baseware/txt-only-bg',
  bookletImage: 'booklet-cp:baseware/cimg-only',
};

/** 这些 id 请求会 miss（实测），列出来避免再次踩坑 */
export const TPL_KNOWN_MISS = ['paper-cp:basic/txt-normal', 'paper-cp:image/img-autowidth', 'paper-cp:image/002-img-full'];

/**
 * 批量拉取 matrix，带磁盘缓存。
 * 只有 cache 里没有的 id 才会再打接口，避免每次创作都拉一遍 20+ 个组件。
 *
 * @param {object} api  Xiumi 客户端实例（已登录），只用其 templateItems 方法
 * @param {string[]} ids
 * @param {{refresh?:boolean, cacheDir?:string}} [opts]
 * @returns {Promise<Record<string, {atom_tpl_id:string, display_name:string, matrix:any, renderer_accelerate?:string}>>}
 */
export async function loadTemplates(api, ids, { refresh = false, cacheDir } = {}) {
  const dir = cacheDir || defaultCacheDir();
  const file = path.join(dir, 'templates.json');
  let cache = {};
  if (!refresh && fs.existsSync(file)) {
    try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = {}; }
  }

  const missing = ids.filter((id) => !cache[id]);
  if (missing.length) {
    const got = await api.templateItems(missing);
    const list = Array.isArray(got) ? got : (got?.templates || got?.items || []);
    for (const t of list) {
      cache[t.atom_tpl_id] = {
        atom_tpl_id: t.atom_tpl_id,
        display_name: t.display_name,
        matrix: t.matrix,
        renderer_accelerate: t.renderer_accelerate || undefined,
      };
    }
    const stillMissing = missing.filter((id) => !cache[id]);
    if (stillMissing.length) {
      throw new Error(
        `这些 atom_tpl_id 在模板库里不存在：\n  ${stillMissing.join('\n  ')}\n` +
        `已在 TPL_KNOWN_MISS 里登记的已知 miss：${TPL_KNOWN_MISS.join(', ')}`
      );
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  }

  const out = {};
  for (const id of ids) out[id] = cache[id];
  return out;
}

/** 深拷贝，断开与缓存的引用 */
export const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * 把 HTML 文本写进组件。
 * 文本可能就在顶层（h1..h5、1-txt-normal），也可能嵌在布局里（quot → col1.items[0].txt1）。
 * @returns {boolean} 是否找到落点
 */
export function setText(comp, html) {
  if (comp && comp.txt1 && typeof comp.txt1 === 'object') {
    comp.txt1.text = html;
    return true;
  }
  for (let i = 1; i <= 8; i++) {
    const col = comp?.[`col${i}`];
    if (col && Array.isArray(col.items)) {
      for (const item of col.items) {
        if (setText(item, html)) return true;
      }
      // 空 group：塞一个文本组件进去
      if (!col.items.length && comp.__textProto) {
        const t = clone(comp.__textProto);
        setText(t, html);
        col.items.push(t);
        return true;
      }
    }
  }
  return false;
}

/** 把「数组型 matrix」（layout/horizontal、carousel）归一成单个对象 */
export function normalizeMatrix(m) {
  if (!Array.isArray(m)) return m;
  // 数组型的第一个元素是主容器，其余是内容，这里只取主容器并清空其内容
  const head = clone(m[0]);
  for (let i = 1; i <= 8; i++) {
    if (head[`col${i}`] && Array.isArray(head[`col${i}`].items)) head[`col${i}`].items = [];
  }
  return head;
}

/** 生成符合站内格式的 uuid（编辑器用的是这种 8-4-4-4-12 形态） */
export function uuid() {
  const h = '0123456789abcdef';
  const seg = (n) => Array.from({ length: n }, () => h[(Math.random() * 16) | 0]).join('');
  return `${seg(8)}-${seg(4)}-4${seg(3)}-a${seg(3)}-${seg(12)}`;
}

/** 给组件补 uuid（站内每个组件和子项都带 _$uuid） */
export function ensureUuid(comp) {
  if (!comp || typeof comp !== 'object') return comp;
  if (Array.isArray(comp)) { comp.forEach(ensureUuid); return comp; }
  if (comp._comp) {
    comp._comp._$uuid = comp._comp._$uuid || uuid();
    ensureUuid(comp._comp);
  }
  if (comp.txt1) comp.txt1._$uuid = comp.txt1._$uuid || uuid();
  if (comp.img1) comp.img1._$uuid = comp.img1._$uuid || uuid();
  if (comp.vid1) comp.vid1._$uuid = comp.vid1._$uuid || uuid();
  if (comp.line1) comp.line1._$uuid = comp.line1._$uuid || uuid();
  for (let i = 1; i <= 8; i++) {
    const col = comp[`col${i}`];
    if (col) {
      col._$uuid = col._$uuid || uuid();
      if (Array.isArray(col.items)) col.items.forEach(ensureUuid);
    }
  }
  return comp;
}
