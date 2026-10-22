/**
 * One command registry for the whole app.
 *
 * Shared by the renderer (keyboard, palette, settings) and the main process
 * (native menu generation). Definitions are pure metadata; execution lives in
 * `src/renderer/commands.ts`.
 */

export type CommandCategory =
  'App' | 'File' | 'Edit' | 'View' | 'Go' | 'Insert' | 'History' | 'Project' | 'Compile'

export type CommandScope = 'app' | 'editor'

export interface CommandContext {
  projectOpen: boolean
  tabOpen: boolean
  editableTab: boolean
  compiling: boolean
  pdfVisible: boolean
  sidebarVisible: boolean
  chatVisible: boolean
  vimEnabled: boolean
  visualEnabled: boolean
  historyOpen: boolean
  canUndo: boolean
  canRedo: boolean
}

export interface CommandDefinition {
  id: string
  label: string
  category: CommandCategory
  /** Default shortcut in Mod notation (Mod = Cmd on macOS, Ctrl elsewhere). */
  keys?: string
  /** Editor commands only fire while the CodeMirror editor has focus. */
  scope?: CommandScope
  /** Set false to keep a command palette-only (no native menu entry). */
  menu?: boolean
  /** Availability predicate (palette/disabled state). */
  when?: (context: CommandContext) => boolean
}

const project = (context: CommandContext): boolean => context.projectOpen
const editable = (context: CommandContext): boolean => context.tabOpen && context.editableTab

