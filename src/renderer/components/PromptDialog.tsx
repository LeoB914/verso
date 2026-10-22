import { useState } from 'react'
import { usePromptStore, type PromptRequest } from '../stores/prompt'

/** Modal single-line text prompt (replaces the unsupported window.prompt). */
export function PromptDialog(): React.JSX.Element | null {
  const current = usePromptStore((s) => s.current)
  if (!current) return null
  // Keyed by request id: a new prompt always mounts fresh state.
  return <PromptForm key={current.id} request={current} />
}

function PromptForm({ request }: { request: PromptRequest & { id: number } }): React.JSX.Element {
  const error = usePromptStore((s) => s.error)
  const submit = usePromptStore((s) => s.submit)
  const cancel = usePromptStore((s) => s.cancel)
  const [value, setValue] = useState(request.defaultValue ?? '')

  const confirm = (): void => submit(value.trim())

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel()
      }}
      data-testid="prompt-dialog"
    >
      <div
        className="w-[420px] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-popover)]"
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel()
          if (event.key === 'Enter') confirm()
        }}
      >
        <p className="mb-1 text-[15px] font-semibold">{request.title}</p>
        {request.label && (
          <p className="mb-2 text-[13px] text-[var(--text-secondary)]">{request.label}</p>
        )}
        <input
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2 text-[14px] outline-none focus:border-[var(--accent)]"
          value={value}
          placeholder={request.placeholder}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) usePromptStore.setState({ error: null })
          }}
          data-testid="prompt-input"
        />
        {error && <p className="mt-1 text-[12px] text-[var(--danger)]">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="h-7 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-3 text-[13px] hover:bg-[var(--bg-hover)]"
            onClick={cancel}
            data-testid="prompt-cancel"
          >
            Cancel
          </button>
          <button
            className="h-7 rounded-[var(--radius-md)] bg-[var(--accent)] px-3 text-[13px] font-medium text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
            onClick={confirm}
            disabled={value.trim().length === 0}
            data-testid="prompt-confirm"
          >
            {request.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
