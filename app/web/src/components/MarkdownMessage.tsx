// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

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
  source: string;
  streaming?: boolean;
}

const sanitizeSchema = buildSanitizeSchema();
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight, [rehypeSanitize, sanitizeSchema]] as const;

const components: Components = {
  a({ href, children }) {
    if (!href || !isSafeHref(href)) {
      return <span>{children}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },

  code({ node, className, children, ...props }) {
    const language = parseLanguage(className);
    const rawCode = extractCodeText(node);
    const isBlock = language !== undefined || /\r?\n/.test(rawCode);

    if (isBlock) {
      return (
        <CodeBlock language={language} rawCode={rawCode}>
          {children}
        </CodeBlock>
      );
    }

    return (
      <code className="md-inline-code" {...props}>
        {children}
      </code>
    );
  },

  pre({ children }) {
    return <>{children}</>;
  },
};

export default function MarkdownMessage({ source, streaming = false }: MarkdownMessageProps) {
  return (
    <MarkdownErrorBoundary source={source}>
      <div className="md-content" data-streaming={streaming || undefined}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins as never}
          components={components}
        >
          {source}
        </ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
}
