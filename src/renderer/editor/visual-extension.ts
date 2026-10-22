import { type Extension } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { buildVisualTasks, type VisualContext } from '@shared/latex/visual'
import { useProjectIndex } from '../stores/projectIndex'
import { useProjectStore } from '../stores/project'
import { renderKatex } from '../components/SymbolPalette'
import { useVisualMode } from '../stores/visualMode'
import type { FileNode } from '@shared/ipc'

/**
 * Visual mode extension: maps the pure decoration tasks to CodeMirror
 * decorations. Recomputes on doc/selection changes; constructs touching the
 * cursor reveal their raw LaTeX (live-preview reveal rule).
 */

class MathWidget extends WidgetType {
  constructor(
    readonly latex: string,
    readonly display: boolean,
    readonly html: string | null
  ) {
    super()
  }
  eq(other: MathWidget): boolean {
    return other.latex === this.latex && other.display === this.display
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    if (this.html) {
      span.innerHTML = this.html
      span.className = 'openleaf-math-widget'
    } else {
      span.textContent = this.latex
      span.className = 'openleaf-math-fallback'
      span.style.fontFamily = 'ui-monospace, monospace'
    }
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

class ChipWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly chipKind: string
  ) {
    super()
  }
  eq(other: ChipWidget): boolean {
    return other.label === this.label && other.chipKind === this.chipKind
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.textContent = this.label
    span.className = `openleaf-chip openleaf-chip-${this.chipKind}`
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

function projectUrl(relPath: string): string {
  return `openleaf://project/${relPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

function sourceData(element: HTMLElement, from: number, to: number): void {
  element.dataset.visualFrom = String(from)
  element.dataset.visualTo = String(to)
}

function findFile(node: FileNode | null, relPath: string): boolean {
  if (!node) return false
  if (node.type === 'file' && node.relPath === relPath) return true
  return (node.children ?? []).some((child) => findFile(child, relPath))
}

function resolveImagePath(raw: string): string | null {
  const cleaned = raw.replace(/^\.\//, '')
  const tree = useProjectStore.getState().fileTree
  const candidates = [
    cleaned,
    `${cleaned}.png`,
    `${cleaned}.jpg`,
    `${cleaned}.jpeg`,
    `${cleaned}.gif`,
    `${cleaned}.svg`,
  ]
  return candidates.find((candidate) => findFile(tree, candidate)) ?? null
}

class FigureWidget extends WidgetType {
  constructor(
    readonly src: string | null,
    readonly caption: string,
    readonly label: string | null,
    readonly width: string | null,
    readonly from: number,
    readonly to: number
  ) {
    super()
  }
  eq(other: FigureWidget): boolean {
    return (
      other.src === this.src &&
      other.caption === this.caption &&
      other.label === this.label &&
      other.width === this.width
    )
  }
  toDOM(): HTMLElement {
    const figure = document.createElement('div')
    figure.className = 'openleaf-figure'
    sourceData(figure, this.from, this.to)
    if (this.src) {
      const img = document.createElement('img')
      img.src = projectUrl(this.src)
      img.alt = this.caption || this.label || this.src
      if (this.width) img.style.width = this.width
      figure.appendChild(img)
    } else {
      const missing = document.createElement('div')
      missing.className = 'openleaf-figure-missing'
      missing.textContent = 'Image not found'
      figure.appendChild(missing)
    }
    if (this.caption) {
      const caption = document.createElement('div')
      caption.className = 'openleaf-figure-caption'
      caption.textContent = this.caption
      figure.appendChild(caption)
    }
    if (this.label) {
      const label = document.createElement('div')
      label.className = 'openleaf-env-label'
      label.textContent = `#${this.label}`
      figure.appendChild(label)
    }
    return figure
  }
  ignoreEvent(): boolean {
    return true
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly rows: string[][],
    readonly caption: string,
    readonly label: string | null,
    readonly from: number,
    readonly to: number
  ) {
    super()
  }
  eq(other: TableWidget): boolean {
    return (
      JSON.stringify(other.rows) === JSON.stringify(this.rows) && other.caption === this.caption
    )
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'openleaf-table-widget'
    sourceData(wrap, this.from, this.to)
    const table = document.createElement('table')
    const body = document.createElement('tbody')
    for (const row of this.rows) {
      const tr = document.createElement('tr')
      for (const cell of row) {
        const td = document.createElement('td')
        td.textContent = cell.replace(/\\[a-zA-Z]+\s*/g, '').trim()
        tr.appendChild(td)
      }
      body.appendChild(tr)
    }
    table.appendChild(body)
    wrap.appendChild(table)
    if (this.caption) {
      const caption = document.createElement('div')
      caption.className = 'openleaf-figure-caption'
      caption.textContent = this.caption
      wrap.appendChild(caption)
    }
    if (this.label) {
      const label = document.createElement('div')
      label.className = 'openleaf-env-label'
      label.textContent = `#${this.label}`
      wrap.appendChild(label)
    }
    return wrap
  }
  ignoreEvent(): boolean {
    return true
  }
}

class FootnoteWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly number: number
  ) {
    super()
  }
  eq(other: FootnoteWidget): boolean {
    return other.text === this.text && other.number === this.number
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'openleaf-footnote'
    span.dataset.visualNoReveal = 'true'
    const marker = document.createElement('sup')
    marker.textContent = String(this.number)
    const popover = document.createElement('span')
    popover.className = 'openleaf-footnote-popover'
    popover.textContent = this.text
    span.append(marker, popover)
    span.addEventListener('click', (event) => {
      event.stopPropagation()
      span.classList.toggle('openleaf-footnote-open')
    })
    return span
  }
  ignoreEvent(): boolean {
    return true
  }
}

class LabelWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: LabelWidget): boolean {
    return other.text === this.text
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.textContent = this.text
    span.className = 'openleaf-env-label'
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString()
  const selection = view.state.selection.main
  const bibLabels: Record<string, string> = {}
  for (const entry of useProjectIndex.getState().bibEntries.values()) {
    bibLabels[entry.key] =
      `${(entry.fields.author ?? entry.key).split(',')[0]} ${entry.fields.year ?? ''}`.trim()
  }
  const context: VisualContext = {
    selectionFrom: selection.from,
    selectionTo: selection.to,
    bibLabels,
    renderMath: (latex: string, display: boolean) => renderKatex(latex, display),
    resolveImage: resolveImagePath,
  }

  const tasks = buildVisualTasks(text, context)
  const ranges = tasks.map((task) => {
    if (task.type === 'line') {
      return Decoration.line({ class: task.className }).range(task.from)
    }
    if (task.type === 'mark') {
      return Decoration.mark({ class: task.className }).range(task.from, task.to)
    }
    const widget =
      task.widget.kind === 'math'
        ? new MathWidget(task.widget.latex, task.widget.display, task.widget.html)
        : task.widget.kind === 'chip'
          ? new ChipWidget(task.widget.label, task.widget.chipKind)
          : task.widget.kind === 'figure'
            ? new FigureWidget(
                task.widget.src,
                task.widget.caption,
                task.widget.label,
                task.widget.width,
                task.from,
                task.to
              )
            : task.widget.kind === 'table'
              ? new TableWidget(
                  task.widget.rows,
                  task.widget.caption,
                  task.widget.label,
                  task.from,
                  task.to
                )
              : task.widget.kind === 'footnote'
                ? new FootnoteWidget(task.widget.text, task.widget.number)
                : new LabelWidget(task.widget.text)
    return Decoration.replace({ widget, block: task.block }).range(task.from, task.to)
  })
  // Decoration.set sorts and validates the ranges for us; building this by
  // hand with RangeSetBuilder used to throw on same-position decorations.
  return Decoration.set(ranges, true)
}

/** Visual-mode decorations, active only when enabled for the current file. */
export function visualModeExtension(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(readonly view: EditorView) {
        this.decorations = this.build()
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = this.build()
        }
      }
      private build(): DecorationSet {
        if (!useVisualMode.getState().enabled) return Decoration.none
        return buildDecorations(this.view)
      }
    },
    {
      decorations: (instance) => instance.decorations,
      provide: (instance) =>
        EditorView.atomicRanges.of((view) => {
          const active = view.plugin(instance)
          return active ? active.decorations : Decoration.none
        }),
    }
  )

  const reveal = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-visual-from]'
      )
      if (!target || target.hasAttribute('data-visual-no-reveal')) return false
      const from = Number(target.dataset.visualFrom)
      const to = Number(target.dataset.visualTo)
      if (!Number.isFinite(from) || !Number.isFinite(to)) return false
      view.dispatch({ selection: { anchor: from, head: to } })
      view.focus()
      return true
    },
  })

  return [plugin, reveal]
}
