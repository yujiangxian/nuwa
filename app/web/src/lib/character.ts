// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Pure helpers for character/persona management.
 *
 * These functions contain no DOM/store/IndexedDB dependencies so they can be
 * exercised directly by property-based tests and reused by both the UI layer
 * and the state layer (uiStore).
 */
import type { Character } from '@/store/types';

/** Character `name` 允许的最大字符数（UI 层以 input maxLength 强制上限）。 */
export const NAME_MAX_LENGTH = 20;

/** name 校验结果。 */
export interface NameValidation {
  /** trim 后非空为 true。 */
  ok: boolean;
  /** trim 后的值（ok 时用作落库值；否则为空字符串）。 */
  value: string;
}

/**
 * 校验并规范化角色 name：
 * - 去除首尾空白；
 * - trim 后为空 -> { ok: false, value: '' }；
 * - 否则 -> { ok: true, value: trimmed }。
 *
 * 注：长度上限由输入控件 maxLength 在 UI 层强制（Req 4.7），此处只判空。
 *
 * @param raw 用户输入的原始 name
 */
export function validateName(raw: string): NameValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, value: '' };
  }
  return { ok: true, value: trimmed };
}

/**
 * 生成在 `existing` 角色集合内唯一的新 id。
 *
 * 基于时间戳 + 随机后缀，若意外与现有 id 冲突则重试，保证返回值不在
 * `existing` 中（Req 4.2 集内唯一）。
 *
 * @param existing 现有角色集合
 */
export function generateCharacterId(existing: Character[]): string {
  const taken = new Set(existing.map((c) => c.id));
  let id = '';
  do {
    id = `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (taken.has(id));
  return id;
}

/**
 * 判断是否需要种子初始化：当且仅当持久层读取到的角色集合为空时返回 `true`
 * （Req 2.1）。
 *
 * @param stored 持久层读取到的角色集合
 */
export function needsSeeding(stored: Character[]): boolean {
  return stored.length === 0;
}

/**
 * 删除某角色后计算应当指向的 currentCharacterId。
 *
 * @param chars     删除前的完整角色集合
 * @param removedId 被删除角色 id
 * @param currentId 删除前的 currentCharacterId
 * @returns 删除后仍存在的某个角色 id：
 *   - 若 currentId 不是被删者且仍存在 -> 保持 currentId；
 *   - 若被删者正是 currentId -> 返回剩余集合中的第一个角色 id；
 *   - 剩余集合为空 -> 返回 `null`（由调用方结合「至少保留一个」不变量阻止该情形）。
 */
export function pickNextCurrentId(
  chars: Character[],
  removedId: string,
  currentId: string,
): string | null {
  const remaining = chars.filter((c) => c.id !== removedId);
  if (remaining.length === 0) {
    return null;
  }
  // 当前角色不是被删者且仍存在 -> 保持不变。
  if (currentId !== removedId && remaining.some((c) => c.id === currentId)) {
    return currentId;
  }
  // 被删者即当前角色（或 currentId 已失效）-> 取剩余集合首个。
  return remaining[0].id;
}
