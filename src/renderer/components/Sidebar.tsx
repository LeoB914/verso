import { FileTree } from './FileTree'
import { Outline } from './Outline'
import { SearchPanel } from './SearchPanel'
import { GitPanel } from './GitPanel'
import { ReferencesPanel } from './ReferencesPanel'
import { SymbolPalette } from './SymbolPalette'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { strings } from '../strings'

/**
 * Sidebar body. The section navigation lives in the always-visible vertical
 * rail at the window edge (SidebarRail); this component renders the active
 * section only.
 */
export function Sidebar(): React.JSX.Element {
  const fileTree = useProjectStore((s) => s.fileTree)
  const project = useProjectStore((s) => s.project)
  const segment = useUiStore((s) => s.sidebarSegment)

  return (
    <div className="sidebar-vibrancy flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        {segment === 'files' && (
          <div className="h-full overflow-auto px-2 pb-2 pt-2">
            {project && fileTree ? (
              fileTree.children && fileTree.children.length > 0 ? (
                <FileTree tree={fileTree} />
              ) : (
                <p className="px-2 py-4 text-[13px] text-[var(--text-tertiary)]">
                  {strings.emptyFolder}
                </p>
              )
            ) : (
              <p className="px-2 py-4 text-[13px] text-[var(--text-tertiary)]">
                {strings.noProject}
              </p>
            )}
          </div>
        )}
        {segment === 'outline' && <Outline />}
        {segment === 'search' && <SearchPanel />}
        {segment === 'git' && <GitPanel />}
        {segment === 'references' && <ReferencesPanel />}
        {segment === 'symbols' && <SymbolPalette />}
      </div>
    </div>
  )
}
