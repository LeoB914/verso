import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

interface ToastStore {
  toasts: Toast[]
  show: (kind: Toast['kind'], message: string) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  show: (kind, message) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }].slice(-3) }))
    // Auto-dismiss; errors stay until clicked.
    if (kind !== 'error') {
      setTimeout(() => get().dismiss(id), 4000)
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function toast(kind: Toast['kind'], message: string): void {
  useToastStore.getState().show(kind, message)
}
