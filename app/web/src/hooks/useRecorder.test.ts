// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRecorder } from '@/hooks/useRecorder';
import { installMockMediaRecorder, installMockGetUserMedia } from '@/test/setup';

/**
 * Unit tests for useRecorder.
 *
 * Covers the two behaviours called out in the design (Requirements 1.7, 3.9):
 * 1. When getUserMedia is rejected (denied permission / no device), start()
 *    must set `error` and resolve WITHOUT throwing.
 * 2. MIME negotiation must follow the fallback order audio/webm → audio/mp4
 *    → audio/ogg, driven by which types MediaRecorder reports as supported.
 */
describe('useRecorder', () => {
  describe('getUserMedia rejection', () => {
    it('sets error and does not throw when permission is denied', async () => {
      installMockMediaRecorder();
      installMockGetUserMedia({ reject: true });

      const { result } = renderHook(() => useRecorder());

      // start() must resolve (not reject) even though getUserMedia rejected.
      await act(async () => {
        await expect(result.current.start()).resolves.toBeUndefined();
      });

      expect(result.current.error).toBe(
        '无法访问麦克风，请检查浏览器权限或设备',
      );
      expect(result.current.isRecording).toBe(false);
    });

    it('sets error when mediaDevices.getUserMedia is unavailable', async () => {
      installMockMediaRecorder();
      // Remove getUserMedia so the hook hits the unavailable-device branch.
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {},
        configurable: true,
        writable: true,
      });

      const { result } = renderHook(() => useRecorder());

      await act(async () => {
        await expect(result.current.start()).resolves.toBeUndefined();
      });

      expect(result.current.error).toBe(
        '无法访问麦克风，请检查浏览器权限或设备',
      );
      expect(result.current.isRecording).toBe(false);
    });
  });

  describe('MIME type fallback negotiation', () => {
    /**
     * Drive negotiation by constraining the supported types and asserting the
     * MIME type handed to the constructed MediaRecorder instance.
     */
    async function startWithSupported(
      supportedTypes: string[],
    ): Promise<string> {
      const { getLastInstance } = installMockMediaRecorder({ supportedTypes });
      installMockGetUserMedia();

      const { result } = renderHook(() => useRecorder());

      await act(async () => {
        await result.current.start();
      });

      await waitFor(() => expect(result.current.isRecording).toBe(true));

      const instance = getLastInstance();
      expect(instance).not.toBeNull();
      return instance!.mimeType;
    }

    it('prefers audio/webm when all candidates are supported', async () => {
      const mime = await startWithSupported([
        'audio/webm',
        'audio/mp4',
        'audio/ogg',
      ]);
      expect(mime).toBe('audio/webm');
    });

    it('falls back to audio/mp4 when webm is unsupported', async () => {
      const mime = await startWithSupported(['audio/mp4', 'audio/ogg']);
      expect(mime).toBe('audio/mp4');
    });

    it('falls back to audio/ogg when only ogg is supported', async () => {
      const mime = await startWithSupported(['audio/ogg']);
      expect(mime).toBe('audio/ogg');
    });
  });
});
