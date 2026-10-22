import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'

/**
 * Crash-recovery copies of dirty editor buffers, written every few seconds to
 * `userData/recovery/<projectId>.json` and offered for restore on next start.
 */

export interface RecoveryState {
  savedAt: number
  projectPath: string
  buffers: Array<{ relPath: string; content: string }>
}

function recoveryDir(): string {
  return path.join(app.getPath('userData'), 'recovery')
}

function recoveryFile(projectPath: string): string {
  const id = Buffer.from(projectPath).toString('base64url')
  return path.join(recoveryDir(), `${id}.json`)
}

export async function saveRecovery(
  projectPath: string,
  buffers: Array<{ relPath: string; content: string; dirty?: boolean }>
): Promise<void> {
  const dirty = buffers.filter((tab) => tab.dirty)
  if (dirty.length === 0) {
    await clearRecovery(projectPath).catch(() => undefined)
    return
  }
  const state: RecoveryState = {
    savedAt: Date.now(),
    projectPath,
    buffers: dirty.map((tab) => ({ relPath: tab.relPath, content: tab.content })),
  }
  await fs.mkdir(recoveryDir(), { recursive: true })
  const tmp = recoveryFile(projectPath) + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(state))
  await fs.rename(tmp, recoveryFile(projectPath))
}

export async function loadRecovery(projectPath: string): Promise<RecoveryState | null> {
  try {
    return JSON.parse(await fs.readFile(recoveryFile(projectPath), 'utf8')) as RecoveryState
  } catch {
    return null
  }
}

export async function clearRecovery(projectPath: string): Promise<void> {
  await fs.rm(recoveryFile(projectPath), { force: true })
}
