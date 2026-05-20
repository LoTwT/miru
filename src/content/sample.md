# miru

打开 miru，像翻开一本排版精良的小册子。

miru 是一个浏览器内的 markdown 阅读器。它不是编辑器，也不是另一个带很多面板的工具。你把 markdown 放进来，它把文字、代码、表格和图片整理成一个安静的阅读界面。

## 输入方式

- 粘贴一段 markdown
- 拖入一个 `.md` 文件
- 用文件选择器打开本地文档
- 输入一个允许跨域读取的原始 URL

这些操作都在浏览器中完成。miru 不把你的文档发到服务器，也不嵌入分析、遥测或指纹脚本。

## 排版

正文使用适合长文的 serif 字体、约 65 个字符的行宽和舒适的行高。宽屏不会把段落拉得很长，手机上也保持可读。

> 内容是主角。界面只在你需要它时出现。

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

复制一段 markdown，按 `Cmd+V` / `Ctrl+V`，或者拖入一个 `.md` 文件。miru 会立即把它变成可读的文档。
