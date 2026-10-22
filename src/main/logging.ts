import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'

/**
 * Local rotating error log (userData/logs/openleaf.log, 5 × 1 MB). No
 * telemetry — logs never leave the machine.
 */

const MAX_FILE_SIZE = 1024 * 1024
const MAX_FILES = 5

function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

function currentLogFile(): string {
  return path.join(logsDir(), 'openleaf.log')
}

export async function logError(message: string): Promise<void> {
  await write('ERROR', message)
}

async function write(level: 'ERROR' | 'INFO', message: string): Promise<void> {
  try {
    const dir = logsDir()
    await fsPromises.mkdir(dir, { recursive: true })
    const file = currentLogFile()
    const line = `${new Date().toISOString()} [${level}] ${message}\n`
    try {
      const stat = await fsPromises.stat(file)
      if (stat.size > MAX_FILE_SIZE) {
        rotate(file)
      }
    } catch {
      // File does not exist yet.
    }
    await fsPromises.appendFile(file, line)
  } catch {
    // Logging must never crash the app.
  }
}

function rotate(file: string): void {
  try {
    for (let index = MAX_FILES - 1; index >= 1; index--) {
      const from = `${file}.${index}`
      const to = `${file}.${index + 1}`
      if (fs.existsSync(from)) fs.renameSync(from, to)
    }
    if (fs.existsSync(file)) fs.renameSync(file, `${file}.1`)
  } catch {
    // Best effort.
  }
}

/** Open the logs folder in the OS file manager. */
export async function openLogsFolder(): Promise<void> {
  const { shell } = await import('electron')
  await fsPromises.mkdir(logsDir(), { recursive: true })
  await shell.openPath(logsDir())
}
