/**
 * chat-generation-parameters：对话生成参数的纯函数层。
 *
 * 提供 Param_Validator（`clampParam`）、Default_State、`PARAM_SPECS`、
 * 「Active 参数 → 请求体片段」构造（`buildRequestFragment`）以及
 * localStorage 持久化（`load|saveChatGenParams`，键 `nuwa_chat_gen_params`）。
 *
 * 与后端 `clamp_params` 的取值范围/取整/特殊值严格一致（前后端钳制等价，Property 4）。
 * 与既有合成模式参数（`uiStore` 的 `params/setParam`）互不相关、各自独立。
 */

/** 单个对话生成参数的标识符。 */
export type ChatParamKey = 'temperature' | 'topP' | 'numPredict' | 'topK' | 'repeatPenalty';

/** 下发给后端 / Ollama 的选项键名（snake_case）。 */
export type OllamaParamKey =
  | 'temperature'
  | 'top_p'
  | 'num_predict'
  | 'top_k'
  | 'repeat_penalty';

/** 单个参数的设置态 + 数值。Inactive（active=false）时不随请求下发。 */
export interface ChatParamState {
  active: boolean;
  value: number;
}

/** Generation_Params 全集（前端状态形态）。 */
export type ChatGenParams = Record<ChatParamKey, ChatParamState>;

/** 参数规格：取值范围、是否取整、Ollama 选项键名、特殊值、默认值。 */
export interface ParamSpec {
  min: number;
  max: number;
  integer: boolean;
  /** num_predict 专用：允许「逃逸值」-1（Unlimited_Length），不参与范围钳制。 */
  allowUnlimited?: boolean;
  /** 下发给后端 / Ollama 的键名（snake_case）。 */
  ollamaKey: OllamaParamKey;
  /** Inactive 默认数值（仅用于控件初值，不随请求下发）。 */
  default: number;
}

/** localStorage 持久化键名。 */
export const CHAT_GEN_PARAMS_STORAGE_KEY = 'nuwa_chat_gen_params';

/** 各参数规格（与后端 clamp_params 范围/取整/特殊值严格一致）。 */
export const PARAM_SPECS: Record<ChatParamKey, ParamSpec> = {
  temperature: { min: 0, max: 2, integer: false, ollamaKey: 'temperature', default: 0.8 },
  topP: { min: 0, max: 1, integer: false, ollamaKey: 'top_p', default: 0.9 },
  numPredict: {
    min: 1,
    max: 8192,
    integer: true,
    allowUnlimited: true,
    ollamaKey: 'num_predict',
    default: 512,
  },
  topK: { min: 0, max: 100, integer: true, ollamaKey: 'top_k', default: 40 },
  repeatPenalty: { min: 0, max: 2, integer: false, ollamaKey: 'repeat_penalty', default: 1.1 },
};

/** 全部参数键（稳定顺序，供 UI 与遍历使用）。 */
export const CHAT_PARAM_KEYS: ChatParamKey[] = [
  'temperature',
  'topP',
  'numPredict',
  'topK',
  'repeatPenalty',
];

/** Default_State：所有参数 Inactive，value 取规格 default。 */
export const DEFAULT_CHAT_GEN_PARAMS: ChatGenParams = {
  temperature: { active: false, value: PARAM_SPECS.temperature.default },
  topP: { active: false, value: PARAM_SPECS.topP.default },
  numPredict: { active: false, value: PARAM_SPECS.numPredict.default },
  topK: { active: false, value: PARAM_SPECS.topK.default },
  repeatPenalty: { active: false, value: PARAM_SPECS.repeatPenalty.default },
};

