# Implementation Plan: Markdown 消息渲染

## Overview

本计划将设计落地为可增量执行的编码任务，目标是在 `app/web`（React 19 + TypeScript + Vite）聊天页面引入安全的 Markdown 渲染。实现顺序遵循"纯逻辑层先行 → 组件自底向上 → 集成进 ChatPage → 验证"的策略：

1. 锁定渲染依赖（react-markdown / remark-gfm / rehype-highlight / rehype-sanitize，精确版本）。
2. 实现可测试的纯逻辑 `lib/markdown.ts`（链接协议判定、语言解析、代码文本提取、净化 schema）。
3. 自底向上构建组件：`MarkdownErrorBoundary` → `CodeBlock` → `MarkdownMessage`，并新增 `styles/markdown.css`。
4. 将 `MarkdownMessage` 集成进 `ChatPage.tsx`（assistant 定型消息与流式气泡复用同一渲染路径，user 消息保持纯文本）。
5. 通过属性测试（每条 Correctness Property 一个独立子任务，复用既有 `fast-check`）与单元/回归测试验证。

每个任务都基于前序任务构建，最终在 ChatPage 中接线，无悬空代码。测试子任务以 `*` 标注为可选。

## Tasks

- [x] 1. 锁定 Markdown 渲染依赖
  - 在 `app/web/package.json` 的 `dependencies` 中以精确版本（非 `^`/`~`）新增：`react-markdown` `9.0.1`、`remark-gfm` `4.0.0`、`rehype-highlight` `7.0.0`、`rehype-sanitize` `6.0.0`
  - 运行 `npm --prefix app/web install` 生成锁定的 `package-lock.json`，确认与 React 19 运行时兼容（`highlight.js` 作为 `rehype-highlight` 传递依赖引入，不引入其内置主题）
  - 不引入 `rehype-raw`
  - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 2. 实现 `lib/markdown.ts` 纯逻辑层
  - [x] 2.1 实现纯函数 `isSafeHref` / `parseLanguage` / `extractCodeText` / `buildSanitizeSchema`
    - 新建 `app/web/src/lib/markdown.ts`，文件首行加注释 `// Feature: markdown-message-rendering`
    - `isSafeHref(href)`：解析协议段并小写比对 `['http','https','mailto']`；无协议（相对/锚点 `#`）放行；`javascript:`/`data:`/`vbscript:` 等及解析失败返回 `false`
    - `parseLanguage(className)`：从 `language-X` 前缀类名解析语言标识符 `X`，无则返回 `undefined`
    - `extractCodeText(node)`：递归从 hast code 节点提取纯源码文本（不含 Language_Label 或高亮标记）
    - `buildSanitizeSchema()`：基于 `defaultSchema` 扩展放行 `code`/`span` 上的 `className`（用于 `hljs-*`），不放行任何脚本/嵌入元素与内联事件属性
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 5.3, 5.5, 6.5, 7.3_

  - [x]* 2.2 属性测试：链接协议安全判定
    - 新建 `app/web/src/lib/markdown.isSafeHref.test.ts`
    - **Property 6: 链接协议安全判定**
    - **Validates: Requirements 4.3, 7.3**

  - [x]* 2.3 属性测试：语言标签解析
    - 新建 `app/web/src/lib/markdown.parseLanguage.test.ts`
    - **Property 7: 语言标签解析**
    - **Validates: Requirements 5.3, 5.5**

  - [x]* 2.4 属性测试：代码复制源文本提取（round-trip）
    - 新建 `app/web/src/lib/markdown.extractCodeText.test.ts`
    - **Property 8: 代码复制源文本提取（round-trip）**
    - **Validates: Requirements 6.5**

  - [x]* 2.5 单元测试：净化 schema 白名单
    - 新建 `app/web/src/lib/markdown.schema.test.ts`
    - 断言 `buildSanitizeSchema()` 不放行 `script`/`iframe`/`object`/`embed` 与 `on*` 事件属性，放行 `hljs-*` className
    - _Requirements: 4.1, 4.2, 4.5_

