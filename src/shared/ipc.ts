import { z } from 'zod'
import type { SynctexEditResult, SynctexViewResult } from './latex/synctex'
import type { TexcountResult } from './latex/texcount'

/**
 * Central IPC contract. Every channel is defined exactly once here:
 * a zod request schema (validated in the main process) and the response type.
 * Shape over the wire: `{ ok: true, data } | { ok: false, error }`.
 */

export interface IpcError {
  code: string
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export const compilers = ['pdflatex', 'xelatex', 'lualatex'] as const
export type Compiler = (typeof compilers)[number]

export interface ProjectConfig {
  mainFile: string
  compiler: Compiler
  shellEscape: boolean
  spellLanguage: 'en' | 'de'
  autoCompile: boolean
  /** Spellcheck toggle (Phase 2). */
  spellEnabled: boolean
}

export interface ProjectInfo {
  /** Absolute path of the project folder. */
  path: string
  name: string
  config: ProjectConfig
}

export interface FileNode {
  name: string
  /** Path relative to the project root, `/`-separated. */
  relPath: string
  type: 'file' | 'dir'
  children?: FileNode[]
}

export interface TexTool {
  name: string
  /** Absolute path of the executable. */
  path: string
  version: string | null
}

export type TeXToolName =
  | 'latexmk'
  | 'pdflatex'
  | 'xelatex'
  | 'lualatex'
  | 'biber'
  | 'bibtex'
  | 'synctex'
  | 'texcount'
  | 'perl'

export type { SynctexViewResult, SynctexEditResult } from './latex/synctex'
export type { TexcountResult } from './latex/texcount'

export interface TexEnvironment {
  /** True when latexmk (and at least one engine) was found. */
  available: boolean
  /** How the PATH was resolved, for diagnostics. */
  pathSource: string
  tools: Partial<Record<TeXToolName, TexTool>>
}

export type LogLevel = 'error' | 'warning' | 'info'

export interface LogEntry {
  level: LogLevel
  /** File path as written in the log, or null when unknown. */
  file: string | null
  line: number | null
  message: string
  rawExcerpt?: string
}

export interface FileContent {
  content: string
  /** Modification time in ms since epoch (for conflict detection). */
  mtime: number
  /** True if the file on disk used CRLF line endings. */
  crlf: boolean
  /** True if the file on disk started with a UTF-8 BOM. */
  hadBom: boolean
}

export type CompileState = 'idle' | 'compiling' | 'success' | 'error' | 'canceled'

import type { AppSettingsData as AppSettings } from './settings'
export type { AppSettingsData as AppSettings } from './settings'

export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  includePattern?: string
}

export interface SearchMatch {
  line: number
  /** Column (1-based) of the match start. */
  column: number
  length: number
  preview: string
}

export interface SearchFileResult {
  relPath: string
  matches: SearchMatch[]
}

