import { linter, type Diagnostic } from '@codemirror/lint'
import { parseStructure } from '@shared/latex/structure'
import { findProseRanges } from '@shared/latex/spell-tokenizer'
import { useEditorStore } from '../stores/editor'
import { useProjectStore } from '../stores/project'

/**
 * Spellcheck via the nspell Web Worker, applied as a CodeMirror linter.
 * Only prose ranges (from the shared tokenizer) are checked.
 */

let worker: Worker | null = null
let requestId = 0

type ResultHandler = (misspelled: Array<{ word: string; start: number; end: number }>) => void
const pending = new Map<number, ResultHandler>()

export function getSpellWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('../spell/spell-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        type: string
        requestId?: number
        misspelled?: Array<{ word: string; start: number; end: number }>
        suggestions?: string[]
      }
      if (data.type === 'result' && data.requestId !== undefined) {
        const resolve = pending.get(data.requestId)
        if (resolve) {
          pending.delete(data.requestId)
          resolve(data.misspelled ?? [])
        }
      }
      if (data.type === 'suggestions' && data.requestId !== undefined) {
        const resolve = suggestionPending.get(data.requestId)
        if (resolve) {
          suggestionPending.delete(data.requestId)
          resolve(data.suggestions ?? [])
        }
      }
    }
  } catch {
    return null
  }
  return worker
}

let currentLang = 'en'

export function configureSpellcheck(lang: string, extraWords: string[]): void {
  currentLang = lang === 'de' ? 'de' : 'en'
  getSpellWorker()?.postMessage({ type: 'init', lang: currentLang, extraWords })
}

export function addSpellWord(word: string): void {
  getSpellWorker()?.postMessage({ type: 'addWord', word })
}

/** Ask the worker for spelling suggestions of a word. */
export function requestSuggestions(word: string, lang = currentLang): Promise<string[]> {
  const w = getSpellWorker()
  if (!w) return Promise.resolve([])
  const id = ++requestId
  return new Promise((resolve) => {
    suggestionPending.set(id, resolve)
    w.postMessage({ type: 'suggest', requestId: id, word, lang })
    setTimeout(() => {
      if (suggestionPending.has(id)) {
        suggestionPending.delete(id)
        resolve([])
      }
    }, 5000)
  })
}

const suggestionPending = new Map<number, (suggestions: string[]) => void>()

async function checkWords(
  words: Array<{ word: string; start: number; end: number }>
): Promise<Array<{ word: string; start: number; end: number }>> {
  const w = getSpellWorker()
  if (!w) return []
  const id = ++requestId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    w.postMessage({ type: 'check', requestId: id, lang: currentLang, words })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve([])
      }
    }, 5000)
  })
}

/** CodeMirror linter extension using the worker. */
export const spellcheckLinter = linter(async (view) => {
  const project = useProjectStore.getState().project
  if (!(project?.config.spellEnabled ?? false)) return []
  const text = view.state.doc.toString()
  const regions = parseStructure(text)
  const prose = findProseRanges(text, regions.commentRanges, regions.verbatimRanges)
  const ignored = useEditorStore.getState().spellIgnored
  const candidates = prose.filter((p) => !ignored.has(p.word.toLowerCase()))
  if (candidates.length === 0) return []
  const misspelled = await checkWords(candidates)
  const diagnostics: Diagnostic[] = misspelled.map((m) => ({
    from: m.start,
    to: m.end,
    severity: 'warning',
    message: `Unknown word: ${m.word}`,
    markClass: 'cm-spell-error',
  }))
  return diagnostics
})
