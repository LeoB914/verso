import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useCompileStore } from '../stores/compile'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { PdfViewer } from '../pdf/PdfViewer'
import { api } from '../api'
import { strings } from '../strings'

export function pdfUrlForRelPath(relPath: string): string {
  return `openleaf://project/${relPath.split('/').map(encodeURIComponent).join('/')}`
}

interface PdfPaneProps {
  dark: boolean
}

export function PdfPane({ dark }: PdfPaneProps): React.JSX.Element {
  const status = useCompileStore((s) => s.status)
  const pdfVersion = useCompileStore((s) => s.pdfVersion)
  const project = useProjectStore((s) => s.project)
  const texEnvironment = useCompileStore((s) => s.texEnvironment)
  const detectTex = useCompileStore((s) => s.detectTex)
  const startCompile = useCompileStore((s) => s.startCompile)
  const invert = useUiStore((s) => s.pdfInvert)
  const setInvert = useUiStore((s) => s.setPdfInvert)

  // In detached windows, the PDF path comes from the URL hash.
  const detachedRelPath = useMemo(() => {
    const hash = location.hash.replace(/^#/, '')
    if (!hash.startsWith('detached-pdf/')) return null
    return decodeURIComponent(hash.slice('detached-pdf/'.length))
  }, [])

  const pdfUrl = useMemo(() => {
    if (detachedRelPath) return pdfUrlForRelPath(detachedRelPath)
    // Keep the last produced PDF visible (and the viewer mounted) while a
    // recompile runs or fails — the viewer reloads on the version bump.
    const rel = status.pdfRelPath
    if (!rel) return null
    return pdfUrlForRelPath(rel)
  }, [status, detachedRelPath])

  // In the main window, reflect the detached state (hide the pane).
  const [detached, setDetached] = useState(false)
  useEffect(() => {
    if (detachedRelPath !== null) return
    return api.on('pdf:detached', ({ detached: isDetached }) => setDetached(isDetached))
  }, [detachedRelPath])

  // TeX missing → friendly empty state with install instructions.
  if (texEnvironment && !texEnvironment.available) {
    const instructions = navigator.userAgent.includes('Mac')
      ? strings.texMissingMac
      : navigator.userAgent.includes('Win')
        ? strings.texMissingWindows
        : strings.texMissingLinux
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
        data-testid="tex-missing"
      >
        <p className="text-[14px] font-semibold">{strings.texMissingTitle}</p>
        <p className="max-w-sm text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {instructions}
        </p>
        <button
          className="mt-1 flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-3 py-1 text-[13px] hover:bg-[var(--bg-hover)]"
          onClick={() => void detectTex(true)}
        >
          <RefreshCw size={14} />
          {strings.recheck}
        </button>
      </div>
    )
  }

  if (!pdfUrl) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
        data-testid="pdf-empty"
      >
        <p className="text-[14px] font-semibold text-[var(--text-secondary)]">
          {strings.pdfNotBuilt}
        </p>
        <p className="max-w-sm text-[13px] text-[var(--text-tertiary)]">
          {strings.pdfNotBuiltHint}
        </p>
        {project && (
          <button
            className="mt-1 rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1 text-[13px] font-medium text-[var(--accent-contrast)] hover:opacity-90"
            onClick={() => void startCompile()}
          >
            {strings.compileButton}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center justify-end gap-2 px-2 text-[12px] text-[var(--text-secondary)]">
        <label
          className="flex cursor-pointer items-center gap-1"
          title="Invert colors in dark mode"
        >
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
          {strings.invertInDark}
        </label>
      </div>
      <div className="min-h-0 flex-1">
        <PdfViewer url={pdfUrl} version={pdfVersion} invert={invert} dark={dark} />
      </div>
      {detached && <span className="hidden">pdf docked elsewhere</span>}
    </div>
  )
}
