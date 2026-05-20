# miru

打开 miru，像翻开一本排版精良的小册子。

miru 是一个浏览器内的 markdown 阅读器。它**不是编辑器**，也不是另一个带很多面板的工具。你把 markdown 放进来，它把文字、代码、表格和图片整理成一个*安静的*阅读界面。

## 输入方式

把一份 markdown 交给 miru 有四种方式：

- **粘贴**一段 markdown 文本
- **拖入**一个 `.md` 文件
- 用**文件选择器**打开本地文档
- 输入一个允许跨域读取的**原始 URL**

这些操作都在浏览器中完成。miru 不把你的文档发到服务器，也不嵌入分析、遥测或指纹脚本——隐私不是设置项，是默认。

## 排版

正文使用适合长文的 serif 字体、约 65 个字符的行宽和舒适的行高。宽屏不会把段落拉得很长，手机上也保持可读。

> 内容是主角。界面只在你需要它时出现。

miru 渲染标准的 [CommonMark](https://commonmark.org) 加上 [GitHub 风格扩展（GFM）](https://github.github.com/gfm/)：表格、任务列表、删除线、自动链接都支持。

### 行内元素

一段文字里可以有**加粗**、*斜体*、`行内代码`、[链接](https://commonmark.org)，以及 ~~删除线~~。它们在阅读流里应当自然，不喧宾夺主。

#### 任务列表

- [x] 渲染 markdown
- [x] 跟随系统深浅色
- [ ] 在 app 内调整字体与行宽（V1）

### 代码

```ts
type ReaderMode = 'calm' | 'focused'

export function openMarkdown(markdown: string): ReaderMode {
  return markdown.trim() ? 'focused' : 'calm'
}
```

### 表格

| 能力 | V0 |
|---|---|
| CommonMark + GFM | 是 |
| Shiki 高亮 | 是 |
| 远程图片 | 自动加载并剥离 referrer |
| 自定义 UI | V1 |

## 现在试试

> **把任意 markdown 交给 miru：**
>
> - **粘贴** — 按 `Cmd+V` / `Ctrl+V`
> - **拖入** — 把 `.md` 文件拖到页面上
> - **打开文件** — 用文件选择器选本地文档
> - **URL** — 在上方输入框粘贴一个原始 markdown 链接

miru 会立即把它变成一份可读的文档。想了解更多，看看 [CommonMark 教程](https://commonmark.org/help/)。
