/**
 * 界面多语言（ui-internationalization）的纯逻辑层。
 *
 * 关注点分离（镜像 lib/theme.ts）：
 * - `resolveLocale` 是无副作用纯函数（语言解析归一）。
 * - `translate` 是无副作用纯函数（带回退的翻译键查找）。
 * - `CATALOGS` / `LOCALE_LABELS` 是静态数据。
 *
 * 本模块不导入 React，不读写 Zustand store，不接触 DOM。对相同输入恒返回相同输出。
 */

/** 受支持语言的规范代码集合（Locale_Code）。zh-CN 为 Default_Locale。 */
export type LocaleCode = 'zh-CN' | 'en' | 'ja';

/** 默认语言代码（Default_Locale）。 */
export const DEFAULT_LOCALE: LocaleCode = 'zh-CN';

/** 全部受支持 Locale_Code，按稳定顺序。 */
export const SUPPORTED_LOCALES: readonly LocaleCode[] = ['zh-CN', 'en', 'ja'];

/** Locale_Code -> Display_Label 映射（设置选择器中展示的名称）。 */
export const LOCALE_LABELS: Record<LocaleCode, string> = {
  'zh-CN': '简体中文',
  en: 'English',
  ja: '日本語',
};

/** Display_Label -> Locale_Code 反向映射（resolveLocale 内部使用）。 */
export const LABEL_TO_CODE: Record<string, LocaleCode> = {
  简体中文: 'zh-CN',
  English: 'en',
  日本語: 'ja',
};

/** 翻译键（Translation_Key）：标识一条界面文案的稳定字符串键。 */
export type TranslationKey = string;

/** 单一 Locale_Code 对应的翻译目录（Translation_Catalog）。 */
export type TranslationCatalog = Record<TranslationKey, string>;

/**
 * 三种语言的翻译目录。三者共享同一组 Translation_Key 集合（Req 1.2），
 * `zh-CN` 目录对每个键提供 trim 后非空字符串（Req 1.3）。
 */
export const CATALOGS: Record<LocaleCode, TranslationCatalog> = {
  'zh-CN': {
    'home.subtitle': '多模型 AI 交互终端',
    'home.feature.chat.title': '智能对话',
    'home.feature.chat.desc': '与 AI 对话，用声音回复',
    'home.feature.characters.title': '角色管理',
    'home.feature.characters.desc': '创建与管理 AI 人设',
    'home.feature.presets.title': '提示词',
    'home.feature.presets.desc': '管理与复用常用提示词',
    'home.feature.voice.title': '声音工坊',
    'home.feature.voice.desc': '合成、克隆、管理声音',
    'home.feature.transcribe.title': '录音转写',
    'home.feature.transcribe.desc': '语音转文字',
    'home.feature.models.title': '模型管理',
    'home.feature.models.desc': '下载、切换模型',
    'settings.title': '设置',
    'settings.appearance': '外观',
    'settings.backendUrl': '后端地址',
    'settings.modelsDir': '模型目录',
    'settings.language': '界面语言',
    'settings.autoPlay.title': '合成后自动播放',
    'settings.autoPlay.desc': '音频生成完成后立即播放',
    'settings.theme.dark': '深色',
    'settings.theme.light': '浅色',
    'settings.theme.system': '跟随系统',
  },
  en: {
    'home.subtitle': 'Multi-model AI terminal',
    'home.feature.chat.title': 'Smart Chat',
    'home.feature.chat.desc': 'Chat with AI, reply with voice',
    'home.feature.characters.title': 'Characters',
    'home.feature.characters.desc': 'Create and manage AI personas',
    'home.feature.presets.title': 'Prompts',
    'home.feature.presets.desc': 'Manage and reuse common prompts',
    'home.feature.voice.title': 'Voice Studio',
    'home.feature.voice.desc': 'Synthesize, clone, and manage voices',
    'home.feature.transcribe.title': 'Transcription',
    'home.feature.transcribe.desc': 'Speech to text',
    'home.feature.models.title': 'Models',
    'home.feature.models.desc': 'Download and switch models',
    'settings.title': 'Settings',
    'settings.appearance': 'Appearance',
    'settings.backendUrl': 'Backend URL',
    'settings.modelsDir': 'Models Directory',
    'settings.language': 'Language',
    'settings.autoPlay.title': 'Auto-play after synthesis',
    'settings.autoPlay.desc': 'Play immediately after audio is generated',
    'settings.theme.dark': 'Dark',
    'settings.theme.light': 'Light',
    'settings.theme.system': 'System',
  },
  ja: {
    'home.subtitle': 'マルチモデル AI ターミナル',
    'home.feature.chat.title': 'スマートチャット',
    'home.feature.chat.desc': 'AI と会話し、音声で応答',
    'home.feature.characters.title': 'キャラクター管理',
    'home.feature.characters.desc': 'AI ペルソナの作成と管理',
    'home.feature.presets.title': 'プロンプト',
    'home.feature.presets.desc': 'よく使うプロンプトを管理・再利用',
    'home.feature.voice.title': 'ボイススタジオ',
    'home.feature.voice.desc': '音声の合成・クローン・管理',
    'home.feature.transcribe.title': '文字起こし',
    'home.feature.transcribe.desc': '音声をテキストに変換',
    'home.feature.models.title': 'モデル管理',
    'home.feature.models.desc': 'モデルのダウンロードと切り替え',
    'settings.title': '設定',
    'settings.appearance': '外観',
    'settings.backendUrl': 'バックエンド URL',
    'settings.modelsDir': 'モデルディレクトリ',
    'settings.language': '言語',
    'settings.autoPlay.title': '合成後に自動再生',
    'settings.autoPlay.desc': '音声生成後すぐに再生',
    'settings.theme.dark': 'ダーク',
    'settings.theme.light': 'ライト',
    'settings.theme.system': 'システムに従う',
  },
};

