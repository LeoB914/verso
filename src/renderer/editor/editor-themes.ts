import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Editor themes. Each theme is defined by a token map and rendered with a
 * common builder, so user themes (JSON in userData/themes/) can use the same
 * pipeline. See docs/themes.md for the schema.
 */

export interface EditorThemeDefinition {
  id: string
  name: string
  dark: boolean
  /** Editor colors. */
  colors: {
    background: string
    foreground: string
    gutterForeground: string
    gutterBorder: string
    activeLine: string
    selection: string
    cursor: string
    matchingBracket: string
    searchMatch: string
    searchMatchSelected: string
  }
  /** LaTeX token colors. */
  tokens: {
    comment: string
    keyword: string
    command: string
    math: string
    string: string
    number: string
    heading: string
    meta: string
    invalid: string
  }
}

function buildTheme(def: EditorThemeDefinition): Extension[] {
  const theme = EditorView.theme({
    '&': { color: def.colors.foreground, backgroundColor: def.colors.background },
    '.cm-content': { caretColor: def.colors.cursor },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: def.colors.cursor },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: def.colors.selection,
    },
    '.cm-activeLine': { backgroundColor: def.colors.activeLine },
    '.cm-gutters': {
      backgroundColor: def.colors.background,
      color: def.colors.gutterForeground,
      border: 'none',
      borderRight: `1px solid ${def.colors.gutterBorder}`,
    },
    '.cm-activeLineGutter': {
      backgroundColor: def.colors.activeLine,
      color: def.colors.foreground,
    },
    '.cm-matchingBracket': {
      backgroundColor: def.colors.matchingBracket,
      outline: `1px solid ${def.colors.matchingBracket}`,
      color: 'inherit',
    },
    '.cm-selectionMatch': { backgroundColor: def.colors.matchingBracket },
    '.cm-panels': {
      backgroundColor: def.colors.background,
      color: def.colors.foreground,
      borderBottom: `1px solid ${def.colors.gutterBorder}`,
    },
    '.cm-searchMatch': { backgroundColor: def.colors.searchMatch },
    '.cm-searchMatch-selected': { backgroundColor: def.colors.searchMatchSelected },
    '.cm-tooltip': {
      backgroundColor: def.colors.background,
      border: `1px solid ${def.colors.gutterBorder}`,
      borderRadius: 'var(--radius-md)',
    },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      lineHeight: '1.6',
    },
  })

  const highlight = HighlightStyle.define([
    { tag: t.comment, color: def.tokens.comment, fontStyle: 'italic' },
    { tag: [t.keyword, t.controlKeyword], color: def.tokens.keyword },
    {
      tag: [t.controlOperator, t.operator, t.meta, t.processingInstruction],
      color: def.tokens.command,
    },
    { tag: [t.string, t.special(t.string)], color: def.tokens.string },
    { tag: [t.number, t.atom], color: def.tokens.number },
    { tag: [t.heading], color: def.tokens.heading, fontWeight: 'bold' },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.strong], fontWeight: 'bold' },
    { tag: [t.invalid], color: def.tokens.invalid, textDecoration: 'underline wavy' },
  ])

  void def.tokens.math
  return [theme, syntaxHighlighting(highlight)]
}

// --- Built-in themes ---------------------------------------------------------

const openleafLight: EditorThemeDefinition = {
  id: 'openleaf-light',
  name: 'Verso Light',
  dark: false,
  colors: {
    background: 'var(--bg-content)',
    foreground: '#1d1d1f',
    gutterForeground: '#aeaeb2',
    gutterBorder: 'var(--border-subtle)',
    activeLine: 'rgba(0, 0, 0, 0.035)',
    selection: 'rgba(10, 132, 255, 0.2)',
    cursor: '#0a84ff',
    matchingBracket: 'rgba(10, 132, 255, 0.15)',
    searchMatch: 'rgba(255, 204, 0, 0.35)',
    searchMatchSelected: 'rgba(255, 149, 0, 0.5)',
  },
  tokens: {
    comment: '#6e7681',
    keyword: '#a626a4',
    command: '#0184bc',
    math: '#b76b01',
    string: '#50a14f',
    number: '#b76b01',
    heading: '#e45649',
    meta: '#4078f2',
    invalid: '#e45649',
  },
}

