/**
 * Content-Security-Policy for all renderer windows (pure, unit-tested).
 *
 * Production: scripts only from the app bundle ('self') — no inline scripts,
 * no eval, nothing remote. Development additionally allows the Vite dev server,
 * its HMR websocket and inline scripts, because @vitejs/plugin-react injects an
 * inline refresh preamble into index.html.
 *
 * Styles keep 'unsafe-inline' in both modes: React and CodeMirror set inline
 * `style` attributes, which a stricter style-src would break.
 */
export function buildContentSecurityPolicy(devServerUrl?: string | null): string {
  const dev = devServerUrl ? ` ${devServerUrl} ws://${new URL(devServerUrl).host}` : ''
  const devInlineScripts = devServerUrl ? " 'unsafe-inline'" : ''
  return [
    `default-src 'self' openleaf:${dev}`,
    `script-src 'self'${devInlineScripts}${dev}`,
    `style-src 'self' 'unsafe-inline'${dev}`,
    `img-src 'self' openleaf: data: blob:${dev}`,
    `font-src 'self' data:`,
    `connect-src 'self' openleaf:${devServerUrl ? ` ws:${dev}` : ''}`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
  ].join('; ')
}