/**
 * 将任意输入归一为合法 LocaleCode（Locale_Resolver）。无副作用纯函数。
 *
 * - 输入等于某合法 LocaleCode（'zh-CN'/'en'/'ja'）→ 原样返回（Req 2.2）
 * - 输入等于某 Display_Label（'简体中文'/'English'/'日本語'）→ 返回对应 LocaleCode（Req 2.1）
 * - 其他任意输入（空串、null、undefined、未知字符串）→ 返回 DEFAULT_LOCALE（Req 2.3）
 *
 * 不读写 store/DOM/任何外部状态；对相同输入恒返回相同输出（Req 2.4）。
 */
export function resolveLocale(input: string | null | undefined): LocaleCode {
  if (input == null) return DEFAULT_LOCALE;
  // 合法 LocaleCode 原样返回（Req 2.2）。
  if ((SUPPORTED_LOCALES as readonly string[]).includes(input)) {
    return input as LocaleCode;
  }
  // 合法 Display_Label 映射到对应 LocaleCode（Req 2.1）。
  // 用 hasOwnProperty 防止命中原型链属性（如 'toString'/'constructor'），
  // 否则非法输入会错误地返回继承的函数而非回退 Default_Locale。
  if (Object.prototype.hasOwnProperty.call(LABEL_TO_CODE, input)) {
    return LABEL_TO_CODE[input];
  }
  // 其他任意输入回退 Default_Locale（Req 2.3）。
  return DEFAULT_LOCALE;
}

/**
 * 在给定目录集合中带回退地查找翻译（可注入入口，便于属性测试合成目录）。
 * 纯函数：不修改任何外部状态。
 *
 * 回退链（Req 3）：
 * 1. key 在 locale 目录中已定义 → 返回该值（Req 3.1）
 * 2. 否则 key 在 DEFAULT_LOCALE 目录中已定义 → 返回默认语言值（Req 3.2）
 * 3. 否则 → 返回 key 本身作为占位（Req 3.3）
 */
export function translateIn(
  catalogs: Record<LocaleCode, TranslationCatalog>,
  locale: LocaleCode,
  key: TranslationKey,
): string {
  const active = catalogs[locale];
  if (active && Object.prototype.hasOwnProperty.call(active, key)) {
    return active[key];
  }
  const fallback = catalogs[DEFAULT_LOCALE];
  if (fallback && Object.prototype.hasOwnProperty.call(fallback, key)) {
    return fallback[key];
  }
  return key;
}

/**
 * 带回退的翻译查找（Translation_Lookup）。无副作用纯函数。
 *
 * 委托给 translateIn 使用模块内 CATALOGS。回退链 active → DEFAULT_LOCALE → key 本身。
 * 对相同 (locale, key) 恒返回相同字符串，不修改任何外部状态（Req 3.4）。
 */
export function translate(locale: LocaleCode, key: TranslationKey): string {
  return translateIn(CATALOGS, locale, key);
}
