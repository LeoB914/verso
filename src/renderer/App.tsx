import { useEffect, useRef, useSyncExternalStore, useState } from 'react'
import { Group, Panel, Separator, type PanelImperativeHandle } from 'react-resizable-panels'
import { Toolbar } from './components/Toolbar'
import { StatusBar } from './components/StatusBar'
import { Sidebar } from './components/Sidebar'
import { SidebarRail } from './components/SidebarRail'
import { ProblemsPanel } from './components/ProblemsPanel'
import { PdfPane } from './components/PdfPane'
import { TabsBar } from './components/TabsBar'
import { CommandPalette } from './components/CommandPalette'
import { Dashboard } from './components/Dashboard'
import { EditorArea } from './components/EditorArea'
import { HistoryView } from './components/HistoryView'
import { RecoverySheet } from './components/RecoverySheet'
import { PromptDialog } from './components/PromptDialog'
import { useHistoryStore } from './stores/history'
import { SettingsDialog } from './components/SettingsDialog'
import { TableDialog } from './components/TableDialog'
import { WordCountDialog } from './components/WordCountDialog'
import { Toaster } from './components/Toaster'
import { AiChatPanel } from './components/AiChatPanel'
import { useUiStore } from './stores/ui'
import { useEditorStore } from './stores/editor'
import { resetProjectSessionState, useProjectStore } from './stores/project'
import { useSettingsStore } from './stores/settings'
import { subscribeCompileEvents, useCompileStore } from './stores/compile'
import { subscribeProjectIndex, useProjectIndex } from './stores/projectIndex'
import { configureSpellcheck } from './editor/spellcheck'
import { api, invokeOrThrow } from './api'
import { getIsDark, initAppTheme, setAppThemeSetting, subscribeTheme } from './theme'
import { usePromptStore } from './stores/prompt'
import { parseUserTheme, registerUserThemes } from './editor/editor-themes'
import {
  commandDefinitions,
  commandForKeyEvent,
  keyEventToSpec,
  resolveKeybindings,
} from '@shared/commands'
import { runCommand } from './commands'
import { getActiveEditorView } from './editor/CodeMirrorEditor'
import { loadUiState, rememberUiState, resetUiState } from './layout'
import type { ProjectUiState, RecoveryInfo } from '@shared/ipc'
import { strings } from './strings'
import { findMainTex } from '@shared/project-files'