export interface PdfGotoPayload {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface EditorGotoPayload {
  relPath: string
  line: number
  column: number
}

export interface RegistryEntry {
  path: string
  name: string
  lastOpened: number
  tags: string[]
  exists: boolean
  /** Per-project UI layout (pane sizes and visibility), persisted via IPC. */
  uiState?: ProjectUiState
}

/** Persisted per-project layout of the resizable panes (percent sizes). */
export interface ProjectUiState {
  sidebarSize?: number
  pdfSize?: number
  chatSize?: number
  problemsSize?: number
  problemsCollapsed?: boolean
  sidebarVisible?: boolean
  pdfVisible?: boolean
  chatVisible?: boolean
  openTabs?: string[]
  activeTab?: string | null
  cursorLine?: number
  cursorColumn?: number
  pdfZoom?: number
  pdfZoomMode?: 'fitWidth' | 'fitPage' | 'fixed'
}

export interface TemplateInfo {
  id: string
  name: string
  description: string
  mainFile: string
  compiler: Compiler
  builtIn: boolean
}

export interface FileContentMap {
  [relPath: string]: string
}

export interface FsChangeEvent {
  type: 'add' | 'unlink' | 'change' | 'addDir' | 'unlinkDir' | 'rename'
  relPath: string
}

export interface CompileStatus {
  state: CompileState
  /** Duration of the last compile in ms. */
  durationMs?: number
  /** Number of error-level log entries. */
  errorCount?: number
  /** Relative path of the produced PDF inside the project, when available. */
  pdfRelPath?: string | null
  message?: string
}

// ---------------------------------------------------------------------------
// Response type map (one entry per channel)
// ---------------------------------------------------------------------------

export interface IpcResponseMap {
  'project:choose': ProjectInfo | null
  'project:open': ProjectInfo
  'project:close': null
  'project:getCurrent': ProjectInfo | null
  'project:setConfig': ProjectConfig
  'project:getUiState': ProjectUiState
  'project:saveUiState': ProjectUiState
  'project:listTree': FileNode | null
  'project:dictionary': string[]
  'project:dictionary:add': null
  'file:read': FileContent
  'file:write': { mtime: number }
  'tex:detect': TexEnvironment
  'compile:start': { started: boolean }
  'compile:cancel': { canceled: boolean }
  'compile:log': LogEntry[]
  'settings:get': AppSettings
  'settings:set': AppSettings
  'menu:popup': string | null
  'dialog:confirm': boolean
  'dialog:chooseDirectory': string | null
  'search:run': null
  'search:replaceAll': { changedFiles: string[] }
  'app:dirtyTabsReply': null
  'compile:fresh': { started: boolean }
  'synctex:forward': SynctexViewResult | null
  'synctex:backward': SynctexEditResult | null
  'wordcount:run': TexcountResult | null
  'pdf:openExternal': null
  'pdf:detach': null
  'projects:list': RegistryEntry[]
  'projects:remove': null
  'projects:setTags': RegistryEntry | null
  'projects:reveal': null
  'projects:locate': RegistryEntry | null
  'projects:trash': null
  'projects:duplicate': { newPath: string } | null
  'projects:rename': ProjectInfo | null
  'templates:list': TemplateInfo[]
  'templates:instantiate': ProjectInfo | null
  'templates:saveFromProject': TemplateInfo | null
  'templates:delete': null
  'zip:import': ProjectInfo | null
  'zip:importFrom': ProjectInfo | null
  'zip:export': string | null
  'files:create': null
  'files:rename': null
  'files:delete': null
  'files:duplicate': { target: string }
  'files:move': null
  'files:readMany': FileContentMap
  'files:writeMany': null
  'files:importDropped': { relPath: string } | null
  'files:pickImage': { relPath: string } | null
  'files:importImageBytes': { relPath: string }
  'files:applyReferenceUpdates': null
  'app:getSettings': AppSettings & { firstRunDone: boolean }
  'history:snapshot': SnapshotInfo
  'history:list': SnapshotInfo[]
  'history:fileContent': string | null
  'history:imageContent': { dataUrl: string } | null
  'history:exportZip': boolean
  'history:restoreFile': boolean
  'history:restoreProject': boolean
  'git:status': GitStatusInfo | null
  'git:init': null
  'git:stage': null
  'git:unstage': null
  'git:commit': string | null
  'git:log': GitCommitInfo[]
  'git:branches': string[]
  'git:createBranch': null
  'git:checkout': null
  'git:fetch': { ahead: number; behind: number } | null
  'git:cancel': null
  'git:push': string | null
  'git:pull': string | null
  'git:available': { available: boolean; version: string | null }
  'git:fileAtCommit': string | null
  'git:commitFiles': GitCommitFile[]
  'userThemes:list': Array<{
    id: string
    name: string
    dark: boolean
    json: string
    error: string | null
  }>
  'userThemes:openFolder': null
  'bib:fetchDoi': { bibtex: string; key: string } | null
  'recovery:save': null
  'recovery:get': RecoveryInfo | null
  'recovery:clear': null
  'logs:openFolder': null
  'firstrun:done': null
  'firstrun:reset': null
  'chat:send': null
  'chat:stop': null
  'chat:sessions': ChatSessionInfo[]
  'chat:saveSession': null
  'chat:deleteSession': null
  'chat:listModels': { models: string[]; running: boolean }
  'keys:save': null
}

export interface SnapshotInfo {
  id: string
  timestamp: number
  files: Record<string, string>
  images?: Record<string, string>
  label?: string
  reason: string
}

export interface GitStatusInfo {
  branch: string | null
  ahead: number
  behind: number
  files: Array<{ path: string; status: string; staged: boolean }>
  conflicted: string[]
}

export interface GitCommitFile {
  path: string
  /** git name-status letter: A(dded), M(odified), D(eleted), R(enamed), … */
  status: string
}

/**
 * Branch names as git accepts them (subset of `git check-ref-format`), never
 * starting with `-` so a name can not be read as a command-line option.
 */
export const gitBranchName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]+(?<![./])$/, 'Invalid branch name')

