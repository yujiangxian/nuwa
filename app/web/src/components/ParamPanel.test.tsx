import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import ParamPanel from '@/components/ParamPanel';
import { useUIStore } from '@/store/uiStore';
import { CHAT_PARAM_KEYS, DEFAULT_CHAT_GEN_PARAMS } from '@/lib/generationParams';

/**
 * Param_Panel 组件测试（Task 5.5）。
 * Validates: Requirements 1.1, 2.1, 2.3, 3.1, 3.2, 3.3
 */
describe('ParamPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.getState().restoreChatParamDefaults();
    localStorage.clear();
  });

  it('renders a control row for each of the 5 generation params (1.1)', () => {
    render(<ParamPanel />);
    for (const key of CHAT_PARAM_KEYS) {
      expect(screen.getByTestId(`param-row-${key}`)).toBeInTheDocument();
      expect(screen.getByTestId(`param-toggle-${key}`)).toBeInTheDocument();
      expect(screen.getByTestId(`param-slider-${key}`)).toBeInTheDocument();
      expect(screen.getByTestId(`param-number-${key}`)).toBeInTheDocument();
    }
    expect(CHAT_PARAM_KEYS).toHaveLength(5);
  });

  it('provides a Restore_Defaults entry that resets all params (3.1/3.2/3.3)', () => {
    // 先激活一个参数
    useUIStore.getState().setChatParam('temperature', 1.5);
    render(<ParamPanel />);
    expect(useUIStore.getState().chatGenParams.temperature.active).toBe(true);

    fireEvent.click(screen.getByTestId('param-restore-defaults'));
    expect(useUIStore.getState().chatGenParams).toEqual(DEFAULT_CHAT_GEN_PARAMS);
  });

  it('echoes a clamped value when an out-of-range number is entered (2.1)', () => {
    render(<ParamPanel />);
    // 启用 temperature
    fireEvent.click(screen.getByTestId('param-toggle-temperature'));
    const numberInput = screen.getByTestId('param-number-temperature') as HTMLInputElement;
    // 输入越界值 9 → 钳制回显为 2
    fireEvent.change(numberInput, { target: { value: '9' } });
    expect(useUIStore.getState().chatGenParams.temperature.value).toBe(2);
    expect(numberInput.value).toBe('2');
  });

  it('rounds and clamps integer params (topK 250 -> 100) (2.3)', () => {
    render(<ParamPanel />);
    fireEvent.click(screen.getByTestId('param-toggle-topK'));
    const numberInput = screen.getByTestId('param-number-topK') as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: '250' } });
    expect(useUIStore.getState().chatGenParams.topK.value).toBe(100);
  });

  it('Num_Predict 不限制 toggle writes -1 (Unlimited_Length)', () => {
    render(<ParamPanel />);
    fireEvent.click(screen.getByTestId('param-toggle-numPredict'));
    fireEvent.click(screen.getByTestId('param-unlimited-numPredict'));
    expect(useUIStore.getState().chatGenParams.numPredict.value).toBe(-1);
  });

  it('disabling the toggle clears the param to Inactive', () => {
    useUIStore.getState().setChatParam('topP', 0.5);
    render(<ParamPanel />);
    const toggle = screen.getByTestId('param-toggle-topP') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(useUIStore.getState().chatGenParams.topP.active).toBe(false);
  });
});
