/// <reference lib="webworker" />
import Nspell from 'nspell'
import enAffUrl from '../../../resources/dictionaries/en.aff?url'
import enDicUrl from '../../../resources/dictionaries/en.dic?url'
import deAffUrl from '../../../resources/dictionaries/de.aff?url'
import deDicUrl from '../../../resources/dictionaries/de.dic?url'

/**
 * Spellcheck Web Worker: loads Hunspell dictionaries lazily and checks
 * prose word lists sent by the editor.
 */

type SpellInstance = ReturnType<typeof Nspell>

let spell: SpellInstance | null = null
let currentLang: string | null = null
let extraWords: string[] = []

const DICT_URLS: Record<string, { aff: string; dic: string }> = {
  en: { aff: enAffUrl, dic: enDicUrl },
  de: { aff: deAffUrl, dic: deDicUrl },
}

async function ensureSpell(lang: string): Promise<SpellInstance | null> {
  if (spell && currentLang === lang) return spell
  const urls = DICT_URLS[lang]
  if (!urls) return null
  try {
    const [affRes, dicRes] = await Promise.all([fetch(urls.aff), fetch(urls.dic)])
    const aff = new Uint8Array(await affRes.arrayBuffer())
    const dic = new Uint8Array(await dicRes.arrayBuffer())
    spell = Nspell(aff, dic)
    currentLang = lang
    for (const word of extraWords) spell.add(word)
    return spell
  } catch {
    return null
  }
}

export interface CheckRequest {
  type: 'check'
  requestId: number
  lang: string
  words: Array<{ word: string; start: number; end: number }>
}

export interface InitRequest {
  type: 'init'
  lang: string
  extraWords?: string[]
}

export interface AddWordRequest {
  type: 'addWord'
  word: string
}

export type SpellRequest = CheckRequest | InitRequest | AddWordRequest | SuggestRequest

export interface SuggestRequest {
  type: 'suggest'
  requestId: number
  word: string
  lang: string
}

self.onmessage = async (event: MessageEvent<SpellRequest>): Promise<void> => {
  const message = event.data
  if (message.type === 'init') {
    extraWords = message.extraWords ?? []
    await ensureSpell(message.lang)
    self.postMessage({ type: 'ready', lang: message.lang })
    return
  }
  if (message.type === 'addWord') {
    extraWords.push(message.word)
    ;(await ensureSpell(currentLang ?? 'en'))?.add(message.word)
    self.postMessage({ type: 'wordAdded', word: message.word })
    return
  }
  if (message.type === 'check') {
    const instance = await ensureSpell(message.lang)
    if (!instance) {
      self.postMessage({ type: 'result', requestId: message.requestId, misspelled: [] })
      return
    }
    const misspelled = message.words
      .filter((w) => !instance.correct(w.word))
      .map((w) => ({ word: w.word, start: w.start, end: w.end }))
    self.postMessage({ type: 'result', requestId: message.requestId, misspelled })
    return
  }
  if (message.type === 'suggest') {
    const suggestMessage = message as {
      type: 'suggest'
      requestId: number
      word: string
      lang: string
    }
    const instance = await ensureSpell(suggestMessage.lang)
    const suggestions = instance ? instance.suggest(suggestMessage.word).slice(0, 8) : []
    self.postMessage({ type: 'suggestions', requestId: suggestMessage.requestId, suggestions })
  }
}
