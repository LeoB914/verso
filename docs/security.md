# Security model

Verso runs locally, opens no listening network sockets and sends no telemetry. This page
lists how each entry point is protected. To report a vulnerability, see
[SECURITY.md](../SECURITY.md).

## Process isolation

- Renderer windows run with `contextIsolation: true`, `nodeIntegration: false` and
  `sandbox: true`.
- The preload script exposes one bridge object (`window.openleaf`) with `invoke` (typed,
  zod-validated IPC), `on` (event subscription) and `pathForFile` (drag & drop paths). No
  other Electron or Node API reaches the renderer.
- Navigation: `will-navigate` blocks everything except the dev server and internal
  pages; `setWindowOpenHandler` denies popups and opens validated `https://` / `mailto:`
  links in the system browser.
- Permissions: every permission request (camera, location, notifications, …) is denied.
- Content-Security-Policy (`src/main/csp.ts`, applied to every window's session): in the
  installed app scripts load only from the app bundle (`script-src 'self'` — no inline
  scripts, no `eval`, nothing remote), plugins are blocked (`object-src 'none'`) and
  network access from the renderer is limited to the app itself and `openleaf://`.
  Development additionally allows the Vite dev server, its HMR websocket and the inline
  React refresh script. Inline styles stay allowed because React and CodeMirror set
  `style` attributes.

## IPC (renderer → main)

Every channel is declared once in `src/shared/ipc.ts` with a zod request schema and a
response type. Handlers validate payloads and always answer
`{ ok: true, data } | { ok: false, error: { code, message } }`.

| Entry point                                 | Protection                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `file:read` / `file:write`                  | `resolveInProject` (canonical relative path + realpath check), atomic write (temp + rename), mtime conflict check    |
| `files:create/rename/delete/duplicate/move` | same path resolution; renames never overwrite; deleting moves to the system trash, never a hard delete               |
| `project:open`                              | must be a directory; `.openleaf/project.json` is validated field by field                                            |
| `zip:import` / `zip:importFrom`             | zip-slip protection (every entry checked against the extraction root), 500 MB size limit, junk files skipped         |
| `templates:*`                               | template ids must be plain folder names; built-in templates are read from the app bundle                             |
| `git:*`                                     | branch names and revisions are validated so they can never be parsed as `git` options; git uses your own credentials |
| `search:run` / `search:replaceAll`          | regex built from a validated pattern, files resolved through `resolveInProject`                                      |
| `chat:send` / `keys:save`                   | requests run in main; API keys are encrypted with `safeStorage` and never sent back to the renderer                  |

## Path safety

`resolveInProject(root, relPath)` (`src/main/util/paths.ts`) rejects absolute paths,
`..` segments and NUL bytes, resolves symlinks and refuses any target outside the project,
including dangling symlinks. All file operations from the renderer go through it.

## Child processes

TeX tools, `synctex`, `texcount` and `git` are started with argument arrays
(`spawn(cmd, args, { shell: false })`) — never through a shell — so paths with spaces or
special characters cannot inject commands. `-shell-escape` is off unless enabled for a
project.

## Project files in the renderer

PDFs and images are served through `openleaf://project/<relative-path>`, which resolves
every request with `resolveInProject` against the open project; the renderer has no
`file://` access. Chat Markdown is rendered with `react-markdown` without raw HTML.

## Logging

Errors go to a rotating local log (`logs/openleaf.log` in the app data folder,
5 × 1 MB). Nothing is uploaded.
