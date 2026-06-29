// Feature: markdown-message-rendering
// 围栏代码块组件：渲染语法高亮后的代码，提供语言标签与「复制代码」按钮。
//
// 设计参考：.kiro/specs/markdown-message-rendering/design.md
//   「Components and Interfaces · 3. components/CodeBlock.tsx」
import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { useToastStore } from '@/store/toastStore';

export interface CodeBlockProps {
  /** 语言标识符（来自围栏 language-X），无则不显示 Language_Label。 */
  language?: string;
  /** 已高亮的子节点（rehype-highlight 产物），用于展示（Req 5.4）。 */
  children: React.ReactNode;
  /** 源代码原始文本（经 extractCodeText 提取），用于复制（Req 6.5）。 */
  rawCode: string;
}

/**
 * 围栏代码块（Req 5.1-5.5, 6.1-6.5）。
 *
 * - <pre><code class="hljs language-x">…</code></pre>，等宽字体、容器水平滚动；
 * - 顶部工具条：有 language 时左侧显示 Language_Label，右侧 Copy_Code_Button；
 * - 点击复制 rawCode 源码：成功切换 Check 图标并发 success Toast，
 *   失败 catch 后发 error Toast；复制内容不含语言标签或高亮标记。
 */
export default function CodeBlock({ language, children, rawCode }: CodeBlockProps) {
  const addToast = useToastStore((s) => s.addToast);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawCode); // Req 6.2：复制源码
      setCopied(true); // Req 6.3：切换 Check 图标
      addToast({ message: '代码已复制', type: 'success' });
      // 短暂展示成功态后恢复 Copy 图标
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast({ message: '复制失败', type: 'error' }); // Req 6.4
    }
  }, [rawCode, addToast]);

  // code 元素 className：固定附加 hljs 与 language-x（有语言时）
  const codeClassName = language ? `hljs language-${language}` : 'hljs';

  return (
    <div
      className="my-3 overflow-hidden rounded-lg"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
    >
      {/* 顶部工具条 */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {/* 左侧：Language_Label（有语言时显示，Req 5.3 / 5.5） */}
        <span
          className="text-xs font-mono select-none"
          style={{ color: 'var(--text-secondary)' }}
        >
          {language ?? ''}
        </span>

        {/* 右侧：Copy_Code_Button */}
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? '已复制' : '复制代码'}
          title={copied ? '已复制' : '复制代码'}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
          style={{ color: copied ? 'var(--primary)' : 'var(--text-secondary)' }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>

      {/* 代码主体：等宽字体 + 水平滚动（Req 5.1, 5.2） */}
      <pre style={{ overflowX: 'auto' }}>
        <code className={codeClassName}>{children}</code>
      </pre>
    </div>
  );
}
