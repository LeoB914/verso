import { useState } from 'react'
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  BookOpen,
  Image,
  File,
  FileOutput,
  FilePlus,
  FolderPlus,
} from 'lucide-react'
import type { FileNode } from '@shared/ipc'
import { invokeOrThrow, api } from '../api'
import { toast } from '../stores/toast'
import { askText } from '../stores/prompt'
import { useEditorStore } from '../stores/editor'
import { useProjectIndex } from '../stores/projectIndex'
import { useProjectStore } from '../stores/project'
import { useSettingsStore } from '../stores/settings'
import { createProjectEntry } from '../project-actions'
import { strings } from '../strings'

function kindToIcon(node: FileNode, open: boolean): React.JSX.Element {
  if (node.type === 'dir')
    return open ? (
      <FolderOpen size={16} className="text-[var(--accent)]" />
    ) : (
      <Folder size={16} className="text-[var(--accent)]" />
    )
  const ext = node.name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'tex':
    case 'ltx':
    case 'sty':
    case 'cls':
      return <FileText size={16} className="text-[var(--accent)]" />
    case 'bib':
      return <BookOpen size={16} className="text-[var(--warning)]" />
    case 'pdf':
      return <FileOutput size={16} className="text-[var(--danger)]" />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return <Image size={16} className="text-[var(--success)]" />
    default:
      return <File size={16} className="text-[var(--text-tertiary)]" />
  }
}

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|eps)$/i

interface FileTreeProps {
  tree: FileNode
}

