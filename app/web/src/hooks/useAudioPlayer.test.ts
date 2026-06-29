import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMockAudio } from '@/test/setup';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';

/**
 * Unit tests for the single-instance audio player hook.
 *
 * Covers Requirement 3.7 (re-triggering the currently playing source stops it)
 * plus the supporting single-instance behaviour from task 2.5:
 *   - playing a new key stops the previous instance (old key no longer playing,
 *     new key playing)
 *   - isPlaying(key) reflects the current playing state
 *   - calling play again with the active key toggles it off (stop semantics)
 *
 * Playback is driven through jsdom using the shared installMockAudio helper,
 * which stubs HTMLMediaElement.play/pause so no real media element is needed.
 *
 * _Requirements: 3.7_
 */
describe('useAudioPlayer', () => {
  let audio: ReturnType<typeof installMockAudio>;

  beforeEach(() => {
    audio = installMockAudio();
  });

  it('starts playback and reports the playing key via isPlaying', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    expect(result.current.playingKey).toBeNull();
    expect(result.current.isPlaying('a')).toBe(false);

    await act(async () => {
      await result.current.play('a', 'http://example.com/a.wav');
    });

    expect(result.current.playingKey).toBe('a');
    expect(result.current.isPlaying('a')).toBe(true);
    expect(result.current.isPlaying('b')).toBe(false);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('stops the previous instance before playing a new key', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.play('a', 'http://example.com/a.wav');
    });
    expect(result.current.isPlaying('a')).toBe(true);

    await act(async () => {
      await result.current.play('b', 'http://example.com/b.wav');
    });

    // Old key is no longer playing, new key is now playing.
    expect(result.current.isPlaying('a')).toBe(false);
    expect(result.current.isPlaying('b')).toBe(true);
    expect(result.current.playingKey).toBe('b');

    // Switching sources pauses the shared element before the new play().
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it('toggles off when play is called again with the active key', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.play('a', 'http://example.com/a.wav');
    });
    expect(result.current.isPlaying('a')).toBe(true);

    // Re-playing the active key stops it (toggle semantics) and does not
    // start a new playback.
    await act(async () => {
      await result.current.play('a', 'http://example.com/a.wav');
    });

    expect(result.current.isPlaying('a')).toBe(false);
    expect(result.current.playingKey).toBeNull();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('stop() resets the playing state', async () => {
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      await result.current.play('a', 'http://example.com/a.wav');
    });
    expect(result.current.isPlaying('a')).toBe(true);

    act(() => {
      result.current.stop();
    });

    expect(result.current.playingKey).toBeNull();
    expect(result.current.isPlaying('a')).toBe(false);
  });
});