export const commandDefinitions: CommandDefinition[] = [
  // File / project
  { id: 'project.open', label: 'Open Folder…', category: 'File', keys: 'Mod+O' },
  {
    id: 'file.new',
    label: 'New File…',
    category: 'File',
    keys: 'Mod+N',
    when: project,
  },
  {
    id: 'folder.new',
    label: 'New Folder…',
    category: 'File',
    keys: 'Mod+Shift+N',
    when: project,
  },
  {
    id: 'file.save',
    label: 'Save',
    category: 'File',
    keys: 'Mod+S',
    when: editable,
  },
  {
    id: 'file.saveAll',
    label: 'Save All',
    category: 'File',
    keys: 'Mod+Shift+S',
    when: project,
  },
  {
    id: 'tab.close',
    label: 'Close Tab',
    category: 'File',
    keys: 'Mod+W',
    when: (context) => context.tabOpen,
  },
  {
    id: 'tab.closeOthers',
    label: 'Close Other Tabs',
    category: 'File',
    when: (context) => context.tabOpen,
  },
  { id: 'project.close', label: 'Close Project', category: 'Project', when: project },
  {
    id: 'wordcount.details',
    label: 'Word Count Details…',
    category: 'Project',
    when: project,
  },
  {
    id: 'project.exportZip',
    label: 'Export Project as ZIP…',
    category: 'File',
    when: project,
  },
  {
    id: 'project.saveTemplate',
    label: 'Save Project as Template…',
    category: 'File',
    when: project,
  },
  { id: 'git.newBranch', label: 'New Git Branch…', category: 'Project', when: project },
  {
    id: 'project.home',
    label: 'Save All and Show Overview',
    category: 'Project',
    when: project,
  },

  // Compile
  {
    id: 'compile.run',
    label: 'Compile',
    category: 'Compile',
    keys: 'Mod+Enter',
    when: project,
  },
  {
    id: 'compile.fresh',
    label: 'Recompile from Scratch',
    category: 'Compile',
    keys: 'Mod+Alt+Enter',
    when: project,
  },
  {
    id: 'compile.cancel',
    label: 'Cancel Compilation',
    category: 'Compile',
    when: (context) => context.compiling,
  },
  {
    id: 'compile.toggleAuto',
    label: 'Toggle Auto Compile',
    category: 'Compile',
    when: project,
  },
  {
    id: 'synctex.forward',
    label: 'Jump to PDF (SyncTeX)',
    category: 'Go',
    keys: 'Mod+Alt+ArrowRight',
    when: editable,
  },

  // View
  // Letter keys on purpose: a backslash needs Option+Shift+7 on German Mac
  // layouts, so Mod+Backslash and Mod+Alt+Backslash were the same physical key.
  { id: 'view.toggleSidebar', label: 'Toggle Sidebar', category: 'View', keys: 'Mod+Shift+E' },
  {
    id: 'view.togglePdf',
    label: 'Toggle PDF Pane',
    category: 'View',
    keys: 'Mod+Shift+D',
  },
  {
    id: 'view.toggleVisual',
    label: 'Toggle Visual Mode',
    category: 'View',
    keys: 'Mod+Shift+V',
    when: editable,
  },
  { id: 'view.toggleVim', label: 'Toggle Vim Mode', category: 'View' },
  {
    id: 'view.toggleZen',
    label: 'Focus Mode',
    category: 'View',
    keys: 'Mod+Shift+Enter',
  },
  { id: 'ai.chat', label: 'Toggle AI Chat', category: 'View', keys: 'Mod+Shift+L' },

  // Navigate
  { id: 'go.file', label: 'Go to File…', category: 'Go', keys: 'Mod+P', when: project },
  {
    id: 'go.section',
    label: 'Go to Section…',
    category: 'Go',
    keys: 'Mod+R',
    when: project,
  },
  { id: 'go.commands', label: 'Command Palette', category: 'Go', keys: 'Mod+Shift+P' },
  {
    id: 'go.search',
    label: 'Search in Project',
    category: 'Go',
    keys: 'Mod+Shift+F',
    when: project,
  },

  // Insert / editor formatting
  {
    id: 'bib.citePicker',
    label: 'Insert Citation…',
    category: 'Insert',
    keys: 'Mod+Shift+C',
    when: editable,
  },
  { id: 'table.insert', label: 'Insert Table…', category: 'Insert', when: editable },
  { id: 'symbols.palette', label: 'Symbol Palette', category: 'Insert' },
  {
    id: 'editor.bold',
    label: 'Bold',
    category: 'Edit',
    keys: 'Mod+B',
    scope: 'editor',
    when: editable,
  },
  {
    id: 'editor.italic',
    label: 'Italic',
    category: 'Edit',
    keys: 'Mod+I',
    scope: 'editor',
    when: editable,
  },
  {
    id: 'editor.comment',
    label: 'Toggle Comment',
    category: 'Edit',
    keys: 'Mod+/',
    scope: 'editor',
    when: editable,
  },
  {
    id: 'editor.mathBlock',
    label: 'Insert Math Block',
    category: 'Insert',
    scope: 'editor',
    when: editable,
  },
  {
    id: 'editor.undo',
    label: 'Undo',
    category: 'Edit',
    keys: 'Mod+Z',
    scope: 'editor',
    when: (context) => context.editableTab && context.canUndo,
  },
  {
    id: 'editor.redo',
    label: 'Redo',
    category: 'Edit',
    keys: 'Mod+Shift+Z',
    scope: 'editor',
    when: (context) => context.editableTab && context.canRedo,
  },

  // History
  {
    id: 'history.toggle',
    label: 'Version History',
    category: 'History',
    keys: 'Mod+Shift+H',
    when: project,
  },
  { id: 'history.label', label: 'Save Labelled Version…', category: 'History', when: project },

  // App
  { id: 'app.settings', label: 'Settings…', category: 'App', keys: 'Mod+,' },
  { id: 'app.openLogs', label: 'Open Logs Folder', category: 'App' },
]

const commandById = new Map(commandDefinitions.map((command) => [command.id, command]))

export function getCommand(id: string): CommandDefinition | undefined {
  return commandById.get(id)
}

/** Normalised command id → effective shortcut (defaults + user overrides). */
export function resolveKeybindings(
  customKeys: Record<string, string> | null | undefined
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const command of commandDefinitions) {
    if (command.keys) result[command.id] = normalizeKeySpec(command.keys)
  }
  for (const [id, raw] of Object.entries(customKeys ?? {})) {
    if (!commandById.has(id) || typeof raw !== 'string') continue
    if (raw.trim() === '') {
      delete result[id]
      continue
    }
    result[id] = normalizeKeySpec(raw)
  }
  return result
}

