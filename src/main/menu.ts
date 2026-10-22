import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { commandDefinitions, electronAccelerator, resolveKeybindings } from '@shared/commands'
import { getSettings } from './store'
import { listProjects } from './project/registry'

export interface MenuActions {
  /** Executes a registry command in the renderer. */
  runCommand: (id: string) => void
  /** Opens a project from the recent list. */
  openRecent: (path: string) => void
}

interface MenuOptions {
  isMac: boolean
  isPackaged: boolean
  customKeys?: Record<string, string>
  vimEnabled?: boolean
  recentProjects?: Array<{ name: string; path: string; exists: boolean; lastOpened: number }>
}

function commandItem(
  id: string,
  actions: MenuActions,
  keys: Record<string, string>
): MenuItemConstructorOptions {
  const command = commandDefinitions.find((candidate) => candidate.id === id)
  return {
    label: command?.label ?? id,
    accelerator: keys[id] ? electronAccelerator(keys[id]) : undefined,
    click: () => actions.runCommand(id),
  }
}

/**
 * Pure menu template builder (unit-testable): no Electron side effects.
 * Labels/accelerators come from the shared command registry, so the native
 * menu and the renderer can never disagree about shortcuts.
 */
export function buildMenuTemplate(
  actions: MenuActions,
  options: MenuOptions
): MenuItemConstructorOptions[] {
  const { isMac, isPackaged } = options
  const keys = resolveKeybindings(options.customKeys)

  return [
    ...(isMac
      ? [
          {
            label: 'Verso',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              commandItem('app.settings', actions, keys),
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        commandItem('file.new', actions, keys),
        commandItem('folder.new', actions, keys),
        { type: 'separator' },
        commandItem('file.save', actions, keys),
        commandItem('file.saveAll', actions, keys),
        { type: 'separator' },
        commandItem('project.open', actions, keys),
        {
          label: 'Open Recent',
          submenu: (() => {
            const recent = [...(options.recentProjects ?? [])]
              .sort((a, b) => b.lastOpened - a.lastOpened)
              .slice(0, 8)
            if (recent.length === 0) return [{ label: 'No recent projects', enabled: false }]
            return recent.map((project) => ({
              label: project.name,
              enabled: project.exists,
              click: () => actions.openRecent(project.path),
            }))
          })(),
        },
        { type: 'separator' },
        commandItem('project.exportZip', actions, keys),
        commandItem('project.saveTemplate', actions, keys),
        { type: 'separator' },
        commandItem('tab.close', actions, keys),
        commandItem('tab.closeOthers', actions, keys),
        ...(isMac
          ? []
          : ([{ type: 'separator' }, commandItem('app.settings', actions, keys)] as const)),
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        commandItem('editor.undo', actions, keys),
        commandItem('editor.redo', actions, keys),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        commandItem('editor.bold', actions, keys),
        commandItem('editor.italic', actions, keys),
        commandItem('editor.comment', actions, keys),
      ],
    },
    {
      label: 'Compile',
      submenu: [
        commandItem('compile.run', actions, keys),
        commandItem('compile.fresh', actions, keys),
        commandItem('compile.cancel', actions, keys),
        { type: 'separator' },
        commandItem('compile.toggleAuto', actions, keys),
      ],
    },
    {
      label: 'View',
      submenu: [
        commandItem('view.toggleSidebar', actions, keys),
        commandItem('view.togglePdf', actions, keys),
        commandItem('view.toggleVisual', actions, keys),
        {
          ...commandItem('view.toggleVim', actions, keys),
          type: 'checkbox',
          checked: options.vimEnabled ?? false,
        },
        commandItem('ai.chat', actions, keys),
        commandItem('view.toggleZen', actions, keys),
        { type: 'separator' },
        // Reload/devtools are development-only and must never sit on a key the
        // renderer uses.
        ...(!isPackaged
          ? ([
              { role: 'reload', accelerator: 'CmdOrCtrl+Alt+Shift+R' },
              { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Alt+I' },
              { type: 'separator' },
            ] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        commandItem('go.file', actions, keys),
        commandItem('go.section', actions, keys),
        commandItem('go.commands', actions, keys),
        commandItem('go.search', actions, keys),
        { type: 'separator' },
        commandItem('synctex.forward', actions, keys),
      ],
    },
    {
      label: 'Insert',
      submenu: [
        commandItem('bib.citePicker', actions, keys),
        commandItem('table.insert', actions, keys),
        commandItem('symbols.palette', actions, keys),
        commandItem('editor.mathBlock', actions, keys),
      ],
    },
    {
      label: 'History',
      submenu: [
        commandItem('history.toggle', actions, keys),
        commandItem('history.label', actions, keys),
      ],
    },
    {
      label: 'Project',
      submenu: [
        commandItem('project.close', actions, keys),
        commandItem('project.home', actions, keys),
        { type: 'separator' },
        commandItem('git.newBranch', actions, keys),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Verso Help', enabled: false },
        { type: 'separator' },
        commandItem('app.openLogs', actions, keys),
      ],
    },
  ]
}

let installedActions: MenuActions | null = null

export function installApplicationMenu(actions: MenuActions): void {
  installedActions = actions
  rebuildApplicationMenu()
}

/** Rebuild after a settings/keybinding change (called from the settings IPC). */
export function rebuildApplicationMenu(): void {
  if (!installedActions) return
  const settings = getSettings()
  const template = buildMenuTemplate(installedActions, {
    isMac: process.platform === 'darwin',
    isPackaged: app.isPackaged,
    customKeys: settings.customKeys,
    vimEnabled: settings.vimEnabled,
    recentProjects: listProjects(),
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
