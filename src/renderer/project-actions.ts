import { gitBranchName } from '@shared/ipc'
import { invokeOrThrow } from './api'
import { toast } from './stores/toast'
import { askText } from './stores/prompt'
import { useProjectStore } from './stores/project'

/** Prompt + create a file/folder at the project root (shared by the tree and shortcuts). */
export async function createProjectEntry(type: 'file' | 'folder'): Promise<void> {
  const name = await askText({
    title: type === 'file' ? 'New file' : 'New folder',
    label: 'Name (folders may contain / for subfolders)',
    defaultValue: type === 'file' ? 'untitled.tex' : 'folder',
    confirmLabel: 'Create',
  })
  if (!name) return
  await invokeOrThrow('files:create', { relPath: name, type })
  await useProjectStore.getState().refreshTree()
}

/** Export a project folder as a ZIP (asks whether to include the compiled PDF). */
export async function exportProjectAsZip(projectPath: string): Promise<void> {
  const includePdf = await invokeOrThrow('dialog:confirm', {
    title: 'Export as ZIP',
    message: 'Include the compiled PDF in the ZIP archive?',
    confirmLabel: 'Include PDF',
    cancelLabel: 'Sources only',
  })
  try {
    const written = await invokeOrThrow('zip:export', { path: projectPath, includePdf })
    if (written) toast('success', `Exported to ${written}`)
  } catch (err) {
    toast('error', err instanceof Error ? err.message : String(err))
  }
}

/** Save a project as a reusable user template (offered in "New Project"). */
export async function saveProjectAsTemplate(
  projectPath: string,
  suggestedName: string
): Promise<void> {
  const name = await askText({
    title: 'Save as template',
    label: 'Template name',
    defaultValue: suggestedName,
    confirmLabel: 'Save template',
    validate: (value) =>
      /[a-z0-9]/i.test(value) ? null : 'The name needs at least one letter or digit',
  })
  if (!name) return
  try {
    const template = await invokeOrThrow('templates:saveFromProject', { path: projectPath, name })
    if (template) toast('success', `Template “${template.name}” saved`)
    else toast('error', `A template named “${name}” already exists.`)
  } catch (err) {
    toast('error', err instanceof Error ? err.message : String(err))
  }
}

/** Event the Git panel listens to after branch changes made elsewhere. */
export const GIT_CHANGED_EVENT = 'verso:git-changed'

/** Ask for a name, create the branch and switch to it. */
export async function createGitBranch(): Promise<boolean> {
  const name = await askText({
    title: 'New branch',
    label: 'Branch name',
    placeholder: 'e.g. chapter-3-rewrite',
    confirmLabel: 'Create branch',
    validate: (value) =>
      gitBranchName.safeParse(value.trim()).success ? null : 'Not a valid Git branch name',
  })
  if (!name) return false
  try {
    await invokeOrThrow('git:createBranch', { name: name.trim() })
    toast('success', `Switched to new branch “${name.trim()}”`)
    window.dispatchEvent(new Event(GIT_CHANGED_EVENT))
    return true
  } catch (err) {
    toast('error', err instanceof Error ? err.message : String(err))
    return false
  }
}
