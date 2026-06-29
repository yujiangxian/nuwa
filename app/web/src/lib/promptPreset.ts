/**
 * Pure helpers for prompt-preset management.
 *
 * These functions contain no DOM/store/IndexedDB dependencies so they can be
 * exercised directly by property-based tests and reused by both the UI layer
 * and the state layer (uiStore).
 */
import type { PromptPreset } from '@/store/uiStore';

/** Prompt_Preset 的 `title` 允许的最大字符数（UI 层以 input maxLength 强制）。 */
export const TITLE_MAX_LENGTH = 30;
/** Prompt_Preset 的 `content` 允许的最大字符数（UI 层以 textarea maxLength 强制）。 */
export const CONTENT_MAX_LENGTH = 2000;
/** Input_Field 允许容纳的最大字符数（与 Chat_Page textarea maxLength 一致）。 */
export const INPUT_MAX_LENGTH = 2000;

/** 预设字段校验结果。 */
export interface PresetValidation {
  /** title 与 content trim 后均非空为 true。 */
  ok: boolean;
  /** trim 后的 title（ok 时用作落库值）。 */
  title: string;
  /** trim 后的 content（ok 时用作落库值）。 */
  content: string;
}

/**
 * 校验并规范化预设字段：
 * - title 与 content 各自去除首尾空白；
 * - 二者 trim 后均非空 -> { ok: true, title, content }（trim 后值）；
 * - 否则 -> { ok: false, ... }。
 *
 * 注：长度上限由输入控件 maxLength 在 UI 层强制（Req 3.8/3.9），此处只判空。
 *
 * @param rawTitle   用户输入的原始 title
 * @param rawContent 用户输入的原始 content
 */
export function validatePreset(
  rawTitle: string,
  rawContent: string,
): PresetValidation {
  const title = rawTitle.trim();
  const content = rawContent.trim();
  const ok = title.length > 0 && content.length > 0;
  return { ok, title, content };
}

/**
 * 生成在 `existing` 预设集合内唯一的新 id（Req 3.2）。
 *
 * 基于时间戳 + 随机后缀，若意外与现有 id 冲突则重试，保证返回值不在
 * `existing` 中。
 *
 * @param existing 现有预设集合
 */
export function generatePresetId(existing: PromptPreset[]): string {
  const taken = new Set(existing.map((p) => p.id));
  let id = '';
  do {
    id = `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (taken.has(id));
  return id;
}

/** 插入文本构造结果。 */
export interface InsertResult {
  /** 结果长度 ≤ maxLen 为 true；超限为 false（应拒绝插入）。 */
  ok: boolean;
  /** ok 时为写回 Input_Field 的新文本；超限时等于 prev（原文本，不变）。 */
  text: string;
}

/**
 * 由 Input_Field 当前文本 `prev` 与所选预设 `content` 构造 Inserted_Text：
 * - 若 `prev.trim()` 为空 -> 结果文本为 `content`（Req 6.3）；
 * - 否则 -> 结果文本为 `prev + '\n' + content`（Req 6.4）；
 * - 若结果文本码点数 > `maxLen` -> { ok: false, text: prev }（Req 6.5，拒绝且不变）；
 * - 否则 -> { ok: true, text: 结果文本 }。
 *
 * 长度按码点计算（使用 `Array.from`），避免破坏多字节字符。
 *
 * @param prev    Input_Field 当前文本
 * @param content 所选预设的正文
 * @param maxLen  结果文本允许的最大码点数，默认 INPUT_MAX_LENGTH
 */
export function buildInsertedText(
  prev: string,
  content: string,
  maxLen: number = INPUT_MAX_LENGTH,
): InsertResult {
  const target = prev.trim().length === 0 ? content : `${prev}\n${content}`;
  if (Array.from(target).length > maxLen) {
    return { ok: false, text: prev };
  }
  return { ok: true, text: target };
}
