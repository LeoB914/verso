import { create } from 'zustand'

/**
 * In-app text prompt. Electron's renderer does not implement `window.prompt`
 * (it throws "prompt() is not supported"), so every text input goes through
 * this dialog instead.
 */

export interface PromptRequest {
  title: string
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  /** Return an error message to keep the dialog open. */
  validate?: (value: string) => string | null
}

interface PromptState {
  current: (PromptRequest & { id: number }) | null
  error: string | null
  open: (request: PromptRequest) => Promise<string | null>
  submit: (value: string) => void
  cancel: () => void
}

let resolveCurrent: ((value: string | null) => void) | null = null
let nextId = 1

export const usePromptStore = create<PromptState>((set, get) => ({
  current: null,
  error: null,

  open: (request) =>
    new Promise<string | null>((resolve) => {
      // A second prompt replaces the first: resolve the old one as cancelled.
      resolveCurrent?.(null)
      resolveCurrent = resolve
      set({ current: { ...request, id: nextId++ }, error: null })
    }),

  submit: (value) => {
    const { current } = get()
    if (!current) return
    const error = current.validate?.(value) ?? null
    if (error) {
      set({ error })
      return
    }
    set({ current: null, error: null })
    resolveCurrent?.(value)
    resolveCurrent = null
  },

  cancel: () => {
    set({ current: null, error: null })
    resolveCurrent?.(null)
    resolveCurrent = null
  },
}))

/** Convenience wrapper: `const name = await askText({ title: 'New file' })`. */
export function askText(request: PromptRequest): Promise<string | null> {
  return usePromptStore.getState().open(request)
}
