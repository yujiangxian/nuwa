// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: markdown-message-rendering
// 纯逻辑层：Markdown 渲染所需的无副作用纯函数。
// 抽成纯函数，供 MarkdownMessage / CodeBlock 组件与属性测试共用。
//
// 设计参考：.kiro/specs/markdown-message-rendering/design.md
//   「Components and Interfaces · 1. lib/markdown.ts」
import { defaultSchema } from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';

/** 视为安全可点击的协议白名单（小写比对）。 */
const SAFE_PROTOCOLS = ['http', 'https', 'mailto'] as const;

/**
 * 判定链接/图片地址协议是否安全可点击（Req 4.3, 7.3）。
 *
 * 规则：
 * - 仅 `http`、`https`、`mailto` 协议视为安全；
 * - 无协议的相对地址、锚点（`#...`）、协议相对地址（`//host`）视为安全；
 * - `javascript:`、`data:`、`vbscript:` 等一律拒绝；
 * - 解析失败按不安全处理。
 *
 * 为防御 `java\nscript:` 这类以控制字符/空白拆分协议的绕过手法，
 * 先剥离全部空白与控制字符再解析协议段（与浏览器对 URL 的处理一致）。
 */
export function isSafeHref(href: unknown): boolean {
  if (typeof href !== 'string') return false;
  try {
    // 移除所有空白与 C0/C1 控制字符，避免 `java\tscript:` 之类的协议拆分绕过。
    const normalized = href.replace(/[\u0000-\u0020\u007F-\u009F\s]/g, '');
    if (normalized === '') return true; // 空串视为相对地址，放行
    // 协议段：以字母开头，后接字母/数字/+/-/. ，直到第一个冒号。
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized);
    if (!match) return true; // 无协议（相对路径 / 锚点 / 协议相对）放行
    const scheme = match[1].toLowerCase();
    return (SAFE_PROTOCOLS as readonly string[]).includes(scheme);
  } catch {
    return false;
  }
}

/**
 * 从 code 元素的 className 解析语言标识符（Req 5.3, 5.5）。
 *
 * className 可能是字符串（如 "language-ts hljs"）或字符串数组
 * （hast 中 className 常以 string[] 形式存在）。从中查找 `language-X`
 * 前缀类名并返回 `X`；无则返回 `undefined`。
 */
export function parseLanguage(className: string | string[] | undefined): string | undefined {
  if (!className) return undefined;
  const classes = Array.isArray(className)
    ? className
    : String(className).split(/\s+/);
  for (const cls of classes) {
    const match = /^language-(.+)$/.exec(cls);
    if (match && match[1]) return match[1];
  }
  return undefined;
}

/** hast 节点的最小结构（仅用于文本提取，避免引入完整类型依赖）。 */
interface HastNodeLike {
  type?: string;
  value?: unknown;
  children?: unknown;
}

/**
 * 递归从 hast code 节点提取纯源码文本（Req 6.5）。
 *
 * 仅累积文本节点（`type === 'text'`）的 `value`，跳过元素标签与
 * rehype-highlight 注入的高亮 `<span>` 包裹，从而得到不含
 * Language_Label 或高亮标记的原始源码文本。
 */
export function extractCodeText(node: unknown): string {
  if (node == null) return '';
  // 字符串本身即为文本
  if (typeof node === 'string') return node;
  // 数组：逐个拼接
  if (Array.isArray(node)) {
    return node.map((child) => extractCodeText(child)).join('');
  }
  if (typeof node !== 'object') return '';
  const n = node as HastNodeLike;
  // 文本节点：取其 value
  if (n.type === 'text' && typeof n.value === 'string') {
    return n.value;
  }
  // 其余元素节点：递归其 children
  if (n.children != null) {
    return extractCodeText(n.children);
  }
  return '';
}

/**
 * 构造 rehype-sanitize 的白名单 schema（Req 4.1, 4.2, 4.5）。
 *
 * 基于 `defaultSchema`：
 * - 扩展放行 `code` / `span` 上的 `className`（用于 `hljs-*` 高亮类与 `language-*`）；
 * - 不放行任何脚本/嵌入元素（script/iframe/object/embed 不在白名单中，自然被移除）；
 * - 不放行任何内联事件属性（`on*` 不在白名单中，自然被移除）。
 *
 * defaultSchema 不可变，这里做浅/深拷贝后扩展，避免污染共享对象。
 */
export function buildSanitizeSchema(): Schema {
  const base = defaultSchema;
  const baseAttributes = base.attributes ?? {};

  // 合并某个标签已有的属性白名单与新增的 className 许可。
  type PropertyDefinition = NonNullable<Schema['attributes']>[string][number];
  const withClassName = (tag: string): PropertyDefinition[] => {
    const existing = (baseAttributes[tag] ?? []) as PropertyDefinition[];
    // 去掉已有的 className 条目（可能是 ['className', ...] 受限形式），
    // 改为放行任意 className（hljs-* 高亮类不可预先枚举）。
    const filtered = existing.filter(
      (attr) => !(attr === 'className' || (Array.isArray(attr) && attr[0] === 'className')),
    );
    return [...filtered, 'className'];
  };

  return {
    ...base,
    attributes: {
      ...baseAttributes,
      code: withClassName('code'),
      span: withClassName('span'),
    },
  };
}
