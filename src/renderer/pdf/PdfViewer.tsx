import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  MoveHorizontal,
  TextCursor,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { strings } from '../strings'
import { pdfClickToSynctex } from './synctex-point'
import { loadUiState, rememberUiState } from '../layout'
import type * as PdfjsModule from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * PDF viewer: lazy virtualized pages (IntersectionObserver), text layer with
 * selection + search highlighting, link annotations, zoom presets, page
 * navigation, scroll-anchor preservation across recompiles, Ctrl+scroll zoom.
 */

interface PdfPageInfo {
  width: number
  height: number
}

interface PdfDocument {
  numPages: number
  getPage: (n: number) => Promise<PdfPageProxy>
  getDestination?: (id: string) => Promise<unknown[] | null>
  getPageIndex?: (ref: unknown) => Promise<number>
}

interface PdfPageProxy {
  getViewport: (opts: { scale: number }) => { width: number; height: number }
  render: (opts: {
    canvasContext: CanvasRenderingContext2D
    viewport: { width: number; height: number }
  }) => { promise: Promise<void> }
  getTextContent: () => Promise<{ items: TextItem[] }>
  getAnnotations: () => Promise<
    Array<{ subtype: string; url?: string; dest?: unknown; rect?: number[] }>
  >
  getDestination?: (id: string) => Promise<unknown[] | null>
  getPageIndex?: (ref: unknown) => Promise<number>
}

interface TextItem {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

interface PdfViewerProps {
  url: string
  /** Increment to force a reload (after re-compile). */
  version: number
  invert: boolean
  dark: boolean
}

interface SearchMatch {
  page: number
  itemIndex: number
  snippet: string
}

let pdfjsLibPromise: Promise<typeof PdfjsModule> | null = null

async function loadPdfjs(): Promise<typeof PdfjsModule> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      return lib
    })
  }
  return pdfjsLibPromise
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

