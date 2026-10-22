import { describe, expect, it } from 'vitest'
import { detectConflict } from '../../../src/renderer/components/SettingsDialog'
import { commandRegistry } from '../../../src/renderer/keymap'

describe('keybinding conflict detection', () => {
  it('detects a direct conflict with the registry', () => {
    // file.save owns Mod+S, so reassigning another command to Mod+S conflicts.
    expect(detectConflict('compile.run', 'Mod+S')).toBe('Save')
  })

  it('normalizes Cmd/Meta to Mod', () => {
    expect(detectConflict('compile.run', 'Cmd+S')).toBe('Save')
  })

  it('returns null for unique keys', () => {
    expect(detectConflict('file.save', 'Mod+Shift+F9')).toBeNull()
  })

  it('registry has no internal conflicts by default', () => {
    const seen = new Map<string, string>()
    for (const command of commandRegistry) {
      if (!command.keys) continue
      const normalized = command.keys
        .toLowerCase()
        .replace(/\s/g, '')
        .replace(/cmd|meta/g, 'mod')
      const previous = seen.get(normalized)
      expect(previous, `${command.id} conflicts with ${previous}`).toBeUndefined()
      seen.set(normalized, command.id)
    }
  })
})
