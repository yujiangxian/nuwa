# Requirements Document

## Introduction

本特性为"女娲 Nuwa"应用的聊天页面（`app/web/src/components/ChatPage.tsx`）引入 Markdown 渲染能力。当前 AI 助手回复与流式占位气泡均以原始纯文本渲染（`<p style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</p>`），缺少结构化展示。

本特性将助手消息内容（含流式进行中内容）渲染为 Markdown：标题、粗体/斜体、有序/无序列表、链接、引用块、行内代码，以及带语言标签和"复制代码"按钮的围栏代码块（语言感知语法高亮）。用户消息保持纯文本。

核心约束：

- **安全第一**：模型输出为不可信内容，渲染后的 HTML 必须经过净化（sanitization），绝不注入可执行 HTML/脚本（XSS 防护）。
- **流式健壮性**：进行中的流式气泡可能包含不完整 Markdown（如未闭合的代码围栏），渲染必须优雅处理而不崩溃或闪烁异常。
- **优雅降级**：若渲染抛出异常，回退展示原始文本而非使整个聊天界面崩溃。
- **零回归**：流式输出、TTS 自动朗读、消息操作（复制/删除/重新生成/编辑）、会话持久化、语音循环、搜索等既有行为全部保持可用；既有"复制"操作仍复制原始 Markdown 源文本。
- **主题一致**：与现有暗色玻璃拟态 UI 一致，复用 CSS 变量（如 `--text-primary`、`--primary`）。
- **前端独立**：仅前端改动，不修改后端，不改动 `/api/chat`、`/api/chat/stream` 契约。

本特性使用 TypeScript，并选用成熟的 npm 生态库实现 Markdown 解析与渲染。

## Glossary

- **Markdown_Renderer**：负责将一段 Markdown 源文本转换为安全的 React 元素树并展示的前端组件/模块。
- **Markdown_Source**：一条消息的原始未渲染文本内容（即 `ChatMessage.content`），作为 Markdown 解析的输入与"复制"操作的输出。
- **Assistant_Message**：角色为 `assistant` 的已定型聊天消息（`ChatMessage` 且 `role === 'assistant'`）。
- **User_Message**：角色为 `user` 的聊天消息（`ChatMessage` 且 `role === 'user'`）。
- **Streaming_Bubble**：流式生成进行中显示的临时气泡，其文本来自本地状态 `streamingContent`（不入 store）。
- **Code_Block**：Markdown 中的围栏代码块（` ``` ` 包裹），可带语言标识符。
- **Inline_Code**：Markdown 中以反引号包裹的行内代码片段。
- **Language_Label**：Code_Block 上展示的编程语言名称标签（来自围栏的语言标识符）。
- **Copy_Code_Button**：每个 Code_Block 上用于将该块代码文本复制到系统剪贴板的按钮。
- **Sanitizer**：对 Markdown 转换出的 HTML/节点树执行净化、移除不安全元素与属性的处理环节。
- **Syntax_Highlighter**：对 Code_Block 内容按语言进行语法着色的处理环节。
- **Render_Failure**：Markdown_Renderer 在解析或渲染过程中抛出的未捕获异常状态。
- **Theme_Variables**：现有暗色玻璃拟态 UI 定义的 CSS 自定义属性集合（如 `--text-primary`、`--text-secondary`、`--primary`、`--border`、`--surface-hover`）。
- **Toast**：界面右侧的瞬时通知（经 `useToastStore` 的 `addToast`），用于成功/失败反馈。

## Requirements

### Requirement 1: 助手消息的 Markdown 渲染

**User Story:** 作为用户，我希望助手的回复以富文本 Markdown 呈现，以便更清晰地阅读标题、列表、强调与代码。

#### Acceptance Criteria

1. WHEN 一条 Assistant_Message 被展示, THE Markdown_Renderer SHALL 将其 Markdown_Source 解析并渲染为对应的 React 元素。
2. THE Markdown_Renderer SHALL 渲染以下 Markdown 构造：标题（`#` 到 `######`）、粗体、斜体、有序列表、无序列表、链接、引用块（blockquote）与 Inline_Code。
3. THE Markdown_Renderer SHALL 将围栏代码块渲染为 Code_Block 元素。
4. WHERE Markdown_Source 包含 GitHub 风格 Markdown（GFM）构造（表格、删除线、任务列表）, THE Markdown_Renderer SHALL 渲染该 GFM 构造。
5. WHEN 一条 Assistant_Message 的 Markdown_Source 为纯文本（不含 Markdown 标记）, THE Markdown_Renderer SHALL 将其展示为普通段落文本。