export function PdfViewer({ url, version, invert, dark }: PdfViewerProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const taskRef = useRef<{ destroy: () => Promise<void> } | null>(null)
  const [loaded, setLoaded] = useState<{
    doc: PdfDocument
    sizes: PdfPageInfo[]
    forVersion: number
  } | null>(null)
  const [loadError, setLoadError] = useState<{ message: string; forVersion: number } | null>(null)
  const [zoomMode, setZoomMode] = useState<{
    mode: 'fitWidth' | 'fitPage' | 'fixed'
    zoom: number
  }>({
    mode: 'fitWidth',
    zoom: 1,
  })
  const [containerWidth, setContainerWidth] = useState(800)
  const [containerHeight, setContainerHeight] = useState(800)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInputValue, setPageInputValue] = useState('1')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatches, setSearchMatches] = useState<SearchMatch[] | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectText, setSelectText] = useState(false)
  const [highlight, setHighlight] = useState<{
    page: number
    x: number
    y: number
    w: number
    h: number
  } | null>(null)

  const zoomRestored = useRef(false)
  useEffect(() => {
    void (async () => {
      const ui = await loadUiState()
      if (ui.pdfZoomMode) {
        setZoomMode({ mode: ui.pdfZoomMode, zoom: ui.pdfZoom ?? 1 })
      }
      zoomRestored.current = true
    })()
  }, [])
  useEffect(() => {
    if (!zoomRestored.current) return
    rememberUiState({ pdfZoom: zoomMode.zoom, pdfZoomMode: zoomMode.mode })
  }, [zoomMode])

  const isLoading = !loaded || loaded.forVersion !== version
  const doc = isLoading ? null : loaded.doc
  const pageSizes = isLoading ? null : loaded.sizes
  const error = loadError && loadError.forVersion === version ? loadError.message : null

  // Preserve scroll position (anchored on page + offset) across reloads.
  const anchorRef = useRef<{ page: number; offset: number; ratio: number } | null>(null)
  const ignoreScrollForAnchorRef = useRef(true)

  // Track the scroll anchor continuously while pages are mounted. Capturing
  // on version change is too late: the old pages may already be unmounted and
  // the scroll position clamped, which would anchor on page 1.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => {
      // Skip while reloading (pages unmounted → clamped scroll) and right
      // after a restore applies its own scrollTop.
      if (ignoreScrollForAnchorRef.current) return
      const pages = el.querySelectorAll<HTMLElement>('[data-page]')
      if (pages.length === 0) return
      let current = 1
      let pageTop = 0
      let pageHeight = 1
      for (const page of pages) {
        if (page.offsetTop <= el.scrollTop + 10) {
          current = Number(page.dataset.page)
          pageTop = page.offsetTop
          pageHeight = Math.max(1, page.offsetHeight)
        } else break
      }
      anchorRef.current = {
        page: current,
        offset: el.scrollTop - pageTop,
        ratio: (el.scrollTop - pageTop) / pageHeight,
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // While a reload is pending the old DOM may be gone; never capture then.
  // (The load effect below raises the flag; the restore effect clears it.)

  // After a new document loads, restore the anchor as close as possible.
  useEffect(() => {
    if (!loaded || loaded.forVersion !== version) return
    const anchor = anchorRef.current
    const el = scrollRef.current
    if (!anchor || !el) {
      ignoreScrollForAnchorRef.current = false
      return
    }
    requestAnimationFrame(() => {
      const pages = el.querySelectorAll<HTMLElement>('[data-page]')
      const pageNumber = Math.min(anchor.page, pages.length)
      const target = el.querySelector<HTMLElement>(`[data-page="${pageNumber}"]`)
      if (target) {
        // Reflow-safe: use the relative position inside the page when the
        // page height changed (page breaks moved between compiles).
        el.scrollTop = target.offsetTop + anchor.ratio * target.offsetHeight
      }
      ignoreScrollForAnchorRef.current = false
      anchorRef.current = null
    })
  }, [loaded, version])

  // Load the document whenever url/version changes.
  useEffect(() => {
    let canceled = false
    // Old pages may unmount while loading; never capture a scroll anchor then.
    ignoreScrollForAnchorRef.current = true
    void (async () => {
      try {
        const pdfjs = await loadPdfjs()
        const task = pdfjs.getDocument({ url })
        const raw = await task.promise
        const first = await raw.getPage(1)
        const viewport = first.getViewport({ scale: 1 })
        const sizes: PdfPageInfo[] = Array.from({ length: raw.numPages }, () => ({
          width: viewport.width,
          height: viewport.height,
        }))
        if (canceled) {
          void task.destroy()
          return
        }
        const previousTask = taskRef.current
        taskRef.current = task
        setLoaded({ doc: raw as unknown as PdfDocument, sizes, forVersion: version })
        void previousTask?.destroy().catch(() => undefined)
      } catch (err) {
        if (!canceled)
          setLoadError({
            message: err instanceof Error ? err.message : String(err),
            forVersion: version,
          })
      }
    })()
    return () => {
      canceled = true
    }
  }, [url, version])

  // Track container size (fit width/page + scroll anchoring).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setContainerWidth(Math.max(200, el.clientWidth - 32))
      setContainerHeight(Math.max(200, el.clientHeight - 32))
    })
    observer.observe(el)
    setContainerWidth(Math.max(200, el.clientWidth - 32))
    setContainerHeight(Math.max(200, el.clientHeight - 32))
    return () => observer.disconnect()
  }, [])

  const firstPageSize = pageSizes?.[0] ?? { width: 612, height: 792 }
  const baseScale = (() => {
    if (zoomMode.mode === 'fitWidth') {
      return containerWidth / firstPageSize.width
    }
    if (zoomMode.mode === 'fitPage') {
      return Math.min(containerWidth / firstPageSize.width, containerHeight / firstPageSize.height)
    }
    return zoomMode.zoom
  })()

  const currentScaleRef = useRef(baseScale)
  useEffect(() => {
    currentScaleRef.current = baseScale
  }, [baseScale])
  const zoomBy = (factor: number): void => {
    setZoomMode({
      mode: 'fixed',
      zoom: Math.min(4, Math.max(0.25, currentScaleRef.current * factor)),
    })
  }

  // Scroll spy → page indicator.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !doc) return
    const onScroll = (): void => {
      const pages = el.querySelectorAll<HTMLElement>('[data-page]')
      let current = 1
      for (const page of pages) {
        if (page.offsetTop <= el.scrollTop + el.clientHeight / 3) {
          current = Number(page.dataset.page)
        } else break
      }
      setCurrentPage(current)
      setPageInputValue(String(current))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [doc])

  // Ctrl+scroll zoom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const goToPage = (page: number): void => {
    const el = scrollRef.current
    if (!el) return
    const target = el.querySelector<HTMLElement>(`[data-page="${page}"]`)
    if (target) el.scrollTo({ top: target.offsetTop - 8 })
  }

  const jumpToPdfPoint = useCallback(
    (page: number, x: number, y: number, w: number, h: number): void => {
      const el = scrollRef.current
      if (!el) return
      const target = el.querySelector<HTMLElement>(`[data-page="${page}"]`)
      if (!target) return
      const pdfHeight = pageSizes?.[page - 1]?.height ?? firstPageSize.height
      const scale = Number(target.dataset.scale ?? baseScale)
      // SyncTeX y is measured from the bottom of the page.
      const topOffset = (pdfHeight - y - h) * scale
      el.scrollTo({ top: target.offsetTop + topOffset - el.clientHeight / 3 })
      setHighlight({
        page,
        x: x * scale,
        y: topOffset,
        w: Math.max(w * scale, 4),
        h: Math.max(h * scale, 10),
      })
      setTimeout(() => setHighlight(null), 1600)
    },
    [pageSizes, firstPageSize.height, baseScale]
  )

  // SyncTeX forward: scroll to the target box (event from the main process).
  useEffect(() => {
    return window.openleaf.on('pdf:goto', ({ page, x, y, width, height }) => {
      jumpToPdfPoint(page, x, y, width, height)
    })
  }, [jumpToPdfPoint])

  // Run PDF text search across all pages.
  const runSearch = useCallback(async (): Promise<void> => {
    if (!doc || !searchQuery) {
      setSearchMatches(null)
      return
    }
    const matches: SearchMatch[] = []
    const query = searchQuery.toLowerCase()
    for (let page = 1; page <= doc.numPages && matches.length < 200; page++) {
      const pdfPage = await doc.getPage(page)
      const content = await pdfPage.getTextContent()
      for (let itemIndex = 0; itemIndex < content.items.length; itemIndex++) {
        const item = content.items[itemIndex]
        const text = item.str ?? ''
        if (text.toLowerCase().includes(query)) {
          matches.push({ page, itemIndex, snippet: text.slice(0, 80) })
        }
      }
    }
    setSearchMatches(matches)
    if (matches.length > 0) goToPage(matches[0].page)
  }, [doc, searchQuery])

  return (
    <div className="flex h-full flex-col">
      {/* PDF toolbar */}
      <div className="flex h-9 shrink-0 items-center justify-center gap-1 border-b border-[var(--border-subtle)] px-2 text-[13px] text-[var(--text-secondary)]">
        <button
          className="no-drag rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <input
          className="no-drag h-6 w-10 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-1 text-center text-[12px] tabular-nums"
          value={pageInputValue}
          onChange={(e) => setPageInputValue(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const page = Number(pageInputValue)
              if (page >= 1 && doc && page <= doc.numPages) goToPage(page)
            }
          }}
          aria-label="Page number"
        />
        <span className="tabular-nums" data-testid="pdf-page-indicator">
          / {doc?.numPages ?? 0}
        </span>
        <button
          className="no-drag rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() => goToPage(currentPage + 1)}
          disabled={!doc || currentPage >= doc.numPages}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>

        <span className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />

        <button
          className="no-drag rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() => zoomBy(1 / 1.2)}
          title={strings.zoomOut}
        >
          <ZoomOut size={16} />
        </button>
        <select
          className="no-drag h-6 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-1 text-[12px]"
          value={zoomMode.mode === 'fixed' ? String(Math.round(baseScale * 100)) : zoomMode.mode}
          onChange={(e) => {
            const value = e.target.value
            if (value === 'fitWidth' || value === 'fitPage') {
              setZoomMode({ mode: value, zoom: 1 })
            } else {
              setZoomMode({ mode: 'fixed', zoom: Number(value) / 100 })
            }
          }}
          aria-label="Zoom"
        >
          <option value="fitWidth">Fit width</option>
          <option value="fitPage">Fit page</option>
          {ZOOM_PRESETS.map((preset) => (
            <option key={preset} value={String(preset * 100)}>
              {Math.round(preset * 100)}%
            </option>
          ))}
        </select>
        <button
          className="no-drag rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() => zoomBy(1.2)}
          title={strings.zoomIn}
        >
          <ZoomIn size={16} />
        </button>
        <button
          className={`no-drag ml-1 rounded p-1 hover:bg-[var(--bg-hover)] ${zoomMode.mode === 'fitWidth' ? 'text-[var(--accent)]' : ''}`}
          onClick={() => setZoomMode({ mode: 'fitWidth', zoom: 1 })}
          title={strings.fitWidth}
        >
          <MoveHorizontal size={16} />
        </button>

        <span className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />

        <button
          className={`no-drag rounded p-1 hover:bg-[var(--bg-hover)] ${selectText ? 'text-[var(--accent)]' : ''}`}
          onClick={() => setSelectText((value) => !value)}
          title={
            selectText
              ? 'Text selection on (Alt+click jumps to source)'
              : 'Enable PDF text selection'
          }
          aria-pressed={selectText}
          data-testid="pdf-select-text"
        >
          <TextCursor size={16} />
        </button>
        <button
          className="no-drag rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() => setSearchOpen((v) => !v)}
          title="Search in PDF (Mod+F)"
        >
          <SearchIcon />
        </button>
        <button
          className="no-drag rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() => void window.openleaf.invoke('pdf:openExternal', undefined)}
          title="Open in system viewer"
        >
          <ExternalLink size={16} />
        </button>
        <button
          className="no-drag rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() =>
            window.open(location.href.replace(location.hash, ''), '_blank') === null && undefined
          }
          hidden
        >
          <Download size={16} />
        </button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 text-[13px]">
          <input
            autoFocus
            className="h-6 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
            placeholder="Search in PDF…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch()
              if (e.key === 'Escape') {
                setSearchOpen(false)
                setSearchMatches(null)
              }
            }}
          />
          {searchMatches && (
            <span className="text-[12px] text-[var(--text-secondary)]">
              {searchMatches.length} matches
            </span>
          )}
          <button
            className="rounded p-1 hover:bg-[var(--bg-hover)]"
            onClick={() => void runSearch()}
          >
            Find
          </button>
        </div>
      )}

      {/* Search results list */}
      {searchMatches && searchMatches.length > 0 && (
        <div className="max-h-24 shrink-0 overflow-auto border-b border-[var(--border-subtle)] px-3 py-1 text-[12px]">
          {searchMatches.slice(0, 30).map((match, index) => (
            <button
              key={`${match.page}-${match.itemIndex}-${index}`}
              className="block w-full truncate rounded px-1 py-0.5 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => goToPage(match.page)}
            >
              <span className="text-[var(--text-tertiary)]">p.{match.page} </span>
              {match.snippet}
            </button>
          ))}
        </div>
      )}

      {/* Pages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-4"
        style={invert && dark ? { filter: 'invert(0.92) hue-rotate(180deg)' } : undefined}
      >
        <div className="mx-auto flex flex-col items-center gap-4" data-testid="pdf-pages">
          {error ? <p className="p-8 text-center text-[var(--danger)]">{error}</p> : null}
          {doc &&
            pageSizes &&
            pageSizes.map((size, index) => (
              <PdfPage
                key={`${version}-${index}`}
                doc={doc}
                pageNumber={index + 1}
                baseScale={baseScale}
                size={size}
                searchQuery={searchQuery}
                highlight={highlight}
                selectText={selectText}
                onInternalLink={(page) => goToPage(page)}
                onClick={(x, y) => {
                  const point = pdfClickToSynctex(x, y, baseScale)
                  void window.openleaf.invoke('synctex:backward', {
                    page: index + 1,
                    x: point.x,
                    y: point.y,
                  })
                }}
              />
            ))}
        </div>
      </div>
    </div>
  )
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

interface PdfPageProps {
  doc: PdfDocument
  pageNumber: number
  baseScale: number
  size: PdfPageInfo
  searchQuery: string
  highlight: { page: number; x: number; y: number; w: number; h: number } | null
  selectText: boolean
  onInternalLink: (page: number) => void
  onClick: (xPx: number, yPx: number) => void
}

function PdfPage({
  doc,
  pageNumber,
  baseScale,
  size,
  searchQuery,
  highlight,
  selectText,
  onInternalLink,
  onClick,
}: PdfPageProps): React.JSX.Element {
  const placeholderRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const renderTokenRef = useRef(0)

  useEffect(() => {
    const el = placeholderRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
      },
      { rootMargin: '800px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const renderPage = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || !visible) return
    const token = ++renderTokenRef.current
    const page = await doc.getPage(pageNumber)
    if (renderTokenRef.current !== token) return

    const dpr = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: baseScale * dpr })
    const cssViewport = page.getViewport({ scale: baseScale })

    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.width = `${Math.floor(cssViewport.width)}px`
    canvas.style.height = `${Math.floor(cssViewport.height)}px`
    const context = canvas.getContext('2d')
    if (!context) return
    await page.render({ canvasContext: context, viewport }).promise
    if (renderTokenRef.current !== token) return

    // Text layer with search highlighting.
    const layer = textLayerRef.current
    if (layer) {
      layer.innerHTML = ''
      layer.style.width = `${Math.floor(cssViewport.width)}px`
      layer.style.height = `${Math.floor(cssViewport.height)}px`
      const text = await page.getTextContent()
      if (renderTokenRef.current !== token) return
      const query = searchQuery.toLowerCase()
      for (let itemIndex = 0; itemIndex < text.items.length; itemIndex++) {
        const item = text.items[itemIndex]
        if (!item.str || !item.transform) continue
        const [a, , , d, e, f] = item.transform
        const fontHeight = Math.hypot(a, d)
        const width = item.width ?? 0
        if (query.length > 0) {
          const lower = item.str.toLowerCase()
          let matchIndex = lower.indexOf(query)
          while (matchIndex !== -1) {
            const fraction = matchIndex / Math.max(1, item.str.length)
            const matchFraction = query.length / Math.max(1, item.str.length)
            const mark = document.createElement('div')
            mark.style.position = 'absolute'
            mark.style.left = `${e * baseScale + fraction * width * baseScale}px`
            mark.style.top = `${(cssViewport.height - f * baseScale - fontHeight * baseScale).toFixed(1)}px`
            mark.style.width = `${Math.max(1, matchFraction * width * baseScale)}px`
            mark.style.height = `${fontHeight * baseScale}px`
            mark.style.background = 'rgba(255, 214, 10, 0.45)'
            mark.style.borderRadius = '2px'
            mark.style.pointerEvents = 'none'
            layer.appendChild(mark)
            matchIndex = lower.indexOf(query, matchIndex + query.length)
          }
        }

        const span = document.createElement('span')
        span.textContent = item.str
        span.style.position = 'absolute'
        span.style.left = `${e * baseScale}px`
        span.style.top = `${(cssViewport.height - f * baseScale - fontHeight * baseScale).toFixed(1)}px`
        span.style.fontSize = `${Math.max(1, fontHeight * baseScale)}px`
        span.style.whiteSpace = 'pre'
        layer.appendChild(span)
      }
    }

    // Link annotations (external only; internal dests are a known gap).
    const annotations = await page.getAnnotations()
    if (renderTokenRef.current !== token) return
    const container = canvas.parentElement
    if (container) {
      for (const annotation of annotations) {
        if (annotation.subtype !== 'Link' || !annotation.rect) continue
        const [x1, y1, x2, y2] = annotation.rect
        const href = annotation.url ?? null
        let internalPage: number | null = null
        if (!href && annotation.dest !== undefined) {
          const destination =
            typeof annotation.dest === 'string'
              ? ((await doc.getDestination?.(annotation.dest)) ?? null)
              : (annotation.dest as unknown[] | null)
          const ref = Array.isArray(destination) ? destination[0] : null
          if (ref && doc.getPageIndex) {
            const index = await doc.getPageIndex(ref).catch(() => -1)
            if (index >= 0) internalPage = index + 1
          }
        }
        if (!href && internalPage === null) continue
        const link = document.createElement('a')
        if (href) link.href = href
        link.style.position = 'absolute'
        link.style.left = `${x1 * baseScale}px`
        link.style.top = `${(cssViewport.height - y2 * baseScale).toFixed(1)}px`
        link.style.width = `${(x2 - x1) * baseScale}px`
        link.style.height = `${(y2 - y1) * baseScale}px`
        link.style.cursor = 'pointer'
        link.target = '_blank'
        link.rel = 'noreferrer'
        link.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (href) {
            if (href.startsWith('https://') || href.startsWith('mailto:')) {
              window.open(href, '_blank', 'noreferrer')
            }
          } else if (internalPage !== null) {
            onInternalLink(internalPage)
          }
        })
        container.appendChild(link)
      }
    }
  }, [doc, pageNumber, baseScale, visible, searchQuery, onInternalLink])

  useEffect(() => {
    if (!visible) return
    void renderPage().catch(() => undefined)
  }, [visible, renderPage])

  const cssHeight = Math.floor(size.height * baseScale)
  const cssWidth = Math.floor(size.width * baseScale)

  return (
    <div
      ref={placeholderRef}
      data-page={pageNumber}
      data-scale={baseScale}
      className="relative bg-white shadow"
      style={{ width: cssWidth, height: visible ? undefined : cssHeight }}
      onClick={(event) => {
        // In text-selection mode a normal click selects text; Alt+click still
        // jumps to source. Otherwise every click is PDF → source.
        if (selectText && !event.altKey) return
        const rect = event.currentTarget.getBoundingClientRect()
        onClick(event.clientX - rect.left, event.clientY - rect.top)
      }}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        ref={textLayerRef}
        className="absolute inset-0 select-text overflow-hidden"
        style={{ color: 'transparent', pointerEvents: selectText ? 'auto' : 'none' }}
      />
      {highlight?.page === pageNumber && (
        <div
          className="pointer-events-none absolute rounded border-2 border-[var(--accent)] bg-[var(--accent)]/20 transition-opacity duration-500"
          style={{
            left: highlight.x,
            top: highlight.y,
            width: highlight.w,
            height: highlight.h,
            opacity: 0.9,
          }}
        />
      )}
    </div>
  )
}
