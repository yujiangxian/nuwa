import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the `loadSettings` migration logic in `uiStore.ts`.
 *
 * `loadSettings()` runs at module-evaluation time (it is called inline when the
 * zustand store is created: `settings: loadSettings()`). Therefore each test
 * must seed `localStorage` BEFORE importing the module, then use
 * `vi.resetModules()` + a dynamic `import()` so the store re-evaluates and the
 * one-time migration runs against the freshly seeded storage.
 *
 * jsdom provides a working `localStorage` implementation.
 *
 * Validates: Requirements 4.8
 */

const STORAGE_KEY = 'nuwa_settings';
const LEGACY_DEFAULT_BACKEND_URL = 'http://localhost:9880';
const NEW_DEFAULT_BACKEND_URL = 'http://localhost:8080';

/** Freshly (re)import the store module so `loadSettings()` re-runs. */
async function importStore() {
  vi.resetModules();
  return import('./uiStore');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('uiStore loadSettings migration', () => {
  it('migrates the legacy default backendUrl (9880) to the new default (8080)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ backendUrl: LEGACY_DEFAULT_BACKEND_URL }),
    );

    const { useUIStore } = await importStore();

    expect(useUIStore.getState().settings.backendUrl).toBe(NEW_DEFAULT_BACKEND_URL);
  });

  it('persists the migrated value back to localStorage', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ backendUrl: LEGACY_DEFAULT_BACKEND_URL }),
    );

    await importStore();

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(persisted.backendUrl).toBe(NEW_DEFAULT_BACKEND_URL);
  });

  it('does NOT overwrite a custom backendUrl', async () => {
    const custom = 'http://example.com';
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ backendUrl: custom }));

    const { useUIStore } = await importStore();

    expect(useUIStore.getState().settings.backendUrl).toBe(custom);
  });

  it('uses the new default backendUrl (8080) when nothing is stored', async () => {
    // localStorage is cleared in beforeEach -> no stored settings.
    const { useUIStore } = await importStore();

    expect(useUIStore.getState().settings.backendUrl).toBe(NEW_DEFAULT_BACKEND_URL);
  });

  it('merges stored partial settings with defaults without losing other defaults', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ backendUrl: LEGACY_DEFAULT_BACKEND_URL }),
    );

    const { useUIStore } = await importStore();
    const { settings } = useUIStore.getState();

    // Migrated field.
    expect(settings.backendUrl).toBe(NEW_DEFAULT_BACKEND_URL);
    // Other defaults remain intact.
    expect(settings.modelsDir).toBe('./models');
    expect(settings.theme).toBe('dark');
    expect(settings.autoPlay).toBe(true);
  });

  it('falls back to defaults when stored JSON is corrupted', async () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');

    const { useUIStore } = await importStore();

    expect(useUIStore.getState().settings.backendUrl).toBe(NEW_DEFAULT_BACKEND_URL);
  });
});
