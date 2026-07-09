// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';

import { useUIStore } from '@/store/uiStore';

describe('uiStore lastTrimmedCount (context-window-management)', () => {
  beforeEach(() => {
    useUIStore.getState().setLastTrimmedCount(0);
  });

  // Validates: Requirements 7.3, 8.1, 8.3
  it('defaults to 0 and updates via setLastTrimmedCount', () => {
    expect(useUIStore.getState().lastTrimmedCount).toBe(0);
    useUIStore.getState().setLastTrimmedCount(3);
    expect(useUIStore.getState().lastTrimmedCount).toBe(3);
  });

  it('does not disturb existing chat fields', () => {
    const before = useUIStore.getState();
    const messagesRef = before.messages;
    const genParamsRef = before.chatGenParams;
    useUIStore.getState().setLastTrimmedCount(5);
    const after = useUIStore.getState();
    expect(after.messages).toBe(messagesRef);
    expect(after.chatGenParams).toBe(genParamsRef);
    expect(after.lastTrimmedCount).toBe(5);
  });
});
