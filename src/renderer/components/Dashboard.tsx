import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Grid3X3, List, Plus, Search, Tag, Trash2, Upload } from 'lucide-react'
import type { RegistryEntry, TemplateInfo } from '@shared/ipc'
import { api, invokeOrThrow } from '../api'
import { AppLogo } from './AppLogo'
import { useProjectStore } from '../stores/project'
import { askText } from '../stores/prompt'
import { exportProjectAsZip, saveProjectAsTemplate } from '../project-actions'
import { toast } from '../stores/toast'
import { strings } from '../strings'

/**
 * Dashboard: list/grid of known projects with tags, search, context actions.
 * Shown when no project is open.
 */

// Token-driven tag tints (accent, success, warning, danger + overlays).
function tagColor(tag: string): string {
  let hash = 0
  for (const char of tag) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return TAG_COLOR_VARS[hash % TAG_COLOR_VARS.length]
}
const TAG_COLOR_VARS = [
  'var(--accent)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  'var(--bg-selected)',
  'var(--bg-selected-unfocused)',
  'var(--bg-hover)',
]

export function Dashboard(): React.JSX.Element {
  const [firstRun, setFirstRun] = useState(false)
  const [dontShowWelcome, setDontShowWelcome] = useState(true)
  const [projects, setProjects] = useState<RegistryEntry[]>([])
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectLocation, setNewProjectLocation] = useState('')
  const [defaultProjectLocation, setDefaultProjectLocation] = useState('')
  const openPath = useProjectStore((s) => s.openPath)

  const refresh = async (): Promise<void> => {
    const result = await api.invoke('projects:list', undefined)
    if (result.ok) setProjects(result.data)
    const templatesResult = await api.invoke('templates:list', undefined)
    if (templatesResult.ok) setTemplates(templatesResult.data)
  }

  useEffect(() => {
    void (async () => {
      await refresh()
      const settings = await api.invoke('app:getSettings', undefined)
      if (settings.ok && !settings.data.firstRunDone) setFirstRun(true)
    })()
  }, [])

  // Esc closes the new-project dialog / welcome sheet.
  useEffect(() => {
    if (!newProjectOpen && !firstRun) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (newProjectOpen) setNewProjectOpen(false)
      else setFirstRun(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [newProjectOpen, firstRun])

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const project of projects) for (const tag of project.tags) tags.add(tag)
    return [...tags].sort()
  }, [projects])

  const filtered = useMemo(() => {
    let list = projects
    if (activeTag) list = list.filter((p) => p.tags.includes(activeTag))
    const q = query.trim().toLowerCase()
    if (q) {
      // Search is intentionally by project name only; path matches used to
      // keep unrelated projects visible.
      list = list.filter((p) => p.name.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => b.lastOpened - a.lastOpened)
  }, [projects, query, activeTag])

  const showProjectMenu = async (
    event: React.MouseEvent,
    project: RegistryEntry
  ): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    const items = [
      { id: 'open', label: 'Open' },
      { id: 'reveal', label: 'Reveal in Finder' },
      { id: 'locate', label: 'Locate…' },
      { id: 'sep1', type: 'separator' as const, label: '' },
      { id: 'duplicate', label: 'Duplicate' },
      { id: 'rename', label: 'Rename…' },
      { id: 'editTags', label: 'Edit Tags…' },
      { id: 'sepExport', type: 'separator' as const, label: '' },
      { id: 'exportZip', label: 'Export as ZIP…', enabled: project.exists },
      { id: 'saveTemplate', label: 'Save as Template…', enabled: project.exists },
      { id: 'sep2', type: 'separator' as const, label: '' },
      { id: 'trash', label: 'Move to Trash…' },
      { id: 'remove', label: 'Remove from List' },
    ]
    const result = await api.invoke('menu:popup', { items })
    if (!result.ok || !result.data) return
    switch (result.data) {
      case 'open':
        await openPath(project.path)
        break
      case 'reveal':
        await api.invoke('projects:reveal', { path: project.path })
        break
      case 'locate':
        await api.invoke('projects:locate', { path: project.path })
        await refresh()
        break
      case 'exportZip':
        await exportProjectAsZip(project.path)
        break
      case 'saveTemplate':
        await saveProjectAsTemplate(project.path, project.name)
        await refresh()
        break
      case 'duplicate':
        await api.invoke('projects:duplicate', { path: project.path })
        await refresh()
        break
      case 'rename': {
        const newName = await askText({
          title: 'Rename project',
          defaultValue: project.name,
          confirmLabel: 'Rename',
        })
        if (newName && newName !== project.name) {
          const renamed = await api.invoke('projects:rename', { path: project.path, newName })
          if (!renamed.ok) toast('error', renamed.error.message)
          else if (renamed.data === null) {
            toast('error', `"${newName}" already exists or is not a valid folder name.`)
          }
          await refresh()
        }
        break
      }
      case 'editTags': {
        const tags = await askText({
          title: 'Edit tags',
          label: 'Comma-separated tags',
          defaultValue: project.tags.join(', '),
          confirmLabel: 'Save',
        })
        if (tags !== null) {
          await api.invoke('projects:setTags', {
            path: project.path,
            tags: tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          })
          await refresh()
        }
        break
      }
      case 'trash': {
        const ok = await invokeOrThrow('dialog:confirm', {
          title: 'Move to Trash',
          message: `Move "${project.name}" and all its files to the trash?`,
          confirmLabel: 'Move to Trash',
        })
        if (ok) {
          await api.invoke('projects:trash', { path: project.path })
          await refresh()
        }
        break
      }
      case 'remove':
        await api.invoke('projects:remove', { path: project.path })
        await refresh()
        break
    }
  }

  const openNewProjectDialog = async (): Promise<void> => {
    // Templates may have been saved since the dashboard opened.
    const templatesResult = await api.invoke('templates:list', undefined)
    if (templatesResult.ok) setTemplates(templatesResult.data)
    const settings = await api.invoke('app:getSettings', undefined)
    if (settings.ok) {
      const location = settings.data.defaultProjectDir ?? ''
      setDefaultProjectLocation(location)
      setNewProjectLocation(location)
    }
    setNewProjectOpen(true)
  }

  const chooseProjectLocation = async (): Promise<void> => {
    const result = await api.invoke('dialog:chooseDirectory', {
      title: 'Choose project location',
      defaultPath: newProjectLocation || defaultProjectLocation || undefined,
    })
    if (result.ok && result.data) setNewProjectLocation(result.data)
  }

  const newProject = async (template: TemplateInfo | null): Promise<void> => {
    const name = await askText({
      title: 'New project',
      label: template ? `From template “${template.name}”` : 'From the blank template',
      defaultValue: template ? `${template.name} Project` : 'Untitled Project',
      confirmLabel: 'Create',
      validate: (value) => (/[\\/]/.test(value) ? 'The name cannot contain / or \\' : null),
    })
    if (!name) return
    const parentDir = newProjectLocation || undefined
    const result = template
      ? await api.invoke('templates:instantiate', { templateId: template.id, name, parentDir })
      : await api.invoke('templates:instantiate', { templateId: 'blank', name, parentDir })
    if (result.ok && result.data) {
      setNewProjectOpen(false)
      await openPath(result.data.path)
    } else if (result.ok === false) {
      toast('error', result.error.message)
    } else {
      toast('error', 'A project with this name already exists.')
    }
  }

  const deleteTemplate = async (template: TemplateInfo): Promise<void> => {
    const confirmed = await invokeOrThrow('dialog:confirm', {
      title: 'Delete template',
      message: `Delete the user template “${template.name}”? Projects created from it are not affected.`,
      confirmLabel: 'Delete',
    })
    if (!confirmed) return
    const result = await api.invoke('templates:delete', { templateId: template.id })
    if (!result.ok) toast('error', result.error.message)
    await refresh()
  }

  const importZip = async (): Promise<void> => {
    const result = await api.invoke('zip:import', {})
    if (result.ok && result.data) await openPath(result.data.path)
    else if (!result.ok) toast('error', result.error.message)
  }

  const importZipFromDrop = async (file: File): Promise<void> => {
    const path = window.openleaf.pathForFile(file)
    if (!path || !path.toLowerCase().endsWith('.zip')) return
    try {
      const { importZipFromPathViaInvoke } = await import('../api/zip-helper')
      const result = await importZipFromPathViaInvoke(path)
      if (result) await openPath(result)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div
      className="sidebar-vibrancy relative flex h-full flex-col overflow-hidden"
      data-testid="dashboard"
    >
      <div
        className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
        data-testid="dashboard-watermark"
        aria-hidden="true"
      >
        <AppLogo size={420} className="opacity-[0.055]" />
      </div>
      <div className="drag-region relative z-10 flex h-[58px] shrink-0 items-center gap-3 px-4">
        <div className="ml-20 flex items-center gap-2">
          <AppLogo size={26} />
          <span className="text-[18px] font-semibold">{strings.appName}</span>
        </div>
        <div className="flex-1" />
        <div className="no-drag flex items-center gap-2">
          <div className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2">
            <Search size={14} />
            <input
              className="w-44 bg-transparent text-[13px] outline-none"
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="dashboard-search"
            />
          </div>
          <button
            className="rounded p-1.5 hover:bg-[var(--bg-hover)]"
            onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            title="Toggle view"
          >
            {view === 'grid' ? <List size={16} /> : <Grid3X3 size={16} />}
          </button>
          <button
            className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-2 text-[13px] hover:bg-[var(--bg-hover)]"
            onClick={() => void importZip()}
          >
            <Upload size={14} />
            Import ZIP
          </button>
          <button
            className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent)] px-3 text-[13px] font-medium text-[var(--accent-contrast)] hover:opacity-90"
            onClick={() => void openNewProjectDialog()}
            data-testid="new-project"
          >
            <Plus size={14} />
            New Project
          </button>
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1">
        {/* Tags sidebar */}
        <div className="w-44 shrink-0 overflow-auto border-r border-[var(--border-subtle)] px-3 py-2">
          <p className="mb-1 flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            <Tag size={13} />
            Tags
          </p>
          <button
            className={`block w-full rounded-[var(--radius-sm)] px-2 py-1 text-left text-[13px] ${activeTag === null ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]'}`}
            onClick={() => setActiveTag(null)}
          >
            All projects
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`block w-full rounded-[var(--radius-sm)] px-2 py-1 text-left text-[13px] ${activeTag === tag ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]'}`}
              onClick={() => setActiveTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Project list */}
        <div
          className="min-h-0 flex-1 overflow-auto p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            for (const file of Array.from(e.dataTransfer.files)) {
              void importZipFromDrop(file)
            }
          }}
        >
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <FolderOpen size={32} className="text-[var(--text-tertiary)]" />
              <p className="text-[14px] text-[var(--text-secondary)]">
                {query.trim()
                  ? `No projects match “${query.trim()}”.`
                  : activeTag
                    ? 'No projects with this tag.'
                    : 'No projects yet.'}
              </p>
              <p className="max-w-sm text-[13px] text-[var(--text-tertiary)]">
                {query.trim()
                  ? 'Search matches project names only.'
                  : 'Create a new project from a template, import a ZIP (e.g. from Overleaf), or drag a ZIP here.'}
              </p>
            </div>
          ) : view === 'grid' ? (
            <div
              className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
              data-testid="project-grid"
            >
              {filtered.map((project) => (
                <button
                  key={project.path}
                  className={`flex flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-left hover:border-[var(--accent)] ${project.exists ? '' : 'opacity-50'}`}
                  onClick={() => project.exists && void openPath(project.path)}
                  onContextMenu={(e) => void showProjectMenu(e, project)}
                  data-testid={`project-card-${project.name}`}
                >
                  <span className="truncate text-[14px] font-semibold">{project.name}</span>
                  <span
                    className="truncate text-[12px] text-[var(--text-tertiary)]"
                    title={project.path}
                  >
                    {project.path}
                  </span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    {project.exists
                      ? `Opened ${new Date(project.lastOpened).toLocaleDateString()}`
                      : 'Folder missing'}
                  </span>
                  {project.tags.length > 0 && (
                    <span className="flex gap-1">
                      {project.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full px-1.5 py-px text-[10px] text-white"
                          style={{ background: tagColor(tag) }}
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col" data-testid="project-list">
              {filtered.map((project) => (
                <button
                  key={project.path}
                  className={`flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-left text-[13px] hover:bg-[var(--bg-hover)] ${project.exists ? '' : 'opacity-50'}`}
                  onClick={() => project.exists && void openPath(project.path)}
                  onContextMenu={(e) => void showProjectMenu(e, project)}
                >
                  <FolderOpen size={16} className="text-[var(--accent)]" />
                  <span className="w-40 truncate font-medium">{project.name}</span>
                  <span className="flex-1 truncate text-[var(--text-tertiary)]">
                    {project.path}
                  </span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    {project.exists ? new Date(project.lastOpened).toLocaleDateString() : 'missing'}
                  </span>
                  {project.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-[var(--bg-hover)] px-1.5 py-px text-[10px]"
                    >
                      {tag}
                    </span>
                  ))}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* First-run welcome sheet */}
      {firstRun && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="welcome-sheet"
        >
          <div className="w-[560px] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-popover)]">
            <h1 className="mb-1 text-[18px] font-semibold">Welcome to Verso</h1>
            <p className="mb-4 text-[13px] text-[var(--text-secondary)]">
              A local, offline-first LaTeX editor. Three steps to get started:
            </p>
            <ol className="mb-4 flex flex-col gap-3 text-[14px]">
              <li>
                <span className="font-medium">1. TeX installation</span>
                <TexCheckInline />
              </li>
              <li>
                <span className="font-medium">2. Default project folder</span>
                <p className="text-[13px] text-[var(--text-secondary)]">
                  New projects are created under your documents folder (configurable in Settings).
                </p>
              </li>
              <li>
                <span className="font-medium">3. Try the sample project</span>
                <button
                  className="mt-1 rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1 text-[13px] font-medium text-[var(--accent-contrast)] hover:opacity-90"
                  onClick={() =>
                    void (async () => {
                      const result = await api.invoke('templates:instantiate', {
                        templateId: 'sample-project',
                        name: 'Welcome to Verso',
                      })
                      if (result.ok && result.data) {
                        if (dontShowWelcome) await api.invoke('firstrun:done', undefined)
                        setFirstRun(false)
                        await openPath(result.data.path)
                      }
                    })()
                  }
                >
                  Open sample project
                </button>
              </li>
            </ol>
            <label className="mb-3 flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={dontShowWelcome}
                onChange={(event) => setDontShowWelcome(event.target.checked)}
                data-testid="welcome-dont-show"
              />
              Don’t show this again
            </label>
            <button
              className="text-[13px] text-[var(--text-tertiary)] hover:underline"
              onClick={() => {
                if (dontShowWelcome) void api.invoke('firstrun:done', undefined)
                setFirstRun(false)
              }}
              data-testid="welcome-skip"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* New project dialog */}
      {newProjectOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setNewProjectOpen(false)}
        >
          <div
            className="max-h-[85vh] w-[520px] overflow-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-popover)]"
            onClick={(e) => e.stopPropagation()}
            data-testid="new-project-dialog"
          >
            <p className="mb-3 text-[15px] font-semibold">New Project</p>
            <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-content)] p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                  Location
                </span>
                <div className="flex items-center gap-2">
                  {defaultProjectLocation && newProjectLocation !== defaultProjectLocation && (
                    <button
                      className="text-[12px] text-[var(--text-tertiary)] hover:underline"
                      onClick={() => setNewProjectLocation(defaultProjectLocation)}
                    >
                      Use default
                    </button>
                  )}
                  <button
                    className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[12px] hover:bg-[var(--bg-hover)]"
                    onClick={() => void chooseProjectLocation()}
                    data-testid="new-project-location-choose"
                  >
                    Choose…
                  </button>
                </div>
              </div>
              <p
                className="mt-1 truncate text-[12px] text-[var(--text-tertiary)]"
                title={newProjectLocation || defaultProjectLocation}
                data-testid="new-project-location"
              >
                {newProjectLocation || defaultProjectLocation || 'Default project folder'}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {templates.map((template) => (
                <div key={template.id} className="relative">
                  <button
                    className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3 text-left hover:border-[var(--accent)]"
                    onClick={() => void newProject(template)}
                  >
                    <span className="text-[14px] font-semibold">{template.name}</span>
                    <span className="block text-[12px] text-[var(--text-secondary)]">
                      {template.description}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--text-tertiary)]">
                      {template.builtIn ? 'Built-in' : 'User template'} · main: {template.mainFile}{' '}
                      · {template.compiler}
                    </span>
                  </button>
                  {!template.builtIn && (
                    <button
                      className="absolute top-2 right-2 rounded-[var(--radius-sm)] p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                      onClick={() => void deleteTemplate(template)}
                      title={`Delete template “${template.name}”`}
                      aria-label={`Delete template ${template.name}`}
                      data-testid={`delete-template-${template.id}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button
                className="flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] p-3 text-[13px] text-[var(--text-secondary)] hover:border-[var(--accent)]"
                onClick={() => {
                  setNewProjectOpen(false)
                  void api.invoke('project:choose', undefined)
                }}
              >
                <Trash2 size={14} className="hidden" />
                Or open an existing folder…
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TexCheckInline(): React.JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void (async () => {
      const env = await api.invoke('tex:detect', undefined)
      setAvailable(env.ok ? env.data.available : false)
    })()
  }, [])

  if (available === null)
    return <p className="text-[13px] text-[var(--text-tertiary)]">Checking…</p>
  if (available) {
    return (
      <p className="text-[13px] text-[var(--success)]">
        ✓ LaTeX toolchain found — you are ready to compile.
      </p>
    )
  }
  return (
    <div className="mt-1 flex flex-col gap-1 text-[13px] text-[var(--warning)]">
      <span>
        No LaTeX toolchain found. Install{' '}
        {navigator.userAgent.includes('Mac')
          ? 'MacTeX (tug.org/mactex)'
          : navigator.userAgent.includes('Win')
            ? 'MiKTeX (miktex.org)'
            : 'TeX Live (tug.org/texlive)'}
        .
      </span>
      <button
        className="self-start rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 hover:bg-[var(--bg-hover)]"
        onClick={() =>
          void (async () => {
            setChecking(true)
            const env = await api.invoke('tex:detect', undefined)
            setAvailable(env.ok ? env.data.available : false)
            setChecking(false)
          })()
        }
      >
        {checking ? 'Checking…' : 'Re-check'}
      </button>
    </div>
  )
}
