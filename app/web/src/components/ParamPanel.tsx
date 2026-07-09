// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useUIStore } from '@/store/uiStore';
import {
  PARAM_SPECS,
  CHAT_PARAM_KEYS,
  type ChatParamKey,
} from '@/lib/generationParams';
import { RotateCcw } from 'lucide-react';

/** 各参数的中文标签与滑块步进。 */
const PARAM_META: Record<ChatParamKey, { label: string; step: number }> = {
  temperature: { label: '采样温度 (Temperature)', step: 0.05 },
  topP: { label: '核采样 (Top P)', step: 0.01 },
  numPredict: { label: '最大生成长度 (Num Predict)', step: 1 },
  topK: { label: '候选个数 (Top K)', step: 1 },
  repeatPenalty: { label: '重复惩罚 (Repeat Penalty)', step: 0.05 },
};

/**
 * Param_Panel：为每个对话生成参数渲染一行控件（启用开关 + 滑块 + 数值输入），
 * 数值变更经 setChatParam 即时钳制并持久化、回显合法值；关闭开关走 clearChatParam；
 * Num_Predict 额外提供「不限制」(写入 -1)；底部「恢复默认」→ restoreChatParamDefaults。
 *
 * 控件展示的数值始终来自 store 的 chatGenParams[key]，因此越界输入经钳制后回显合法值。
 */
export default function ParamPanel() {
  const chatGenParams = useUIStore((s) => s.chatGenParams);
  const setChatParam = useUIStore((s) => s.setChatParam);
  const clearChatParam = useUIStore((s) => s.clearChatParam);
  const restoreChatParamDefaults = useUIStore((s) => s.restoreChatParamDefaults);

  return (
    <div className="px-4 pb-2" data-testid="param-panel">
      <div className="flex items-center justify-between mb-2">
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: 'var(--text-muted)' }}
        >
          生成参数
        </div>
        <button
          type="button"
          aria-label="恢复默认"
          data-testid="param-restore-defaults"
          onClick={() => restoreChatParamDefaults()}
          className="flex items-center gap-1 text-[11px] rounded-lg px-2 py-1 transition-all"
          style={{
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={11} /> 恢复默认
        </button>
      </div>

      <div className="space-y-3">
        {CHAT_PARAM_KEYS.map((key) => {
          const spec = PARAM_SPECS[key];
          const meta = PARAM_META[key];
          const state = chatGenParams[key];
          const isUnlimited = spec.allowUnlimited && state.value === -1;

          return (
            <div key={key} data-testid={`param-row-${key}`}>
              <div className="flex items-center justify-between mb-1">
                <label
                  className="flex items-center gap-2 text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <input
                    type="checkbox"
                    aria-label={`启用 ${meta.label}`}
                    data-testid={`param-toggle-${key}`}
                    checked={state.active}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setChatParam(key, state.value);
                      } else {
                        clearChatParam(key);
                      }
                    }}
                  />
                  {meta.label}
                </label>
                <input
                  type="number"
                  aria-label={`${meta.label} 数值`}
                  data-testid={`param-number-${key}`}
                  disabled={!state.active}
                  value={state.value}
                  step={meta.step}
                  onChange={(e) => setChatParam(key, Number(e.target.value))}
                  className="w-20 text-xs rounded-md outline-none text-right"
                  style={{
                    padding: '2px 6px',
                    background: 'var(--surface-hover)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    opacity: state.active ? 1 : 0.5,
                  }}
                />
              </div>

              <input
                type="range"
                aria-label={`${meta.label} 滑块`}
                data-testid={`param-slider-${key}`}
                disabled={!state.active || isUnlimited}
                min={spec.min}
                max={spec.max}
                step={meta.step}
                value={isUnlimited ? spec.min : state.value}
                onChange={(e) => setChatParam(key, Number(e.target.value))}
                className="w-full"
                style={{ opacity: state.active && !isUnlimited ? 1 : 0.4 }}
              />

              {spec.allowUnlimited && (
                <label
                  className="flex items-center gap-1.5 text-[11px] mt-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <input
                    type="checkbox"
                    aria-label="不限制生成长度"
                    data-testid={`param-unlimited-${key}`}
                    checked={isUnlimited}
                    onChange={(e) => {
                      // 勾选 → 写入 -1（Unlimited_Length）；取消 → 回到规格默认值。
                      setChatParam(key, e.target.checked ? -1 : spec.default);
                    }}
                  />
                  不限制（Unlimited）
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