### Requirement 2: 用户消息保持纯文本

**User Story:** 作为用户，我希望我自己输入的消息按原样显示，以便我看到我实际发送的文本。

#### Acceptance Criteria

1. WHEN 一条 User_Message 被展示, THE Markdown_Renderer SHALL 将其 Markdown_Source 作为纯文本展示并保留换行与空白。
2. THE Markdown_Renderer SHALL NOT 对 User_Message 应用 Markdown 解析。

### Requirement 3: 流式进行中内容的 Markdown 渲染

**User Story:** 作为用户，我希望在助手逐字生成时也能看到 Markdown 实时格式化，以便流式过程与最终结果观感一致。

#### Acceptance Criteria

1. WHILE 流式生成进行中, THE Markdown_Renderer SHALL 将 Streaming_Bubble 的当前 `streamingContent` 解析并渲染为 Markdown。
2. IF Streaming_Bubble 的当前内容包含不完整的 Markdown 构造（例如未闭合的代码围栏或未闭合的强调标记）, THEN THE Markdown_Renderer SHALL 渲染当前可解析的内容且不抛出未捕获异常。
3. WHEN 流式生成完成并定型为 Assistant_Message, THE Markdown_Renderer SHALL 对该定型内容渲染出与流式末帧内容等价的 Markdown 结果。
4. WHILE 流式生成进行中, THE Streaming_Bubble SHALL NOT 展示任何消息操作入口（复制/编辑/重新生成/删除）。

### Requirement 4: HTML 净化与 XSS 安全

**User Story:** 作为用户，我希望不可信的模型输出被安全渲染，以便恶意内容无法在我的浏览器中执行脚本或注入危险元素。

#### Acceptance Criteria

1. THE Sanitizer SHALL 从渲染输出中移除 `<script>`、`<iframe>`、`<object>`、`<embed>` 等可执行或可嵌入元素。
2. THE Sanitizer SHALL 从渲染输出中移除内联事件处理属性（如 `onclick`、`onerror`、`onload`）。
3. WHEN Markdown_Source 包含 `javascript:` 协议的链接或图片地址, THE Sanitizer SHALL 移除或中和该地址，使其不可触发脚本执行。
4. THE Markdown_Renderer SHALL NOT 使用 `dangerouslySetInnerHTML` 注入未经 Sanitizer 处理的 HTML。
5. WHEN Markdown_Source 包含原始 HTML 标签, THE Sanitizer SHALL 仅保留经许可名单允许的安全标签与属性，并移除其余内容。

### Requirement 5: 代码块展示

**User Story:** 作为用户，我希望代码块以等宽字体清晰展示并在过长时可滚动，以便我准确阅读代码。

#### Acceptance Criteria

1. THE Markdown_Renderer SHALL 以等宽（monospace）字体渲染 Code_Block 内容。
2. WHEN Code_Block 的某一行宽度超过容器宽度, THE Code_Block SHALL 提供水平滚动而不破坏聊天气泡布局。
3. WHERE Code_Block 的围栏指定了语言标识符, THE Markdown_Renderer SHALL 在该 Code_Block 上展示对应的 Language_Label。
4. WHERE Code_Block 的围栏指定了 Syntax_Highlighter 支持的语言标识符, THE Syntax_Highlighter SHALL 对该 Code_Block 内容应用语言感知的语法着色。
5. WHERE Code_Block 未指定语言标识符, THE Markdown_Renderer SHALL 渲染该 Code_Block 且不展示 Language_Label。

### Requirement 6: 代码块复制按钮

**User Story:** 作为用户，我希望每个代码块都有复制按钮，以便我一键获取代码而无需手动选择。

#### Acceptance Criteria

1. THE Markdown_Renderer SHALL 为每个 Code_Block 提供一个 Copy_Code_Button。
2. WHEN 用户点击某个 Copy_Code_Button, THE Markdown_Renderer SHALL 将该 Code_Block 的原始代码文本写入系统剪贴板。
3. WHEN 代码文本成功写入剪贴板, THE Markdown_Renderer SHALL 通过该 Copy_Code_Button 的视觉状态或 Toast 给出成功反馈。
4. IF 写入剪贴板失败, THEN THE Markdown_Renderer SHALL 通过该 Copy_Code_Button 的视觉状态或 Toast 给出失败反馈。
5. WHEN Copy_Code_Button 复制代码文本, THE Markdown_Renderer SHALL 复制 Code_Block 的源代码文本且不包含 Language_Label 或语法高亮标记。

