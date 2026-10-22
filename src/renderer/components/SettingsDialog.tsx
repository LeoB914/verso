import { useEffect, useMemo, useState } from 'react'
import {
  commandDefinitions,
  detectKeyConflict,
  formatKeySpec,
  isMacPlatform,
  keyEventToSpec,
  resolveKeybindings,
} from '@shared/commands'
import { useSettingsStore } from '../stores/settings'
import { useCompileStore } from '../stores/compile'
import { api } from '../api'
import { toast } from '../stores/toast'
import { allThemes } from '../editor/editor-themes'

/**
 * Settings dialog with sidebar categories. Settings apply live via the
 * settings store; "Reset to defaults" resets the current section.
 */

type Category =
  'general' | 'appearance' | 'editor' | 'compiler' | 'spelling' | 'keyboard' | 'git' | 'ai'

const CATEGORIES: Array<[Category, string]> = [
  ['general', 'General'],
  ['appearance', 'Appearance'],
  ['editor', 'Editor'],
  ['compiler', 'Compiler'],
  ['spelling', 'Spelling'],
  ['keyboard', 'Keyboard'],
  ['git', 'Git'],
  ['ai', 'AI'],
]

export function SettingsDialog(): React.JSX.Element | null {
  const open = useSettingsStore((s) => s.open)
  const setOpen = useSettingsStore((s) => s.setOpen)
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const [category, setCategory] = useState<Category>('general')
  const [userThemes, setUserThemes] = useState<
    Array<{ id: string; name: string; dark: boolean; error: string | null }>
  >([])
  const [aiProvider, setAiProvider] = useState<{
    kind: 'ollama' | 'openai-compatible' | 'anthropic'
    baseUrl?: string
    model: string
    apiKey?: string
  }>({ kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3.2' })
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const texEnvironment = useCompileStore((s) => s.texEnvironment)
  const detectTex = useCompileStore((s) => s.detectTex)

  useEffect(() => {
    if (!open) return
    void useSettingsStore.getState().load()
    void (async () => {
      const result = await api.invoke('userThemes:list', undefined)
      if (result.ok) setUserThemes(result.data)
    })()
  }, [open])

  if (!open || !settings) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex h-[560px] w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[var(--shadow-popover)]"
        onClick={(e) => e.stopPropagation()}
        data-testid="settings-dialog"
      >
        {/* Sidebar */}
        <div className="w-44 shrink-0 overflow-auto border-r border-[var(--border-subtle)] p-2">
          {CATEGORIES.map(([id, label]) => (
            <button
              key={id}
              className={`block w-full rounded-[var(--radius-sm)] px-2 py-1 text-left text-[14px] ${
                category === id ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]'
              }`}
              onClick={() => setCategory(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-auto p-4 text-[14px]">
          {category === 'general' && (
            <div className="flex flex-col gap-3" data-testid="settings-general">
              <h2 className="text-[16px] font-semibold">General</h2>
              <Row label="Default project location">
                <code className="text-[12px]">{settings.defaultProjectDir ?? '(default)'}</code>
              </Row>
              <Row label="Start screen">
                <span className="text-[12px] text-[var(--text-secondary)]">
                  Always opens the project overview
                </span>
              </Row>
              <Row label="Autosave">
                <Switch
                  checked={settings.autosaveEnabled}
                  onChange={(v) => void update({ autosaveEnabled: v })}
                />
              </Row>
              <Row label="Autosave delay (ms)">
                <NumberField
                  value={settings.autosaveDelayMs}
                  min={200}
                  max={30_000}
                  onChange={(v) => void update({ autosaveDelayMs: v })}
                />
              </Row>
              <Row label="Confirm before delete">
                <Switch
                  checked={settings.confirmBeforeDelete}
                  onChange={(v) => void update({ confirmBeforeDelete: v })}
                />
              </Row>
              <Row label="Welcome screen">
                <button
                  className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[13px] hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    void api.invoke('firstrun:reset', undefined)
                    toast('success', 'The welcome screen will show again when no project is open.')
                  }}
                  data-testid="settings-reset-welcome"
                >
                  Show again on startup
                </button>
              </Row>
            </div>
          )}

          {category === 'appearance' && (
            <div className="flex flex-col gap-3" data-testid="settings-appearance">
              <h2 className="text-[16px] font-semibold">Appearance</h2>
              <Row label="UI density">
                <select
                  className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                  value={settings.uiDensity}
                  onChange={(event) =>
                    void update({ uiDensity: event.target.value as 'compact' | 'regular' })
                  }
                >
                  <option value="regular">Regular</option>
                  <option value="compact">Compact</option>
                </select>
              </Row>
              <Row label="App theme">
                <select
                  className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                  value={settings.appTheme}
                  onChange={(e) =>
                    void update({ appTheme: e.target.value as 'light' | 'dark' | 'system' })
                  }
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </Row>
              <Row label="Accent color">
                <input
                  type="color"
                  value={
                    settings.accentOverride ??
                    (getComputedStyle(document.documentElement)
                      .getPropertyValue('--accent')
                      .trim() ||
                      'var(--accent)')
                  }
                  onChange={(e) => void update({ accentOverride: e.target.value })}
                />
                <button
                  className="ml-2 text-[12px] text-[var(--accent)]"
                  onClick={() => void update({ accentOverride: null })}
                >
                  Follow OS
                </button>
              </Row>
              <Row label="Theme in light mode">
                <ThemePicker
                  value={settings.editorThemeLight}
                  dark={false}
                  userThemes={userThemes}
                  onChange={(v) => void update({ editorThemeLight: v })}
                />
              </Row>
              <Row label="Theme in dark mode">
                <ThemePicker
                  value={settings.editorThemeDark}
                  dark
                  userThemes={userThemes}
                  onChange={(v) => void update({ editorThemeDark: v })}
                />
              </Row>
              <button
                className="self-start text-[13px] text-[var(--accent)] hover:underline"
                onClick={() => void api.invoke('userThemes:openFolder', undefined)}
              >
                Open themes folder
              </button>
              {userThemes.some((t) => t.error) && (
                <p className="text-[12px] text-[var(--danger)]">
                  Invalid theme files:{' '}
                  {userThemes
                    .filter((t) => t.error)
                    .map((t) => t.name)
                    .join(', ')}
                </p>
              )}
            </div>
          )}

          {category === 'editor' && (
            <div className="flex flex-col gap-3" data-testid="settings-editor">
              <h2 className="text-[16px] font-semibold">Editor</h2>
              <Row label="Font family">
                <input
                  className="h-7 w-64 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                  value={settings.editorFontFamily}
                  onChange={(e) => void update({ editorFontFamily: e.target.value })}
                  style={{ fontFamily: settings.editorFontFamily }}
                />
              </Row>
              <Row label="Font size">
                <NumberField
                  value={settings.editorFontSize}
                  min={8}
                  max={32}
                  onChange={(v) => void update({ editorFontSize: v })}
                />
              </Row>
              <Row label="Line height">
                <NumberField
                  value={settings.editorLineHeight}
                  min={1}
                  max={3}
                  step={0.1}
                  onChange={(v) => void update({ editorLineHeight: v })}
                />
              </Row>
              <Row label="Tab width">
                <NumberField
                  value={settings.tabWidth}
                  min={2}
                  max={8}
                  onChange={(v) => void update({ tabWidth: v })}
                />
              </Row>
              <Row label="Soft wrap">
                <Switch
                  checked={settings.softWrap}
                  onChange={(v) => void update({ softWrap: v })}
                />
              </Row>
              <Row label="Line numbers">
                <Switch
                  checked={settings.lineNumbers}
                  onChange={(v) => void update({ lineNumbers: v })}
                />
              </Row>
              <Row label="Highlight active line">
                <Switch
                  checked={settings.highlightActiveLine}
                  onChange={(v) => void update({ highlightActiveLine: v })}
                />
              </Row>
              <Row label="Autocomplete">
                <Switch
                  checked={settings.autocompleteEnabled}
                  onChange={(v) => void update({ autocompleteEnabled: v })}
                />
              </Row>
              <Row label="Auto-close brackets">
                <Switch
                  checked={settings.autocloseBrackets}
                  onChange={(v) => void update({ autocloseBrackets: v })}
                />
              </Row>
              <Row label="Vim mode">
                <Switch
                  checked={settings.vimEnabled}
                  onChange={(v) => void update({ vimEnabled: v })}
                />
              </Row>
            </div>
          )}

          {category === 'compiler' && (
            <div className="flex flex-col gap-3" data-testid="settings-compiler">
              <h2 className="text-[16px] font-semibold">Compiler</h2>
              <Row label="Default compiler">
                <select
                  className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                  value={settings.defaultCompiler}
                  onChange={(e) =>
                    void update({
                      defaultCompiler: e.target.value as 'pdflatex' | 'xelatex' | 'lualatex',
                    })
                  }
                >
                  <option value="pdflatex">pdfLaTeX</option>
                  <option value="xelatex">XeLaTeX</option>
                  <option value="lualatex">LuaLaTeX</option>
                </select>
              </Row>
              <Row label="Auto-compile delay (ms)">
                <NumberField
                  value={settings.autoCompileDelayMs}
                  min={500}
                  max={10_000}
                  onChange={(v) => void update({ autoCompileDelayMs: v })}
                />
              </Row>
              <Row label="Compile timeout (ms)">
                <NumberField
                  value={settings.compileTimeoutMs}
                  min={10_000}
                  max={600_000}
                  onChange={(v) => void update({ compileTimeoutMs: v })}
                />
              </Row>
              <Row label="Shell-escape by default">
                <Switch
                  checked={settings.shellEscapeDefault}
                  onChange={(v) => void update({ shellEscapeDefault: v })}
                />
              </Row>
              <h3 className="mt-2 text-[14px] font-semibold">Detected TeX tools</h3>
              <div className="text-[12px]">
                {texEnvironment &&
                  Object.values(texEnvironment.tools).map((tool) =>
                    tool ? (
                      <p key={tool.name}>
                        <span className="font-mono">{tool.name}</span> —{' '}
                        {tool.version ?? 'unknown version'}
                      </p>
                    ) : null
                  )}
                {texEnvironment && !texEnvironment.available && (
                  <p className="text-[var(--warning)]">No working TeX toolchain found.</p>
                )}
                <button
                  className="mt-1 text-[var(--accent)] hover:underline"
                  onClick={() => void detectTex(true)}
                >
                  Re-check
                </button>
              </div>
            </div>
          )}

          {category === 'spelling' && (
            <div className="flex flex-col gap-3" data-testid="settings-spelling">
              <h2 className="text-[16px] font-semibold">Spelling</h2>
              <Row label="Language">
                <select
                  className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                  value={settings.spellLanguage}
                  onChange={(e) => void update({ spellLanguage: e.target.value as 'en' | 'de' })}
                >
                  <option value="en">English (US)</option>
                  <option value="de">German</option>
                </select>
              </Row>
              <Row label="Spellcheck enabled">
                <Switch
                  checked={settings.spellEnabled}
                  onChange={(v) => void update({ spellEnabled: v })}
                />
              </Row>
            </div>
          )}

          {category === 'git' && (
            <div className="flex flex-col gap-3" data-testid="settings-git">
              <h2 className="text-[16px] font-semibold">Git</h2>
              <p className="text-[13px] text-[var(--text-secondary)]">
                Git uses your system configuration and credentials (SSH agent / credential helper).
                Verso never stores passwords.
              </p>
            </div>
          )}

          {category === 'ai' && (
            <div className="flex flex-col gap-3" data-testid="settings-ai">
              <h2 className="text-[16px] font-semibold">AI</h2>
              <Row label="Provider">
                <select
                  className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                  value={aiProvider.kind}
                  onChange={(e) =>
                    setAiProvider({ ...aiProvider, kind: e.target.value as typeof aiProvider.kind })
                  }
                >
                  <option value="ollama">Ollama (local)</option>
                  <option value="openai-compatible">OpenAI-compatible</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </Row>
              {aiProvider.kind !== 'anthropic' && (
                <Row label="Base URL">
                  <input
                    className="h-7 w-64 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                    value={aiProvider.baseUrl ?? ''}
                    placeholder="http://localhost:11434"
                    onChange={(e) => setAiProvider({ ...aiProvider, baseUrl: e.target.value })}
                  />
                </Row>
              )}
              <Row label="Model">
                <input
                  className="h-7 w-64 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                  value={aiProvider.model}
                  onChange={(e) => setAiProvider({ ...aiProvider, model: e.target.value })}
                />
              </Row>
              {aiProvider.kind !== 'ollama' && (
                <Row label="API key">
                  <input
                    type="password"
                    className="h-7 w-64 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                    placeholder="Stored encrypted (safeStorage)"
                    onChange={(e) => setAiProvider({ ...aiProvider, apiKey: e.target.value })}
                  />
                </Row>
              )}
              <button
                className="self-start rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1 text-[13px] text-[var(--accent-contrast)]"
                onClick={() =>
                  void (async () => {
                    if (aiProvider.apiKey) {
                      await api.invoke('keys:save', {
                        provider: aiProvider.kind,
                        key: aiProvider.apiKey,
                      })
                    }
                    await update({ aiProvider } as never)
                    setSavedHint('AI provider saved. The chat panel picks it up on next open.')
                  })()
                }
              >
                Save AI provider
              </button>
              {savedHint && <p className="text-[12px] text-[var(--success)]">{savedHint}</p>}
              <p className="text-[12px] text-[var(--text-tertiary)]">
                {aiProvider.kind === 'ollama'
                  ? 'Local provider — your data stays on this machine.'
                  : 'Cloud provider — requests leave this machine.'}
              </p>
            </div>
          )}

          {category === 'keyboard' && <KeyboardSettings />}

          <div className="mt-6 border-t border-[var(--border-subtle)] pt-3">
            <button
              className="text-[13px] text-[var(--danger)] hover:underline"
              onClick={() => {
                const defaultsTable: Record<string, Record<string, unknown>> = {
                  general: {
                    autosaveEnabled: true,
                    autosaveDelayMs: 1000,
                    confirmBeforeDelete: true,
                  },
                  appearance: {
                    appTheme: 'system',
                    accentOverride: null,
                    editorThemeLight: 'openleaf-light',
                    editorThemeDark: 'openleaf-dark',
                  },
                  editor: {
                    editorFontFamily:
                      'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
                    editorFontSize: 14,
                    editorLineHeight: 1.6,
                    tabWidth: 2,
                    softWrap: true,
                    lineNumbers: true,
                    highlightActiveLine: true,
                    autocompleteEnabled: true,
                    autocloseBrackets: true,
                    vimEnabled: false,
                  },
                  compiler: {
                    defaultCompiler: 'pdflatex',
                    autoCompileDelayMs: 1500,
                    compileTimeoutMs: 120_000,
                    shellEscapeDefault: false,
                  },
                  spelling: { spellLanguage: 'en', spellEnabled: true },
                }
                const defaults = defaultsTable[category]
                if (defaults) void update(defaults as never)
              }}
            >
              Reset to defaults
            </button>
          </div>
        </div>

        <button
          className="absolute right-3 top-3 rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() => setOpen(false)}
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4"
    />
  )
}

function NumberField({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <input
      type="number"
      className="h-7 w-20 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const next = Number(e.target.value)
        if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
      }}
    />
  )
}

function ThemePicker({
  value,
  dark,
  userThemes,
  onChange,
}: {
  value: string
  dark: boolean
  userThemes: Array<{ id: string; name: string; dark: boolean; error: string | null }>
  onChange: (id: string) => void
}): React.JSX.Element {
  const builtIns = allThemes().filter((theme) => theme.dark === dark)
  const user = userThemes.filter((theme) => !theme.error && theme.dark === dark)
  return (
    <select
      className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {builtIns.map((theme) => (
        <option key={theme.id} value={theme.id}>
          {theme.name}
        </option>
      ))}
      {user.length > 0 && (
        <optgroup label="User themes">
          {user.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

/** Pure conflict check: which other command already uses these keys? */
export function detectConflict(commandId: string, keys: string): string | null {
  const custom = useSettingsStore.getState().settings?.customKeys
  return detectKeyConflict(commandId, keys, resolveKeybindings(custom))
}

function KeyboardSettings(): React.JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const [recording, setRecording] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mac = isMacPlatform()
  const bindings = useMemo(() => resolveKeybindings(settings?.customKeys), [settings?.customKeys])
  const groups = useMemo(() => {
    const map = new Map<string, typeof commandDefinitions>()
    for (const command of commandDefinitions) {
      map.set(command.category, [...(map.get(command.category) ?? []), command])
    }
    return [...map.entries()]
  }, [])

  useEffect(() => {
    if (!recording) return
    const handler = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(null)
        setError(null)
        return
      }
      const spec = keyEventToSpec(event)
      if (!spec) return
      const conflict = detectKeyConflict(recording, spec, bindings)
      if (conflict) {
        setError(`${formatKeySpec(spec, mac)} is already used by “${conflict}”.`)
        return
      }
      void update({ customKeys: { ...(settings?.customKeys ?? {}), [recording]: spec } })
      setRecording(null)
      setError(null)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [recording, bindings, mac, settings?.customKeys, update])

  if (!settings) return null

  return (
    <div className="flex flex-col gap-3" data-testid="settings-keyboard">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">Keyboard</h2>
          <p className="text-[12px] text-[var(--text-tertiary)]">
            Click a shortcut and press the new key combination. Changes apply immediately.
          </p>
        </div>
        <button
          className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[12px] hover:bg-[var(--bg-hover)]"
          onClick={() => void update({ customKeys: {} })}
          data-testid="reset-keybindings"
        >
          Reset all
        </button>
      </div>
      {recording && (
        <p className="rounded-[var(--radius-sm)] bg-[var(--bg-selected)] px-2 py-1 text-[12px] text-[var(--accent)]">
          Press a shortcut for “{commandDefinitions.find((c) => c.id === recording)?.label}” — Esc
          cancels.
        </p>
      )}
      {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
      <div className="flex flex-col gap-3">
        {groups.map(([category, commands]) => (
          <div key={category}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {category}
            </p>
            <div className="flex flex-col">
              {commands.map((command) => {
                const effective = bindings[command.id]
                const custom = settings.customKeys?.[command.id]
                return (
                  <div
                    key={command.id}
                    className="flex items-center gap-2 border-b border-[var(--border-subtle)]/60 py-1 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px]">{command.label}</span>
                    <button
                      className={`min-w-[86px] rounded-[var(--radius-sm)] border px-2 py-0.5 text-[12px] ${
                        recording === command.id
                          ? 'border-[var(--accent)] bg-[var(--bg-selected)] text-[var(--accent)]'
                          : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                      }`}
                      onClick={() => {
                        setRecording(command.id)
                        setError(null)
                      }}
                      data-testid={`shortcut-${command.id}`}
                    >
                      {recording === command.id
                        ? 'Press…'
                        : effective
                          ? formatKeySpec(effective, mac)
                          : '—'}
                    </button>
                    <button
                      className="w-12 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
                      disabled={!custom}
                      onClick={() =>
                        void update({
                          customKeys: Object.fromEntries(
                            Object.entries(settings.customKeys ?? {}).filter(
                              ([id]) => id !== command.id
                            )
                          ),
                        })
                      }
                      title="Reset this shortcut"
                    >
                      Reset
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
