// Feature: streaming-chat-output
// 前端流消费纯逻辑层：NDJSON 分帧、单行块解析、增量累积，以及基于
// fetch + ReadableStream 的流消费器 consumeChatStream。
//
// 设计参考：.kiro/specs/streaming-chat-output/design.md
//   「前端：流消费纯逻辑 lib/streamChat.ts」与 Correctness Properties 1/2/3。

/** 下行块（Stream_Chunk）解码后的形态。三字段互斥（恰含其一）。 */
export interface StreamChunk {
  /** 本次增量文本。 */
  delta?: string;
  /** 结束标志。 */
  done?: boolean;
  /** 错误信息。 */
  error?: string;
}

/**
 * NDJSON 分帧（纯函数）。
 *
 * 按 `\n` 切分缓冲区，返回已完成的整行数组与尾部未完成的剩余片段。
 * 由于实现等价于 `buffer.split('\n')` 再取出最后一段作为 `rest`，
 * 因此始终满足 round-trip：`[...lines, rest].join('\n') === buffer`。
 */
export function parseStreamLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  // split 至少返回一个元素，pop 必有值；?? '' 仅为满足类型收窄。
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}

/**
 * 解析单行 NDJSON 为 StreamChunk（纯函数）。
 *
 * 仅提取类型正确的已知字段（delta:string / done:boolean / error:string）。
 * 非法 JSON、非对象（含 null、数组、原始值）一律返回空块 `{}`，由调用方忽略。
 */
export function parseChunk(line: string): StreamChunk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const obj = parsed as Record<string, unknown>;
  const chunk: StreamChunk = {};
  if (typeof obj.delta === 'string') chunk.delta = obj.delta;
  if (typeof obj.done === 'boolean') chunk.done = obj.done;
  if (typeof obj.error === 'string') chunk.error = obj.error;
  return chunk;
}

/**
 * 增量累积（纯函数）：把一个块的 `delta` 追加到已累积文本。
 * 无 delta（done / error / 空块）时原样返回 prev。
 */
export function accumulateDelta(prev: string, chunk: StreamChunk): string {
  return typeof chunk.delta === 'string' ? prev + chunk.delta : prev;
}

/**
 * 定型持久化决策（纯函数）。
 *
 * 流式生成以「正常完成（done）」或「被停止 / 出错」收尾后，决定是否把
 * 累积内容作为 assistant Final_Message 持久化：当且仅当累积内容非空时持久化。
 * 抽成纯函数以便对 Correctness Property 6（定型持久化次数不变式）做属性测试。
 */
export function shouldPersistFinal(content: string): boolean {
  return content.length > 0;
}

/**
 * 消费 Stream_Endpoint 响应体：基于 ReadableStream reader + TextDecoder。
 *
 * - 用 `TextDecoder.decode(value, { stream: true })` 增量解码，避免切坏多字节字符；
 * - 用 parseStreamLines 维护 leftover，逐整行 parseChunk 后回调 onChunk；
 * - 流结束时处理最后残余片段（无尾随换行的最后一行）；
 * - 经外部 AbortSignal 中断时，reader.read() 抛 AbortError，视为正常停止不再抛出。
 */
export async function consumeChatStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: StreamChunk) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let leftover = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      leftover += decoder.decode(value, { stream: true });
      const { lines, rest } = parseStreamLines(leftover);
      leftover = rest;
      for (const line of lines) {
        if (line.length === 0) continue;
        onChunk(parseChunk(line));
      }
    }
    // flush decoder：取出缓冲中残留的多字节尾字节。
    leftover += decoder.decode();
    // 处理流结束时无尾随换行的最后一行。
    if (leftover.length > 0) {
      onChunk(parseChunk(leftover));
    }
  } catch (err) {
    if (isAbortError(err)) return;
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader 已处于错误/取消态时 releaseLock 可能抛错，忽略即可。
    }
  }
}

/** 判定一个异常是否为中断（AbortSignal.abort）触发的 AbortError。 */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}