### Requirement 7: 链接安全打开

**User Story:** 作为用户，我希望点击 Markdown 中的链接时能在新标签安全打开，以便不丢失当前会话且不暴露引用风险。

#### Acceptance Criteria

1. WHEN Markdown_Renderer 渲染一个链接, THE Markdown_Renderer SHALL 为该链接设置 `target="_blank"`。
2. WHEN Markdown_Renderer 渲染一个链接, THE Markdown_Renderer SHALL 为该链接设置 `rel="noopener noreferrer"`。
3. THE Markdown_Renderer SHALL 仅对 `http`、`https` 与 `mailto` 协议的链接地址保留为可点击链接。

### Requirement 8: 渲染失败的优雅降级

**User Story:** 作为用户，我希望即使某条消息渲染出错也能看到其原始内容，以便聊天界面不会崩溃且信息不丢失。

#### Acceptance Criteria

1. IF Markdown_Renderer 在渲染一条消息时发生 Render_Failure, THEN THE Markdown_Renderer SHALL 展示该消息的原始 Markdown_Source 纯文本。
2. IF 一条消息发生 Render_Failure, THEN THE Markdown_Renderer SHALL 保持聊天页面其余部分可正常交互。
3. WHEN 发生 Render_Failure 并回退为纯文本, THE Markdown_Renderer SHALL 保留 Markdown_Source 的换行与空白。

### Requirement 9: 复制操作复制原始 Markdown 源

**User Story:** 作为用户，我希望消息级"复制"按钮复制原始 Markdown 文本，以便我能在其他支持 Markdown 的地方原样粘贴。

#### Acceptance Criteria

1. WHEN 用户对一条 Assistant_Message 触发既有"复制"操作, THE Markdown_Renderer SHALL 将该消息的 Markdown_Source 原始文本（而非渲染后的 HTML 或纯文本）写入系统剪贴板。
2. THE Markdown_Renderer SHALL 保留既有消息操作（复制、删除、重新生成、编辑）对 Assistant_Message 的可用性不变。

### Requirement 10: 主题一致性

**User Story:** 作为用户，我希望渲染后的 Markdown 与应用暗色玻璃拟态风格一致，以便视觉体验统一。

#### Acceptance Criteria

1. THE Markdown_Renderer SHALL 使用 Theme_Variables 设置渲染文本与元素的颜色。
2. THE Markdown_Renderer SHALL 使用 Theme_Variables 设置链接、Inline_Code 与 Code_Block 的配色，使其与现有暗色 UI 协调。
3. THE Markdown_Renderer SHALL 渲染各 Markdown 元素时保持与现有气泡内边距与间距协调的排版。

### Requirement 11: 既有聊天行为零回归

**User Story:** 作为用户，我希望引入 Markdown 渲染后所有既有聊天功能照常工作，以便我的使用流程不被打断。

#### Acceptance Criteria

1. THE Markdown_Renderer SHALL 保持流式输出逐字更新行为不变。
2. THE Markdown_Renderer SHALL 保持 TTS 自动朗读对定型 Assistant_Message 文本的触发行为不变。
3. WHEN 触发对某条 Assistant_Message 的 TTS 合成, THE Markdown_Renderer SHALL 提供该消息的 Markdown_Source 文本作为合成输入。
4. THE Markdown_Renderer SHALL 保持会话持久化、语音循环与搜索功能行为不变。
5. THE Markdown_Renderer SHALL 保持搜索结果片段的高亮渲染行为不变。

### Requirement 12: 库选型与依赖锁定

**User Story:** 作为开发者，我希望使用成熟、默认安全的 Markdown 库并锁定确切版本，以便构建可复现且安全可靠。

#### Acceptance Criteria

1. THE Markdown_Renderer SHALL 基于默认不使用 `dangerouslySetInnerHTML` 的成熟 React Markdown 库（如 `react-markdown`）实现。
2. THE Markdown_Renderer SHALL 通过 remark/rehype 插件生态实现 GFM 支持、HTML 净化与语法高亮。
3. WHEN 在 `package.json` 中新增 Markdown 相关依赖, THE 依赖项 SHALL 以确切版本号（精确锁定，非范围）声明。
4. THE 新增依赖 SHALL 与项目的 React 19 运行时兼容。
