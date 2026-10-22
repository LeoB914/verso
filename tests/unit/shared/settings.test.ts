import { describe, expect, it } from 'vitest'
import { migrateSettings, parseSettings, appSettingsSchema } from '../../../src/shared/settings'

describe('settings schema', () => {
  it('applies defaults to an empty object', () => {
    const settings = parseSettings({})
    expect(settings.appTheme).toBe('system')
    expect(settings.editorFontSize).toBe(14)
    expect(settings.autoCompileDelayMs).toBe(1500)
  })

  it('migrates a settingsVersion-less shape to v1', () => {
    const migrated = migrateSettings({ vimEnabled: true })
    expect(migrated.settingsVersion).toBe(1)
  })

  it('keeps valid values through migration', () => {
    const migrated = migrateSettings({ editorFontSize: 16, settingsVersion: 1 })
    const settings = parseSettings(migrated)
    expect(settings.editorFontSize).toBe(16)
  })

  it('salvages valid fields when others are invalid', () => {
    const settings = parseSettings({ editorFontSize: 999, appTheme: 'dark' })
    expect(settings.editorFontSize).toBe(14) // invalid → default
    expect(settings.appTheme).toBe('dark') // valid → kept
  })

  it('rejects out-of-range enum values at the schema level', () => {
    const result = appSettingsSchema.safeParse({ appTheme: 'sepia' })
    expect(result.success).toBe(false)
  })
})
