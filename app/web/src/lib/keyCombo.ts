/**
 * 按键组合（Key_Combo）的纯逻辑层（command-palette）。
 *
 * 关注点分离（镜像 lib/theme.ts / lib/i18n.ts）：
 * - `parseKeyCombo` / `formatKeyCombo` / `keyComboEquals` / `eventToKeyCombo` 均为无副作用纯函数。
 * - 平台判定经显式参数 `platform` 注入，纯函数不读取 `navigator`/DOM/store。
 * - `detectPlatform` 是唯一读取运行期环境的薄函数，仅供 Hook/组件调用。
 *
 * 本模块不导入 React，不读写 Zustand store，不接触 DOM（除显式的 detectPlatform）。
 * 对相同输入恒返回相同输出。
 */

/** 跨平台判定：'mac' 将 mod 解析为 meta，'other' 解析为 ctrl。显式注入以保持纯函数。 */
export type Platform = 'mac' | 'other';

/** 规范化按键组合。修饰键为布尔标志，key 为规范化后的小写主键名。 */
export interface KeyCombo {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  /** 单个主键，小写（如 'k'、'enter'、'arrowdown'、'/'）。 */
  key: string;
}

/** 修饰键归一标志名。 */
type ModifierFlag = 'ctrl' | 'meta' | 'shift' | 'alt';

/**
 * 将单个 token 归类为修饰键标志，未知或 `mod` 之外返回 null。
 * `mod` 依平台归一为 meta（mac）/ ctrl（other）。
 */
function resolveModifierToken(token: string, platform: Platform): ModifierFlag | null {
  switch (token) {
    case 'ctrl':
    case 'control':
      return 'ctrl';
    case 'meta':
    case 'cmd':
    case 'command':
      return 'meta';
    case 'shift':
      return 'shift';
    case 'alt':
    case 'option':
      return 'alt';
    case 'mod':
      return platform === 'mac' ? 'meta' : 'ctrl';
    default:
      return null;
  }
}

/**
 * 解析 Key_Combo 字符串为 KeyCombo（Req 7.1, 7.6）。无副作用纯函数。
 *
 * 语法：token 以 '+' 连接，忽略大小写与多余空白；末尾恰为单个主键，
 * 其余为修饰键。'mod' 依 platform 归一为 meta（mac）或 ctrl（other）。
 *
 * 返回 null（Req 7.2）当：空串/全空白、缺少主键（仅修饰键）、
 * 含未知 token、出现一个以上主键（重复主键）。
 */
export function parseKeyCombo(input: string, platform: Platform): KeyCombo | null {
  if (typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0) return null;

  // 按 '+' 切分并去掉空段（容忍多余空白，如 ' ctrl + k '）。
  const tokens = normalized
    .split('+')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  const combo: KeyCombo = { ctrl: false, meta: false, shift: false, alt: false, key: '' };
  let primaryCount = 0;

  for (const token of tokens) {
    const modifier = resolveModifierToken(token, platform);
    if (modifier) {
      combo[modifier] = true;
    } else {
      // 非修饰键即视为主键。出现第二个主键即重复主键，非法（Req 7.2）。
      primaryCount += 1;
      if (primaryCount > 1) return null;
      combo.key = token;
    }
  }

  // 缺少主键（仅修饰键）非法（Req 7.2）。
  if (primaryCount !== 1) return null;
  return combo;
}

/**
 * 将 KeyCombo 格式化为规范字符串（Req 7.3）。无副作用纯函数。
 * 固定修饰键顺序：ctrl -> meta -> shift -> alt，最后接主键，以 '+' 连接。
 * 例：{ctrl:true, shift:true, key:'p'} -> "ctrl+shift+p"。
 */
export function formatKeyCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push('ctrl');
  if (combo.meta) parts.push('meta');
  if (combo.shift) parts.push('shift');
  if (combo.alt) parts.push('alt');
  parts.push(combo.key);
  return parts.join('+');
}

/** 结构相等比较（四个修饰标志 + key 全等）。无副作用纯函数。 */
export function keyComboEquals(a: KeyCombo, b: KeyCombo): boolean {
  return (
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.shift === b.shift &&
    a.alt === b.alt &&
    a.key === b.key
  );
}

/**
 * 将 DOM KeyboardEvent 归一化为 KeyCombo（Keybinding_Engine 使用）。无副作用纯函数。
 * 读取 e.ctrlKey/metaKey/shiftKey/altKey 与 e.key（转小写）。platform 显式注入。
 * 注意：本函数仅做纯数据转换，不读取除入参 event 外的任何外部状态。
 */
export function eventToKeyCombo(
  e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'key'>,
  _platform: Platform,
): KeyCombo {
  return {
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key: (e.key ?? '').toLowerCase(),
  };
}

/**
 * 运行期一次性平台探测（仅供 Hook/组件调用，纯函数不依赖它）。
 * 读取 navigator.platform / userAgent 判定 macOS；不可用时回退 'other'。
 */
export function detectPlatform(): Platform {
  try {
    if (typeof navigator !== 'undefined') {
      const haystack = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`.toLowerCase();
      if (haystack.includes('mac')) return 'mac';
    }
  } catch {
    /* ignore — 回退 other */
  }
  return 'other';
}
