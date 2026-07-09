// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: command-palette — Palette_Store 切片状态迁移测试（任务 3.2）
//
// 直接调用 actions 断言状态迁移（Req 1.2, 1.3, 4.1, 4.2, 4.3）。
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';

describe('uiStore — Palette_Store 切片', () => {
  beforeEach(() => {
    // 重置面板相关状态，避免跨用例污染。
    useUIStore.setState({ paletteOpen: false, paletteQuery: 'stale', highlightIndex: 99 });
  });

  it('openPalette 后 paletteOpen=true && paletteQuery="" && highlightIndex=-1（Req 1.3）', () => {
    useUIStore.getState().openPalette();
    const s = useUIStore.getState();
    expect(s.paletteOpen).toBe(true);
    expect(s.paletteQuery).toBe('');
    expect(s.highlightIndex).toBe(-1);
  });

  it('closePalette 后 paletteOpen=false（Req 1.2）', () => {
    useUIStore.getState().openPalette();
    useUIStore.getState().closePalette();
    expect(useUIStore.getState().paletteOpen).toBe(false);
  });

  it('setPaletteQuery 写入查询文本', () => {
    useUIStore.getState().setPaletteQuery('hello');
    expect(useUIStore.getState().paletteQuery).toBe('hello');
  });

  it('moveHighlight 带回绕移动（Req 4.1, 4.2）', () => {
    useUIStore.setState({ highlightIndex: 2 });
    useUIStore.getState().moveHighlight(1, 3); // 末尾向下回绕到 0
    expect(useUIStore.getState().highlightIndex).toBe(0);
    useUIStore.getState().moveHighlight(-1, 3); // 0 向上回绕到末尾
    expect(useUIStore.getState().highlightIndex).toBe(2);
    useUIStore.getState().moveHighlight(1, 0); // 空列表 -1
    expect(useUIStore.getState().highlightIndex).toBe(-1);
  });

  it('setHighlightIndex 直接设值（Req 4.3）', () => {
    useUIStore.getState().setHighlightIndex(5);
    expect(useUIStore.getState().highlightIndex).toBe(5);
  });
});