const openleafDark: EditorThemeDefinition = {
  id: 'openleaf-dark',
  name: 'Verso Dark',
  dark: true,
  colors: {
    background: 'var(--bg-content)',
    foreground: '#f5f5f7',
    gutterForeground: '#6e6e73',
    gutterBorder: 'var(--border-subtle)',
    activeLine: 'rgba(255, 255, 255, 0.045)',
    selection: 'rgba(10, 132, 255, 0.3)',
    cursor: '#0a84ff',
    matchingBracket: 'rgba(10, 132, 255, 0.25)',
    searchMatch: 'rgba(255, 214, 10, 0.3)',
    searchMatchSelected: 'rgba(255, 159, 10, 0.5)',
  },
  tokens: {
    comment: '#7f8c98',
    keyword: '#c792ea',
    command: '#82aaff',
    math: '#f78c6c',
    string: '#c3e88d',
    number: '#f78c6c',
    heading: '#ff5370',
    meta: '#82aaff',
    invalid: '#ff5370',
  },
}

const solarizedLight: EditorThemeDefinition = {
  id: 'solarized-light',
  name: 'Solarized Light',
  dark: false,
  colors: {
    background: '#fdf6e3',
    foreground: '#657b83',
    gutterForeground: '#93a1a1',
    gutterBorder: '#eee8d5',
    activeLine: 'rgba(147, 161, 161, 0.12)',
    selection: 'rgba(238, 232, 213, 0.9)',
    cursor: '#cb4b16',
    matchingBracket: 'rgba(147, 161, 161, 0.25)',
    searchMatch: 'rgba(181, 137, 0, 0.3)',
    searchMatchSelected: 'rgba(203, 75, 22, 0.4)',
  },
  tokens: {
    comment: '#93a1a1',
    keyword: '#859900',
    command: '#268bd2',
    math: '#d33682',
    string: '#2aa198',
    number: '#d33682',
    heading: '#cb4b16',
    meta: '#6c71c4',
    invalid: '#dc322f',
  },
}

const solarizedDark: EditorThemeDefinition = {
  id: 'solarized-dark',
  name: 'Solarized Dark',
  dark: true,
  colors: {
    background: '#002b36',
    foreground: '#839496',
    gutterForeground: '#586e75',
    gutterBorder: '#073642',
    activeLine: 'rgba(131, 148, 150, 0.08)',
    selection: 'rgba(88, 110, 117, 0.6)',
    cursor: '#b58900',
    matchingBracket: 'rgba(88, 110, 117, 0.4)',
    searchMatch: 'rgba(181, 137, 0, 0.35)',
    searchMatchSelected: 'rgba(203, 75, 22, 0.45)',
  },
  tokens: {
    comment: '#586e75',
    keyword: '#859900',
    command: '#268bd2',
    math: '#d33682',
    string: '#2aa198',
    number: '#d33682',
    heading: '#cb4b16',
    meta: '#6c71c4',
    invalid: '#dc322f',
  },
}

const dracula: EditorThemeDefinition = {
  id: 'dracula',
  name: 'Dracula',
  dark: true,
  colors: {
    background: '#282a36',
    foreground: '#f8f8f2',
    gutterForeground: '#6272a4',
    gutterBorder: '#21222c',
    activeLine: 'rgba(68, 71, 90, 0.4)',
    selection: 'rgba(68, 71, 90, 0.8)',
    cursor: '#f8f8f0',
    matchingBracket: 'rgba(139, 233, 253, 0.2)',
    searchMatch: 'rgba(241, 250, 140, 0.3)',
    searchMatchSelected: 'rgba(255, 121, 198, 0.4)',
  },
  tokens: {
    comment: '#6272a4',
    keyword: '#ff79c6',
    command: '#8be9fd',
    math: '#bd93f9',
    string: '#f1fa8c',
    number: '#bd93f9',
    heading: '#50fa7b',
    meta: '#8be9fd',
    invalid: '#ff5555',
  },
}

