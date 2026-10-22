import helpData from '../../../resources/latex-error-help.json'

export interface ErrorHelp {
  id: string
  pattern: string
  title: string
  explanation: string
  fix: string
}

export const errorHelpEntries = helpData as ErrorHelp[]

/**
 * Match a log message against the help database. Returns the best match
 * (first entry whose regex matches) or null.
 */
export function matchErrorHelp(message: string): ErrorHelp | null {
  for (const entry of errorHelpEntries) {
    try {
      if (new RegExp(entry.pattern, 'i').test(message)) return entry
    } catch {
      // Invalid pattern in the database — skip.
    }
  }
  return null
}
