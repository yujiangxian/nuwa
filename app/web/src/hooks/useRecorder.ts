import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useRecorder — encapsulates the MediaRecorder lifecycle for microphone capture.
 *
 * Responsibilities:
 * - Negotiate a supported MIME type (audio/webm → audio/mp4 → audio/ogg).
 * - Request microphone access via getUserMedia; on denial/unavailable device,
 *   surface a human-readable `error` WITHOUT throwing to the caller.
 * - Track elapsed recording time in milliseconds.
 * - On stop(), flush chunks into a Blob, stop every media track, and reject
 *   recordings that are too short (< 1KB) by resolving to `null`.
 */
export interface UseRecorder {
  isRecording: boolean;
  /** Elapsed recording time in milliseconds. */
  recordingTime: number;
  /** Human-readable microphone error, or null when no error. */
  error: string | null;
  start: () => Promise<void>;
  /** Resolves with the recorded Blob, or null when no/too-short audio. */
  stop: () => Promise<Blob | null>;
}

/** Candidate MIME types in preference order. */
const MIME_CANDIDATES = ['audio/webm', 'audio/mp4', 'audio/ogg'] as const;

/** Minimum acceptable recording size in bytes; below this we treat as empty. */
const MIN_BLOB_SIZE = 1024;

const MIC_ERROR_MESSAGE = '无法访问麦克风，请检查浏览器权限或设备';

/**
 * Pick the first MIME type the current browser's MediaRecorder supports.
 * Falls back to an empty string (lets the browser choose its default) when
 * isTypeSupported is unavailable or none match.
 */
function negotiateMimeType(): string {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return '';
  }
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

export function useRecorder(): UseRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Wall-clock timestamp (ms) when the current recording started. */
  const startTimeRef = useRef<number>(0);
  /** Tick interval (ms) used to refresh the elapsed-time readout. */
  const TICK_MS = 100;
  /** Resolver for the in-flight stop() promise, settled in MediaRecorder.onstop. */
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Stop all tracks of the active stream and release the reference. */
  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    // Reset prior error state on each new attempt.
    setError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setError(MIC_ERROR_MESSAGE);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Permission denied / no device: surface error, do NOT throw.
      setError(MIC_ERROR_MESSAGE);
      return;
    }

    try {
      const mimeType = negotiateMimeType();
      mimeTypeRef.current = mimeType;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        releaseStream();
        clearTimer();
        setIsRecording(false);

        const type = mimeTypeRef.current || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        recorderRef.current = null;

        // Reject too-short recordings.
        const result = blob.size >= MIN_BLOB_SIZE ? blob : null;

        const resolve = stopResolverRef.current;
        stopResolverRef.current = null;
        if (resolve) {
          resolve(result);
        }
      };

      recorder.start();
      setRecordingTime(0);
      setIsRecording(true);

      clearTimer();
      // Track elapsed time in milliseconds against a wall-clock anchor so the
      // readout stays accurate regardless of tick jitter.
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setRecordingTime(Date.now() - startTimeRef.current);
      }, TICK_MS);
    } catch {
      // MediaRecorder construction/start failed: clean up and report.
      releaseStream();
      recorderRef.current = null;
      setError(MIC_ERROR_MESSAGE);
    }
  }, [clearTimer, releaseStream]);

  const stop = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      // Nothing recording — settle immediately.
      clearTimer();
      releaseStream();
      setIsRecording(false);
      return Promise.resolve(null);
    }

    return new Promise<Blob | null>((resolve) => {
      stopResolverRef.current = resolve;
      try {
        recorder.stop();
      } catch {
        // If stop throws, settle defensively.
        stopResolverRef.current = null;
        clearTimer();
        releaseStream();
        setIsRecording(false);
        resolve(null);
      }
    });
  }, [clearTimer, releaseStream]);

  // Clean up timer and media tracks if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      clearTimer();
      releaseStream();
    };
  }, [clearTimer, releaseStream]);

  return { isRecording, recordingTime, error, start, stop };
}
