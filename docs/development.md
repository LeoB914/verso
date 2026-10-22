# Development

## Prerequisites

- Node.js 22 or newer and npm
- Git
- A TeX distribution with `latexmk` and `biber` (see [Getting started](getting-started.md)) —
  the compile tests run against the real installation and are skipped without `latexmk`

## Set up and run

```bash
npm install
npm run dev
```

`npm run dev` starts electron-vite with hot reload for the renderer and opens the start
screen. The first `npm install` downloads the Electron binary on first use.

## Scripts

| Command                    | What it does                                                                      |
| -------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`              | Start the app in development mode                                                 |
| `npm run build`            | Production build into `out/`                                                      |
| `npm run typecheck`        | TypeScript for main/preload, E2E tests and renderer                               |
| `npm run lint`             | ESLint + Prettier check (`npm run format` fixes formatting)                       |
| `npm test`                 | Vitest unit tests (`npm run test:watch` for watch mode)                           |
| `npm run test:e2e`         | Build, then Playwright E2E tests against the Electron app                         |
| `npm run verify:templates` | Compile every built-in template with the real TeX installation                    |
| `npm run screenshots`      | Light/dark screenshots into `docs/screenshots/` (isolated app profile)            |
| `npm run docs:shortcuts`   | Regenerate the table in [keyboard-shortcuts.md](keyboard-shortcuts.md)            |
| `npm run icons`            | Regenerate app icons from `resources/icon.svg`                                    |
| `npm run dist`             | Build an installer for the current OS into `dist/` (see [release.md](release.md)) |

## Project layout

```
src/main/        Electron main process: TeX, compile, files, history, Git, AI, IPC handlers
src/preload/     the typed contextBridge API (nothing else)
src/renderer/    React UI: components, CodeMirror editor, PDF viewer, Zustand stores
src/shared/      code used by both sides: IPC contract, command registry, LaTeX parsers
resources/       templates, sample project, dictionaries, icons, LaTeX command data
tests/unit/      Vitest tests (mirroring src/), tests/e2e/ Playwright tests, tests/fixtures/
scripts/         build helpers (dictionaries, icons, screenshots, template verification)
```

Details: [Architecture](architecture.md).

## Tests

- **Unit tests** (`tests/unit/`) cover pure logic — parsers, path safety, history store,
  command registry, stores. They never need the Electron binary; `electron` is mocked in
  `tests/unit/setup-electron-mock.ts`.
- **E2E tests** (`tests/e2e/`) launch the built app with a temporary copy of
  `tests/fixtures/project` and an isolated profile (`OPENLEAF_USER_DATA_DIR`).
  `tests/e2e/compile.spec.ts` compiles with the real TeX installation (pdfLaTeX, XeLaTeX,
  LuaLaTeX, Biber, SyncTeX, cancel).
- Anything that touches TeX (compile, log parsing, SyncTeX, templates, word count) must be
  verified with the real toolchain, not only with fixtures.

### Manual checks before a release

Things automated tests cannot cover — run them with the installed app:

- Window chrome: sidebar vibrancy on macOS in light and dark mode, traffic lights inset,
  toolbar draggable; switching the system appearance updates Verso when the theme is
  "System".
- Trackpad: pinch/`Cmd`-scroll zoom in the PDF, smooth scrolling, PDF position kept after
  recompiling mid-document.
- Shortcuts with a real keyboard (also on a non-US layout): each fires exactly once.
- Detached PDF on a second monitor: SyncTeX works in both directions across windows;
  closing the window docks the PDF back.
- Finder/Explorer: double-clicking a `.tex` file opens its project; a project in a path
  with spaces and umlauts compiles and syncs.
- Git push/pull over SSH with your normal credentials; pulling with unsaved edits shows
  the "file changed on disk" banner.
- Performance: a ~5,000-line `.tex` file types without lag (autocomplete, spellcheck and
  visual mode on); a ~300-page PDF scrolls smoothly.
- Crash recovery: force-quit with unsaved edits; the next start offers to restore them.

## Conventions

See [CONTRIBUTING.md](../CONTRIBUTING.md) for code style, commit messages and the pull
request checklist.
