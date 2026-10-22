import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Square, Trash2, Wifi, WifiOff } from 'lucide-react'
import Markdown from 'react-markdown'
import type { ChatSessionInfo } from '@shared/ipc'
import { api, invokeOrThrow } from '../api'
import { askText } from '../stores/prompt'
import { useProjectStore } from '../stores/project'
import { useEditorStore } from '../stores/editor'

/**
 * AI chat sidebar: streaming answers with Markdown, provider indicator
 * (local vs cloud), chat history per project, stop generation.
 */

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  streaming?: boolean
}

interface ProviderConfig {
  kind: 'ollama' | 'openai-compatible' | 'anthropic'
  baseUrl?: string
  model: string
  apiKey?: string
}

const DEFAULT_PROVIDER: ProviderConfig = {
  kind: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2',
}

export function AiChatPanel(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [provider, setProvider] = useState<ProviderConfig>(DEFAULT_PROVIDER)
  const [generating, setGenerating] = useState(false)
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([])
  const [sessionId] = useState(() => `chat-${Date.now().toString(36)}`)
  const project = useProjectStore((s) => s.project)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const refreshSessions = async (): Promise<void> => {
    if (!project) return
    const result = await api.invoke('chat:sessions', { projectId: project.path })
    if (result.ok) setSessions(result.data)
  }

  useEffect(() => {
    void (async () => {
      await refreshSessions()
      // Load saved provider config.
      const settings = await api.invoke('settings:get', undefined)
      if (settings.ok) {
        const stored = (settings.data as unknown as { aiProvider?: ProviderConfig }).aiProvider
        if (stored) setProvider(stored)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.path])

  useEffect(() => {
    const offs = [
      api.on('chat:token', ({ sessionId: id, token }) => {
        if (id !== sessionId) return
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant' && last.streaming) {
            return [...prev.slice(0, -1), { ...last, content: last.content + token }]
          }
          return [...prev, { role: 'assistant', content: token, streaming: true }]
        })
      }),
      api.on('chat:done', ({ sessionId: id }) => {
        if (id !== sessionId) return
        setGenerating(false)
        setMessages((prev) => prev.map((m) => ({ ...m, streaming: false })))
      }),
      api.on('chat:error', ({ sessionId: id, message }) => {
        if (id !== sessionId) return
        setGenerating(false)
        setMessages((prev) => [
          ...prev.map((m) => ({ ...m, streaming: false })),
          { role: 'assistant', content: `⚠ ${message}` },
        ])
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [sessionId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const send = async (): Promise<void> => {
    if (!input.trim() || generating || !project) return
    const userMessage: ChatMessage = { role: 'user', content: input.trim() }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    setGenerating(true)
    await api.invoke('chat:send', {
      sessionId,
      projectId: project.path,
      messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
      provider,
    })
    // Persist the session after completion (best-effort).
    setTimeout(() => {
      void (async () => {
        await api.invoke('chat:saveSession', {
          session: {
            id: sessionId,
            projectId: project.path,
            title: userMessage.content.slice(0, 50),
            createdAt: Date.now(),
            messages: messagesRef.current,
            provider,
          },
        })
        await refreshSessions()
      })()
    }, 3000)
  }

  const messagesRef = useRef<ChatMessage[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const isLocal = provider.kind === 'ollama'

  return (
    <div className="flex h-full flex-col bg-[var(--bg-content)]" data-testid="ai-chat-panel">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
        <Bot size={16} />
        <span className="text-[13px] font-semibold">AI Chat</span>
        <span
          className={`flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] ${isLocal ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--warning)]/15 text-[var(--warning)]'}`}
          title={
            isLocal
              ? 'Local model — data stays on this machine'
              : 'Cloud provider — data leaves this machine'
          }
        >
          {isLocal ? <WifiOff size={11} /> : <Wifi size={11} />}
          {isLocal ? 'local' : 'cloud'}
        </span>
        <div className="flex-1" />
        <button
          className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
          onClick={() => {
            void (async () => {
              const models = await invokeOrThrow('chat:listModels', {
                baseUrl: provider.baseUrl ?? 'http://localhost:11434',
              })
              if (models.models.length > 0) {
                const model = await askText({
                  title: 'Choose model',
                  label: `Installed: ${models.models.join(', ')}`,
                  defaultValue: provider.model,
                  confirmLabel: 'Use model',
                })
                if (model)
                  setProvider({
                    ...provider,
                    model,
                    kind: provider.kind === 'ollama' ? 'ollama' : provider.kind,
                  })
              } else {
                alert(
                  'Ollama is not reachable at ' + (provider.baseUrl ?? 'http://localhost:11434')
                )
              }
            })()
          }}
          title="Pick model"
        >
          {provider.model}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-3" data-testid="chat-messages">
        {messages.length === 0 && (
          <p className="text-[13px] text-[var(--text-tertiary)]">Ask about the current project.</p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={`mb-2 rounded-[var(--radius-md)] px-3 py-2 text-[13px] leading-relaxed ${
              message.role === 'user'
                ? 'ml-8 bg-[var(--bg-selected)]'
                : 'mr-4 bg-[var(--bg-elevated)] border border-[var(--border-subtle)]'
            }`}
          >
            <Markdown>{message.content}</Markdown>
          </div>
        ))}
      </div>

      {/* History */}
      {sessions.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-t border-[var(--border-subtle)] px-2 py-1">
          {sessions.slice(0, 5).map((session) => (
            <button
              key={session.id}
              className="shrink-0 truncate rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
              title={session.title}
              onClick={() => {
                void (async () => {
                  await api.invoke('chat:deleteSession', {
                    projectId: project?.path ?? '',
                    sessionId: session.id,
                  })
                  await refreshSessions()
                })()
              }}
            >
              <Trash2 size={11} className="inline" /> {session.title}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex shrink-0 items-end gap-2 border-t border-[var(--border-subtle)] p-2">
        <textarea
          className="h-16 flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2 py-1.5 text-[13px]"
          placeholder="Ask the AI about the current project…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          data-testid="chat-input"
        />
        {generating ? (
          <button
            className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2"
            onClick={() => void api.invoke('chat:stop', { sessionId })}
            title="Stop generation"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            className="rounded-[var(--radius-md)] bg-[var(--accent)] p-2 text-[var(--accent-contrast)] disabled:opacity-50"
            onClick={() => void send()}
            disabled={!input.trim()}
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// Keep the editor store import referenced for future context chips.
void useEditorStore
