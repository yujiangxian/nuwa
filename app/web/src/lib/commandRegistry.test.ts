// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: command-palette — Command_Registry builder 单元测试（任务 4.2，Req 2, 5）
import { describe, it, expect, vi } from 'vitest';
import { buildCommandRegistry, type CommandRegistryContext } from './commandRegistry';
import { SUPPORTED_LOCALES, LOCALE_LABELS } from '@/lib/i18n';
import { parseKeyCombo, formatKeyCombo } from '@/lib/keyCombo';
import type { AppPage } from '@/store/types';

function makeCtx(overrides: Partial<CommandRegistryContext> = {}): {
  ctx: CommandRegistryContext;
  setPage: ReturnType<typeof vi.fn>;
  setSettingsOpen: ReturnType<typeof vi.fn>;
  updateSetting: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
} {
  const setPage = vi.fn();
  const setSettingsOpen = vi.fn();
  const updateSetting = vi.fn();
  const createSession = vi.fn();
  const ctx: CommandRegistryContext = {
    setPage,
    setSettingsOpen,
    updateSetting,
    createSession,
    currentCharacterId: 'assistant',
    platform: 'other',
    ...overrides,
  };
  return { ctx, setPage, setSettingsOpen, updateSetting, createSession };
}

describe('buildCommandRegistry — 结构', () => {
  it('每项含 id/title/keywords/group/run（Req 2.1）', () => {
    const { ctx } = makeCtx();
    const items = buildCommandRegistry(ctx);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.title).toBe('string');
      expect(Array.isArray(item.keywords)).toBe(true);
      expect(['navigation', 'settings', 'appearance', 'session']).toContain(item.group);
      expect(typeof item.run).toBe('function');
    }
  });

  it('7 个 App_Page 各有导航命令（Req 2.2）', () => {
    const { ctx } = makeCtx();
    const items = buildCommandRegistry(ctx);
    const pages: AppPage[] = ['home', 'chat', 'voice', 'transcribe', 'models', 'characters', 'presets'];
    for (const page of pages) {
      expect(items.some((i) => i.id === `nav.${page}` && i.group === 'navigation')).toBe(true);
    }
  });

  it('存在打开设置、3 个主题、每个 SUPPORTED_LOCALES 一个语言命令、新建会话命令（Req 2.3-2.6）', () => {
    const { ctx } = makeCtx();
    const items = buildCommandRegistry(ctx);
    expect(items.some((i) => i.id === 'settings.open')).toBe(true);
    for (const theme of ['dark', 'light', 'system']) {
      expect(items.some((i) => i.id === `theme.${theme}`)).toBe(true);
    }
    for (const code of SUPPORTED_LOCALES) {
      expect(items.some((i) => i.id === `locale.${code}`)).toBe(true);
    }
    expect(items.some((i) => i.id === 'session.new')).toBe(true);
  });

  it('id 唯一（Req 2.7）', () => {
    const { ctx } = makeCtx();
    const items = buildCommandRegistry(ctx);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(items.length);
  });

  it('带 combo 的命令其 combo === formatKeyCombo(parseKeyCombo(src, platform))（Req 2.8）', () => {
    const { ctx } = makeCtx({ platform: 'mac' });
    const items = buildCommandRegistry(ctx);
    const session = items.find((i) => i.id === 'session.new');
    expect(session?.combo).toBe(formatKeyCombo(parseKeyCombo('mod+n', 'mac')!));
    // mac 下 mod -> meta。
    expect(session?.combo).toBe('meta+n');
  });
});

describe('buildCommandRegistry — run 副作用接线', () => {
  it('导航命令 run 调用 setPage（Req 5.1）', () => {
    const { ctx, setPage } = makeCtx();
    const items = buildCommandRegistry(ctx);
    items.find((i) => i.id === 'nav.models')!.run();
    expect(setPage).toHaveBeenCalledWith('models');
  });

  it('打开设置 run 调用 setSettingsOpen(true)（Req 5.2）', () => {
    const { ctx, setSettingsOpen } = makeCtx();
    const items = buildCommandRegistry(ctx);
    items.find((i) => i.id === 'settings.open')!.run();
    expect(setSettingsOpen).toHaveBeenCalledWith(true);
  });

  it('主题 run 调用 updateSetting("theme", value)（Req 5.3）', () => {
    const { ctx, updateSetting } = makeCtx();
    const items = buildCommandRegistry(ctx);
    items.find((i) => i.id === 'theme.light')!.run();
    expect(updateSetting).toHaveBeenCalledWith('theme', 'light');
  });

  it('语言 run 调用 updateSetting("language", LOCALE_LABELS[code])（Req 5.4）', () => {
    const { ctx, updateSetting } = makeCtx();
    const items = buildCommandRegistry(ctx);
    items.find((i) => i.id === 'locale.en')!.run();
    expect(updateSetting).toHaveBeenCalledWith('language', LOCALE_LABELS.en);
  });

  it('新建会话 run 调用 createSession(currentCharacterId) + setPage("chat")（Req 5.5）', () => {
    const { ctx, createSession, setPage } = makeCtx({ currentCharacterId: 'socrates' });
    const items = buildCommandRegistry(ctx);
    items.find((i) => i.id === 'session.new')!.run();
    expect(createSession).toHaveBeenCalledWith('socrates');
    expect(setPage).toHaveBeenCalledWith('chat');
  });
});
