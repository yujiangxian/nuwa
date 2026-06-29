import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useUIStore } from './uiStore';

/**
 * Property 5：主题设置持久化往返一致。
 *
 * 复用既有 useUIStore.updateSetting（内部 saveSettings → localStorage 键 nuwa_settings）
 * 作为持久化机制，不新增独立存储。往返读取通过解析持久化后的 localStorage 内容完成
 * （等价于 loadSettings 的读取路径：JSON.parse 后合并）。
 */
describe('主题设置持久化往返 — 属性测试', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Feature: appearance-theme-mode, Property 5: 主题设置持久化往返一致
  it('Property 5: theme 往返相等且不影响其余既有字段', () => {
    fc.assert(
      fc.property(fc.constantFrom<'dark' | 'light' | 'system'>('dark', 'light', 'system'), (theme) => {
        // 记录更新前的既有四字段，作为「不变」基准。
        const before = useUIStore.getState().settings;
        const baseline = {
          backendUrl: before.backendUrl,
          modelsDir: before.modelsDir,
          autoPlay: before.autoPlay,
          language: before.language,
        };

        // 经既有持久化机制保存。
        useUIStore.getState().updateSetting('theme', theme);

        // 往返读取：从持久化的 localStorage 解析（loadSettings 读取路径）。
        const raw = localStorage.getItem('nuwa_settings');
        expect(raw).not.toBeNull();
        const persisted = JSON.parse(raw as string);

        // 往返一致：theme 等于保存值。
        expect(persisted.theme).toBe(theme);
        // 内存 store 也应反映该值。
        expect(useUIStore.getState().settings.theme).toBe(theme);

        // 既有四字段不变（Req 7.1/7.2）。
        expect(persisted.backendUrl).toBe(baseline.backendUrl);
        expect(persisted.modelsDir).toBe(baseline.modelsDir);
        expect(persisted.autoPlay).toBe(baseline.autoPlay);
        expect(persisted.language).toBe(baseline.language);
      }),
      { numRuns: 100 },
    );
  });
});
