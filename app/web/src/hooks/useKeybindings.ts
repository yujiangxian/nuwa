// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useEffect } from 'react';
import { useUIStore } from '@/store/uiStore';
import { detectPlatform, eventToKeyCombo, type KeyCombo } from '@/lib/keyCombo';

/**
 * 全局键盘快捷键引擎（Keybinding_Engine，Req 6）。在 App 顶层调用一次。
 *
 * 行为：
 * - 挂载时在 document 注册单个 keydown 监听器（Req 6.1），卸载时移除（Req 6.5）。
 * - 将事件经 eventToKeyCombo(platform) 归一化为 Key_Combo（Req 6.1）。
 * - 与已注册 Keybinding 匹配：相等则触发动作并 preventDefault（Req 6.2, 1.6）。
 *   · mod+k：paletteOpen 为 false 时 openPalette，为 true 时 closePalette（Req 1.1, 1.4）。
 *   · Escape：关闭最上层模态（Command_Palette 优先于 SettingsModal）（Req 1.2, 6.4）。
 * - Editable_Target 守卫：焦点位于 input/textarea/select/contenteditable 且
 *   Key_Combo 不含 ctrl/meta 时，不触发任何动作（Req 6.3）。
 *
 * 监听器仅注册一次（依赖数组为空）；状态/actions 经 useUIStore.getState() 实时读取，避免闭包过期。
 */
export function useKeybindings(): void {
  useEffect(() => {
    const platform = detectPlatform();

    /** 焦点是否落在可编辑控件（Editable_Target，Req 6.3）。 */
    const isEditableTarget = (): boolean => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    /** mod 键：mac 用 meta，其它平台用 ctrl。 */
    const hasModKey = (combo: KeyCombo): boolean =>
      platform === 'mac' ? combo.meta : combo.ctrl;

    const handler = (e: KeyboardEvent): void => {
      const combo = eventToKeyCombo(e, platform);
      const state = useUIStore.getState();

      // Editable_Target 守卫：无 ctrl/meta 修饰的按键不触发任何 Keybinding（Req 6.3）。
      const hasCtrlOrMeta = combo.ctrl || combo.meta;
      if (isEditableTarget() && !hasCtrlOrMeta) {
        return;
      }

      // mod+k：切换面板开关（Req 1.1, 1.4, 1.6, 6.2）。
      if (combo.key === 'k' && hasModKey(combo) && !combo.shift && !combo.alt) {
        e.preventDefault();
        if (state.paletteOpen) {
          state.closePalette();
        } else {
          state.openPalette();
        }
        return;
      }

      // Escape：关闭最上层模态（面板优先于设置，Req 1.2, 6.4）。
      if (combo.key === 'escape' && !hasCtrlOrMeta && !combo.shift && !combo.alt) {
        if (state.paletteOpen) {
          state.closePalette();
        } else if (state.isSettingsOpen) {
          state.setSettingsOpen(false);
        }
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
