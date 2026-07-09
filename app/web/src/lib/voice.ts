// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Voice reference resolution helpers.
 *
 * Maps a Character's bound voiceId to the backend Reference_Voice fields
 * (`ref_audio` / `ref_text`) consumed by `POST /api/inference/tts`.
 */

/**
 * A reference voice entry, aligned with `GET /api/voices` response items.
 * Only the fields required by {@link resolveVoiceRef} are declared as required;
 * `name` / `sample_rate` are kept optional so callers can pass the full backend
 * `Voice` shape without friction.
 */
export interface Voice {
  /** Unique voice identifier. */
  id: string;
  /** Display name. */
  name?: string;
  /** Path to the reference audio file (used as `ref_audio`). */
  path: string;
  /** Reference transcript for the audio (used as `ref_text`); may be null. */
  transcript: string | null;
  /** Audio sample rate in Hz. */
  sample_rate?: number;
  /**
   * Audio duration in seconds; optional additional field that does not affect
   * {@link resolveVoiceRef} (which only relies on `path` / `transcript`).
   */
  duration_seconds?: number | null;
}

/**
 * The reference fields submitted to the TTS endpoint.
 */
export interface VoiceRef {
  /** Reference audio path; empty string means "use backend default". */
  ref_audio: string;
  /** Reference transcript; empty string means "use backend default". */
  ref_text: string;
}

/**
 * Resolve a voiceId to its TTS reference fields.
 *
 * - On a hit, returns `{ ref_audio: voice.path, ref_text: voice.transcript ?? '' }`.
 * - On a miss (no match) or an empty list, returns `{ ref_audio: '', ref_text: '' }`,
 *   letting the backend fall back to its DEFAULT_REF_AUDIO / DEFAULT_REF_TEXT.
 * - A `null` transcript is mapped to an empty string.
 *
 * @param voiceId The Character-bound voice id, or undefined when none is bound.
 * @param voices  The list of available reference voices.
 */
export function resolveVoiceRef(
  voiceId: string | undefined,
  voices: Voice[]
): VoiceRef {
  const v = voices.find((x) => x.id === voiceId);
  if (!v) {
    return { ref_audio: '', ref_text: '' };
  }
  return { ref_audio: v.path, ref_text: v.transcript ?? '' };
}