export function App(): React.JSX.Element {
  // Detached PDF window: render only the PDF pane.
  const [detachedMode] = useState(() => location.hash.replace(/^#/, '').startsWith('detached-pdf'))
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)
  const pdfVisible = useUiStore((s) => s.pdfVisible)
  const chatVisible = useUiStore((s) => s.chatVisible)
  // Effective app theme (settings + OS), rendered via data-theme on <html>.
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => getIsDark(),
    () => false
  )

  const paletteOpen = useUiStore((s) => s.paletteOpen)
  const paletteMode = useUiStore((s) => s.paletteMode)
  const closePalette = useUiStore((s) => s.closePalette)
  const tableOpen = useUiStore((s) => s.tableDialogOpen)

  // Pane layout persistence (per project, via the project registry).
  const problemsCollapsed = useUiStore((s) => s.problemsCollapsed)
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null)
  const pdfPanelRef = useRef<PanelImperativeHandle | null>(null)
  const chatPanelRef = useRef<PanelImperativeHandle | null>(null)
  const problemsPanelRef = useRef<PanelImperativeHandle | null>(null)
  const layoutRef = useRef<ProjectUiState>({})

  const rememberPaneSize = (pane: 'sidebarSize' | 'pdfSize' | 'chatSize' | 'problemsSize') => {
    return (size: { asPercentage: number }): void => {
      const percent = Math.round(size.asPercentage * 10) / 10
      layoutRef.current[pane] = percent
      rememberUiState({ [pane]: percent } as ProjectUiState)
    }
  }

  const rememberVisibility = (patch: ProjectUiState): void => {
    Object.assign(layoutRef.current, patch)
    rememberUiState(patch)
  }

  // TeX detection + index + settings on startup.
  useEffect(() => {
    void useCompileStore.getState().detectTex()
    void (async () => {
      await useSettingsStore.getState().load()
      const settings = useSettingsStore.getState().settings
      if (settings) {
        initAppTheme(settings.appTheme)
        if (settings.accentOverride) {
          document.documentElement.style.setProperty('--accent', settings.accentOverride)
        }
        document.documentElement.dataset.density = settings.uiDensity
      }
      // Register user themes before the editor builds its theme extensions.
      const themes = await api.invoke('userThemes:list', undefined)
      if (themes.ok) {
        const defs = themes.data
          .map((theme) => (theme.error ? null : parseUserTheme(theme.json)))
          .filter((def): def is NonNullable<typeof def> => def !== null)
        registerUserThemes(defs)
        // Re-apply the editor theme now that user themes exist.
        const current = useSettingsStore.getState().settings
        if (current) setAppThemeSetting(current.appTheme)
      }
    })()
  }, [])

  // Accent + theme events from the main process.
  useEffect(() => {
    const offAccent = api.on('app:accent', (color) => {
      if (color) document.documentElement.style.setProperty('--accent', color)
      else document.documentElement.style.removeProperty('--accent')
    })
    const offTheme = api.on('app:theme', (theme) => setAppThemeSetting(theme))
    // Any settings change (even via a direct IPC call) updates the renderer
    // store so every setting takes effect live.
    const offSettings = api.on('app:settings', (settings) => {
      useSettingsStore.setState({ settings: settings as never })
      const appTheme = (settings as { appTheme?: 'light' | 'dark' | 'system' }).appTheme
      if (appTheme) setAppThemeSetting(appTheme)
    })
    return () => {
      offAccent()
      offTheme()
      offSettings()
    }
  }, [])

  const setZenMode = useUiStore((s) => s.setZenMode)

  // Esc closes the topmost dialog/menu/overlay; in focus mode it exits.
  const zenMode = useUiStore((s) => s.zenMode)
  useEffect(() => {
    const enterFullscreen = useSettingsStore.getState().settings?.zenEnterFullscreen ?? false
    if (!enterFullscreen) return
    if (zenMode && !document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => undefined)
    } else if (!zenMode && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    }
  }, [zenMode])
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (usePromptStore.getState().current) {
        usePromptStore.getState().cancel()
        return
      }
      if (paletteOpen) {
        closePalette()
        return
      }
      if (tableOpen) {
        useUiStore.getState().setTableDialogOpen(false)
        return
      }
      if (useSettingsStore.getState().open) {
        useSettingsStore.getState().setOpen(false)
        return
      }
      if (useHistoryStore.getState().open) {
        useHistoryStore.getState().setOpen(false)
        return
      }
      if (zenMode) setZenMode(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [paletteOpen, closePalette, tableOpen, zenMode, setZenMode])

  // Open `main.tex` automatically when a project containing one is opened.
  // Depends on the tree, not on tabs, so closing the tab does not reopen it.
  const projectFileTree = useProjectStore((s) => s.fileTree)
  useEffect(() => {
    if (!projectFileTree) return
    const mainTex = findMainTex(projectFileTree)
    if (!mainTex) return
    const editor = useEditorStore.getState()
    if (editor.tabs.some((tab) => tab.relPath === mainTex)) {
      if (editor.activePath !== mainTex) editor.setActive(mainTex)
      return
    }
    void editor.openFileByPath(mainTex)
  }, [projectFileTree])

  // Project index + spellcheck configuration follow the open project.
  const projectPath = useProjectStore((s) => s.project?.path)
  useEffect(() => {
    if (!projectPath) return
    void useProjectIndex.getState().reindex()
    void (async () => {
      try {
        const project = useProjectStore.getState().project
        const dictionary = await invokeOrThrow('project:dictionary', undefined)
        configureSpellcheck(project?.config.spellLanguage ?? 'en', dictionary)
      } catch {
        configureSpellcheck('en', [])
      }
    })()
  }, [projectPath])

  // Crash recovery: mirror dirty buffers every 5 s (only when they changed);
  // an empty set clears the recovery file.
  useEffect(() => {
    if (!projectPath) return
    // Start from "nothing dirty": an empty set must not be sent right after
    // opening, or it would delete a recovery file the user has not decided on.
    let lastSent = '[]'
    const send = (): void => {
      const editor = useEditorStore.getState()
      const buffers = editor.tabs
        .filter((t) => t.dirty && !t.readOnly && !t.preview)
        .map((t) => ({ relPath: t.relPath, content: t.content, dirty: true }))
      const serialised = JSON.stringify(buffers.map((b) => [b.relPath, b.content]))
      if (serialised === lastSent) return
      lastSent = serialised
      void api.invoke('recovery:save', { buffers })
    }
    const timer = setInterval(send, 5000)
    return () => clearInterval(timer)
  }, [projectPath])

  // Recovered buffers are offered after a crash or a hard renderer reload.
  const [recovery, setRecovery] = useState<RecoveryInfo | null>(null)
  useEffect(() => {
    if (!projectPath) return
    void (async () => {
      const result = await api.invoke('recovery:get', undefined)
      if (result.ok && result.data) setRecovery(result.data)
    })()
  }, [projectPath])

  // Load the persisted pane layout when a project opens (per project, via the
  // project registry); apply sizes + visibility afterwards.
  const [layoutLoadedFor, setLayoutLoadedFor] = useState<string | null>(null)
  const [storedProblemsSize, setStoredProblemsSize] = useState<number | null>(null)
  useEffect(() => {
    if (!projectPath) {
      void (async () => {
        resetUiState()
        setLayoutLoadedFor(null)
      })()
      return
    }
    if (layoutLoadedFor === projectPath) return
    void (async () => {
      const ui = await loadUiState()
      layoutRef.current = ui
      setStoredProblemsSize(ui.problemsSize ?? null)
      if (ui.sidebarVisible !== undefined) {
        useUiStore.getState().setSidebarVisible(ui.sidebarVisible)
      }
      if (ui.pdfVisible !== undefined) useUiStore.getState().setPdfVisible(ui.pdfVisible)
      if (ui.chatVisible !== undefined) useUiStore.getState().setChatVisible(ui.chatVisible)
      if (ui.problemsCollapsed !== undefined) {
        useUiStore.getState().setProblemsCollapsed(ui.problemsCollapsed)
      }
      setLayoutLoadedFor(projectPath)
      // Panels may need a frame to mount before resizing.
      requestAnimationFrame(() => {
        try {
          if (ui.sidebarSize) sidebarPanelRef.current?.resize(`${ui.sidebarSize}%`)
          if (ui.pdfSize) pdfPanelRef.current?.resize(`${ui.pdfSize}%`)
          if (ui.chatSize) chatPanelRef.current?.resize(`${ui.chatSize}%`)
          if (ui.problemsSize) problemsPanelRef.current?.resize(`${ui.problemsSize}%`)
          if (ui.problemsCollapsed ?? true) problemsPanelRef.current?.collapse()
          else if (ui.problemsSize) problemsPanelRef.current?.expand()
        } catch {
          // panels may not be mounted (hidden panes)
        }
      })
    })()
  }, [projectPath, layoutLoadedFor])

  // Restore the previously open tabs/cursor for this project.
  const restoredTabsFor = useRef<string | null>(null)
  useEffect(() => {
    if (!projectPath || layoutLoadedFor !== projectPath || !projectFileTree) return
    if (restoredTabsFor.current === projectPath) return
    restoredTabsFor.current = projectPath
    const ui = layoutRef.current
    const paths = (ui.openTabs ?? []).filter((relPath) => relPath.length > 0)
    if (paths.length === 0) return
    void (async () => {
      const editor = useEditorStore.getState()
      for (const relPath of paths) await editor.openFileByPath(relPath)
      const active = ui.activeTab && paths.includes(ui.activeTab) ? ui.activeTab : paths[0]
      editor.setActive(active)
      if (ui.cursorLine) await editor.applyJump(active, ui.cursorLine)
    })()
  }, [projectPath, layoutLoadedFor, projectFileTree])

  // Keep the problems panel's collapsed state in sync with the ui store
  // (auto-expand on compile errors, toggle button, persisted per project).
  const syncingProblemsRef = useRef(false)
  useEffect(() => {
    const panel = problemsPanelRef.current
    if (!panel) return
    // Suppress the onResize handler while we apply the size programmatically;
    // a stale isCollapsed() during the resize would otherwise toggle the
    // store straight back.
    syncingProblemsRef.current = true
    if (problemsCollapsed) panel.collapse()
    else {
      const stored = layoutRef.current.problemsSize
      if (stored && stored > 5) panel.resize(`${stored}%`)
      else panel.resize('20%')
    }
    window.setTimeout(() => {
      syncingProblemsRef.current = false
    }, 100)
    if (layoutLoadedFor) rememberUiState({ problemsCollapsed })
  }, [problemsCollapsed, layoutLoadedFor])

  // Persist visibility changes (after the stored layout has been loaded, so
  // defaults never overwrite it).
  useEffect(() => {
    if (!projectPath || layoutLoadedFor !== projectPath) return
    rememberVisibility({ sidebarVisible, pdfVisible, chatVisible })
  }, [sidebarVisible, pdfVisible, chatVisible, layoutLoadedFor, projectPath])

  // Compile status + project-opened events; fetch current project on mount.
  useEffect(() => {
    const offProject = api.on('project:opened', (info) => {
      const previous = useProjectStore.getState().project?.path
      if (previous !== info.path) {
        resetProjectSessionState()
        // Drop the old tree before refreshTree so auto-open can never see
        // project A's main.tex while project B is loading.
        useProjectStore.setState({ project: info, fileTree: null })
      } else {
        useProjectStore.setState({ project: info })
      }
      void useProjectStore.getState().refreshTree()
    })
    void (async () => {
      const result = await api.invoke('project:getCurrent', undefined)
      if (result.ok && result.data) {
        if (useProjectStore.getState().project?.path !== result.data.path) {
          resetProjectSessionState()
        }
        useProjectStore.setState({ project: result.data, fileTree: null })
        void useProjectStore.getState().refreshTree()
      }
    })()
    return offProject
  }, [])
  useEffect(() => subscribeCompileEvents(), [])
  useEffect(() => subscribeProjectIndex(), [])

  // Native menu + app events.
  useEffect(() => {
    const offs = [
      api.on('menu:command', (id) => runCommand(id)),
      api.on('menu:open-recent', (path) => void useProjectStore.getState().openPath(path)),
      api.on('editor:open-file', ({ relPath }) => {
        void useEditorStore.getState().openFileByPath(relPath)
      }),
      api.on('editor:goto', ({ relPath, line }) => {
        void useEditorStore.getState().applyJump(relPath, line)
      }),
      api.on('app:query-dirty', (requestId) => {
        void api
          .invoke('app:dirtyTabsReply', {
            requestId,
            count: useEditorStore.getState().dirtyCount(),
          })
          .catch(() => undefined)
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // One keyboard dispatcher for every registry command. Effective shortcuts are
  // read live from settings, so rebinding in Settings applies immediately.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (usePromptStore.getState().current) return
      const spec = keyEventToSpec(event)
      if (!spec) return
      // Keep Mod+K working as a legacy alias for the command palette.
      if (spec === 'Mod+K') {
        event.preventDefault()
        runCommand('go.commands')
        return
      }
      const bindings = resolveKeybindings(useSettingsStore.getState().settings?.customKeys)
      const commandId = commandForKeyEvent(event, bindings)
      const command = commandDefinitions.find((candidate) => candidate.id === commandId)
      if (!command) return
      if (command.scope === 'editor') {
        const view = getActiveEditorView()
        if (!view || !view.hasFocus) return
      }
      event.preventDefault()
      runCommand(command.id)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Persist tabs + cursor for this project (debounced by layout.ts).
  const tabs = useEditorStore((s) => s.tabs)
  const cursorInfo = useEditorStore((s) => s.cursorInfo)
  useEffect(() => {
    if (!projectPath || layoutLoadedFor !== projectPath) return
    rememberUiState({
      openTabs: tabs.filter((tab) => !tab.preview).map((tab) => tab.relPath),
      activeTab: useEditorStore.getState().activePath,
      cursorLine: cursorInfo.line,
      cursorColumn: cursorInfo.column,
    })
  }, [tabs, cursorInfo, projectPath, layoutLoadedFor])

  // Wordcount refresh after saves (debounced).
  useEffect(() => {
    const dirtyCount = tabs.filter((t) => t.dirty).length
    if (dirtyCount > 0) return
    const timer = setTimeout(() => {
      void useCompileStore.getState().refreshWordcount()
    }, 2000)
    return () => clearTimeout(timer)
  }, [tabs])

  // File watcher events: reload clean tabs silently, flag dirty conflicts,
  // refresh the tree on adds/deletes.
  useEffect(() => {
    const reloadOrFlag = (relPath: string): void => {
      const editor = useEditorStore.getState()
      const tab = editor.tabs.find((t) => t.relPath === relPath)
      if (!tab) return
      if (tab.dirty) {
        editor.setDiskConflict(relPath)
      } else {
        void editor.reloadTab(relPath)
      }
    }
    const offFs = api.on('fs:changed', (event) => {
      if (event.type === 'change') reloadOrFlag(event.relPath)
      if (
        event.type === 'add' ||
        event.type === 'unlink' ||
        event.type === 'addDir' ||
        event.type === 'unlinkDir'
      ) {
        void useProjectStore.getState().refreshTree()
      }
    })
    // Writes made by the app itself on the user's behalf (accepting a
    // proposal, history restore, reference updates, replace-all): the editor
    // must pick them up instead of saving over them.
    const offApp = api.on('file:changedByApp', ({ relPath }) => {
      reloadOrFlag(relPath)
      void useProjectStore.getState().refreshTree()
    })
    return () => {
      offFs()
      offApp()
    }
  }, [])

  // Autosave: debounce after the last edit (configurable delay), plus a save
  // when the window loses focus. `tabs` changes on every keystroke.
  const autosaveEnabled = useSettingsStore((s) => s.settings?.autosaveEnabled ?? true)
  const autosaveDelayMs = useSettingsStore((s) => s.settings?.autosaveDelayMs ?? 1000)
  const tabsForAutosave = useEditorStore((s) => s.tabs)
  useEffect(() => {
    if (!autosaveEnabled) return
    const saveDirty = (): void => {
      const editor = useEditorStore.getState()
      const dirty = editor.tabs.filter((t) => t.dirty && !t.readOnly && !t.preview)
      for (const tab of dirty) void editor.saveTab(tab.relPath)
    }
    const timer = setTimeout(saveDirty, autosaveDelayMs)
    window.addEventListener('blur', saveDirty)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('blur', saveDirty)
    }
  }, [tabsForAutosave, autosaveEnabled, autosaveDelayMs])

  const hasProject = useProjectStore((s) => s.project !== null)

  if (detachedMode) {
    return (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <PdfPane dark={dark} />
        </div>
      </div>
    )
  }

  // Zen mode: editor only, centred, with a hover mini bar.
  if (zenMode && hasProject) {
    return (
      <div className="flex h-full flex-col bg-[var(--bg-content)]" data-testid="zen-mode">
        <div className="flex h-8 items-center justify-center opacity-0 transition-opacity duration-150 hover:opacity-100">
          <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1 text-[12px] text-[var(--text-secondary)] shadow-[var(--shadow-popover)]">
            <span>
              {strings.statusWordCount(
                useEditorStore
                  .getState()
                  .tabs.find((t) => t.relPath === useEditorStore.getState().activePath)
                  ?.content.split(/\s+/).length ?? 0
              )}
            </span>
            <button
              className="text-[var(--accent)] hover:underline"
              onClick={() => void useCompileStore.getState().startCompile()}
            >
              {strings.compileButton}
            </button>
            <button className="hover:text-[var(--text-primary)]" onClick={() => setZenMode(false)}>
              Exit focus mode (Esc)
            </button>
          </div>
        </div>
        <div
          className="mx-auto min-h-0 w-full flex-1 px-4"
          style={{ maxWidth: `${useSettingsStore.getState().settings?.zenMaxWidthCh ?? 80}ch` }}
        >
          <EditorArea dark={dark} />
        </div>
      </div>
    )
  }

  // Dashboard view: no project open.
  if (!hasProject) {
    return (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <Dashboard />
        </div>
        <StatusBar />
        <SettingsDialog />
        <Toaster />
        <PromptDialog />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <SidebarRail />
        <Group orientation="horizontal" className="h-full min-w-0 flex-1">
          {sidebarVisible && (
            <>
              <Panel
                id="sidebar"
                minSize="12%"
                defaultSize="20%"
                panelRef={sidebarPanelRef}
                onResize={rememberPaneSize('sidebarSize')}
              >
                <Sidebar />
              </Panel>
              <Separator className="w-px bg-[var(--border-subtle)]" />
            </>
          )}
          <Panel id="editor" minSize="20%">
            <div className="flex h-full flex-col">
              <TabsBar />
              <Group orientation="vertical" className="min-h-0 flex-1">
                <Panel id="editorArea" minSize="25%">
                  <div className="h-full min-h-0 overflow-hidden">
                    <EditorArea dark={dark} />
                  </div>
                </Panel>
                <Separator className="h-px bg-[var(--border-subtle)]" />
                <Panel
                  id="problems"
                  collapsible
                  collapsedSize="28px"
                  minSize="10%"
                  maxSize="60%"
                  defaultSize={
                    problemsCollapsed
                      ? '28px'
                      : storedProblemsSize
                        ? `${storedProblemsSize}%`
                        : '20%'
                  }
                  panelRef={problemsPanelRef}
                  onResize={(size) => {
                    if (syncingProblemsRef.current) return
                    // Pixel-based collapsed detection: isCollapsed() can be
                    // stale right after programmatic resizes.
                    const pixelCollapsed = size.inPixels <= 34
                    if (pixelCollapsed !== problemsCollapsed) {
                      useUiStore.getState().setProblemsCollapsed(pixelCollapsed)
                    } else if (!pixelCollapsed) {
                      rememberPaneSize('problemsSize')(size)
                    }
                  }}
                >
                  <ProblemsPanel />
                </Panel>
              </Group>
            </div>
          </Panel>
          {pdfVisible && (
            <>
              <Separator className="w-px bg-[var(--border-subtle)]" />
              <Panel
                id="pdf"
                minSize="15%"
                defaultSize="40%"
                panelRef={pdfPanelRef}
                onResize={rememberPaneSize('pdfSize')}
              >
                <PdfPane dark={dark} />
              </Panel>
            </>
          )}
          {chatVisible && (
            <>
              <Separator className="w-px bg-[var(--border-subtle)]" />
              <Panel
                id="chat"
                minSize="15%"
                defaultSize="25%"
                panelRef={chatPanelRef}
                onResize={rememberPaneSize('chatSize')}
              >
                <AiChatPanel />
              </Panel>
            </>
          )}
        </Group>
      </div>
      <StatusBar />
      <HistoryView />
      <SettingsDialog />
      {recovery && <RecoverySheet info={recovery} onDone={() => setRecovery(null)} />}
      <Toaster />
      <PromptDialog />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={(open) => {
          if (!open) closePalette()
        }}
        mode={paletteMode}
        key={`${paletteMode}-${paletteOpen}`}
      />
      <TableDialog
        open={tableOpen}
        onClose={() => useUiStore.getState().setTableDialogOpen(false)}
      />
      <WordCountDialog />
    </div>
  )
}

// Debug hook for tests/troubleshooting (dev builds only).
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__OL_DEBUG_HOOK = async () => {
    const { useProjectIndex } = await import('./stores/projectIndex')
    const { useEditorStore } = await import('./stores/editor')
    const indexState = useProjectIndex.getState()
    const editorState = useEditorStore.getState()
    return {
      labels: indexState.labels.length,
      structures: [...indexState.structures.keys()],
      tabContent: editorState.tabs.map((t) => ({
        path: t.relPath,
        tail: t.content.slice(-20),
        dirty: t.dirty,
      })),
      active: editorState.activePath,
    }
  }
}
