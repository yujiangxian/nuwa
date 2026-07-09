// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useAudioPlayer — manages a single shared HTMLAudioElement instance and exposes
 * keyed play/stop controls so callers can play audio by a "source key".
 *
 * Semantics:
 * - Only one audio source plays at a time. Playing a new key automatically stops
 *   the previously playing source (cross-source mutual exclusion).
 * - Calling play() again with the SAME key that is currently playing acts as a
 *   toggle and stops playback instead of restarting it.
 * - audio.onended / audio.onerror reset the playing state (playingKey → null).
 * - On unmount the underlying audio is stopped and cleaned up.
 */
export interface UseAudioPlayer {
  /** Key of the source currently playing, or null when idle. */
  playingKey: string | null;
  /**
   * Play the given URL associated with `key`. Stops any previously playing
   * source first. If `key` is already playing, this stops playback (toggle).
   */
  play: (key: string, url: string) => Promise<void>;
  /** Stop playback and reset the playing state. */
  stop: () => void;
  /** Whether the given key is the one currently playing. */
  isPlaying: (key: string) => boolean;
}

export function useAudioPlayer(): UseAudioPlayer {
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Mirrors `playingKey` for use inside callbacks without stale closures. */
  const playingKeyRef = useRef<string | null>(null);

  /** Lazily create the single shared audio element. */
  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.onended = () => {
        playingKeyRef.current = null;
        setPlayingKey(null);
      };
      audio.onerror = () => {
        playingKeyRef.current = null;
        setPlayingKey(null);
      };
      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  /** Stop the current playback (pause + reset position) and clear state. */
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      // Reset so the next play() starts from the beginning.
      try {
        audio.currentTime = 0;
      } catch {
        // Some environments throw before metadata loads; safe to ignore.
      }
    }
    playingKeyRef.current = null;
    setPlayingKey(null);
  }, []);

  const play = useCallback(
    async (key: string, url: string): Promise<void> => {
      // Toggle: requesting the currently playing key stops it.
      if (playingKeyRef.current === key) {
        stop();
        return;
      }

      const audio = ensureAudio();

      // Stop the previous source before switching to the new one.
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // Ignore — see note in stop().
      }

      audio.src = url;
      playingKeyRef.current = key;
      setPlayingKey(key);

      try {
        await audio.play();
      } catch {
        // Playback failed (e.g. load/decoding error, autoplay policy):
        // reset state so callers can surface a friendly message.
        if (playingKeyRef.current === key) {
          playingKeyRef.current = null;
          setPlayingKey(null);
        }
      }
    },
    [ensureAudio, stop]
  );

  const isPlaying = useCallback((key: string): boolean => {
    return playingKeyRef.current === key;
  }, []);

  // Stop and release the audio element when the component unmounts.
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.onended = null;
        audio.onerror = null;
        audio.src = '';
      }
      audioRef.current = null;
      playingKeyRef.current = null;
    };
  }, []);

  return { playingKey, play, stop, isPlaying };
}
