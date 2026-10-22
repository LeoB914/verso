import { useMemo, useState } from 'react'
import { Command } from 'cmdk'
import {
  commandDefinitions,
  formatKeySpec,
  isMacPlatform,
  resolveKeybindings,
} from '@shared/commands'
import { getCommandContext, recentCommandIds, runCommand } from '../commands'
import { useEditorStore } from '../stores/editor'
import { useProjectIndex } from '../stores/projectIndex'
import { useSettingsStore } from '../stores/settings'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'commands' | 'files' | 'sections' | 'cites'
}

export function CommandPalette({
  open,
  onOpenChange,
  mode,
}: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const tabs = useEditorStore((s) => s.tabs)
  const openFileByPath = useEditorStore((s) => s.openFileByPath)
  const applyJump = useEditorStore((s) => s.applyJump)
  const outline = useProjectIndex((s) => s.outline)
  const indexVersion = useProjectIndex((s) => s.version)
  const customKeys = useSettingsStore((s) => s.settings?.customKeys)
  const bindings = useMemo(() => resolveKeybindings(customKeys), [customKeys])
  const context = getCommandContext()
  const mac = isMacPlatform()

  const items = useMemo(() => {
    if (mode === 'files') {
      return tabs.map((tab) => ({
        key: tab.relPath,
        label: tab.relPath,
        hint: tab.dirty ? 'unsaved' : '',
        disabled: false,
        run: () => void openFileByPath(tab.relPath),
      }))
    }
    if (mode === 'cites') {
      const index = useProjectIndex.getState()
      void indexVersion
      const command = useSettingsStore.getState().settings?.citeCommand ?? 'cite'
      const items: Array<{
        key: string
        label: string
        hint: string
        disabled: boolean
        run: () => void
      }> = []
      for (const entry of index.bibEntries.values()) {
        items.push({
          key: entry.key,
          label: entry.key,
          hint: [entry.fields.author, entry.fields.year, entry.fields.title]
            .filter(Boolean)
            .join(' — ')
            .slice(0, 80),
          disabled: false,
          run: () => {
            // Insert at the active editor cursor (adds to an existing list).
            useEditorStore.getState().requestCitationInsert(command, entry.key)
          },
        })
      }
      return items
    }
    if (mode === 'sections') {
      return outline.map((section) => ({
        key: `${section.relPath}-${section.position}`,
        label: section.title || '(untitled)',
        hint: section.relPath,
        disabled: false,
        run: () => void applyJump(section.relPath, section.line),
      }))
    }
    const recent = recentCommandIds()
    return commandDefinitions
      .map((command) => ({
        key: command.id,
        label: command.label,
        hint: bindings[command.id] ? formatKeySpec(bindings[command.id], mac) : command.category,
        disabled: command.when ? !command.when(context) : false,
        run: () => runCommand(command.id),
      }))
      .sort((a, b) => {
        const ai = recent.indexOf(a.key)
        const bi = recent.indexOf(b.key)
        if (ai !== -1 || bi !== -1) {
          if (ai === -1) return 1
          if (bi === -1) return -1
          return ai - bi
        }
        return a.label.localeCompare(b.label)
      })
  }, [mode, tabs, outline, openFileByPath, applyJump, indexVersion, bindings, context, mac])

  if (!open) return null

  const filtered = query
    ? items.filter((item) => fuzzyMatch(item.label.toLowerCase(), query.toLowerCase()))
    : items

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => onOpenChange(false)}
      data-testid="command-palette"
    >
      <div
        className="w-[480px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[var(--shadow-popover)]"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Command palette" loop>
          <div className="border-b border-[var(--border-subtle)] p-2">
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onOpenChange(false)
              }}
              placeholder={
                mode === 'files'
                  ? 'Go to file…'
                  : mode === 'sections'
                    ? 'Go to section…'
                    : mode === 'cites'
                      ? 'Insert citation…'
                      : 'Type a command…'
              }
              className="w-full bg-transparent px-1 text-[14px] outline-none"
            />
          </div>
          <Command.List className="max-h-[300px] overflow-auto p-1">
            <Command.Empty className="px-3 py-4 text-center text-[13px] text-[var(--text-tertiary)]">
              No matches
            </Command.Empty>
            {filtered.map((item) => (
              <Command.Item
                key={item.key}
                value={item.label}
                disabled={item.disabled}
                onSelect={() => {
                  item.run()
                  onOpenChange(false)
                }}
                className="flex cursor-pointer items-center justify-between rounded-[var(--radius-sm)] px-3 py-1.5 text-[14px] data-[disabled=true]:cursor-default data-[disabled=true]:opacity-40 data-[selected=true]:bg-[var(--bg-selected)]"
              >
                <span className="truncate">{item.label}</span>
                {item.hint && (
                  <span className="ml-2 shrink-0 text-[12px] text-[var(--text-tertiary)]">
                    {item.hint}
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  )
}

/** Simple subsequence fuzzy match with a score. */
function fuzzyMatch(text: string, query: string): boolean {
  let i = 0
  for (const char of query) {
    i = text.indexOf(char, i)
    if (i === -1) return false
    i++
  }
  return true
}
