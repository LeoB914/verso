import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import type { CommandContext } from '@shared/commands'
import { api } from './api'
import { getActiveEditorView } from './editor/CodeMirrorEditor'
import { insertMathBlock } from './editor/format-actions'
import { toggleComment, wrapSelection } from './editor/latex-editing'
import {
  createGitBranch,
  createProjectEntry,
  exportProjectAsZip,
  saveProjectAsTemplate,
} from './project-actions'
import { askText } from './stores/prompt'
import { useCompileStore } from './stores/compile'
import { useEditorStore } from './stores/editor'
import { useHistoryStore } from './stores/history'
import { useProjectStore } from './stores/project'
import { useSettingsStore } from './stores/settings'
import { useUiStore } from './stores/ui'
import { useVisualMode } from './stores/visualMode'
import { toast } from './stores/toast'

/** Context used for command availability (palette/disabled state). */
export function getCommandContext(): CommandContext {
  const editor = useEditorStore.getState()
  const active = editor.tabs.find((tab) => tab.relPath === editor.activePath)
  const project = useProjectStore.getState().project
  const compile = useCompileStore.getState()
  const ui = useUiStore.getState()
  const settings = useSettingsStore.getState().settings
  const view = getActiveEditorView()
  return {
    projectOpen: project !== null,
    tabOpen: active !== undefined,
    editableTab: active !== undefined && !active.readOnly && active.preview === undefined,
    compiling: compile.status.state === 'compiling',
    pdfVisible: ui.pdfVisible,
    sidebarVisible: ui.sidebarVisible,
    chatVisible: ui.chatVisible,
    vimEnabled: settings?.vimEnabled ?? false,
    visualEnabled: useVisualMode.getState().enabled,
    historyOpen: useHistoryStore.getState().open,
    canUndo: view ? undoDepth(view.state) > 0 : false,
    canRedo: view ? redoDepth(view.state) > 0 : false,
  }
}

function isTextField(element: Element | null): boolean {
  if (!element) return false
  const tag = element.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    (element as HTMLElement).isContentEditable
  )
}

async function saveAllOrReport(): Promise<boolean> {
  const ok = await useEditorStore.getState().saveAll()
  if (!ok) toast('error', 'Some files could not be saved.')
  return ok
}

/** Execute a command by id. Used by the keyboard, native menu and palette. */
export function runCommand(id: string): void {
  rememberCommand(id)
  const editor = useEditorStore.getState()
  const ui = useUiStore.getState()
  const view = getActiveEditorView()

  switch (id) {
    case 'project.open':
      void api.invoke('project:choose', undefined)
      return
    case 'project.close':
      void useProjectStore.getState().closeProject()
      return
    case 'wordcount.details':
      ui.setWordCountOpen(true)
      return
    case 'project.home':
      void (async () => {
        if (await saveAllOrReport()) await useProjectStore.getState().closeProject()
      })()
      return
    case 'project.exportZip': {
      const current = useProjectStore.getState().project
      if (current) void exportProjectAsZip(current.path)
      return
    }
    case 'project.saveTemplate': {
      const current = useProjectStore.getState().project
      if (current) void saveProjectAsTemplate(current.path, current.name)
      return
    }
    case 'git.newBranch':
      void createGitBranch()
      return
    case 'app.openLogs':
      void api.invoke('logs:openFolder', undefined)
      return
    case 'file.new':
      void createProjectEntry('file')
      return
    case 'folder.new':
      void createProjectEntry('folder')
      return
    case 'file.save':
      void editor.save()
      return
    case 'file.saveAll':
      void saveAllOrReport()
      return
    case 'tab.close':
      if (editor.activePath) void editor.closeTab(editor.activePath)
      return
    case 'tab.closeOthers':
      if (editor.activePath) void editor.closeOtherTabs(editor.activePath)
      return
    case 'compile.run':
      void useCompileStore.getState().startCompile()
      return
    case 'compile.fresh':
      void useCompileStore.getState().startFreshCompile()
      return
    case 'compile.cancel':
      void useCompileStore.getState().cancelCompile()
      return
    case 'compile.toggleAuto': {
      const compile = useCompileStore.getState()
      void compile.setAutoCompile(!compile.autoCompile)
      return
    }
    case 'synctex.forward':
      void (async () => {
        const path = editor.activePath
        if (!path || !view) return
        const pos = view.state.selection.main.head
        const line = view.state.doc.lineAt(pos)
        await api.invoke('synctex:forward', {
          relPath: path,
          line: line.number,
          column: pos - line.from,
        })
      })()
      return
    case 'view.toggleSidebar':
      ui.toggleSidebar()
      return
    case 'view.togglePdf':
      ui.togglePdf()
      return
    case 'view.toggleVisual': {
      const active = editor.tabs.find((tab) => tab.relPath === editor.activePath)
      if (!active || active.readOnly || active.preview) return
      const visual = useVisualMode.getState()
      visual.setEnabled(!visual.enabled)
      return
    }
    case 'view.toggleVim': {
      const settings = useSettingsStore.getState()
      void settings.update({ vimEnabled: !(settings.settings?.vimEnabled ?? false) })
      return
    }
    case 'view.toggleZen':
      ui.setZenMode()
      return
    case 'ai.chat':
      ui.setChatVisible(!ui.chatVisible)
      return
    case 'go.file':
      ui.openPalette('files')
      return
    case 'go.section':
      ui.openPalette('sections')
      return
    case 'go.commands':
      ui.openPalette('commands')
      return
    case 'go.search':
      ui.setSidebarSegment('search')
      ui.setSidebarVisible(true)
      window.setTimeout(() => {
        document.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus()
      }, 60)
      return
    case 'bib.citePicker':
      ui.openPalette('cites')
      return
    case 'table.insert':
      ui.setTableDialogOpen(true)
      return
    case 'symbols.palette':
      ui.setSidebarSegment('symbols')
      ui.setSidebarVisible(true)
      return
    case 'editor.bold':
      if (view) wrapSelection(view, '\\textbf')
      return
    case 'editor.italic':
      if (view) wrapSelection(view, '\\textit')
      return
    case 'editor.comment':
      if (view) toggleComment.run?.(view)
      return
    case 'editor.mathBlock':
      if (view) insertMathBlock(view)
      return
    case 'editor.undo':
      if (isTextField(document.activeElement)) document.execCommand('undo')
      else if (view) undo(view)
      return
    case 'editor.redo':
      if (isTextField(document.activeElement)) document.execCommand('redo')
      else if (view) redo(view)
      return
    case 'history.toggle': {
      const history = useHistoryStore.getState()
      history.setOpen(!history.open)
      return
    }
    case 'history.label':
      void (async () => {
        const label = await askText({
          title: 'Save version',
          label: 'Label for this version',
          placeholder: 'e.g. Before restructuring the introduction',
          confirmLabel: 'Save version',
        })
        if (label) void useHistoryStore.getState().snapshotNow('Manual version', label)
      })()
      return
    case 'app.settings':
      void useSettingsStore.getState().setOpen(true)
      return
    default:
      return
  }
}

// --- Recently used commands (palette ordering) -----------------------------

const RECENT_KEY = 'verso.recent-commands'
const RECENT_LIMIT = 8

export function recentCommandIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function rememberCommand(id: string): void {
  try {
    const next = [id, ...recentCommandIds().filter((existing) => existing !== id)].slice(
      0,
      RECENT_LIMIT
    )
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // localStorage can be unavailable; recency is a nicety, not correctness.
  }
}
