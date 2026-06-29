import { useEffect } from 'react';
import { useUIStore } from '@/store/uiStore';
import { applyTheme, getSystemPrefersDark, resolveTheme } from '@/lib/theme';

/**
 * 运行期主题副作用：
 * 1. 订阅 useUIStore 的 settings.theme；任一变更时 applyTheme(resolveTheme(theme, prefersDark))。
 * 2. 当 theme === 'system' 时，订阅 matchMedia('(prefers-color-scheme: dark)') 的 'change'，
 *    系统偏好变化时重新解析并应用。
 * 3. 当 theme 变为非 'system'（'dark'/'light'）或组件卸载时，移除上述监听（清理）。
 *
 * 在 App 顶层调用一次即可。
 */
export function useThemeEffect(): void {
  const theme = useUIStore((s) => s.settings.theme);

  useEffect(() => {
    // 先按当前设置解析并应用一次。
    applyTheme(resolveTheme(theme, getSystemPrefersDark()));

    // 仅 'system' 模式需要订阅系统偏好变化（Req 4.1）；锁定主题忽略系统变化（Req 4.4/4.5）。
    if (theme !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent): void => {
      applyTheme(resolveTheme('system', e.matches));
    };

    // 优先 addEventListener，回退旧浏览器的 addListener。
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    mql.addListener(handler);
    return () => {
      mql.removeListener(handler);
    };
  }, [theme]);
}
