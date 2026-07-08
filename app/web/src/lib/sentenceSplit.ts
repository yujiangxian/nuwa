/**
 * 流式 TTS 句子边界检测。
 *
 * 输入累积的全部文本，返回"新完成的句子"和"未完成的尾巴"。
 * 用于在 LLM 流式输出过程中检测可送 TTS 合成的完整句子。
 */

const MIN_SENTENCE_LEN = 1;

/**
 * Split accumulated text into completed sentences and an incomplete tail.
 * Sentence delimiters: 。！？ ! ? followed by space/newline, and \n
 */
export function extractSentences(accumulated: string): {
  sentences: string[];
  incomplete: string;
} {
  if (!accumulated) return { sentences: [], incomplete: '' };

  // Treat newlines as sentence boundaries
  const lines = accumulated.split('\n');
  if (lines.length > 1) {
    const complete = lines.slice(0, -1).map((l) => l.trim()).filter((s) => s.length >= MIN_SENTENCE_LEN);
    const incomplete = lines[lines.length - 1];
    return { sentences: complete, incomplete };
  }

  // Pattern: Chinese 。！？ or English .!? followed by space or end of string
  const sentenceDelim = /([^。！？!?\n]+[。！？!?])\s*/g;
  const matches: string[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = sentenceDelim.exec(accumulated)) !== null) {
    matches.push(m[1].trim());
    lastIndex = m.index + m[0].length;
  }

  const incomplete = accumulated.slice(lastIndex);
  const sentences = matches.filter((s) => s.length >= MIN_SENTENCE_LEN);

  return { sentences, incomplete };
}

/**
 * Diff-based extraction: given the previously-seen boundary position,
 * return only *new* completed sentences.
 *
 * `prevBoundary` is the character index (char count, not byte offset) of
 * the last already-extracted sentence end.
 */
export function extractNewSentences(
  accumulated: string,
  prevBoundary: number,
): { sentences: string[]; boundary: number } {
  const { incomplete } = extractSentences(accumulated);
  const allComplete = accumulated.slice(0, accumulated.length - incomplete.length);

  // Count characters in complete portion as the new boundary
  const boundary = [...allComplete].length;

  if (boundary <= prevBoundary) return { sentences: [], boundary };

  // Only return sentences from the new portion
  const newText = [...accumulated].slice(prevBoundary, boundary).join('');
  const newCompleted = extractSentences(newText).sentences;

  return { sentences: newCompleted, boundary };
}
