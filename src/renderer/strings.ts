/**
 * All user-facing strings in one place (UI language: English only).
 */
export const strings = {
  appName: 'Verso',

  // Toolbar
  compilerLabel: 'Compiler',
  compileButton: 'Compile',
  compiling: 'Compiling…',
  compileSuccess: (ms: number) => `Compiled in ${(ms / 1000).toFixed(1)} s`,
  compileCanceled: 'Compile canceled',
  compileFailed: 'Compilation failed',
  closeTab: 'Close Tab',

  // Sidebar segments
  tabFiles: 'Files',
  tabOutline: 'Outline',
  tabSearch: 'Search',

  // Sidebar
  noProject: 'No project open',
  emptyFolder: 'Empty project',

  // File tree
  mainFileBadge: 'Main',

  // Editor
  unsavedDot: '•',

  // PDF pane
  invertInDark: 'Invert in dark',
  fitWidth: 'Fit width',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  pdfNotBuilt: 'No PDF yet',
  pdfNotBuiltHint: 'Compile your document to see the result here.',

  // TeX missing
  texMissingTitle: 'LaTeX toolchain not found',
  texMissingMac:
    'Verso needs a TeX distribution. Install MacTeX (https://www.tug.org/mactex/) and re-check.',
  texMissingWindows:
    'Verso needs a TeX distribution. Install MiKTeX (https://miktex.org) or TeX Live (https://tug.org/texlive/), then re-check. Note: latexmk on Windows also requires Perl.',
  texMissingLinux:
    'Verso needs a TeX distribution. Install TeX Live (https://tug.org/texlive/) via your package manager, then re-check.',
  recheck: 'Re-check',

  // Problems
  noProblems: 'No problems',
  problems: (n: number) => `${n} problem${n === 1 ? '' : 's'}`,
  levelError: 'Error',
  levelWarning: 'Warning',
  levelInfo: 'Info',

  // Status bar
  statusLine: (line: number, col: number) => `Ln ${line}, Col ${col}`,
  statusWordCount: (words: number) => `${words} words`,

  // Crash recovery
  recoveryTitle: 'Recovered unsaved changes',
  recoveryHint: 'Verso kept a copy of these buffers after the last crash.',
  recoveryRestore: 'Restore',
  recoveryDiscard: 'Discard',
  recoveryDiscardAll: 'Discard recovered changes',
} as const