const nord: EditorThemeDefinition = {
  id: 'nord',
  name: 'Nord',
  dark: true,
  colors: {
    background: '#2e3440',
    foreground: '#d8dee9',
    gutterForeground: '#4c566a',
    gutterBorder: '#3b4252',
    activeLine: 'rgba(59, 66, 82, 0.6)',
    selection: 'rgba(67, 76, 94, 0.8)',
    cursor: '#88c0d0',
    matchingBracket: 'rgba(136, 192, 208, 0.2)',
    searchMatch: 'rgba(235, 203, 139, 0.3)',
    searchMatchSelected: 'rgba(163, 190, 140, 0.4)',
  },
  tokens: {
    comment: '#616e88',
    keyword: '#81a1c1',
    command: '#88c0d0',
    math: '#b48ead',
    string: '#a3be8c',
    number: '#b48ead',
    heading: '#8fbcbb',
    meta: '#5e81ac',
    invalid: '#bf616a',
  },
}

const githubLight: EditorThemeDefinition = {
  id: 'github-light',
  name: 'GitHub Light',
  dark: false,
  colors: {
    background: '#ffffff',
    foreground: '#24292e',
    gutterForeground: '#959da5',
    gutterBorder: '#e1e4e8',
    activeLine: 'rgba(0, 0, 0, 0.04)',
    selection: 'rgba(9, 105, 218, 0.18)',
    cursor: '#0969da',
    matchingBracket: 'rgba(9, 105, 218, 0.15)',
    searchMatch: 'rgba(255, 223, 93, 0.6)',
    searchMatchSelected: 'rgba(255, 179, 0, 0.6)',
  },
  tokens: {
    comment: '#6a737d',
    keyword: '#d73a49',
    command: '#005cc5',
    math: '#e36209',
    string: '#032f62',
    number: '#005cc5',
    heading: '#22863a',
    meta: '#6f42c1',
    invalid: '#cb2431',
  },
}

const oneDark: EditorThemeDefinition = {
  id: 'one-dark',
  name: 'One Dark',
  dark: true,
  colors: {
    background: '#282c34',
    foreground: '#abb2bf',
    gutterForeground: '#5c6370',
    gutterBorder: '#21252b',
    activeLine: 'rgba(92, 99, 112, 0.15)',
    selection: 'rgba(62, 68, 81, 0.8)',
    cursor: '#528bff',
    matchingBracket: 'rgba(82, 139, 255, 0.2)',
    searchMatch: 'rgba(229, 192, 123, 0.3)',
    searchMatchSelected: 'rgba(224, 108, 117, 0.45)',
  },
  tokens: {
    comment: '#5c6370',
    keyword: '#c678dd',
    command: '#61afef',
    math: '#d19a66',
    string: '#98c379',
    number: '#d19a66',
    heading: '#e06c75',
    meta: '#61afef',
    invalid: '#e06c75',
  },
}

export const builtInThemes: EditorThemeDefinition[] = [
  openleafLight,
  openleafDark,
  solarizedLight,
  solarizedDark,
  dracula,
  nord,
  githubLight,
  oneDark,
]

// --- Theme registry ----------------------------------------------------------

const userThemes = new Map<string, EditorThemeDefinition>()

/** Validate and parse a user theme JSON file. */
export function parseUserTheme(json: string): EditorThemeDefinition | null {
  try {
    const raw = JSON.parse(json) as Partial<EditorThemeDefinition>
    if (
      typeof raw.id === 'string' &&
      typeof raw.name === 'string' &&
      typeof raw.dark === 'boolean' &&
      raw.colors &&
      typeof raw.colors.background === 'string'
    ) {
      return raw as EditorThemeDefinition
    }
  } catch {
    // Invalid JSON — skip.
  }
  return null
}

export function registerUserThemes(defs: EditorThemeDefinition[]): void {
  for (const def of defs) userThemes.set(def.id, def)
}

export function allThemes(): EditorThemeDefinition[] {
  return [...builtInThemes, ...userThemes.values()]
}

export function getTheme(id: string): EditorThemeDefinition | null {
  return allThemes().find((theme) => theme.id === id) ?? null
}

/** Build the CodeMirror extensions for a theme id (falls back to Verso). */
export function themeExtensions(id: string): Extension[] {
  const def = getTheme(id)
  if (!def) return themeExtensions('openleaf-light')
  return buildTheme(def)
}
