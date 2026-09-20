# 组件库速查（全部经 `GET /api/templates/items` 实测命中）

## 两个 id 别搞混

| 名词 | 例子 | 用途 |
|---|---|---|
| `atom_tpl_id` | `paper-cp:basic/h1` | **请求 matrix 用的身份** |
| `matrix._comp.tplId` | `paper-cp:header/1-txt-normal` | 实例化后的 id |

用 `atom_tpl_id` 取回 matrix 后，**原样落库**，不要改 `_comp.tplId`。

对照关系（容易误判）：

| atom_tpl_id | matrix._comp.tplId |
|---|---|
| `paper-cp:basic/h1` … `h5` | `paper-cp:header/1-txt-normal` |
| `paper-cp:basic/quot` | `paper-cp:layout/row1-r1c1` |
| `paper-cp:basic/split-line` | `paper-cp:other/000-base-line` |
| `paper-cp:image/001-img-center` | `paper-cp:image/img-autowidth` |

## 文本字段名不统一

| 组件 | 文本/内容字段 |
|---|---|
| `header/1-txt-normal`、`basic/h1..h5`、`basic/ul-*`、`basic/ol-*`、`booklet-cp:baseware/txt-only-bg` | 顶层 `txt1.text` |
| `basic/quot` | ⚠️ **不是顶层**。`_comp.tplId` 是 `layout/row1-r1c1`，文本在 `col1.items[0].txt1.text` |
| `basic/split-line` | 无文本，用 `line1` |
| `image/001-img-center` | `img1.src` |
| `video/video-xm` | `vid1.src` |
| `booklet-cp:baseware/cimg-only` | `cimg1` |
| `layout/row1-r1cN` | `col1`…`colN` 是 group，内容放 `colN.items[]` |

autoxiumi 的 `setText()` 会递归找 `txt1`，所以直接传 HTML 即可。

## matrix 形状不统一

多数是对象，但这几个是**数组**：

- `paper-cp:layout/horizontal` → `[{…主容器…}, …]`
- `paper-cp:layout/carousel` → `[{…}, {…}, {…}]`

`normalizeMatrix()` 会取首个元素当容器并清空其内容。

## 实测可用清单

```
文本   paper-cp:header/1-txt-normal
标题   paper-cp:basic/h1 h2 h3 h4 h5
列表   paper-cp:basic/ul-1 ul-2 ol-1 ol-2 ol-3
引用   paper-cp:basic/quot
分割   paper-cp:basic/split-line
图片   paper-cp:image/001-img-center
视频   paper-cp:video/video-xm
布局   paper-cp:layout/row1-r1c1  row1-r1c2  row1-r1c3
       paper-cp:layout/horizontal  vertical  carousel  overlap
       paper-cp:layout/free-canvas  flow-canvas
册子   booklet-cp:baseware/txt-only-bg
       booklet-cp:baseware/cimg-only
```

## 已知 miss（别再试）

```
paper-cp:basic/txt-normal
paper-cp:image/img-autowidth      ← 这是实例化后的 tplId，不是 atom_tpl_id
paper-cp:image/002-img-full
```

## 浏览整个库

```js
// 标签树
const tree = await api.templateTagsTree();
// 按分类 + 关键词搜（21640 条）
const r = await api.listTemplates({ tagCategory: 'paper-cp', q: '图片', limit: 20, page: 0 });
// 批量取完整 matrix
const items = await api.templateItems(['paper-cp:basic/h1', 'paper-cp:image/001-img-center']);
```

## `renderer_accelerate` 要不要带

模板里带一份预渲染 HTML。**实测不带也能正确渲染** —— 渲染器发现缓存缺失会从 JSON 重建。
autoxiumi 默认带上（省一点渲染开销），不是必需。
