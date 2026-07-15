// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { test, expect } from '@playwright/test';

/** Minimal AppConfig shape accepted by useConfig / SettingsModal. */
const minimalConfig = {
  models_dir: 'models',
  output_dir: 'output',
  voices_dir: 'assets/datasets/voices',
  backend: 'cpu',
  threads: 8,
  default_cfg: 1.0,
  default_timesteps: 20,
  current_llm_model: null,
  current_asr_model: null,
  current_tts_model: null,
  current_models: {},
  current_voice_id: null,
  theme: 'ocean',
};

test.beforeEach(async ({ page }) => {
  // Route-mock backend endpoints the SPA may hit on load (Home itself is IndexedDB-only,
  // but Settings / QueryClient consumers and navigation should not crash on empty APIs).
  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    });
  });
  await page.route('**/api/config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(minimalConfig),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/models**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
  await page.route('**/api/voices**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
  // Catch-all for other GET /api/* so unexpected probes don't fail the page.
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });
});

test('home page loads without crashing', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto('/');
  await expect(page).toHaveTitle(/女娲|Nuwa/i);
  await expect(page.getByRole('heading', { name: /女娲 Nuwa/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /设置/i })).toBeVisible();

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});