export function FileTree({ tree }: FileTreeProps): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastSelected, setLastSelected] = useState<string | null>(null)

  const onSelect = (relPath: string, event: React.MouseEvent): void => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-tree-path]')].map(
      (row) => row.dataset.treePath ?? ''
    )
    if (event.shiftKey && lastSelected) {
      const from = rows.indexOf(lastSelected)
      const to = rows.indexOf(relPath)
      if (from !== -1 && to !== -1) {
        const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1)
        setSelected(new Set(range))
        setLastSelected(relPath)
        return
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelected((previous) => {
        const next = new Set(previous)
        if (next.has(relPath)) next.delete(relPath)
        else next.add(relPath)
        return next
      })
      setLastSelected(relPath)
      return
    }
    setSelected(new Set([relPath]))
    setLastSelected(relPath)
  }

  const deleteSelected = async (): Promise<void> => {
    if (selected.size === 0) return
    const confirm = useSettingsStore.getState().settings?.confirmBeforeDelete ?? true
    if (
      confirm &&
      !(await invokeOrThrow('dialog:confirm', {
        title: 'Move to Trash',
        message: `Move ${selected.size} selected item(s) to the trash?`,
        confirmLabel: 'Move to Trash',
      }))
    ) {
      return
    }
    const trashed: string[] = []
    for (const relPath of selected) {
      await invokeOrThrow('files:delete', { relPath })
        .then(() => trashed.push(relPath))
        .catch(() => undefined)
    }
    useEditorStore.getState().dropPaths(trashed)
    setSelected(new Set())
    await useProjectStore.getState().refreshTree()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-tree-path]')]
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setSelected(new Set(rows.map((row) => row.dataset.treePath ?? '')))
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      void deleteSelected()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const current = rows.findIndex((row) => row.dataset.treePath === [...selected][0])
      const nextIndex = Math.min(
        rows.length - 1,
        Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1))
      )
      const next = rows[nextIndex]
      if (next?.dataset.treePath) {
        setSelected(new Set([next.dataset.treePath]))
        setLastSelected(next.dataset.treePath)
        next.focus()
      }
      return
    }
    if (event.key === 'Enter') {
      const current = rows.find((row) => row.dataset.treePath === [...selected][0])
      current?.click()
    }
  }

  return (
    <div
      className="flex flex-col outline-none"
      data-testid="file-tree"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <RootActions />
      {tree.children?.map((child) => (
        <TreeNode
          key={child.relPath}
          node={child}
          depth={0}
          selectedPaths={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

/** "New file/folder" buttons at the top of the Files section. */
function RootActions(): React.JSX.Element {
  return (
    <div className="mb-1 flex items-center justify-end gap-1 border-b border-[var(--border-subtle)] px-1 pb-1.5">
      <button
        className="flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={() => void createProjectEntry('file')}
        title="New file"
        data-testid="tree-new-file"
      >
        <FilePlus size={15} />
        File
      </button>
      <button
        className="flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={() => void createProjectEntry('folder')}
        title="New folder"
        data-testid="tree-new-folder"
      >
        <FolderPlus size={15} />
        Folder
      </button>
    </div>
  )
}

interface TreeNodeProps {
  node: FileNode
  depth: number
  parentRel?: string
  selectedPaths: Set<string>
  onSelect: (relPath: string, event: React.MouseEvent) => void
}

function TreeNode({
  node,
  depth,
  parentRel = '',
  selectedPaths,
  onSelect,
}: TreeNodeProps): React.JSX.Element {
  const [open, setOpen] = useState(depth === 0)
  const [renaming, setRenaming] = useState<string | null>(null)

  const activePath = useEditorStore((s) => s.activePath)
  const openFileByPath = useEditorStore((s) => s.openFileByPath)
  const mainFile = useProjectStore((s) => s.project?.config.mainFile)
  const refreshTree = useProjectStore((s) => s.refreshTree)

  const isDir = node.type === 'dir'
  const isMain = mainFile === node.relPath
  const isImage = IMAGE_EXTENSIONS.test(node.name)
  const isPdf = node.name.toLowerCase().endsWith('.pdf')

  const openNode = (): void => {
    if (isDir) {
      setOpen((value) => !value)
      return
    }
    if (isImage || isPdf) {
      // Preview tabs for images and PDFs.
      void openFileByPath(node.relPath, {
        readOnly: true,
        preview: isImage ? 'image' : 'pdf',
      })
      return
    }
    if (/\.(tex|ltx|bib|cls|sty|txt|md|csv|log)$/i.test(node.name)) {
      void openFileByPath(node.relPath)
    }
  }

  const showMenu = async (event: React.MouseEvent): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    const items: Array<{ id: string; label?: string; type?: 'separator' }> = []
    if (!isDir) {
      if (/\.(tex|ltx)$/i.test(node.name) && mainFile !== node.relPath) {
        items.push({ id: 'setMain', label: 'Set as Main File' })
      }
      items.push({ id: 'rename', label: 'Rename' }, { id: 'duplicate', label: 'Duplicate' })
    }
    items.push({ id: 'newHere', label: 'New File Here' }, { id: 'sep1', type: 'separator' })
    items.push({ id: 'delete', label: 'Move to Trash' })
    const result = await api.invoke('menu:popup', { items })
    if (!result.ok || !result.data) return
    switch (result.data) {
      case 'setMain':
        await useProjectStore.getState().setMainFile(node.relPath)
        break
      case 'rename':
        setRenaming(node.name)
        break
      case 'duplicate':
        await invokeOrThrow('files:duplicate', { relPath: node.relPath })
        await refreshTree()
        break
      case 'newHere': {
        const name = await askText({
          title: 'New file',
          label: isDir ? `Inside ${node.relPath}/` : 'Name of the new file',
          defaultValue: 'untitled.tex',
          confirmLabel: 'Create',
        })
        if (name) {
          const target = isDir ? `${node.relPath}/${name}` : `${parentRel}${name}`
          await invokeOrThrow('files:create', { relPath: target, type: 'file' })
          await refreshTree()
        }
        break
      }
      case 'delete': {
        // The confirmation can be turned off in Settings → General.
        const confirm = useSettingsStore.getState().settings?.confirmBeforeDelete ?? true
        const ok =
          !confirm ||
          (await invokeOrThrow('dialog:confirm', {
            title: 'Move to Trash',
            message: `Move "${node.name}" to the trash?`,
            confirmLabel: 'Move to Trash',
          }))
        if (ok) {
          await invokeOrThrow('files:delete', { relPath: node.relPath })
          useEditorStore.getState().dropPaths([node.relPath])
          await refreshTree()
        }
        break
      }
    }
  }

  const commitRename = async (newName: string): Promise<void> => {
    setRenaming(null)
    if (!newName || newName === node.name) return
    const parent = node.relPath.slice(0, node.relPath.length - node.name.length)
    const target = parent + newName
    try {
      // Offer to update references for .tex and image files.
      const updates = await maybeComputeReferenceUpdates(node.relPath, target)
      await invokeOrThrow('files:rename', { relPath: node.relPath, target })
      if (updates.length > 0) {
        const confirmed = await invokeOrThrow('dialog:confirm', {
          title: 'Update references',
          message: `Update ${updates.length} reference(s) to the renamed file?`,
          confirmLabel: 'Update references',
        })
        if (confirmed) {
          await invokeOrThrow('files:applyReferenceUpdates', { updates } as never)
        }
      }
      // Keep open tabs (and their unsaved edits) attached to the new path.
      useEditorStore.getState().renamePath(node.relPath, target)
      await refreshTree()
    } catch (err) {
      // e.g. "A file named … already exists." — nothing changed on disk.
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const dragOver = (event: React.DragEvent): void => {
    if (isDir) {
      event.preventDefault()
      setOpen(true)
    }
  }

  const dropOnFolder = async (event: React.DragEvent): Promise<void> => {
    if (!isDir) return
    event.preventDefault()
    event.stopPropagation()
    const relPath = event.dataTransfer.getData('application/openleaf-relpath')
    if (relPath && relPath !== node.relPath && !node.relPath.startsWith(relPath + '/')) {
      const target = `${node.relPath}/${relPath.split('/').pop()}`
      try {
        await invokeOrThrow('files:move', { relPath, target })
      } catch (err) {
        toast('error', err instanceof Error ? err.message : String(err))
        return
      }
      useEditorStore.getState().renamePath(relPath, target)
      await refreshTree()
      return
    }
    // External files from the OS.
    try {
      for (const file of Array.from(event.dataTransfer.files)) {
        const absolute = window.openleaf.pathForFile(file)
        if (!absolute) continue
        await invokeOrThrow('files:importDropped', {
          sourcePath: absolute,
          targetDir: node.relPath,
        })
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
    await refreshTree()
  }

  return (
    <div>
      {renaming !== null ? (
        <input
          autoFocus
          className="mx-1 rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--bg-content)] px-1 text-[13px]"
          style={{ paddingLeft: 8 + depth * 14 }}
          defaultValue={node.name}
          onBlur={(e) => void commitRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename(e.currentTarget.value)
            if (e.key === 'Escape') setRenaming(null)
          }}
        />
      ) : (
        <div
          className={`flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] py-[3px] pr-2 text-left text-[14px] ${
            selectedPaths.has(node.relPath) || activePath === node.relPath
              ? 'bg-[var(--bg-selected)]'
              : 'hover:bg-[var(--bg-hover)]'
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={(event) => {
            onSelect(node.relPath, event)
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey) openNode()
          }}
          data-tree-path={node.relPath}
          onContextMenu={(e) => void showMenu(e)}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('application/openleaf-relpath', node.relPath)}
          onDragOver={dragOver}
          onDrop={(e) => void dropOnFolder(e)}
          role={isDir ? 'button' : undefined}
          aria-expanded={isDir ? open : undefined}
          data-testid={`tree-file-${node.relPath}`}
        >
          {isDir && (
            <ChevronRight
              size={13}
              className={`shrink-0 text-[var(--text-tertiary)] transition-transform ${open ? 'rotate-90' : ''}`}
            />
          )}
          {kindToIcon(node, open)}
          <span className="truncate">{node.name}</span>
          {isMain && (
            <span className="ml-auto rounded-full bg-[var(--accent)] px-1.5 py-px text-[11px] text-[var(--accent-contrast)]">
              {strings.mainFileBadge}
            </span>
          )}
        </div>
      )}
      {isDir &&
        open &&
        node.children?.map((child) => (
          <TreeNode
            key={child.relPath}
            node={child}
            depth={depth + 1}
            parentRel={`${node.relPath}/`}
            selectedPaths={selectedPaths}
            onSelect={onSelect}
          />
        ))}
    </div>
  )
}

/** Compute reference updates via the project index (renderer side). */
async function maybeComputeReferenceUpdates(
  oldRelPath: string,
  newRelPath: string
): Promise<Array<{ relPath: string; oldKey: string; newKey: string }>> {
  if (!/\.(tex|pdf|png|jpg|jpeg|gif|eps|svg|bib)$/i.test(oldRelPath)) return []
  const index = useProjectIndex.getState()
  const structures = index.structures
  const files: Record<string, string> = {}
  for (const [relPath] of structures) {
    // Reconstructing the text is not possible from structures alone; read the files.
    try {
      const file = await invokeOrThrow('file:read', { relPath })
      files[relPath] = file.content
    } catch {
      // Skip.
    }
  }
  const { computeReferenceUpdates } = await import('@shared/latex/references')
  return computeReferenceUpdates(files, oldRelPath, newRelPath)
}
