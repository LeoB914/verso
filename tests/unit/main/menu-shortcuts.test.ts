import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { buildMenuTemplate, type MenuActions } from '../../../src/main/menu'

const actions: MenuActions = {
  runCommand: () => undefined,
  openRecent: () => undefined,
}

function collectAccelerators(items: MenuItemConstructorOptions[]): Array<{
  label: string
  accelerator: string
}> {
  const result: Array<{ label: string; accelerator: string }> = []
  for (const item of items) {
    if (item.accelerator) {
      result.push({ label: item.label ?? String(item.role), accelerator: String(item.accelerator) })
    }
    if (Array.isArray(item.submenu)) result.push(...collectAccelerators(item.submenu))
  }
  return result
}

/** Normalise "CmdOrCtrl+Shift+C" / "Mod+Shift+C" to a comparable form. */
function normalize(keys: string): string {
  return keys
    .replace(/CmdOrCtrl/gi, 'Mod')
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .sort()
    .join('+')
}

/** Renderer shortcuts, read from the keymap source (pure text, no imports). */
function rendererKeys(): string[] {
  const source = readFileSync(join(__dirname, '../../../src/shared/commands.ts'), 'utf8')
  return [...source.matchAll(/keys: '([^']+)'/g)].map((match) => normalize(match[1]))
}

describe('menu accelerators', () => {
  it('never binds the same accelerator to two different menu items', () => {
    const accelerators = collectAccelerators(
      buildMenuTemplate(actions, { isMac: true, isPackaged: true })
    )
    const seen = new Map<string, string>()
    for (const entry of accelerators) {
      const key = normalize(entry.accelerator)
      const previous = seen.get(key)
      expect(
        previous,
        `${entry.label} and ${previous} both use ${entry.accelerator}`
      ).toBeUndefined()
      seen.set(key, entry.label)
    }
  })

  it('keeps reload/devtools out of packaged builds', () => {
    const packaged = buildMenuTemplate(actions, { isMac: true, isPackaged: true })
    const flat = JSON.stringify(packaged)
    expect(flat).not.toContain('"reload"')
    expect(flat).not.toContain('"toggleDevTools"')
  })

  it('only adds dev-only items in unpackaged builds, off the renderer keys', () => {
    const dev = buildMenuTemplate(actions, { isMac: true, isPackaged: false })
    const devOnly = collectAccelerators(dev).filter(
      (entry) => entry.label === 'reload' || entry.label === 'toggleDevTools'
    )
    expect(devOnly.some((a) => a.label === 'reload')).toBe(true)
    const keys = new Set(rendererKeys())
    for (const entry of devOnly) {
      expect(keys.has(normalize(entry.accelerator)), entry.accelerator).toBe(false)
    }
  })

  it('does not duplicate the Settings accelerator across menus', () => {
    for (const isMac of [true, false]) {
      const accelerators = collectAccelerators(
        buildMenuTemplate(actions, { isMac, isPackaged: true })
      )
      const settings = accelerators.filter((a) => a.accelerator === 'CmdOrCtrl+,')
      expect(settings).toHaveLength(1)
    }
  })
})

describe('menu entries for project tools', () => {
  function labels(items: MenuItemConstructorOptions[]): string[] {
    return items.flatMap((item) => [
      item.label ?? '',
      ...(Array.isArray(item.submenu) ? labels(item.submenu) : []),
    ])
  }

  it('offers ZIP export, save as template, new branch and the logs folder', () => {
    const all = labels(buildMenuTemplate(actions, { isMac: true, isPackaged: true }))
    expect(all).toEqual(
      expect.arrayContaining([
        'Export Project as ZIP…',
        'Save Project as Template…',
        'New Git Branch…',
        'Open Logs Folder',
      ])
    )
  })
})
