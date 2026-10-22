import { describe, expect, it } from 'vitest'
import {
  commandDefinitions,
  commandForKeyEvent,
  detectKeyConflict,
  getCommand,
  keyEventToSpec,
  normalizeKeySpec,
  resolveKeybindings,
} from '@shared/commands'

describe('command registry', () => {
  it('has unique ids and unique default shortcuts', () => {
    const ids = new Set<string>()
    const keys = new Set<string>()
    for (const command of commandDefinitions) {
      expect(ids.has(command.id), command.id).toBe(false)
      ids.add(command.id)
      if (!command.keys) continue
      const key = normalizeKeySpec(command.keys)
      expect(keys.has(key), `${command.id} duplicates ${key}`).toBe(false)
      keys.add(key)
    }
  })

  it('resolves defaults, overrides and unbinding', () => {
    const bindings = resolveKeybindings({
      'file.save': 'Mod+Shift+K',
      'editor.bold': '',
      'does.not.exist': 'Mod+Shift+Z',
    })
    expect(bindings['file.save']).toBe('Mod+Shift+K')
    expect(bindings['editor.bold']).toBeUndefined()
    expect(bindings['editor.italic']).toBe('Mod+I')
  })

  it('normalises modifier order and key case', () => {
    expect(normalizeKeySpec('shift+cmd+p')).toBe('Mod+Shift+P')
    expect(normalizeKeySpec('alt+mod+arrowright')).toBe('Mod+Alt+ArrowRight')
    expect(getCommand('go.commands')?.keys).toBe('Mod+Shift+P')
  })

  it('extracts shortcuts from DOM keyboard events', () => {
    expect(
      keyEventToSpec({ key: 'P', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })
    ).toBe('Mod+Shift+P')
    expect(
      keyEventToSpec({
        key: 'Control',
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      })
    ).toBeNull()
  })

  it('detects conflicting bindings', () => {
    const bindings = resolveKeybindings(undefined)
    expect(detectKeyConflict('compile.run', 'Mod+S', bindings)).toBe('Save')
    expect(detectKeyConflict('compile.run', 'Mod+Shift+F9', bindings)).toBeNull()
  })
})

describe('keyboard layouts', () => {
  const key = (k: string, mods: { shift?: boolean; alt?: boolean } = {}) => ({
    key: k,
    metaKey: true,
    ctrlKey: false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  })
  const bindings = resolveKeybindings(undefined)

  it('matches Mod+/ when the layout needs Shift for "/" (German: Shift+7)', () => {
    expect(commandForKeyEvent(key('/', { shift: true }), bindings)).toBe('editor.comment')
  })

  it('prefers the exact Shift binding over the fallback', () => {
    expect(commandForKeyEvent(key('Z', { shift: true }), bindings)).toBe('editor.redo')
    expect(commandForKeyEvent(key('z'), bindings)).toBe('editor.undo')
  })

  it('never drops Shift for letters', () => {
    expect(commandForKeyEvent(key('S', { shift: true }), bindings)).toBe('file.saveAll')
    expect(commandForKeyEvent(key('s'), bindings)).toBe('file.save')
  })
})
