import { useEffect, useRef } from 'react'
import { EditorState, Compartment, Transaction, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import { defaultKeymap, history, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  snippet,
} from '@codemirror/autocomplete'
import { highlightSelectionMatches, searchKeymap, search } from '@codemirror/search'
import { lintKeymap, forEachDiagnostic, forceLinting, linter } from '@codemirror/lint'
import { hoverTooltip } from '@codemirror/view'
import { getCM, vim } from '@replit/codemirror-vim'
import { useEditorStore, perTabStates } from '../stores/editor'
import { useSettingsStore } from '../stores/settings'
import { useProjectIndex } from '../stores/projectIndex'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { figureSnippet } from './format-actions'
import { latexLanguage } from './latex-language'
import { themeExtensions } from './editor-themes'
import { latexCompletionSource } from './completion'
import { latexEnter, latexDollar, latexPairs, syncBeginEnd } from './latex-editing'
import { structureField, latexFoldService } from './folding'
import { spellcheckLinter, requestSuggestions } from './spellcheck'
import { visualModeExtension } from './visual-extension'
import { useVisualMode } from '../stores/visualMode'
import {
  createCompileDiagnosticsLinter,
  showStashedDiagnostics,
  stashDiagnosticsForFile,
} from './diagnostics'
import { citationInsertion } from '@shared/latex/citations'
import { htmlToLatex } from '@shared/latex/html-to-latex'
import { useCompileStore } from '../stores/compile'
import { api } from '../api'

interface EditorProps {
  dark: boolean
}

/** CodeMirror defaults overridden by the central command dispatcher. */
const GLOBAL_COMMAND_KEYS = new Set(['Mod-Enter', 'Mod-i', 'Mod-Alt-\\', 'Mod-/'])

/** Build the (shared) extension list once. */
function buildExtensions(
  dark: boolean,
  themeCompartment: Compartment,
  vimCompartment: Compartment,
  readOnlyCompartment: Compartment,
  editorSettingsCompartment: Compartment,
  behaviorCompartment: Compartment,
  visualCompartment: Compartment
) {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      const path = viewPathByView.get(update.view) ?? null
      if (path) {
        useEditorStore.getState().updateContent(path, update.state.doc.toString())
        syncBeginEnd(update)
      }
      // Auto-compile scheduler tick.
      useCompileStore.getState().notifyUserActivity()
      if (
        useUiStore.getState().zenMode &&
        useSettingsStore.getState().settings?.zenTypewriterScroll
      ) {
        const head = update.state.selection.main.head
        requestAnimationFrame(() => {
          update.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
        })
      }
    }
    if (update.selectionSet || update.docChanged) {
      const range = update.state.selection.main
      const pos = range.head
      const line = update.state.doc.lineAt(pos)
      useEditorStore.getState().setCursor(line.number, pos - line.from + 1)
      if (!range.empty) {
        const start = update.view.coordsAtPos(range.from)
        const end = update.view.coordsAtPos(range.to)
        const rect = update.view.dom.getBoundingClientRect()
        if (start && end) {
          useEditorStore.getState().setSelectionInfo({
            from: range.from,
            to: range.to,
            text: update.state.doc.sliceString(range.from, range.to),
            left: start.left - rect.left,
            top: start.top - rect.top,
            bottom: end.bottom - rect.top,
          })
        }
      } else {
        useEditorStore.getState().setSelectionInfo(null)
      }
    }
  })

  // Constrain the editor to its container so .cm-scroller scrolls internally
  // (without this, .cm-editor grows with the content and the page cannot scroll).
  const heightTheme = EditorView.theme({
    '&': { height: '100%' },
    '.cm-scroller': { overflow: 'auto' },
  })

  return [
    heightTheme,
    highlightActiveLineGutter(),
    history(),
    foldGutter(),
    drawSelection(),
    rectangularSelection(),
    crosshairCursor(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    search({ top: true }),
    behaviorCompartment.of(buildToggleExtensions(useSettingsStore.getState().settings)),
    latexLanguage,
    structureField,
    latexFoldService,
    spellcheckLinter,
    linter(
      createCompileDiagnosticsLinter((view) => viewPathByView.get(view as EditorView) ?? null)
    ),
    keymap.of([
      latexEnter,
      latexDollar,
      ...latexPairs,
      indentWithTab,
      ...closeBracketsKeymap,
      // These keys are owned by the central command dispatcher (Phase 12).
      // Without removing the CM defaults they would fire twice: app shortcut
      // + CodeMirror default action.
      ...defaultKeymap.filter((binding) => !GLOBAL_COMMAND_KEYS.has(binding.key ?? '')),
      ...searchKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
    EditorView.domEventHandlers({
      paste(event, view) {
        const clipboardEvent = event as ClipboardEvent
        // Rich paste (Word/Pages/browser) → LaTeX. Shift+Mod+V stays plain.
        if ((event as unknown as { shiftKey?: boolean }).shiftKey) return false
        const image = [...(clipboardEvent.clipboardData?.items ?? [])].find((item) =>
          item.type.startsWith('image/')
        )
        if (image) {
          event.preventDefault()
          void (async () => {
            const file = image.getAsFile()
            if (!file) return
            const bytes = new Uint8Array(await file.arrayBuffer())
            let binary = ''
            for (let index = 0; index < bytes.length; index += 0x8000) {
              binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
            }
            const result = await api.invoke('files:importImageBytes', {
              name: file.name || 'pasted-image.png',
              data: btoa(binary),
              targetDir: 'figures',
            })
            if (result.ok) {
              useEditorStore.getState().requestSnippet(figureSnippet(result.data.relPath))
              void useProjectStore.getState().refreshTree()
            }
          })()
          return true
        }
        const html = clipboardEvent.clipboardData?.getData('text/html')
        if (!html) return false
        const latex = htmlToLatex(html)
        if (!latex.trim()) return false
        event.preventDefault()
        const range = view.state.selection.main
        view.dispatch({
          changes: { from: range.from, to: range.to, insert: latex },
          selection: { anchor: range.from + latex.length },
          annotations: Transaction.userEvent.of('input.paste'),
        })
        return true
      },
    }),
    updateListener,
    EditorView.contentAttributes.of({
      'aria-label': 'LaTeX editor',
      spellcheck: 'false',
    }),
    hoverTooltip(
      async (view, pos) => {
        const text = view.state.doc.toString()
        // Cite key hover: \cite{key}
        const line = view.state.doc.lineAt(pos)
        const before = line.text.slice(0, pos - line.from)
        const citeMatch = /\\[a-zA-Z]*cite[a-zA-Z]*\{([^{}]*)$/.exec(before)
        if (citeMatch) {
          const key = citeMatch[1].split(',').pop()?.trim() ?? ''
          const index = useProjectIndex.getState()
          const entry = index.bibEntries.get(key)
          if (entry) {
            return {
              pos: pos - key.length,
              create: () => {
                const dom = document.createElement('div')
                dom.className = 'text-[12px] leading-snug'
                dom.innerHTML = [
                  `<strong>${entry.key}</strong>`,
                  entry.fields.author ? `<div>${entry.fields.author}</div>` : '',
                  entry.fields.year ? `<div>${entry.fields.year}</div>` : '',
                  entry.fields.title ? `<div><em>${entry.fields.title}</em></div>` : '',
                ].join('')
                return { dom }
              },
            }
          }
          return {
            pos: pos - key.length,
            create: () => {
              const dom = document.createElement('div')
              dom.textContent = `Unknown citation key: ${key}`
              return { dom }
            },
          }
        }
        // Math hover: KaTeX preview.
        const { findMathRange } = await import('@shared/latex/bibliography')
        const range = findMathRange(text, pos)
        if (!range) return null
        const macros: Record<string, string> = {}
        const index = useProjectIndex.getState()
        for (const definition of index.definitions) {
          if (definition.kind === 'command') {
            macros[definition.name] = ''
          }
        }
        const { renderKatex } = await import('../components/SymbolPalette')
        const rendered = renderKatex(range.latex, range.display)
        return {
          pos: range.start,
          end: range.end,
          create: () => {
            const dom = document.createElement('div')
            if (rendered) {
              dom.innerHTML = rendered
            } else {
              dom.textContent = 'Preview not available — compile to see.'
            }
            return { dom }
          },
        }
      },
      { hoverTime: 400 }
    ),
    themeCompartment.of(themeExtensions(themeIdFor(useSettingsStore.getState().settings, dark))),
    vimCompartment.of([]),
    readOnlyCompartment.of([]),
    editorSettingsCompartment.of(
      buildEditorSettingsExtensions(useSettingsStore.getState().settings)
    ),
    // Visual mode lives in a compartment so toggling it reconfigures the
    // extension immediately (a plain ViewPlugin would not notice the store
    // change until the next edit — visual mode appeared to do nothing).
    visualCompartment.of(useVisualMode.getState().enabled ? visualModeExtension() : []),
  ]
}

/** Build the configurable editor extensions from settings. */
function buildEditorSettingsExtensions(
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
): Extension[] {
  if (!settings) return []
  return [
    EditorView.theme({
      '.cm-content, .cm-gutters': {
        fontFamily: settings.editorFontFamily,
        fontSize: settings.editorFontSize + 'px',
        lineHeight: String(settings.editorLineHeight),
      },
    }),
    EditorState.tabSize.of(settings.tabWidth),
  ]
}

/** Editor theme id from settings for the current light/dark mode. */
export function themeIdFor(
  settings: ReturnType<typeof useSettingsStore.getState>['settings'],
  dark: boolean
): string {
  if (!settings) return dark ? 'openleaf-dark' : 'openleaf-light'
  return dark
    ? (settings.editorThemeDark ?? 'openleaf-dark')
    : (settings.editorThemeLight ?? 'openleaf-light')
}

/** Editor behaviour toggles from settings (soft wrap, line numbers, …). */
export function buildToggleExtensions(
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
): Extension[] {
  if (!settings) {
    return [
      lineNumbers(),
      highlightActiveLine(),
      autocompletion({ override: [latexCompletionSource], activateOnTyping: true }),
      closeBrackets(),
      EditorView.lineWrapping,
    ]
  }
  return [
    settings.lineNumbers ? lineNumbers() : [],
    settings.highlightActiveLine ? highlightActiveLine() : [],
    settings.autocompleteEnabled
      ? autocompletion({ override: [latexCompletionSource], activateOnTyping: true })
      : [],
    settings.autocloseBrackets ? closeBrackets() : [],
    settings.softWrap ? EditorView.lineWrapping : [],
  ]
}

/** Which tab is loaded into which view (single editor instance). */
const viewPathByView = new WeakMap<EditorView, string | null>()

/** Currently mounted editor view — used by the formatting toolbar. */
let activeEditorView: EditorView | null = null

export function getActiveEditorView(): EditorView | null {
  return activeEditorView
}

export function CodeMirrorEditor({ dark }: EditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef<Compartment | null>(null)
  const vimCompartmentRef = useRef<Compartment | null>(null)
  const readOnlyCompartmentRef = useRef<Compartment | null>(null)
  const editorSettingsCompartmentRef = useRef<Compartment | null>(null)
  const behaviorCompartmentRef = useRef<Compartment | null>(null)
  const visualCompartmentRef = useRef<Compartment | null>(null)
  const extensionsRef = useRef<unknown[] | null>(null)

  const activePath = useEditorStore((s) => s.activePath)
  const tabs = useEditorStore((s) => s.tabs)
  const jumpRequest = useEditorStore((s) => s.jumpRequest)
  const vimEnabled = useSettingsStore((s) => s.settings?.vimEnabled ?? false)
  const visualEnabled = useVisualMode((s) => s.enabled)

  const activeTab = tabs.find((t) => t.relPath === activePath)

  // Create the editor once.
  useEffect(() => {
    if (!containerRef.current || viewRef.current) return

    const themeCompartment = new Compartment()
    const vimCompartment = new Compartment()
    const readOnlyCompartment = new Compartment()
    const editorSettingsCompartment = new Compartment()
    const behaviorCompartment = new Compartment()
    const visualCompartment = new Compartment()
    themeCompartmentRef.current = themeCompartment
    vimCompartmentRef.current = vimCompartment
    readOnlyCompartmentRef.current = readOnlyCompartment
    editorSettingsCompartmentRef.current = editorSettingsCompartment
    behaviorCompartmentRef.current = behaviorCompartment
    visualCompartmentRef.current = visualCompartment
    const extensions = buildExtensions(
      dark,
      themeCompartment,
      vimCompartment,
      readOnlyCompartment,
      editorSettingsCompartment,
      behaviorCompartment,
      visualCompartment
    )
    extensionsRef.current = extensions as unknown as unknown[]

    const view = new EditorView({
      state: EditorState.create({ doc: '', extensions: extensions as never }),
      parent: containerRef.current,
    })
    viewRef.current = view
    activeEditorView = view
    viewPathByView.set(view, null)

    const contextMenuHandler = (event: MouseEvent): void => {
      void handleContextMenu(event, view)
    }
    view.dom.addEventListener('contextmenu', contextMenuHandler)

    return () => {
      view.dom.removeEventListener('contextmenu', contextMenuHandler)
      if (activeEditorView === view) activeEditorView = null
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep visual-mode per-file memory in sync.
  useEffect(() => {
    useVisualMode.getState().setActivePath(activePath)
  }, [activePath])

  // Swap documents when the active tab changes (preserving per-tab state).
  useEffect(() => {
    const view = viewRef.current
    if (!view || viewPathByView.get(view) === activePath) return

    const previousPath = viewPathByView.get(view) ?? null
    // Only keep the state of a tab that still exists: a closed (or renamed)
    // tab's old state would otherwise resurface with stale content when a
    // file with that path is opened again.
    if (
      previousPath !== null &&
      useEditorStore.getState().tabs.some((t) => t.relPath === previousPath)
    ) {
      perTabStates.set(previousPath, view.state)
    }

    const saved = activePath !== null ? perTabStates.get(activePath) : undefined
    let nextState: EditorState
    if (saved instanceof EditorState) {
      nextState = saved
    } else {
      const content =
        useEditorStore.getState().tabs.find((t) => t.relPath === activePath)?.content ?? ''
      nextState = EditorState.create({
        doc: content,
        extensions: (extensionsRef.current ?? []) as never,
      })
    }

    view.setState(nextState)
    // A restored per-tab state may carry a stale visual-mode compartment
    // value; always reapply the current (per-file) setting.
    const visualCompartment = visualCompartmentRef.current
    if (visualCompartment) {
      const enabled = useVisualMode.getState().enabled
      view.dispatch({
        effects: visualCompartment.reconfigure(enabled ? visualModeExtension() : []),
      })
    }
    viewPathByView.set(view, activePath)
    if (activePath) view.focus()
  }, [activePath])

  // React to content reloads (replace-all, file reload), keeping the cursor
  // on its line where possible.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !activePath || viewPathByView.get(view) !== activePath) return
    const current = view.state.doc.toString()
    if (activeTab && current !== activeTab.content) {
      const head = view.state.selection.main.head
      const line = view.state.doc.lineAt(head)
      const lineNo = line.number
      const column = head - line.from
      const newLines = activeTab.content.split('\n')
      const targetLine = Math.min(lineNo, newLines.length)
      let anchor = 0
      for (let i = 0; i < targetLine - 1; i++) anchor += newLines[i].length + 1
      anchor = Math.min(anchor + column, activeTab.content.length)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: activeTab.content },
        selection: { anchor },
      })
    }
  }, [activeTab?.content, activePath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Switch theme with the app theme / the configured editor themes.
  const editorThemeLight = useSettingsStore((s) => s.settings?.editorThemeLight ?? 'openleaf-light')
  const editorThemeDark = useSettingsStore((s) => s.settings?.editorThemeDark ?? 'openleaf-dark')
  useEffect(() => {
    const view = viewRef.current
    if (!view || !themeCompartmentRef.current) return
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(
        themeExtensions(dark ? editorThemeDark : editorThemeLight)
      ),
    })
  }, [dark, editorThemeLight, editorThemeDark])

  // Apply editor settings live.
  const editorSettings = useSettingsStore((s) => s.settings)
  useEffect(() => {
    const view = viewRef.current
    if (!view || !editorSettingsCompartmentRef.current || !editorSettings) return
    view.dispatch({
      effects: editorSettingsCompartmentRef.current.reconfigure(
        buildEditorSettingsExtensions(editorSettings)
      ),
    })
  }, [editorSettings])

  // Apply the behaviour toggles (line numbers, soft wrap, autocomplete, …).
  useEffect(() => {
    const view = viewRef.current
    if (!view || !behaviorCompartmentRef.current) return
    view.dispatch({
      effects: behaviorCompartmentRef.current.reconfigure(buildToggleExtensions(editorSettings)),
    })
  }, [editorSettings])

  // Toggle visual mode immediately (source ⇄ visual switch).
  useEffect(() => {
    const view = viewRef.current
    const compartment = visualCompartmentRef.current
    if (!view || !compartment) return
    view.dispatch({
      effects: compartment.reconfigure(visualEnabled ? visualModeExtension() : []),
    })
  }, [visualEnabled])

  // Toggle vim mode.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !vimCompartmentRef.current) return
    view.dispatch({
      effects: vimCompartmentRef.current.reconfigure(vimEnabled ? [vim()] : []),
    })
  }, [vimEnabled])

  // Re-open completion when the project index arrives after typing (e.g. the
  // user types \ref{ immediately after a project opens).
  useEffect(() => {
    return useProjectIndex.subscribe((state, previous) => {
      if (state.version === previous.version) return
      const view = viewRef.current
      if (!view || !view.hasFocus) return
      const pos = view.state.selection.main.head
      const line = view.state.doc.lineAt(pos)
      const before = line.text.slice(0, pos - line.from)
      if (/\\(?:[a-zA-Z]+)?\{[^}]*$/.test(before)) startCompletion(view)
    })
  }, [])

  // Vim mode indicator follows the editor's actual mode.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (!vimEnabled) {
      useEditorStore.getState().setVimMode(null)
      return
    }
    let handler: ((event: { mode: string }) => void) | null = null
    const timer = window.setTimeout(() => {
      const cm = getCM(view)
      if (!cm) return
      handler = (event: { mode: string }): void => useEditorStore.getState().setVimMode(event.mode)
      cm.on('vim-mode-change', handler)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      const cm = getCM(view)
      if (cm && handler) cm.off('vim-mode-change', handler)
    }
  }, [vimEnabled])

  // Jump requests (problem list / outline clicks).
  useEffect(() => {
    const view = viewRef.current
    if (!view || !jumpRequest) return
    const lineCount = view.state.doc.lines
    const lineNumber = Math.min(Math.max(1, jumpRequest.line), lineCount)
    const line = view.state.doc.line(lineNumber)
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
    view.focus()
    useEditorStore.getState().clearJump()
  }, [jumpRequest])

  // Insert a citation at the cursor (requested by the References panel).
  const citationRequest = useEditorStore((s) => s.citationRequest)
  useEffect(() => {
    const view = viewRef.current
    if (!view || !citationRequest) return
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    const column = head - line.from
    const insertion = citationInsertion(
      line.text,
      column,
      citationRequest.command,
      citationRequest.key
    )
    const from = line.from + insertion.from
    const to = line.from + insertion.to
    view.dispatch({
      changes: { from, to, insert: insertion.text },
      selection: { anchor: from + insertion.text.length },
      scrollIntoView: true,
    })
    view.focus()
    useEditorStore.getState().clearCitationRequest()
  }, [citationRequest])

  // Insert a snippet at the cursor with tab stops (image drop, commands).
  const snippetRequest = useEditorStore((s) => s.snippetRequest)
  useEffect(() => {
    const view = viewRef.current
    if (!view || !snippetRequest) return
    const head = view.state.selection.main.head
    const apply = snippet(snippetRequest.text)
    apply(view, { label: 'snippet' } as never, head, head)
    view.focus()
    useEditorStore.getState().clearSnippetRequest()
  }, [snippetRequest])

  // Apply compile diagnostics to the active tab; cleared on next compile.
  const logEntries = useCompileStore((s) => s.logEntries)
  const compileVersion = useCompileStore((s) => s.pdfVersion)
  useEffect(() => {
    const view = viewRef.current
    if (!view || !activePath) return
    stashDiagnosticsForFile(activePath, logEntries)
    const apply = (): void => {
      const current = viewRef.current
      if (!current || viewPathByView.get(current) !== activePath) return
      showStashedDiagnostics(current, activePath)
    }
    apply()
    forceLinting(view as never)
    // A lint run that was already in flight when the log arrived can land
    // afterwards with its stale result and replace the diagnostics; repaint a
    // few times instead of re-linting on every view update (which used to
    // hide the hover tooltips for seconds and caused needless work).
    const timers = [300, 1200, 3000, 6000].map((ms) => window.setTimeout(apply, ms))
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [logEntries, compileVersion, activePath])

  // SyncTeX source → PDF (Mod+Alt+Right) runs through the central command
  // dispatcher (`synctex.forward`); auto-compile on edits is handled in the
  // update listener (buildExtensions).

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden bg-[var(--bg-content)]"
      data-testid="editor-container"
    />
  )
}

