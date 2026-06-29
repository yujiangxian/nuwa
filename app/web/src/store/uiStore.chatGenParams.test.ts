import { describe, it, expect, beforeEach } from 'vitest';

import { useUIStore } from '@/store/uiStore';
import {
  DEFAULT_CHAT_GEN_PARAMS,
  CHAT_GEN_PARAMS_STORAGE_KEY,
  loadChatGenParams,
} from '@/lib/generationParams';

/**
 * Chat_Store 的对话生成参数动作单元测试（Task 5.2）。
 * Validates: Requirements 1.2, 1.3, 3.2, 3.3
 */
describe('uiStore chat generation params actions', () => {
  beforeEach(() => {
    localStorage.clear();
    // 重置为 Default_State，隔离每个用例。
    useUIStore.getState().restoreChatParamDefaults();
    localStorage.clear();
  });

  it('setChatParam marks Active, records clamped value, and persists (1.2/1.3)', () => {
    // 越界输入 9 应钳制到 temperature 上界 2。
    useUIStore.getState().setChatParam('temperature', 9);
    const state = useUIStore.getState().chatGenParams.temperature;
    expect(state.active).toBe(true);
    expect(state.value).toBe(2);

    // 已持久化：从 localStorage 恢复得到相同结果。
    expect(localStorage.getItem(CHAT_GEN_PARAMS_STORAGE_KEY)).not.toBeNull();
    expect(loadChatGenParams().temperature).toEqual({ active: true, value: 2 });
  });

  it('setChatParam rounds integer params (topK 3.7 -> 4)', () => {
    useUIStore.getState().setChatParam('topK', 3.7);
    expect(useUIStore.getState().chatGenParams.topK).toEqual({ active: true, value: 4 });
  });

  it('clearChatParam sets the param Inactive and persists', () => {
    useUIStore.getState().setChatParam('topP', 0.5);
    expect(useUIStore.getState().chatGenParams.topP.active).toBe(true);

    useUIStore.getState().clearChatParam('topP');
    expect(useUIStore.getState().chatGenParams.topP.active).toBe(false);
    expect(loadChatGenParams().topP.active).toBe(false);
  });

  it('restoreChatParamDefaults resets all to Default_State and persists (3.2/3.3)', () => {
    useUIStore.getState().setChatParam('temperature', 1.5);
    useUIStore.getState().setChatParam('topK', 50);

    useUIStore.getState().restoreChatParamDefaults();
    expect(useUIStore.getState().chatGenParams).toEqual(DEFAULT_CHAT_GEN_PARAMS);
    expect(loadChatGenParams()).toEqual(DEFAULT_CHAT_GEN_PARAMS);
  });
});
