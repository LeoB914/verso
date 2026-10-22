import { useToastStore } from '../stores/toast'

/** Toasts: bottom-right, max 3 stacked, auto-dismiss except errors. */
export function Toaster(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (toasts.length === 0) return <div className="hidden" />

  return (
    <div
      className="pointer-events-none fixed bottom-8 right-4 z-[60] flex flex-col gap-2"
      data-testid="toaster"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-left text-[13px] shadow-[var(--shadow-popover)] ${
            toast.kind === 'error'
              ? 'border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]'
              : toast.kind === 'success'
                ? 'border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
          }`}
          onClick={() => dismiss(toast.id)}
          data-testid={`toast-${toast.kind}`}
        >
          {toast.message}
        </button>
      ))}
    </div>
  )
}
