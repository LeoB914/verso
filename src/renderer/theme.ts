/**
 * Renderer-side app theme. The renderer computes the effective theme from the
 * setting (light/dark/system) plus the OS media query and sets
 * `document.documentElement.dataset.theme` — CSS tokens key off that
 * attribute. (nativeTheme.themeSource in the main process does not reliably
 * propagate to the renderer's prefers-color-scheme media query, so the
 * renderer owns the decision; the main-process call only tints window chrome.)
 */

export type AppTheme = 'light' | 'dark' | 'system'

/** matchMedia is unavailable in node environments (unit tests) — guard it. */
const media: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'> =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }

let appTheme: AppTheme = 'system'
const listeners = new Set<() => void>()

function isDark(): boolean {
  return appTheme === 'dark' || (appTheme === 'system' && media.matches)
}

function apply(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = isDark() ? 'dark' : 'light'
}

function emit(): void {
  for (const listener of listeners) listener()
}

media.addEventListener('change', () => {
  apply()
  emit()
})

/** Apply the initial theme (called once settings are loaded). */
export function initAppTheme(theme: AppTheme): void {
  appTheme = theme
  apply()
  emit()
}

/** Update the theme setting (called when settings change). */
export function setAppThemeSetting(theme: AppTheme): void {
  if (theme === appTheme) return
  appTheme = theme
  apply()
  emit()
}

/** Current effective dark state. */
export function getIsDark(): boolean {
  return isDark()
}

/** Subscribe to effective-theme changes (for useSyncExternalStore). */
export function subscribeTheme(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}