/** A commit hash, optionally followed by `^` for its parent. */
export const gitRevision = z.string().regex(/^[0-9a-f]{4,40}\^?$/i, 'Invalid commit')

export interface GitCommitInfo {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
}

export interface ChatSessionInfo {
  id: string
  projectId: string
  title: string
  createdAt: number
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  provider: {
    kind: 'ollama' | 'openai-compatible' | 'anthropic'
    baseUrl?: string
    model: string
    apiKey?: string
  }
}

export interface RecoveryInfo {
  savedAt: number
  projectPath: string
  buffers: Array<{ relPath: string; content: string }>
}

export type IpcChannel = keyof IpcResponseMap
export type IpcResponse<C extends IpcChannel> = IpcResponseMap[C]

// ---------------------------------------------------------------------------
// Request schemas (validated with zod in the main process)
// ---------------------------------------------------------------------------

const projectPatchSchema = z.object({
  mainFile: z.string().min(1).optional(),
  compiler: z.enum(compilers).optional(),
  shellEscape: z.boolean().optional(),
  spellLanguage: z.enum(['en', 'de']).optional(),
  autoCompile: z.boolean().optional(),
  spellEnabled: z.boolean().optional(),
})

export const ipcSchemas = {
  'project:choose': z.void(),
  'project:open': z.object({ path: z.string().min(1) }),
  'project:close': z.void(),
  'project:getCurrent': z.void(),
  'project:setConfig': z.object({ patch: projectPatchSchema }),
  'project:getUiState': z.void(),
  'project:saveUiState': z.object({
    uiState: z.object({
      sidebarSize: z.number().min(1).max(99).optional(),
      pdfSize: z.number().min(1).max(99).optional(),
      chatSize: z.number().min(1).max(99).optional(),
      problemsSize: z.number().min(1).max(99).optional(),
      problemsCollapsed: z.boolean().optional(),
      sidebarVisible: z.boolean().optional(),
      pdfVisible: z.boolean().optional(),
      chatVisible: z.boolean().optional(),
    }),
  }),
  'project:listTree': z.void(),
  'project:dictionary': z.void(),
  'project:dictionary:add': z.object({ word: z.string().min(1) }),
  'file:read': z.object({ relPath: z.string() }),
  'file:write': z.object({
    relPath: z.string(),
    content: z.string(),
    expectedMtime: z.number().nullable(),
  }),
  'tex:detect': z.void(),
  'compile:start': z.object({ compiler: z.enum(compilers).optional() }),
  'compile:cancel': z.void(),
  'compile:log': z.void(),
  'settings:get': z.void(),
  // Any subset of the app settings may be patched. A partial() of the settings
  // schema would re-apply every .default() and silently reset all other keys,
  // so the patch is validated by patchSettings after merging (parseSettings).
  'settings:set': z.object({
    patch: z.record(z.string(), z.unknown()),
  }),
  'menu:popup': z.object({
    items: z.array(
      z.object({
        id: z.string(),
        label: z.string().optional(),
        type: z.enum(['normal', 'separator']).optional(),
        enabled: z.boolean().optional(),
      })
    ),
  }),
  'dialog:confirm': z.object({
    title: z.string(),
    message: z.string(),
    confirmLabel: z.string().optional(),
    cancelLabel: z.string().optional(),
  }),
  'dialog:chooseDirectory': z.object({
    title: z.string().optional(),
    defaultPath: z.string().optional(),
  }),
  'search:run': z.object({
    query: z.string().min(1),
    options: z.object({ caseSensitive: z.boolean(), wholeWord: z.boolean(), regex: z.boolean() }),
  }),
  'search:replaceAll': z.object({
    query: z.string().min(1),
    options: z.object({ caseSensitive: z.boolean(), wholeWord: z.boolean(), regex: z.boolean() }),
    replacement: z.string(),
    relPaths: z.array(z.string()).optional(),
  }),
  'app:dirtyTabsReply': z.object({ requestId: z.string().min(1), count: z.number().int().min(0) }),
  'compile:fresh': z.void(),
  'synctex:forward': z.object({
    relPath: z.string().min(1),
    line: z.number().int().min(1),
    column: z.number().int().min(0),
  }),
  'synctex:backward': z.object({ page: z.number().int().min(1), x: z.number(), y: z.number() }),
  'wordcount:run': z.void(),
  'pdf:openExternal': z.void(),
  'pdf:detach': z.void(),
  'projects:list': z.void(),
  'projects:remove': z.object({ path: z.string().min(1) }),
  'projects:setTags': z.object({ path: z.string().min(1), tags: z.array(z.string()) }),
  'projects:reveal': z.object({ path: z.string().min(1) }),
  'projects:locate': z.object({ path: z.string().min(1) }),
  'projects:trash': z.object({ path: z.string().min(1) }),
  'projects:duplicate': z.object({ path: z.string().min(1) }),
  'projects:rename': z.object({ path: z.string().min(1), newName: z.string().min(1) }),
  'templates:list': z.void(),
  'templates:instantiate': z.object({
    templateId: z.string().min(1),
    name: z.string().min(1),
    parentDir: z.string().optional(),
  }),
  'templates:saveFromProject': z.object({ path: z.string().min(1), name: z.string().min(1) }),
  'templates:delete': z.object({ templateId: z.string().min(1) }),
  'zip:import': z.object({ targetDir: z.string().optional() }),
  'zip:importFrom': z.object({ zipPath: z.string().min(1) }),
  'zip:export': z.object({ path: z.string().min(1), includePdf: z.boolean() }),
  'files:create': z.object({
    relPath: z.string().min(1),
    type: z.enum(['file', 'folder']),
    content: z.string().optional(),
  }),
  'files:rename': z.object({ relPath: z.string().min(1), target: z.string().min(1) }),
  'files:delete': z.object({ relPath: z.string().min(1) }),
  'files:duplicate': z.object({ relPath: z.string().min(1) }),
  'files:move': z.object({ relPath: z.string().min(1), target: z.string().min(1) }),
  'files:readMany': z.object({ relPaths: z.array(z.string()) }),
  'files:writeMany': z.object({
    files: z.array(z.object({ relPath: z.string().min(1), content: z.string() })),
  }),
  'files:importDropped': z.object({
    sourcePath: z.string().min(1),
    targetDir: z.string().optional(),
  }),
  'files:pickImage': z.void(),
  'files:importImageBytes': z.object({
    name: z.string().min(1),
    data: z.string().min(1),
    targetDir: z.string().optional(),
  }),
  'files:applyReferenceUpdates': z.object({
    updates: z.array(
      z.object({ relPath: z.string().min(1), oldKey: z.string(), newKey: z.string() })
    ),
  }),
  'app:getSettings': z.void(),
  'history:snapshot': z.object({
    reason: z.string(),
    label: z.string().optional(),
    overrides: z.record(z.string(), z.string()).optional(),
  }),
  'history:list': z.void(),
  'history:fileContent': z.object({ snapshotId: z.string().min(1), relPath: z.string() }),
  'history:imageContent': z.object({ snapshotId: z.string().min(1), relPath: z.string() }),
  'history:exportZip': z.object({ snapshotId: z.string().min(1) }),
  'history:restoreFile': z.object({
    snapshotId: z.string().min(1),
    relPath: z.string(),
    overrides: z.record(z.string(), z.string()).optional(),
  }),
  'history:restoreProject': z.object({
    snapshotId: z.string().min(1),
    overrides: z.record(z.string(), z.string()).optional(),
  }),
  'git:status': z.void(),
  'git:init': z.void(),
  'git:stage': z.object({ paths: z.array(z.string()) }),
  'git:unstage': z.object({ paths: z.array(z.string()) }),
  'git:commit': z.object({ message: z.string().min(1), amend: z.boolean() }),
  'git:log': z.void(),
  'git:branches': z.void(),
  'git:createBranch': z.object({ name: gitBranchName }),
  'git:checkout': z.object({ name: gitBranchName, force: z.boolean() }),
  'git:fetch': z.void(),
  'git:cancel': z.void(),
  'git:push': z.object({ setUpstream: z.boolean() }),
  'git:pull': z.void(),
  'git:available': z.void(),
  'git:fileAtCommit': z.object({ commitHash: gitRevision, relPath: z.string().min(1) }),
  'git:commitFiles': z.object({ commitHash: gitRevision }),
  'userThemes:list': z.void(),
  'userThemes:openFolder': z.void(),
  'bib:fetchDoi': z.object({ doi: z.string().min(1) }),
  'recovery:save': z.object({
    buffers: z.array(
      z.object({ relPath: z.string(), content: z.string(), dirty: z.boolean().optional() })
    ),
  }),
  'recovery:get': z.void(),
  'recovery:clear': z.void(),
  'logs:openFolder': z.void(),
  'firstrun:done': z.void(),
  'firstrun:reset': z.void(),
  'chat:send': z.object({
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    messages: z.array(
      z.object({ role: z.enum(['user', 'assistant', 'system']), content: z.string() })
    ),
    provider: z.object({
      kind: z.enum(['ollama', 'openai-compatible', 'anthropic']),
      baseUrl: z.string().optional(),
      model: z.string().min(1),
      apiKey: z.string().optional(),
    }),
  }),
  'chat:stop': z.object({ sessionId: z.string() }),
  'chat:sessions': z.object({ projectId: z.string().min(1) }),
  'chat:saveSession': z.object({
    session: z.object({
      id: z.string(),
      projectId: z.string(),
      title: z.string(),
      createdAt: z.number(),
      messages: z.array(
        z.object({ role: z.enum(['user', 'assistant', 'system']), content: z.string() })
      ),
      provider: z.object({
        kind: z.enum(['ollama', 'openai-compatible', 'anthropic']),
        baseUrl: z.string().optional(),
        model: z.string(),
        apiKey: z.string().optional(),
      }),
    }),
  }),
  'chat:deleteSession': z.object({ projectId: z.string(), sessionId: z.string() }),
  'chat:listModels': z.object({ baseUrl: z.string().default('http://localhost:11434') }),
  'keys:save': z.object({ provider: z.string().min(1), key: z.string().min(1) }),
} as const

