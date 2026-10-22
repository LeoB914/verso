import { BookOpen, FileText, GitBranch, List, Search, Sigma } from 'lucide-react'
import { useUiStore, type SidebarSegment } from '../stores/ui'
import { strings } from '../strings'

const SEGMENTS: Array<{
  id: SidebarSegment
  label: string
  icon: typeof FileText
}> = [
  { id: 'files', label: strings.tabFiles, icon: FileText },
  { id: 'outline', label: strings.tabOutline, icon: List },
  { id: 'search', label: strings.tabSearch, icon: Search },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'references', label: 'Refs', icon: BookOpen },
  { id: 'symbols', label: 'Symbols', icon: Sigma },
]

/**
 * Always-visible vertical section navigation at the far left window edge.
 * Selecting a section opens the sidebar; clicking the active section again
 * collapses the whole sidebar body.
 */
export function SidebarRail(): React.JSX.Element {
  const segment = useUiStore((s) => s.sidebarSegment)
  const setSegment = useUiStore((s) => s.setSidebarSegment)
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)
  const setSidebarVisible = useUiStore((s) => s.setSidebarVisible)

  const select = (id: SidebarSegment): void => {
    // Clicking the active section again collapses the sidebar; any other
    // section selection (also while collapsed) opens it.
    if (sidebarVisible && segment === id) {
      setSidebarVisible(false)
      return
    }
    setSegment(id)
    setSidebarVisible(true)
  }

  return (
    <div
      className="sidebar-vibrancy flex w-[72px] shrink-0 flex-col items-stretch border-r border-[var(--border-subtle)]"
      data-testid="sidebar-rail"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 py-2">
        {SEGMENTS.map(({ id, label, icon: Icon }) => {
          const active = sidebarVisible && segment === id
          return (
            <button
              key={id}
              className={`flex flex-col items-center gap-1 rounded-[var(--radius-md)] px-1 py-2 text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-[var(--bg-selected)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
              onClick={() => select(id)}
              title={active ? `${label} — click again to hide the sidebar` : label}
              aria-pressed={active}
              data-testid={`sidebar-tab-${id}`}
            >
              <Icon size={20} strokeWidth={1.9} className="shrink-0" />
              <span className="w-full truncate text-center leading-tight">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
