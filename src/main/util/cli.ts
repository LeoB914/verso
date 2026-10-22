import { existsSync, statSync } from 'node:fs'
import * as path from 'node:path'

export interface CliPathContext {
  /** Working directory of the process (electron-vite passes `.` in dev). */
  cwd: string
  /** The app bundle/app directory — never treat it as a project. */
  appPath: string
}

/**
 * Pick an explicitly passed project directory from `process.argv`.
 *
 * Deliberately strict: relative arguments (electron-vite passes `.` in dev)
 * and the app's own directory are ignored, so a normal start always lands on
 * the dashboard. Absolute paths from “Open with” / CLI / E2E still work.
 */
export function findProjectDirectoryArg(
  args: readonly string[],
  context: CliPathContext
): string | null {
  const cwd = path.resolve(context.cwd)
  const appPath = path.resolve(context.appPath)

  for (const arg of args) {
    if (!arg || arg.startsWith('-') || !path.isAbsolute(arg)) continue
    const resolved = path.resolve(arg)
    if (resolved === cwd) continue
    if (resolved === appPath || resolved.startsWith(appPath + path.sep)) continue
    try {
      if (existsSync(resolved) && statSync(resolved).isDirectory()) return resolved
    } catch {
      // Ignore unreadable arguments.
    }
  }
  return null
}
