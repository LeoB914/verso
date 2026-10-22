import { describe, expect, it } from 'vitest'
import { commandRegistry } from '../../../src/renderer/keymap'

/** Normalise "Mod+Shift+C" for duplicate detection. */
function normalize(keys: string): string {
  return keys
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .sort()
    .join('+')
}

describe('keymap registry', () => {
  it('binds the cite picker to Mod+Shift+C', () => {
    const cite = commandRegistry.find((c) => c.id === 'bib.citePicker')
    expect(cite?.keys).toBe('Mod+Shift+C')
  })

  it('lists every command App binds (otherwise bind() silently does nothing)', () => {
    for (const id of [
      'history.toggle',
      'history.label',
      'bib.citePicker',
      'table.insert',
      'symbols.palette',
      'ai.chat',
      'view.toggleVisual',
      'go.section',
    ]) {
      expect(
        commandRegistry.some((c) => c.id === id),
        id
      ).toBe(true)
    }
  })

  it('has no duplicate keybindings', () => {
    const seen = new Map<string, string>()
    for (const command of commandRegistry) {
      if (!command.keys) continue
      const key = normalize(command.keys)
      const previous = seen.get(key)
      expect(previous, `${command.id} and ${previous} both use ${command.keys}`).toBeUndefined()
      seen.set(key, command.id)
    }
  })

  it('keeps Mod+R for Go to Section', () => {
    const section = commandRegistry.find((c) => c.id === 'go.section')
    expect(section?.keys).toBe('Mod+R')
  })
})
