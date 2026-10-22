import { useRef } from 'react'
import { X } from 'lucide-react'
import { useEditorStore } from '../stores/editor'
import { api } from '../api'
import { strings } from '../strings'

export function TabsBar(): React.JSX.Element | null {
  const tabs = useEditorStore((s) => s.tabs)
  const activePath = useEditorStore((s) => s.activePath)
  const setActive = useEditorStore((s) => s.setActive)
  const closeTab = useEditorStore((s) => s.closeTab)
  const closeOtherTabs = useEditorStore((s) => s.closeOtherTabs)
  const reorderTabs = useEditorStore((s) => s.reorderTabs)
  const reloadTab = useEditorStore((s) => s.reloadTab)
  const dragIndex = useRef<number | null>(null)

  if (tabs.length === 0) return null

  const showContextMenu = async (event: React.MouseEvent, relPath: string): Promise<void> => {
    event.preventDefault()
    const result = await api.invoke('menu:popup', {
      items: [
        { id: 'close', label: strings.closeTab },
        { id: 'closeOthers', label: 'Close Other Tabs' },
        { id: 'sep', type: 'separator', label: '' },
        { id: 'reload', label: 'Reload from Disk' },
      ],
    })
    if (!result.ok || !result.data) return
    if (result.data === 'close') void closeTab(relPath)
    else if (result.data === 'closeOthers') void closeOtherTabs(relPath)
    else if (result.data === 'reload') void reloadTab(relPath)
  }

  return (
    <div
      className="flex h-[36px] shrink-0 items-stretch overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
      data-testid="tabs-bar"
    >
      {tabs.map((tab, index) => (
        <div
          key={tab.relPath}
          className={`no-drag group flex max-w-[220px] shrink-0 items-center gap-1.5 border-r border-[var(--border-subtle)] px-3 text-[13px] ${
            activePath === tab.relPath
              ? 'bg-[var(--bg-content)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
          onClick={() => setActive(tab.relPath)}
          onAuxClick={(e) => {
            if (e.button === 1) void closeTab(tab.relPath)
          }}
          onContextMenu={(e) => void showContextMenu(e, tab.relPath)}
          draggable
          onDragStart={() => (dragIndex.current = index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIndex.current !== null && dragIndex.current !== index) {
              reorderTabs(dragIndex.current, index)
            }
            dragIndex.current = null
          }}
          data-testid={`tab-${tab.relPath}`}
          title={tab.relPath}
        >
          <span className="truncate">
            {tab.relPath.split('/').pop()}
            {tab.dirty ? ` ${strings.unsavedDot}` : ''}
          </span>
          <button
            className="rounded p-0.5 opacity-0 hover:bg-[var(--bg-hover)] group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              void closeTab(tab.relPath)
            }}
            aria-label={strings.closeTab}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
