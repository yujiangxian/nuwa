// Feature: markdown-message-rendering
// Markdown 渲染核心组件：组装 react-markdown 插件管线，并把不可信的模型输出
// 渲染为结构化、经净化的 Markdown。
//
// 设计参考：.kiro/specs/markdown-message-rendering/design.md
//   「Components and Interfaces · 2. components/MarkdownMessage.tsx」
//
// 关键设计：
// - 用 MarkdownErrorBoundary 包裹 react-markdown，单条消息渲染失败仅就地回退原文。
// - rehype 插件顺序：先 rehype-highlight 着色，再 rehype-sanitize 净化（最终安全闸门）。
// - react-markdown v9 已移除 code 组件的 inline prop，这里通过「是否含 language-* 类名
//   或代码文本含换行」来区分行内代码与围栏代码块。
// - 围栏代码块路由到 CodeBlock；为避免 <pre><pre> 嵌套，覆写 pre 为透传片段，
//   由 CodeBlock 自行提供 <pre> 容器。
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import {
  isSafeHref,
  parseLanguage,
  extractCodeText,
  buildSanitizeSchema,
} from '@/lib/markdown';
import MarkdownErrorBoundary from '@/components/MarkdownErrorBoundary';
import CodeBlock from '@/components/CodeBlock';

export interface MarkdownMessageProps {
  /** Markdown_Source：消息原始文本（msg.content 或 streamingContent）。 */
  source: string;
  /** 是否为流式进行中内容（仅影响细微样式，不改变解析逻辑）。 */
  streaming?: boolean;
}

// schema 构造为纯函数，组件外构造一次，避免每次渲染重复分配（流式逐字更新高频渲染）。
const sanitizeSchema = buildSanitizeSchema();
const remarkPlugins = [remarkGfm];
// 顺序至关重要：先 rehype-highlight 注入 hljs-* 节点，再 rehype-sanitize 作为最后一道净化闸门。
const rehypePlugins = [rehypeHighlight, [rehypeSanitize, sanitizeSchema]] as const;

/**
 * react-markdown components 覆写表。
 *
 * - a：href 经 isSafeHref 校验，安全则在新标签打开并带 rel；否则降级为纯文本 <span>（Req 7.1-7.3）。
 * - code：行内代码渲染为主题样式 <code>；围栏代码块路由到 CodeBlock（Req 1.x, 5.4）。
 * - pre：透传为片段，避免与 CodeBlock 自带的 <pre> 形成非法嵌套。
 */
const components: Components = {
  a({ href, children }) {
    // 不安全协议（javascript:/data: 等）或缺失 href：降级为纯文本，杜绝可点击链接（Req 7.3）。
    if (!href || !isSafeHref(href)) {
      return <span>{children}</span>;
    }
    // 安全链接：新标签打开并阻断 opener 引用（Req 7.1, 7.2）。
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },

  // react-markdown v9 已移除 inline prop，签名为 ({ node, className, children, ...props })。
  code({ node, className, children, ...props }) {
    const language = parseLanguage(className);
    // 从 hast 节点提取纯源码文本（不含高亮标记），用于复制与换行判定。
    const rawCode = extractCodeText(node);
    // 围栏代码块判定：含 language-* 类名，或源码文本包含换行。
    // 行内代码既无 language-* 类名也通常不含换行。
    const isBlock = language !== undefined || /\r?\n/.test(rawCode);

    if (isBlock) {
      return (
        <CodeBlock language={language} rawCode={rawCode}>
          {children}
        </CodeBlock>
      );
    }

    // 行内代码：主题样式 <code>（样式由 .md-content code 提供，Req 5.4 反向：行内不进 CodeBlock）。
    return (
      <code className="md-inline-code" {...props}>
        {children}
      </code>
    );
  },

  // 围栏代码块由 CodeBlock 自带 <pre>，这里透传避免 <pre><pre> 嵌套。
  pre({ children }) {
    return <>{children}</>;
  },
};

/**
 * 渲染单条 Assistant_Message / 流式内容的 Markdown（Req 1.x, 3.1, 4.4, 5.4, 7.x, 12.1, 12.2）。
 *
 * 整体包裹于 MarkdownErrorBoundary：单条消息渲染抛错时仅就地回退为保留换行的原文，
 * 不影响聊天页面其余部分（Req 8）。
 */
export default function MarkdownMessage({ source, streaming = false }: MarkdownMessageProps) {
  return (
    <MarkdownErrorBoundary source={source}>
      <div className="md-content" data-streaming={streaming || undefined}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          // 类型上 rehype-sanitize 的元组写法与 PluggableList 兼容，断言以满足 TS。
          rehypePlugins={rehypePlugins as never}
          components={components}
        >
          {source}
        </ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
}
