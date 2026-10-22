import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { BrowserWindow, safeStorage } from 'electron'
import { streamText, type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { registerStream, finishStream, stopStream } from './stream-registry'

/**
 * AI chat backend: providers configured in Settings → AI. API keys are
 * encrypted with safeStorage and never leave the main process. Streaming
 * tokens are pushed to the renderer via events.
 */

export interface AiProviderConfig {
  kind: 'ollama' | 'openai-compatible' | 'anthropic'
  /** Ollama: base URL. OpenAI-compatible: base URL. */
  baseUrl?: string
  model: string
  /** API key (openai-compatible / anthropic), stored encrypted. */
  apiKey?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatSessionMeta {
  id: string
  projectId: string
  title: string
  createdAt: number
  messages: ChatMessage[]
  provider: AiProviderConfig
}

function sessionsDir(): Promise<string> {
  return (async () => {
    const { app } = await import('electron')
    const dir = path.join(app.getPath('userData'), 'chat')
    await fs.mkdir(dir, { recursive: true })
    return dir
  })()
}

function projectIdOf(root: string): string {
  return createHash('sha256').update(root).digest('hex').slice(0, 16)
}

export async function listChatSessions(projectRoot: string): Promise<ChatSessionMeta[]> {
  const dir = await sessionsDir()
  const prefix = `${projectIdOf(projectRoot)}-`
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    const sessions: ChatSessionMeta[] = []
    for (const file of files) {
      try {
        sessions.push(
          JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')) as ChatSessionMeta
        )
      } catch {
        continue
      }
    }
    return sessions.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export async function saveChatSession(session: ChatSessionMeta): Promise<void> {
  const dir = await sessionsDir()
  const file = path.join(dir, `${projectIdOf(session.projectId)}-${session.id}.json`)
  await fs.writeFile(file, JSON.stringify(session, null, 0))
}

export async function deleteChatSession(projectRoot: string, sessionId: string): Promise<void> {
  const dir = await sessionsDir()
  await fs.rm(path.join(dir, `${projectIdOf(projectRoot)}-${sessionId}.json`), { force: true })
}

// --- API keys (safeStorage) -------------------------------------------------

function keysFile(): Promise<string> {
  return (async () => {
    const { app } = await import('electron')
    const dir = path.join(app.getPath('userData'), 'keys')
    await fs.mkdir(dir, { recursive: true })
    return path.join(dir, 'ai-keys.bin')
  })()
}

export async function saveApiKey(providerKind: string, key: string): Promise<void> {
  const file = await keysFile()
  const store = await readKeyStore(file)
  store[providerKind] = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key).toString('base64')
    : Buffer.from(key).toString('base64')
  await fs.writeFile(file, JSON.stringify(store))
}

export async function loadApiKey(providerKind: string): Promise<string | null> {
  const file = await keysFile()
  const store = await readKeyStore(file)
  const value = store[providerKind]
  if (!value) return null
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
  return Buffer.from(value, 'base64').toString('utf8')
}

async function readKeyStore(file: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

// --- Model factory -----------------------------------------------------------

export async function createModel(config: AiProviderConfig): Promise<LanguageModel> {
  if (config.kind === 'ollama') {
    const compatible = createOpenAICompatible({
      name: 'ollama',
      baseURL: `${config.baseUrl ?? 'http://localhost:11434'}/v1`,
    })
    return compatible(config.model)
  }
  if (config.kind === 'openai-compatible') {
    const apiKey = config.apiKey ?? (await loadApiKey('openai-compatible')) ?? ''
    const compatible = createOpenAICompatible({
      name: 'openai-compatible',
      baseURL: config.baseUrl ?? '',
      apiKey,
    })
    return compatible(config.model)
  }
  if (config.kind === 'anthropic') {
    const apiKey = config.apiKey ?? (await loadApiKey('anthropic')) ?? ''
    const anthropic = createAnthropic({ apiKey })
    return anthropic(config.model)
  }
  throw new Error(`Unknown provider: ${String(config)}`)
}

// --- Streaming chat -----------------------------------------------------------

export interface ChatRequest {
  sessionId: string
  projectId: string
  messages: ChatMessage[]
  provider: AiProviderConfig
}

export async function streamChat(request: ChatRequest): Promise<void> {
  const window = BrowserWindow.getAllWindows()[0]
  const model = await createModel(request.provider)
  let aborted = false
  // Abort the underlying HTTP request, not just token forwarding: cloud
  // providers keep generating (and billing) otherwise.
  const controller = new AbortController()
  registerStream(request.sessionId, () => {
    aborted = true
    controller.abort()
  })

  try {
    const result = streamText({
      model,
      messages: request.messages as never,
      abortSignal: controller.signal,
    })

    for await (const delta of result.textStream) {
      if (aborted) break
      window?.webContents.send('chat:token', { sessionId: request.sessionId, token: delta })
    }
    const finalText = aborted ? undefined : await result.text
    window?.webContents.send('chat:done', { sessionId: request.sessionId, text: finalText ?? '' })
  } catch (err) {
    if (!aborted) {
      window?.webContents.send('chat:error', {
        sessionId: request.sessionId,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  } finally {
    finishStream(request.sessionId)
  }
}

export function stopChatStream(sessionId: string): void {
  stopStream(sessionId)
}

/** List installed Ollama models (or a not-running hint). */
export async function listOllamaModels(
  baseUrl: string
): Promise<{ models: string[]; running: boolean }> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) return { models: [], running: false }
    const data = (await response.json()) as { models?: Array<{ name: string }> }
    return { models: (data.models ?? []).map((m) => m.name), running: true }
  } catch {
    return { models: [], running: false }
  }
}
