import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * FIFO audio queue — extends single-track playback with auto-advance.
 *
 * Each enqueue(key, url) adds to the tail. If nothing is currently playing,
 * the item starts immediately. When the current audio ends, the queue pops
 * the next item and plays it automatically. On error, the broken item is
 * skipped and the next one is tried.
 *
 * Single-shot playback: playNow(key, url) clears the queue and plays just
 * this one item — equivalent to the old useAudioPlayer.play() semantics.
 */

export interface UseAudioQueue {
  playing: boolean;
  playingKey: string | null;
  /** Add to the end of the FIFO queue. Starts playing immediately if idle. */
  enqueue: (key: string, url: string) => void;
  /** Replace the entire queue with a single item and play it immediately. */
  playNow: (key: string, url: string) => void;
  /** Clear queue and stop playback. */
  clear: () => void;
  /** Whether the given key is currently playing. */
  isPlaying: (key: string) => boolean;
  /** Number of items waiting in the queue (excluding the currently playing one). */
  getQueueLength: () => number;
  /** Set audio playback speed. */
  setSpeed: (rate: number) => void;
}

export function useAudioQueue(): UseAudioQueue {
  const [playing, setPlaying] = useState(false);
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Array<{ key: string; url: string }>>([]);
  const currentKeyRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  const speedRef = useRef(1);

  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.playbackRate = speedRef.current;
      audio.onended = () => {
        const next = queueRef.current.shift();
        if (next) {
          currentKeyRef.current = next.key;
          setPlayingKey(next.key);
          audio.src = next.url;
          audio.play().catch(() => {
            // Failed to load next — try skipping it
            if (queueRef.current.length > 0) {
              const n = queueRef.current.shift()!;
              currentKeyRef.current = n.key;
              setPlayingKey(n.key);
              audio.src = n.url;
              audio.play().catch(() => {});
            } else {
              currentKeyRef.current = null;
              setPlayingKey(null);
              playingRef.current = false;
              setPlaying(false);
            }
          });
        } else {
          currentKeyRef.current = null;
          setPlayingKey(null);
          playingRef.current = false;
          setPlaying(false);
        }
      };
      audio.onerror = () => {
        const next = queueRef.current.shift();
        if (next) {
          currentKeyRef.current = next.key;
          setPlayingKey(next.key);
          audio.src = next.url;
          audio.play().catch(() => {});
        } else {
          currentKeyRef.current = null;
          setPlayingKey(null);
          playingRef.current = false;
          setPlaying(false);
        }
      };
      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  const enqueue = useCallback((key: string, url: string) => {
    const audio = ensureAudio();
    queueRef.current.push({ key, url });
    if (!currentKeyRef.current && queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      currentKeyRef.current = next.key;
      setPlayingKey(next.key);
      audio.src = next.url;
      audio.play().catch(() => {});
      playingRef.current = true;
      setPlaying(true);
    }
  }, [ensureAudio]);

  const playNow = useCallback((key: string, url: string) => {
    const audio = ensureAudio();
    // Clear queue and stop current
    queueRef.current = [];
    audio.pause();
    try { audio.currentTime = 0; } catch { /* ignore */ }

    currentKeyRef.current = key;
    setPlayingKey(key);
    audio.src = url;
    audio.play().catch(() => {});
    playingRef.current = true;
    setPlaying(true);
  }, [ensureAudio]);

  const clear = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
      try { audio.currentTime = 0; } catch { /* ignore */ }
    }
    queueRef.current = [];
    currentKeyRef.current = null;
    setPlayingKey(null);
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const isPlaying = useCallback((key: string): boolean => {
    return currentKeyRef.current === key;
  }, []);

  const getQueueLength = useCallback((): number => {
    return queueRef.current.length;
  }, []);

  const setSpeed = useCallback((rate: number) => {
    speedRef.current = rate;
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

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
      queueRef.current = [];
    };
  }, []);

  return { playing, playingKey, enqueue, playNow, clear, isPlaying, getQueueLength, setSpeed };
}