export function normalizeKeySpec(spec: string): string {
  const parts = spec
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  let mod = false
  let alt = false
  let shift = false
  const keys: string[] = []
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'mod' || lower === 'cmd' || lower === 'ctrl' || lower === 'meta') mod = true
    else if (lower === 'alt' || lower === 'option') alt = true
    else if (lower === 'shift') shift = true
    else keys.push(part)
  }
  const key = keys
    .join('+')
    .replace(/^arrow(left|right|up|down)$/i, (_, dir: string) => `Arrow${capitalize(dir)}`)
    .replace(/^return$/i, 'Enter')
  const displayKey = key.length === 1 ? key.toUpperCase() : key
  return [...(mod ? ['Mod'] : []), ...(alt ? ['Alt'] : []), ...(shift ? ['Shift'] : []), displayKey]
    .filter(Boolean)
    .join('+')
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

/** Shortcut notation from a DOM keyboard event; null for modifier-only keys. */
export function keyEventToSpec(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'CapsLock'].includes(event.key)) return null
  return normalizeKeySpec(
    [
      event.metaKey || event.ctrlKey ? 'Mod' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
      event.key,
    ]
      .filter(Boolean)
      .join('+')
  )
}

/**
 * Candidate shortcut specs for a keyboard event, most specific first. On many
 * layouts punctuation needs Shift (German `/` = Shift+7), so for single
 * non-letter characters the spec without Shift is tried too — the same rule
 * CodeMirror's keymap uses.
 */
export function keyEventToSpecs(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string[] {
  const exact = keyEventToSpec(event)
  if (!exact) return []
  const specs = [exact]
  if (event.shiftKey && event.key.length === 1 && !/[a-z]/i.test(event.key)) {
    const withoutShift = keyEventToSpec({ ...event, shiftKey: false })
    if (withoutShift && withoutShift !== exact) specs.push(withoutShift)
  }
  return specs
}

/** Command id bound to a keyboard event (exact match wins over the Shift fallback). */
export function commandForKeyEvent(
  event: Parameters<typeof keyEventToSpecs>[0],
  bindings: Record<string, string>
): string | null {
  for (const spec of keyEventToSpecs(event)) {
    const match = Object.entries(bindings).find(([, value]) => value === spec)
    if (match) return match[0]
  }
  return null
}

/** Electron accelerator string for a Mod-notation shortcut. */
export function electronAccelerator(keys: string): string {
  return normalizeKeySpec(keys)
    .replace(/^Mod/, 'CmdOrCtrl')
    .replace(/ArrowLeft/g, 'Left')
    .replace(/ArrowRight/g, 'Right')
    .replace(/ArrowUp/g, 'Up')
    .replace(/ArrowDown/g, 'Down')
}

/** Label of another command already using `keys`, or null. */
export function detectKeyConflict(
  commandId: string,
  keys: string,
  bindings: Record<string, string>
): string | null {
  if (!keys.trim()) return null
  const normalized = normalizeKeySpec(keys)
  for (const [id, value] of Object.entries(bindings)) {
    if (id === commandId) continue
    if (value === normalized) {
      const command = commandById.get(id)
      if (command) return command.label
    }
  }
  return null
}

/** Display helper: `Mod+Shift+P` → `⌘⇧P` on macOS is handled in UI code. */
export function formatKeySpec(keys: string, isMac: boolean): string {
  if (!keys) return ''
  const parts = normalizeKeySpec(keys).split('+')
  if (!isMac) return parts.join('+')
  return parts
    .map((part) => {
      if (part === 'Mod') return '⌘'
      if (part === 'Alt') return '⌥'
      if (part === 'Shift') return '⇧'
      if (part === 'ArrowRight') return '→'
      if (part === 'ArrowLeft') return '←'
      if (part === 'ArrowUp') return '↑'
      if (part === 'ArrowDown') return '↓'
      return part
    })
    .join('')
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
}
