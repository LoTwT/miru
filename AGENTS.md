# miru 工程协作说明

## 产品边界

miru 是一个本地优先、阅读优先的 Markdown 与 PDF 阅读器。它不是编辑器，也不提供账户、云同步、服务端解析或文档代理。实现选择应优先保持安静的阅读体验、浏览器本地处理、离线可用和无障碍能力。

## 项目地图

- `src/App.vue`：应用模式与顶层交互编排；复杂功能优先下沉到 feature composable 或独立组件。
- `src/components/`：阅读器、PDF、本地文库和阅读设置等界面组件。
- `src/features/input/`：粘贴、文件、拖放和 URL 输入流程。
- `src/features/reader/`：Markdown 阅读状态、搜索、书签和渲染编排。
- `src/features/library/`：只存在浏览器中的文库、阅读位置及相关存储。
- `src/features/settings/`：阅读设置、预设、本地字体及持久化。
- `src/lib/markdown/`：把不可信 Markdown 转为安全 HTML 的核心边界。
- `src/lib/theme/`：主题契约、令牌和首屏主题引导脚本。
- `tests/unit/`：Vitest 单元与组件测试；`tests/e2e/`：Playwright 桌面及移动 Chromium 场景。
- `public/` 与 `vite.config.ts`：CSP、静态资源、PWA 清单和 service worker 缓存策略。
- `docs/product/`、`docs/ux/`、`docs/ops/`：产品决策、交互约束和发布手册。

不要直接修改生成目录 `dist/`、依赖目录 `node_modules/` 或测试产物；它们不属于源代码。

## 常用命令

使用仓库声明的 pnpm 版本，不要换用 npm 或 yarn。

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test:unit
pnpm bench:reader
pnpm build
pnpm check:bundle
pnpm check:deploy
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
pnpm test:e2e:cross-browser
```

`pnpm check:bundle` 与 `pnpm check:deploy` 依赖已生成的 `dist/`，因此应在 `pnpm build` 后运行。`pnpm check:deploy` 会复核安全响应头、PWA 产物和 precache 边界，并执行无凭据的 Wrangler dry-run。端到端测试通过 production preview 使用 `dist/`；`pnpm test:e2e` 覆盖完整桌面/移动 Chromium 场景，`pnpm test:e2e:cross-browser` 只覆盖 Firefox/WebKit 核心阅读 smoke。PWA 离线场景保持 Chromium-only。

`pnpm bench:reader` 是手动性能对比工具，不是 CI 时间硬门槛。比较结果时应使用相同机器与运行时，并记录基准输出。

## 隐私、安全与离线不变量

- 文档解析、PDF 阅读、文库和上传字体必须留在浏览器内；不要新增文档上传、服务端代理、遥测、分析、指纹或隐式日志。
- URL 输入只能由用户明确触发，并由浏览器直接按 CORS 规则请求；不得增加绕过 CORS 的后端。内容引用的远程图片必须继续使用受限 scheme、无 referrer 和现有加载策略。
- Markdown 和文档元数据均视为不可信输入。不要绕过或削弱 `src/lib/markdown/` 的净化、链接协议限制、DOMPurify 配置或站点 CSP。需要支持新语法时，同时补充恶意输入回归测试。
- 用户文档、远程 URL 响应和上传字体不得进入共享 PWA precache。文档与偏好只能使用现有的浏览器本地存储边界（IndexedDB / localStorage）；上传字体仍须保存在本地 IndexedDB。
- 应用壳和已打包的关键资源应保持离线可用。可选大字体与 PDF 运行时资源的缓存例外由 `vite.config.ts` 显式管理；修改缓存策略时要验证不会缓存用户内容，也不会破坏离线启动和更新流程。
- 不要提交密钥、令牌、个人路径或生产环境凭据。新增运行时网络来源前必须说明必要性，并同步审查 CSP、隐私文案和离线行为。

## 热点与实现约束

- `App.vue`、`PdfViewer.vue` 和 `ReadingSettingsControl.vue` 是高复杂度热点。新增职责时优先提取 feature composable、纯函数模块或聚焦组件，避免继续扩大顶层文件。
- `useDocumentInput.ts` 是资源与网络输入边界：保持类型/大小限制、可取消请求和可理解的错误信息。
- `renderer.ts` 是安全边界：渲染输出、外链和图片策略的变更必须有单元测试。
- 本地文库、阅读位置、设置和字体都有持久化 schema。schema 变更需要向后兼容迁移测试，不能静默丢弃用户数据。
- `readingThemeBootstrap.ts` 参与首屏内联脚本和 CSP hash。相关改动必须通过 production build；不要手工复制生成 hash。
- Vue 代码使用 TypeScript、Composition API 和 `<script setup>`；组件 props/emit 保持显式类型，跨功能状态优先放在所属 feature 中。
- 新增依赖须说明用途，锁文件与 `package.json` 一起提交；浏览器运行时依赖不得暗中引入外部服务。

## 验证要求

- 纯逻辑或组件改动：至少运行相关测试、`pnpm typecheck` 和 `pnpm test:unit`。
- 入口依赖、路由级组件、样式或构建配置改动：额外运行 `pnpm build && pnpm check:bundle`。
- 输入、阅读流程、PDF、文库、设置、键盘/焦点、响应式布局或 PWA 行为改动：运行相关 Playwright 场景；跨域或浏览器差异无法稳定自动化时，在交付说明中写明手动验证证据。
- CSP、主题首屏脚本、service worker 或缓存规则改动：必须执行完整 production build，检查生成产物，并验证离线与更新路径没有缓存用户内容。
- 修复缺陷时先添加能复现问题的回归测试。不要通过降低断言、跳过测试或放宽 bundle budget 来掩盖回归。
- 交付时列出执行过的命令、结果和未执行检查的原因；不要声称未实际运行的验证已通过。
