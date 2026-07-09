// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, expect, it } from 'vitest';
import {
  installMockAudio,
  installMockClipboard,
  installMockGetUserMedia,
  installMockMediaRecorder,
} from './setup';

/**
 * Placeholder smoke test for the test environment (Task 1).
 *
 * Confirms Vitest + jsdom is wired up and that the browser API mock helpers
 * from setup.ts install correctly. Real feature tests are added in later tasks.
 */
describe('test environment', () => {
  it('runs under jsdom with a document available', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
  });

  it('exposes jest-dom matchers', () => {
    const el = document.createElement('div');
    el.textContent = 'hello';
    document.body.appendChild(el);
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('hello');
  });

  it('installs a controllable MediaRecorder mock', () => {
    installMockMediaRecorder();
    const MR = (globalThis as unknown as { MediaRecorder: { isTypeSupported: (t: string) => boolean } })
      .MediaRecorder;
    expect(MR.isTypeSupported('audio/webm')).toBe(true);
    expect(MR.isTypeSupported('audio/unknown')).toBe(false);
  });

  it('installs getUserMedia / Audio / clipboard mocks', async () => {
    const getUserMedia = installMockGetUserMedia();
    const { play } = installMockAudio();
    const writeText = installMockClipboard();

    await navigator.mediaDevices.getUserMedia({ audio: true });
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    await new Audio('blob:mock').play();
    expect(play).toHaveBeenCalledTimes(1);

    await navigator.clipboard.writeText('copied');
    expect(writeText).toHaveBeenCalledWith('copied');
  });
});
