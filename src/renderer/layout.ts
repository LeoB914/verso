import type { ProjectUiState } from '@shared/ipc'
import { invokeOrThrow } from './api'

/**
 * Per-project pane layout persistence (sizes in %, visibility, problems
 * state) — stored in the project registry via IPC, never localStorage.
 */

const current: ProjectUiState = {}
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function currentUiState(): ProjectUiState {
  return { ...current }
}

export function rememberUiState(patch: ProjectUiState): void {
  Object.assign(current, patch)
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void invokeOrThrow('project:saveUiState', { uiState: currentUiState() }).catch(() => undefined)
  }, 400)
}

/** Load the persisted layout for the open project. */
export async function loadUiState(): Promise<ProjectUiState> {
  try {
    const result = await invokeOrThrow('project:getUiState', undefined)
    Object.assign(current, result)
  } catch {
    // keep defaults
  }
  return currentUiState()
}

/** Forget the in-memory layout (called when a project closes). */
export function resetUiState(): void {
  for (const key of Object.keys(current) as Array<keyof ProjectUiState>) {
    delete current[key]
  }
}
