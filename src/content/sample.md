# miru

打开 miru，像翻开一本排版精良的小册子。

miru 是一个浏览器内的 markdown 阅读器。它**不是编辑器**，也不是另一个带很多面板的工具。你把 markdown 放进来，它把文字、代码、表格和图片整理成一个*安静的*阅读界面。

> 点主标题左边的小三角，可以把整篇样例折起来 —— 先看结构，再展开细读。

## 输入方式

把一份 markdown 交给 miru 有四种方式：

- **粘贴**一段 markdown 文本（全局 `Cmd+V` / `Ctrl+V`，或顶部 `⋯` 菜单）
- **拖入**一个 `.md` 文件
- 用顶部 `⋯` 菜单的**打开文件**选择本地文档
- 在顶部 `⋯` 菜单输入一个允许跨域读取的**原始 URL**

## 排版与阅读

正文使用适合长文的 serif 字体、约 65 个字符的行宽和舒适的行距。宽屏不会把段落拉得很长，手机上也保持可读。

> 内容是主角。界面只在你需要它时出现。

点右上角的 `aA`，可以按自己的眼睛调**字号、行宽、行距、主题（浅 / 深 / sepia / 跟随系统）和正文字体**——设置只存在本机，刷新仍在。

miru 渲染标准的 [CommonMark](https://commonmark.org) 加上 [GitHub 风格扩展（GFM）](https://github.github.com/gfm/)。

### 行内元素

一段文字里可以有**加粗**、*斜体*、`行内代码`、[链接](https://commonmark.org)，以及 ~~删除线~~。它们在阅读流里自然，不喧宾夺主。

### 任务列表

- [x] 渲染 CommonMark + GFM
- [x] 跟随系统深浅色 + 阅读定制
- [x] 点标题折叠章节

### 代码

```ts
type ReaderMode = 'calm' | 'focused'

export function openMarkdown(markdown: string): ReaderMode {
  return markdown.trim() ? 'focused' : 'calm'
}
```

### 表格

| 能力 | 状态 |
|---|---|
| CommonMark + GFM | 是 |
| Shiki 代码高亮 | 是 |
| 远程图片 | 自动加载并剥离 referrer |
| 阅读定制（字号 / 行宽 / 主题…） | 是 |
| 标题折叠 | 是 |

## 隐私

miru 的所有处理都在你的浏览器里完成。它**不把你的文档发到服务器**，也不嵌入分析、遥测或指纹脚本——隐私不是设置项，是默认。

你的阅读偏好只存在本机 `localStorage`，不上传、不跨设备同步。

## 现在试试

把任意 markdown 交给 miru：粘贴、拖入、打开文件、或在顶部 `⋯` 里贴一个原始 URL。miru 会立即把它变成一份可读的文档。想了解更多，看看 [CommonMark 教程](https://commonmark.org/help/)。
