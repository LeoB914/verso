# Architecture

Verso is an Electron app (main / preload / renderer) built with electron-vite, React,
CodeMirror 6 and pdf.js. The renderer never touches Node APIs — every interaction goes
through a typed IPC contract validated with zod. Internal identifiers (`openleaf://`,
`.openleaf/`, the `OPENLEAF_*` environment variables) keep the project's original name
for compatibility with existing projects.

```
src/
  main/              Electron main process (Node)
    tex/             TeX detection, latexmk runner, synctex wrapper, texcount
    project/         registry, project config, file ops, watcher, templates, zip, search
    history/         snapshot store (content-addressed blobs + index)
    git/             simple-git wrapper
    ai/              chat providers (Ollama / OpenAI-compatible / Anthropic)
    ipc/             zod-validated IPC handlers, one module per concern
    recovery.ts      crash-recovery copies of dirty buffers
    logging.ts       rotating local error log
  preload/           contextBridge API (sandboxed, CJS)
  renderer/          React app
    components/      UI (toolbar, sidebar panels, dialogs, dashboard…)
    editor/          CodeMirror 6 setup, completions, folding, visual mode, diagnostics
    pdf/             pdfjs viewer (virtualized pages, text layer, search)
    stores/          zustand stores (project, editor, compile, settings, …)
  shared/            code used by both processes: IPC contract, zod schemas, command
                     registry, LaTeX structure/bib/log parsers, path safety, settings
resources/           templates, sample project, icons, dictionaries
tests/               unit (mirrors src) + Playwright E2E
```

## Commands and shortcuts

Every user-facing action is a command in `src/shared/commands.ts` (id, label, category,
default shortcut, availability). The native menu is generated from this registry, the
renderer has one keyboard dispatcher (`src/renderer/App.tsx`) that executes commands via
`src/renderer/commands.ts`, and the command palette lists them all. User overrides from
Settings → Keyboard are applied to keyboard and menu immediately.

## Compile pipeline

1. The renderer saves every dirty tab, then invokes `compile:start` (Mod+Enter or
   toolbar) with the project's compiler.
2. Main spawns
   `latexmk -pdf|-xelatex|-lualatex -synctex=1 -interaction=nonstopmode -file-line-error
-outdir=.openleaf/build <mainFile>` with argument arrays (never a shell string).
   PATH is resolved at startup from the user's login shell + known TeX locations.
3. One compile at a time; a new request cancels the running one (process-group kill,
   `taskkill /T /F` on Windows) and the superseded run reports nothing. A compile
   requested while one is running is queued once. Timeout: Settings → Compiler
   (default 120 s).
4. After completion main parses `.openleaf/build/<name>.log` (pure parser in
   `src/shared/latex/log-parser.ts`, unit-tested against real fixtures), pushes a
   `compile:status` event and snapshots the project ("Compiled").

## SyncTeX

Both directions call the `synctex` CLI with argument arrays against
`.openleaf/build/<name>.pdf`:

- source → PDF: `synctex view -i line:col:file -o pdf` → page + x/y box; the renderer
  scrolls there and shows a fading highlight.
- PDF → source: `synctex edit -o page:x:y:pdf` → file/line; the renderer opens the file
  and jumps to the line.

## Writes and the file watcher

Every write goes through `writeFileInProject` (path safety, atomic temp + rename,
mtime conflict check, CRLF/BOM preserved) and records the sha256 of the written bytes,
so the chokidar watcher suppresses the app's own writes. Writes the app makes on the
user's behalf (history restore, reference updates, replace-all, bibliography edits)
additionally push `file:changedByApp`, so open tabs reload instead of saving over the
new content. Renames/moves re-key open tabs; trashing a file closes its tabs.

## Version history

Snapshots (on open, after successful compiles, every 5 minutes when something changed,
before restores, labelled versions) store content-addressed gzip blobs plus an index.
Index mutations (create, prune) are serialised per project and the index is written
atomically; pruning keeps every blob — text and image — still referenced by a kept
snapshot. The history follows a project when its folder is renamed or located again.

## Data locations

`userData` is Electron's app data folder (`~/Library/Application Support/Verso` on macOS).

| Data                                 | Location                                                |
| ------------------------------------ | ------------------------------------------------------- |
| App settings, project registry, tags | `userData/config.json` (electron-store)                 |
| User templates / editor themes       | `userData/templates/`, `userData/themes/`               |
| Chat history                         | `userData/chat/`                                        |
| API keys                             | `userData/keys/` (safeStorage-encrypted)                |
| Snapshot history                     | `userData/history/<projectId>/`                         |
| Recovery copies                      | `userData/recovery/`                                    |
| Logs                                 | `userData/logs/` (rotating, local only)                 |
| Per-project config                   | `<project>/.openleaf/project.json`                      |
| Build output                         | `<project>/.openleaf/build/` (gitignored automatically) |
