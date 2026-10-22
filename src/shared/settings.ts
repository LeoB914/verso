import { z } from 'zod'

/**
 * App settings schema (shared, zod-validated). Stored via electron-store in
 * the main process; `settingsVersion` enables migrations.
 */

export const appSettingsSchema = z.object({
  settingsVersion: z.number().int().default(1),

  // General
  autosaveEnabled: z.boolean().default(true),
  autosaveDelayMs: z.number().int().min(200).max(30_000).default(1000),
  confirmBeforeDelete: z.boolean().default(true),
  defaultProjectDir: z.string().nullable().default(null),

  // Appearance
  appTheme: z.enum(['light', 'dark', 'system']).default('system'),
  accentOverride: z.string().nullable().default(null),
  editorThemeLight: z.string().default('openleaf-light'),
  editorThemeDark: z.string().default('openleaf-dark'),
  uiDensity: z.enum(['compact', 'regular']).default('regular'),

  // Editor
  editorFontFamily: z
    .string()
    .default('ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'),
  editorFontSize: z.number().int().min(8).max(32).default(14),
  editorLineHeight: z.number().min(1).max(3).default(1.6),
  tabWidth: z.number().int().min(2).max(8).default(2),
  softWrap: z.boolean().default(true),
  lineNumbers: z.boolean().default(true),
  highlightActiveLine: z.boolean().default(true),
  autocompleteEnabled: z.boolean().default(true),
  autocloseBrackets: z.boolean().default(true),
  vimEnabled: z.boolean().default(false),

  // Compiler
  defaultCompiler: z.enum(['pdflatex', 'xelatex', 'lualatex']).default('pdflatex'),
  autoCompileDelayMs: z.number().int().min(500).max(10_000).default(1500),
  compileTimeoutMs: z.number().int().min(10_000).max(600_000).default(120_000),
  shellEscapeDefault: z.boolean().default(false),

  // Spelling
  spellLanguage: z.enum(['en', 'de']).default('en'),
  spellEnabled: z.boolean().default(true),

  // Citation insertion command used by the References panel.
  citeCommand: z
    .enum(['cite', 'parencite', 'textcite', 'autocite', 'citep', 'citet'])
    .default('cite'),

  // Zen mode
  zenMaxWidthCh: z.number().int().min(40).max(200).default(80),
  zenTypewriterScroll: z.boolean().default(false),
  zenEnterFullscreen: z.boolean().default(false),

  // Keyboard overrides: command id → key string (Mod notation).
  customKeys: z.record(z.string(), z.string()).default({}),

  // AI provider (keys stored separately, encrypted with safeStorage).
  aiProvider: z
    .object({
      kind: z.enum(['ollama', 'openai-compatible', 'anthropic']),
      baseUrl: z.string().optional(),
      model: z.string().default('llama3.2'),
    })
    .default({ kind: 'ollama', model: 'llama3.2' }),
})

export type AppSettingsData = z.output<typeof appSettingsSchema>

/** Migrate older settings shapes to the current version. */
export function migrateSettings(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated = { ...raw }
  // v0 → v1: nested legacy keys flattened, defaults applied by the schema.
  if (typeof migrated.settingsVersion !== 'number') {
    migrated.settingsVersion = 1
    // Legacy Phase 2/3 flags lived at the top level already; nothing to move.
  }
  // Example forward-compatible migration hook.
  return migrated
}

/** Validate settings; invalid input falls back field-by-field to defaults. */
export function parseSettings(raw: unknown): AppSettingsData {
  const result = appSettingsSchema.safeParse(raw)
  if (result.success) return result.data
  // Salvage: parse field by field.
  const defaults = appSettingsSchema.parse({})
  const partial = (raw ?? {}) as Record<string, unknown>
  const salvaged: Record<string, unknown> = { ...defaults }
  for (const key of Object.keys(defaults)) {
    const single = appSettingsSchema
      .pick({ [key]: true } as never)
      .safeParse({ [key]: partial[key] })
    if (single.success) {
      Object.assign(salvaged, single.data)
    }
  }
  return salvaged as AppSettingsData
}