- [x] 3. 实现 `MarkdownErrorBoundary`（每条消息独立错误边界）
  - [x] 3.1 实现 class 错误边界组件
    - 新建 `app/web/src/components/MarkdownErrorBoundary.tsx`
    - `getDerivedStateFromError` 置 `hasError`；错误态渲染 `<p style={{ whiteSpace: 'pre-wrap' }}>{source}</p>`，颜色用 `var(--text-primary)`
    - `componentDidUpdate` 中比较 `prevProps.source`，变化时重置 `hasError`（支持流式逐字重试）
    - _Requirements: 8.1, 8.2, 8.3_

  - [x]* 3.2 属性测试：渲染失败回退保留原文与空白
    - 新建 `app/web/src/components/MarkdownErrorBoundary.test.tsx`
    - **Property 9: 渲染失败回退保留原文与空白**
    - **Validates: Requirements 8.3**

  - [x]* 3.3 单元测试：错误隔离
    - 新建 `app/web/src/components/MarkdownErrorBoundary.isolation.test.tsx`
    - 注入抛错子组件，断言回退显示原文且边界外的兄弟元素仍正常渲染/交互
    - _Requirements: 8.1, 8.2_

- [x] 4. 实现 `CodeBlock`（围栏代码块 + 复制按钮）
  - [x] 4.1 实现 CodeBlock 组件
    - 新建 `app/web/src/components/CodeBlock.tsx`
    - 渲染 `<pre><code class="hljs language-x">…</code></pre>`，等宽字体、容器 `overflow-x: auto`
    - 顶部工具条：有 `language` 时左侧显示 Language_Label，右侧 `Copy_Code_Button`（复用 lucide `Copy`/`Check` 图标）
    - 点击复制：`navigator.clipboard.writeText(rawCode)`，成功切换 `Check` 图标并可发 success Toast，失败 `catch` 后发 error Toast（复用 `useToastStore`）；复制内容为 `rawCode` 源码，不含标签/高亮标记
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 4.2 单元测试：复制按钮与语言标签
    - 新建 `app/web/src/components/CodeBlock.test.tsx`
    - mock `navigator.clipboard.writeText`：验证点击调用、成功图标切换/Toast、失败（reject）Toast；多代码块按钮数匹配；有/无语言时 Language_Label 显示/隐藏；断言容器具 monospace 与 `overflow-x: auto`
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 6.1, 6.2, 6.3, 6.4_

- [x] 5. 新增主题样式 `styles/markdown.css`
  - 新建 `app/web/src/styles/markdown.css`，作用域 `.md-content`
  - 标题/段落/列表/引用块/表格/链接/行内代码/代码块的颜色引用 `Theme_Variables`（`--text-primary`、`--text-secondary`、`--primary`、`--border`、`--surface-hover` 等）
  - 将 `hljs-*` 高亮类映射到自定义暗色配色（不引入第三方 highlight.js 主题）；排版间距与现有气泡 `px-5 py-3.5` 内边距协调
  - 在 `MarkdownMessage` 或 `main.tsx` 引入该样式
  - _Requirements: 10.1, 10.2, 10.3_

- [x] 6. 实现 `MarkdownMessage`（渲染核心，组装管线）
  - [x] 6.1 实现 MarkdownMessage 组件与插件管线
    - 新建 `app/web/src/components/MarkdownMessage.tsx`
    - 用 `MarkdownErrorBoundary` 包裹 `react-markdown`；配置 `remarkPlugins: [remark-gfm]`、`rehypePlugins: [rehype-highlight, [rehype-sanitize, buildSanitizeSchema()]]`（顺序：先高亮后净化）
    - `components` 覆写 `a`：`href` 经 `isSafeHref` 校验，安全则输出 `target="_blank" rel="noopener noreferrer"`，否则降级为 `<span>`
    - `components` 覆写 `code`：行内代码渲染为主题样式 `<code>`，围栏代码块路由到 `CodeBlock`（用 `parseLanguage` 取语言、`extractCodeText` 取 `rawCode`）
    - 容器加 `className="md-content"`；`streaming` prop 仅影响细微样式，不改变解析逻辑
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 4.4, 5.4, 7.1, 7.2, 7.3, 12.1, 12.2_

  - [x]* 6.2 属性测试：纯文本语义保留
    - 新建 `app/web/src/components/MarkdownMessage.plaintext.test.tsx`
    - **Property 1: 纯文本语义保留**
    - **Validates: Requirements 1.5**

  - [x]* 6.3 属性测试：流式与定型渲染等价
    - 新建 `app/web/src/components/MarkdownMessage.equivalence.test.tsx`
    - **Property 3: 流式与定型渲染等价**
    - **Validates: Requirements 3.3**

  - [x]* 6.4 属性测试：危险元素与内联事件属性净化
    - 新建 `app/web/src/components/MarkdownMessage.sanitize.test.tsx`
    - **Property 4: 危险元素与内联事件属性净化**
    - **Validates: Requirements 4.1, 4.2, 4.5**

  - [x]* 6.5 属性测试：安全链接渲染
    - 新建 `app/web/src/components/MarkdownMessage.links.test.tsx`
    - **Property 5: 安全链接渲染**
    - **Validates: Requirements 7.1, 7.2**

  - [x]* 6.6 属性测试：不完整 Markdown 渲染健壮性
    - 新建 `app/web/src/components/MarkdownMessage.incomplete.test.tsx`
    - **Property 11: 不完整 Markdown 渲染健壮性**
    - **Validates: Requirements 3.2**

  - [x]* 6.7 单元测试：各 Markdown 构造渲染
    - 新建 `app/web/src/components/MarkdownMessage.render.test.tsx`
    - 标题/粗体斜体/有序无序列表/链接/引用块/行内代码/围栏代码块/GFM 表格·删除线·任务列表各一例，断言生成对应标签；带语言围栏断言出现 `hljs` 高亮节点
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 5.4_