export type IpcRequest<C extends IpcChannel> = z.output<(typeof ipcSchemas)[C]>

// ---------------------------------------------------------------------------
// Event contract (main → renderer pushes)
// ---------------------------------------------------------------------------

export interface EventContract {
  'compile:status': CompileStatus
  /** Pushed by the main process whenever a project is opened (CLI, last project, menu). */
  'project:opened': ProjectInfo
  'search:results': { batch: SearchFileResult[]; done: boolean }
  /** Payload = requestId the renderer must reply with via `app:dirtyTabsReply`. */
  'app:query-dirty': string
  'fs:changed': FsChangeEvent
  'file:changedByApp': { relPath: string }
  'pdf:goto': PdfGotoPayload
  'editor:goto': EditorGotoPayload
  'pdf:detached': { detached: boolean; pdfRelPath: string | null }
  'menu:command': string
  'menu:open-recent': string
  'editor:open-file': { relPath: string }
  'app:accent': string | null
  'app:theme': 'light' | 'dark' | 'system'
  'app:settings': unknown
  'chat:token': { sessionId: string; token: string }
  'chat:done': { sessionId: string; text: string }
  'chat:error': { sessionId: string; message: string }
}

export type EventChannel = keyof EventContract

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type IpcHandler<C extends IpcChannel> = (
  input: IpcRequest<C>
) => Promise<IpcResponse<C>> | IpcResponse<C>
