// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import '@testing-library/jest-dom';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Test setup file loaded before every test (see vitest.config.ts `setupFiles`).
 *
 * jsdom does not implement the browser media / clipboard APIs that the voice
 * interaction features rely on (MediaRecorder, getUserMedia, HTMLAudioElement
 * playback, navigator.clipboard). This file installs lightweight, controllable
 * mocks plus small helpers so individual tests can drive recording, playback
 * and clipboard behaviour deterministically.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal subset of MediaRecorder used by the app, enough for jsdom tests. */
export interface MockMediaRecorder {
  state: 'inactive' | 'recording' | 'paused';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start: (timeslice?: number) => void;
  stop: () => void;
  /** Test helper: push a chunk of recorded data to the consumer. */
  emitData: (data: Blob) => void;
}

// ---------------------------------------------------------------------------
// MediaRecorder mock
// ---------------------------------------------------------------------------

/**
 * Install a controllable MediaRecorder mock on the global scope and return the
 * most recent instance so tests can drive `ondataavailable`/`onstop` manually.
 */
export function installMockMediaRecorder(options?: {
  /** MIME types reported as supported by `isTypeSupported`. */
  supportedTypes?: string[];
}): { getLastInstance: () => MockMediaRecorder | null } {
  const supported = options?.supportedTypes ?? ['audio/webm', 'audio/mp4', 'audio/ogg'];
  let lastInstance: MockMediaRecorder | null = null;

  class MediaRecorderMock implements MockMediaRecorder {
    state: 'inactive' | 'recording' | 'paused' = 'inactive';
    mimeType: string;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    constructor(_stream?: unknown, opts?: { mimeType?: string }) {
      this.mimeType = opts?.mimeType ?? 'audio/webm';
      lastInstance = this;
    }

    static isTypeSupported(type: string): boolean {
      return supported.includes(type);
    }

    start(): void {
      this.state = 'recording';
    }

    stop(): void {
      this.state = 'inactive';
      this.onstop?.();
    }

    emitData(data: Blob): void {
      this.ondataavailable?.({ data });
    }
  }

  // jsdom has no MediaRecorder; attach the mock to globalThis.
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = MediaRecorderMock;

  return { getLastInstance: () => lastInstance };
}

// ---------------------------------------------------------------------------
// getUserMedia mock
// ---------------------------------------------------------------------------

/**
 * Install a `navigator.mediaDevices.getUserMedia` mock.
 * Pass `reject` to simulate denied permission / missing device.
 */
export function installMockGetUserMedia(options?: {
  reject?: boolean;
  error?: Error;
}): ReturnType<typeof vi.fn> {
  const fakeTrack = { stop: vi.fn() };
  const fakeStream = { getTracks: () => [fakeTrack] };

  const getUserMedia = vi.fn(async () => {
    if (options?.reject) {
      throw options.error ?? new DOMException('Permission denied', 'NotAllowedError');
    }
    return fakeStream as unknown as MediaStream;
  });

  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: getUserMedia,
    configurable: true,
    writable: true,
  });

  return getUserMedia;
}

// ---------------------------------------------------------------------------
// HTMLAudioElement playback mock
// ---------------------------------------------------------------------------

/**
 * Stub HTMLMediaElement play/pause so audio playback works under jsdom
 * (jsdom otherwise throws "Not implemented: HTMLMediaElement.prototype.play").
 */
export function installMockAudio(): { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> } {
  const play = vi.fn(async () => undefined);
  const pause = vi.fn(() => undefined);

  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: play,
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    writable: true,
    value: pause,
  });

  return { play, pause };
}

// ---------------------------------------------------------------------------
// navigator.clipboard mock
// ---------------------------------------------------------------------------

/** Install a `navigator.clipboard.writeText` mock and return the spy. */
export function installMockClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(async () => undefined);

  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: {},
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(navigator.clipboard, 'writeText', {
    value: writeText,
    configurable: true,
    writable: true,
  });

  return writeText;
}

// ---------------------------------------------------------------------------
// window.matchMedia mock (prefers-color-scheme)
// ---------------------------------------------------------------------------

/** Controllable matchMedia list stub returned by installMockMatchMedia. */
export interface MockMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  /** Test helper: flip `matches` and notify registered 'change' listeners. */
  dispatch: (matches: boolean) => void;
}

/**
 * Install a controllable `window.matchMedia` mock for the
 * `(prefers-color-scheme: dark)` query. jsdom does not implement matchMedia.
 *
 * Returns the mql stub so tests can flip the system preference at runtime via
 * `dispatch(matches)`, which fires any registered 'change' listeners.
 */
export function installMockMatchMedia(options?: { prefersDark?: boolean }): MockMediaQueryList {
  const changeListeners = new Set<(e: { matches: boolean; media: string }) => void>();

  const mql: MockMediaQueryList = {
    matches: options?.prefersDark ?? false,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((type: string, cb: (e: { matches: boolean; media: string }) => void) => {
      if (type === 'change') changeListeners.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: (e: { matches: boolean; media: string }) => void) => {
      if (type === 'change') changeListeners.delete(cb);
    }),
    addListener: vi.fn((cb: (e: { matches: boolean; media: string }) => void) => {
      changeListeners.add(cb);
    }),
    removeListener: vi.fn((cb: (e: { matches: boolean; media: string }) => void) => {
      changeListeners.delete(cb);
    }),
    dispatch: (matches: boolean) => {
      mql.matches = matches;
      const event = { matches, media: mql.media };
      for (const cb of changeListeners) cb(event);
    },
  };

  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn(() => mql),
    configurable: true,
    writable: true,
  });

  return mql;
}

// ---------------------------------------------------------------------------
// Global lifecycle: keep tests isolated.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // jsdom does not implement Element.scrollIntoView (used to keep the latest
  // chat message in view); stub it so components calling it don't throw.
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  }
  // jsdom lacks URL.createObjectURL/revokeObjectURL used for audio blobs.
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:mock'),
      configurable: true,
      writable: true,
    });
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});