- [x] 7. 集成进 `ChatPage.tsx` 并接线
  - [x] 7.1 将 MarkdownMessage 接入聊天渲染路径
    - 修改 `app/web/src/components/ChatPage.tsx`
    - assistant 定型消息：将 `<p whiteSpace:pre-wrap>{msg.content}</p>` 替换为 `<MarkdownMessage source={msg.content} />`，气泡内边距/播放按钮/`renderMessageActions` 保持不变
    - 流式气泡：`streamingContent.length > 0` 分支替换为 `<MarkdownMessage source={streamingContent} streaming />`，光标 `▍` 作为兄弟元素保留；"正在思考..."占位分支不变；流式气泡仍不渲染任何消息操作入口
    - user 消息分支、`handleCopy(msg.content)`、`speakMessage(msg.content)`、`renderHighlightedSnippet` 均不改动
    - _Requirements: 1.1, 2.1, 2.2, 3.1, 3.4, 11.1_

  - [x]* 7.2 属性测试：User_Message 不被 Markdown 解析
    - 新建 `app/web/src/components/ChatPage.userPlaintext.test.tsx`
    - **Property 2: User_Message 不被 Markdown 解析**
    - **Validates: Requirements 2.1, 2.2**

  - [x]* 7.3 属性测试：消息级复制复制原始 Markdown 源
    - 新建 `app/web/src/components/ChatPage.copySource.test.tsx`
    - **Property 10: 消息级复制复制原始 Markdown 源**
    - **Validates: Requirements 9.1**

  - [x]* 7.4 单元/回归测试：流式无操作入口与既有行为
    - 新建 `app/web/src/components/ChatPage.markdown.test.tsx`
    - 断言流式态无 `message-actions` testid；assistant 四操作（复制/删除/重新生成/编辑）可用性不变；`speakMessage` 调用 `synthesize` 时 `text === msg.content`
    - _Requirements: 3.4, 9.2, 11.2, 11.3_

- [x] 8. 最终检查点
  - 运行 `npm --prefix app/web run test` 确认含属性测试在内的全套测试通过（每条属性最少 100 次迭代）
  - 运行 `npm --prefix app/web run build` 验证类型检查与构建（React 19 兼容）
  - 确认未引入 `rehype-raw`、未使用 `dangerouslySetInnerHTML`，既有 `streamChat`/`uiStore.*`/`chatSearch` 测试保持全绿
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标注 `*` 的子任务为可选测试任务，可为加速 MVP 跳过；核心实现任务不可跳过。
- 每条 Correctness Property 由单个独立属性测试子任务实现，并标注属性编号与所验证的需求条款。
- 属性测试复用项目既有 `fast-check@3.23.2`，渲染层属性使用 `@testing-library/react` + `jsdom`，纯逻辑属性直接对 `lib/markdown.ts` 函数断言；测试文件以 `// Feature: markdown-message-rendering, Property {number}: {property_text}` 注释标注。
- 各属性测试拆分为独立文件，以便在同一波次并行执行且避免写文件冲突。
- 检查点确保增量验证；本特性仅前端改动，不修改后端契约。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "5.1"] },
    { "id": 1, "tasks": ["2.1", "3.2", "3.3"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "4.1"] },
    { "id": 3, "tasks": ["4.2", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "7.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.4"] }
  ]
}
```
