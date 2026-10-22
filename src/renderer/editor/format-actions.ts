import type { EditorView } from '@codemirror/view'

/** LaTeX figure block for an imported image path. */
export function figureSnippet(relPath: string): string {
  const withoutExt = relPath.replace(/\.(png|jpg|jpeg|gif|eps|svg|pdf)$/i, '')
  const base = withoutExt.split('/').pop() ?? 'figure'
  return [
    '\\begin{figure}[ht]',
    '  \\centering',
    `  \\includegraphics[width=\\linewidth]{${withoutExt}}`,
    `  \\caption{${base}}`,
    `  \\label{fig:${base}}`,
    '\\end{figure}',
    '',
  ].join('\n')
}

/**
 * Apply a LaTeX font-size declaration to the selection as a group:
 * `{\small text}`. With no selection the cursor lands inside the group.
 */
export function applyFontSize(view: EditorView, command: string): void {
  const range = view.state.selection.main
  const text = view.state.doc.sliceString(range.from, range.to)
  const insert = `{${command} ${text}}`
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + command.length + 2 + text.length },
  })
  view.focus()
}

/**
 * Insert a sectioning command. A selection becomes its title; otherwise an
 * empty `\section{}` is added (on its own line unless the cursor is on an
 * empty line) with the cursor between the braces.
 */
export function insertSection(view: EditorView, command: string): void {
  const range = view.state.selection.main
  const text = view.state.doc.sliceString(range.from, range.to)
  if (text.length > 0) {
    const insert = `${command}{${text}}`
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + insert.length },
    })
    view.focus()
    return
  }
  const line = view.state.doc.lineAt(range.head)
  const emptyLine = line.text.trim() === ''
  if (emptyLine) {
    const insert = `${command}{}`
    view.dispatch({
      changes: { from: line.from, to: line.to, insert },
      selection: { anchor: line.from + command.length + 1 },
    })
  } else {
    const insert = `\n\n${command}{}\n`
    view.dispatch({
      changes: { from: line.to, insert },
      selection: { anchor: line.to + 2 + command.length + 1 },
    })
  }
  view.focus()
}

/** Insert a display-math block (`\[ … \]`) around the selection or at the cursor. */
export function insertMathBlock(view: EditorView): void {
  const range = view.state.selection.main
  const text = view.state.doc.sliceString(range.from, range.to)
  if (text.length > 0) {
    const insert = `\\[\n${text}\n\\]`
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + insert.length },
    })
  } else {
    const line = view.state.doc.lineAt(range.head)
    const prefix = line.text.trim() === '' ? '' : '\n\n'
    const insert = `${prefix}\\[\n\n\\]`
    const from = line.text.trim() === '' ? line.from : line.to
    const to = line.text.trim() === '' ? line.to : line.to
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + prefix.length + 3 },
    })
  }
  view.focus()
}