/** 返回一份全新的 Default_State 拷贝（避免外部修改共享引用）。 */
function freshDefaults(): ChatGenParams {
  return {
    temperature: { ...DEFAULT_CHAT_GEN_PARAMS.temperature },
    topP: { ...DEFAULT_CHAT_GEN_PARAMS.topP },
    numPredict: { ...DEFAULT_CHAT_GEN_PARAMS.numPredict },
    topK: { ...DEFAULT_CHAT_GEN_PARAMS.topK },
    repeatPenalty: { ...DEFAULT_CHAT_GEN_PARAMS.repeatPenalty },
  };
}

/** 数值钳制到闭区间 [min, max]。 */
function clampRange(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * Param_Validator：把单个参数的原始输入钳制到其规格范围。
 * - integer 规格：先取整（Math.round）再 clamp。
 * - allowUnlimited 且输入为 -1：原样返回 -1（Unlimited_Length）。
 * - 非有限数（NaN/Infinity）：回退到规格 default（再按规格处理）。
 * - 对已合法值幂等：clampParam(key, clampParam(key, v)) === clampParam(key, v)。
 */
export function clampParam(key: ChatParamKey, raw: number): number {
  const spec = PARAM_SPECS[key];
  // 非有限数兜底：以规格默认值替代，避免向后端/Ollama 下发 NaN。
  let v = Number.isFinite(raw) ? raw : spec.default;

  if (spec.allowUnlimited && v === -1) {
    return -1;
  }
  if (spec.integer) {
    v = Math.round(v);
  }
  return clampRange(v, spec.min, spec.max);
}

/**
 * 「Active 参数 → 请求体片段」构造：返回仅含 Active 参数的对象，
 * 键为对应 Ollama 选项键名，值为经 clampParam 钳制后的数值。
 * Default_State（无 Active）返回 {}（空对象，不含任何生成字段）。
 * 该片段绝不包含 `messages` 或 `system` 键。
 */
export function buildRequestFragment(
  params: ChatGenParams,
): Partial<Record<OllamaParamKey, number>> {
  const fragment: Partial<Record<OllamaParamKey, number>> = {};
  for (const key of CHAT_PARAM_KEYS) {
    const state = params[key];
    if (state && state.active) {
      const spec = PARAM_SPECS[key];
      fragment[spec.ollamaKey] = clampParam(key, state.value);
    }
  }
  return fragment;
}

/** 归一化单个参数态：缺失/非法回退默认 active=false、value=default（并钳制 value）。 */
function normalizeParamState(key: ChatParamKey, raw: unknown): ChatParamState {
  const spec = PARAM_SPECS[key];
  if (raw && typeof raw === 'object') {
    const obj = raw as Partial<ChatParamState>;
    const active = typeof obj.active === 'boolean' ? obj.active : false;
    const rawValue = typeof obj.value === 'number' ? obj.value : spec.default;
    return { active, value: clampParam(key, rawValue) };
  }
  return { active: false, value: spec.default };
}

/**
 * 从 localStorage 恢复 Generation_Params；不存在/损坏则返回 Default_State，
 * 并对缺失键逐参数与默认合并兜底（与既有 loadSettings 容错一致）。
 */
export function loadChatGenParams(): ChatGenParams {
  try {
    const rawStr = localStorage.getItem(CHAT_GEN_PARAMS_STORAGE_KEY);
    if (!rawStr) return freshDefaults();
    const parsed = JSON.parse(rawStr) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return freshDefaults();
    const result = freshDefaults();
    for (const key of CHAT_PARAM_KEYS) {
      result[key] = normalizeParamState(key, parsed[key]);
    }
    return result;
  } catch {
    return freshDefaults();
  }
}

/**
 * 持久化 Generation_Params 到 localStorage（键 nuwa_chat_gen_params）。
 * 写入失败（隐私模式/配额）静默忽略（与 saveSettings 一致），不抛错。
 */
export function saveChatGenParams(params: ChatGenParams): void {
  try {
    localStorage.setItem(CHAT_GEN_PARAMS_STORAGE_KEY, JSON.stringify(params));
  } catch {
    /* ignore */
  }
}