// --- Native context menu with spellcheck suggestions ----------------------

async function handleContextMenu(event: MouseEvent, view: EditorView): Promise<void> {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos === null) return

  // Git conflict markers: offer resolution actions inside a conflicted block.
  const conflictBlock = findConflictBlock(view.state.doc.toString(), pos)
  if (conflictBlock) {
    event.preventDefault()
    const chosen = await window.openleaf.invoke('menu:popup', {
      items: [
        { id: 'ours', label: 'Accept Current (ours)' },
        { id: 'theirs', label: 'Accept Incoming (theirs)' },
        { id: 'both', label: 'Accept Both' },
      ],
    })
    if (!chosen.ok || !chosen.data) return
    const { from, to, ours, theirs } = conflictBlock
    const insert = chosen.data === 'ours' ? ours : chosen.data === 'theirs' ? theirs : ours + theirs
    view.dispatch({
      changes: { from, to, insert: insert + (insert.endsWith('\n') ? '' : '\n') },
    })
    return
  }

  const diagnostics: Array<{ from: number; to: number; message: string }> = []
  forEachDiagnostic(view.state, (d) =>
    diagnostics.push({ from: d.from, to: d.to, message: d.message })
  )
  const target = diagnostics.find((d) => d.from <= pos && d.to >= pos)
  if (!target) return
  event.preventDefault()

  const word = view.state.doc.sliceString(target.from, target.to)
  const suggestions = await requestSuggestions(word)
  const items = [
    ...suggestions.slice(0, 5).map((s, i) => ({ id: `suggest:${i}`, label: s })),
    ...(suggestions.length > 0 ? [{ id: 'sep1', type: 'separator' as const, label: '' }] : []),
    { id: 'add', label: 'Add to project dictionary' },
    { id: 'ignore', label: 'Ignore word' },
  ]
  const chosen = await window.openleaf.invoke('menu:popup', { items })
  if (!chosen.ok || chosen.data === null) return
  if (chosen.data.startsWith('suggest:')) {
    const replacement = suggestions[Number(chosen.data.slice(8))]
    if (replacement) {
      view.dispatch({ changes: { from: target.from, to: target.to, insert: replacement } })
    }
  } else if (chosen.data === 'add') {
    useEditorStore.getState().ignoreWord(word)
    void import('./spellcheck').then(({ addSpellWord }) => addSpellWord(word))
    void api.invoke('project:dictionary:add', { word }).catch(() => undefined)
  } else if (chosen.data === 'ignore') {
    useEditorStore.getState().ignoreWord(word)
  }
}

// --- Git conflict marker helpers -------------------------------------------

interface ConflictBlock {
  from: number
  to: number
  ours: string
  theirs: string
}

/** Locate the `<<<<<<< … ======= … >>>>>>>` block containing `pos` (if any). */
function findConflictBlock(text: string, pos: number): ConflictBlock | null {
  const startMarker = text.lastIndexOf('<<<<<<<', pos)
  if (startMarker === -1) return null
  const sep = text.indexOf('=======', startMarker)
  const end = text.indexOf('>>>>>>>', startMarker)
  if (sep === -1 || end === -1) return null
  if (pos > end + 7) return null
  const ours = text.slice(text.indexOf('\n', startMarker) + 1, sep)
  const theirs = text.slice(text.indexOf('\n', sep) + 1, end)
  const blockEnd = text.indexOf('\n', end)
  return {
    from: startMarker,
    to: blockEnd === -1 ? text.length : blockEnd + 1,
    ours,
    theirs,
  }
}
