/**
 * model-management：模型元数据相对时间纯函数层。
 *
 * 从 ModelsPage（ModelCard）内联的 lastUsedText 逻辑抽取，行为逐位保持：
 * 依据 (now - lastUsed) 秒差产生「刚刚使用 / N 分钟前 / N 小时前 / N 天前」文案。
 *
 * 纯函数：now 可注入，默认取系统时间。
 */

/**
 * 依据 last_used（Unix 秒）与当前时间（Unix 秒）的差值产生相对时间文案：
 * - diff < 60：'刚刚使用'
 * - [60, 3600)：'N 分钟前'（Math.floor(diff/60)）
 * - [3600, 86400)：'N 小时前'（Math.floor(diff/3600)）
 * - >= 86400：'N 天前'（Math.floor(diff/86400)）
 *
 * @param lastUsedSeconds 最近使用时间（Unix 秒级时间戳）
 * @param nowSeconds 当前时间（Unix 秒），默认 Math.floor(Date.now()/1000)
 */
export function formatLastUsed(
  lastUsedSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const diff = nowSeconds - lastUsedSeconds;
  if (diff < 60) return '刚刚使用';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}
