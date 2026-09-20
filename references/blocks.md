# 输入格式

`create.mjs` 接受两种输入：`.md`（走 `markdownToBlocks`）和 `.json`（直接是 spec）。
两者最终都变成同一份 `blocks` 数组，由 `scripts/lib/builder.mjs` 编译成 showData。

## spec 顶层

```json
{
  "type": "paper",
  "title": "作品标题",
  "blocks": [ ... ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | 否 | `paper` / `booklet` / `tablet` / `placard`，默认 `paper`。也可用 `--type` |
| `title` | 否 | 默认 `无标题`，可用 `--title` 覆盖 |
| `blocks` | 是 | 块列表，见下 |

## Markdown 映射

| Markdown | 编译成 |
|---|---|
| `# 标题` | `paper-cp:basic/h1` |
| `## 标题` | `paper-cp:basic/h2` |
| `### 标题` | `paper-cp:basic/h3` |
| 空行分隔的段落 | `paper-cp:header/1-txt-normal` |
| `> 引用` | `paper-cp:basic/quot`（布局型，文本递归写入 `col1.items[0].txt1`） |
| `- 项` | `paper-cp:basic/ul-1` |
| `1. 项` | `paper-cp:basic/ol-1` |
| `---` 或 `***` | `paper-cp:basic/split-line` |
| `![alt](src)` 独占一行 | `paper-cp:image/001-img-center` |
| 单独一行的换页符 `\f` | 分页 |

Markdown 里连续多行会被合成**一个**段落块（`p`），段落内部保留换行。

## JSON blocks

每个块是一个对象，按首个命中的键决定类型：

```json
{ "h1": "一级标题" }
{ "h2": "二级标题" }
{ "h3": "三级标题" }
{ "p": "段落，可含 HTML" }
{ "quote": "引用" }
{ "divider": true }
{ "img": { "src": "https://…", "alt": "说明", "width": 80 } }
{ "img": "./relative/local.png" }
{ "video": "https://…" }
{ "list": ["第一项", "第二项"], "ordered": false }
{ "cols": ["左栏文字", "https://… 裸链接按图片处理"] }
{ "html": "<p style=\"color:#c00\">需要精细控制样式时用</p>" }
{ "page": true }
```

| 键 | 编译成 | 备注 |
|---|---|---|
| `h1` / `h2` / `h3` | `basic/h1..h3` | |
| `p` / `paragraph` | `header/1-txt-normal` | 含标签的 HTML 原样保留，否则按空行包 `<p>` |
| `quote` | `basic/quot` | 文本嵌在布局里，`setText` 会递归找到 |
| `divider` | `basic/split-line` | 无文本 |
| `img` / `image` | `image/001-img-center` | 字符串＝src；对象可带 `alt`、`width`（百分比，写进 `_comp.pose.width`） |
| `video` | `video/video-xm` | 写入 `vid1.src` |
| `list` | `basic/ul-1` 或 `basic/ol-1` | `ordered: true` 走有序；每项包一层 `<p>` |
| `cols` | `layout/row1-r1c1` / `r1c2` / `r1c3` | 按数组长度选列数 |
| `html` | `header/1-txt-normal` | 与 `p` 同组件，但**不做任何包裹**，原样写入 |
| `page` | 分页标记 | 不产生组件；builder 在标记处切页并同步补 `grounds` |

未知键会抛 `不认识的 block`，不会静默丢弃。

## 多栏

`cols` 的长度决定组件：1 列 `row1-r1c1`、2 列 `row1-r1c2`、3 列及以上 `row1-r1c3`。

每栏的值按内容自动判定：**以 `http(s)://` 或 `//` 开头的字符串当图片**，其余当文本。
所以要把 URL 当纯文本显示，用对象形式 `{ "img": … }` 之外的写法，或直接改用 `html` 块。

## 分页

`{ "page": true }`（Markdown 里是单独一行的换页符）切分页面。builder 会：

1. 按标记把组件分组
2. 丢弃末尾的空组
3. 第一组用首屏，其余**克隆首屏**并各补一个 `grounds` 条目

`pages` 与 `grounds` 必须等长，这一步是强制的。

## 本地图片

`img` 是相对或绝对本地路径时，`create.mjs` 调 `uploadImageBase64` 换成站内地址再写入。

- 相对路径按 **spec 文件所在目录**解析，不是 `cwd`
- 只处理 `.png/.jpg/.jpeg/.gif/.webp/.svg`
- 文件不存在或扩展名不符时**原样写入并告警**，不中止

## 模板引用

`markdownToBlocks` 与 `buildFromSpec` 都可单独引用：

```js
import { buildFromSpec, markdownToBlocks } from './lib/builder.mjs';
import { TPL, loadTemplates, setText } from './lib/templates.mjs';

const blocks = markdownToBlocks(md);
const show = await buildFromSpec(api, { type: 'paper', title, blocks });
```
