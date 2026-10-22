import { Transaction, type ChangeSet, type EditorState as CMEditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { type KeyBinding } from '@codemirror/view'

/**
 * LaTeX editing behaviors: smart bracket pairing, `\begin{}` auto-`\end{}`,
 * selection wrapping (Mod+B/I) and comment toggling (Mod+/).
 */

/** Dispatch with an input userEvent so autocompletion re-activates. */
function dispatchInput(view: EditorView, spec: Parameters<EditorView['dispatch']>[0]): void {
  view.dispatch({
    ...spec,
    annotations: Transaction.userEvent.of('input.type'),
  })
}

/** Enter after `\begin{foo}` inserts a matching `\end{foo}` block. */
export const latexEnter: KeyBinding = {
  key: 'Enter',
  run: (view) => {
    const state = view.state
    const pos = state.selection.main.head
    const line = state.doc.lineAt(pos)
    const before = line.text.slice(0, pos - line.from)
    // Lists: Enter continues an item, Enter on an empty item exits it.
    const item = /^(\s*)\\item\b/.exec(line.text)
    if (item && pos >= line.from + item[0].length) {
      const indent = item[1]
      const itemEnd = line.from + item[0].length
      const contentAfter = line.text.slice(itemEnd - line.from).trim()
      if (contentAfter === '') {
        view.dispatch({
          changes: { from: line.from + indent.length, to: line.to },
          selection: { anchor: line.from + indent.length },
        })
        return true
      }
      dispatchInput(view, {
        changes: { from: pos, insert: `\n${indent}\\item ` },
        selection: { anchor: pos + indent.length + 7 },
      })
      return true
    }
    const match = /\\begin\{([^}]+)\}\s*$/.exec(before)
    if (!match) return false
    const env = match[1]
    const indent = /^\s*/.exec(line.text)?.[0] ?? ''
    const insert = `\n${indent}\t\n${indent}\\end{${env}}`
    dispatchInput(view, {
      changes: { from: pos, insert },
      selection: { anchor: pos + 1 + indent.length + 1 },
    })
    return true
  },
}

/** Rename `\begin{x}` → live-update the matching `\end{x}`. */
export function syncBeginEnd(update: {
  docChanged: boolean
  state: CMEditorState
  startState: CMEditorState
  changes: ChangeSet
  view: EditorView
}): void {
  if (!update.docChanged) return
  const view = update.view
  const oldDoc = update.startState.doc
  const newDoc = update.state.doc

  update.changes.iterChanges((fromA, toA) => {
    // Old line range affected.
    const oldLine = oldDoc.lineAt(fromA)
    const oldLineText = oldDoc.sliceString(oldLine.from, oldLine.to)
    // Was there a \begin{…} on that line whose name overlapped the edit?
    for (const match of oldLineText.matchAll(/\\begin\{([^}]*)\}/g)) {
      const nameFrom = oldLine.from + (match.index ?? 0) + 7
      const nameTo = nameFrom + match[1].length
      if (toA < nameFrom || fromA > nameTo) continue
      const oldName = match[1]
      // New name: find the \begin{ on the mapped range in the new doc.
      const mappedFrom = update.changes.mapPos(nameFrom, -1)
      const newLine = newDoc.lineAt(mappedFrom)
      const newMatch = /\\begin\{([^}]*)\}/.exec(newDoc.sliceString(newLine.from, newLine.to))
      if (!newMatch) return
      const newName = newMatch[1]
      if (newName === oldName) return

      // Find the matching \end{oldName} after this position (depth-aware).
      const searchFrom = newLine.to
      let depth = 1
      let pos = searchFrom
      const beginRe = new RegExp(`\\\\begin\\{${escapeRegex(newName)}\\}`, 'g')
      const endRe = new RegExp(`\\\\end\\{${escapeRegex(oldName)}\\}`, 'g')
      while (pos < newDoc.length) {
        beginRe.lastIndex = pos
        endRe.lastIndex = pos
        const beginMatch = beginRe.exec(newDoc.toString())
        const endMatch = endRe.exec(newDoc.toString())
        if (!endMatch) return
        if (beginMatch && beginMatch.index < endMatch.index) {
          depth++
          pos = beginMatch.index + beginMatch[0].length
          continue
        }
        depth--
        if (depth === 0) {
          const nameStart = pos + endMatch.index + 5 // '\end{'
          const current = newDoc.sliceString(nameStart, nameStart + oldName.length)
          if (current === oldName) {
            view.dispatch({
              changes: { from: nameStart, to: nameStart + oldName.length, insert: newName },
              annotations: [],
            })
          }
          return
        }
        pos = endMatch.index + endMatch[0].length
      }
      return
    }
  })
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Type `$` → smart `$$` insertion and skip-over. */
export const latexDollar: KeyBinding = {
  key: '$',
  run: (view) => {
    const state = view.state
    const pos = state.selection.main.head
    const before = state.doc.sliceString(Math.max(0, pos - 1), pos)
    const after = state.doc.sliceString(pos, pos + 1)
    // Selection: wrap in $…$.
    if (!state.selection.main.empty) {
      const range = state.selection.main
      const text = state.doc.sliceString(range.from, range.to)
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: `$${text}$` },
        selection: { anchor: range.from + 1 + text.length + 1 },
      })
      return true
    }
    // Skip over existing closer.
    if (before === '$' && after === '$') {
      view.dispatch({ selection: { anchor: pos + 1 } })
      return true
    }
    // Empty inline math: insert $$ and put cursor between.
    dispatchInput(view, { changes: { from: pos, insert: '$$' }, selection: { anchor: pos + 1 } })
    return true
  },
}

/** Standard closeBrackets-style pairs extended with $$ skip-over. */
export const latexPairs: KeyBinding[] = [
  {
    key: '(',
    run: (view) => insertPaired(view, '(', ')'),
  },
  {
    key: '[',
    run: (view) => insertPaired(view, '[', ']'),
  },
  {
    key: '{',
    run: (view) => insertPaired(view, '{', '}'),
  },
  {
    key: ')',
    run: (view) => skipOver(view, ')'),
  },
  {
    key: ']',
    run: (view) => skipOver(view, ']'),
  },
  {
    key: '}',
    run: (view) => skipOver(view, '}'),
  },
]

function insertPaired(view: EditorView, open: string, close: string): boolean {
  const state = view.state
  const range = state.selection.main
  if (!range.empty) {
    const text = state.doc.sliceString(range.from, range.to)
    dispatchInput(view, {
      changes: { from: range.from, to: range.to, insert: open + text + close },
      selection: { anchor: range.from + 1 + text.length + 1 },
    })
    return true
  }
  dispatchInput(view, {
    changes: { from: range.head, insert: open + close },
    selection: { anchor: range.head + 1 },
  })
  return true
}

function skipOver(view: EditorView, close: string): boolean {
  const state = view.state
  const pos = state.selection.main.head
  if (state.doc.sliceString(pos, pos + 1) === close && state.selection.main.empty) {
    view.dispatch({ selection: { anchor: pos + 1 } })
    return true
  }
  return false
}

/** Wrap the selection (or insert an empty group) with a LaTeX command. */
export function wrapSelection(view: EditorView, command: string): void {
  const state = view.state
  const range = state.selection.main
  const text = state.doc.sliceString(range.from, range.to)
  dispatchInput(view, {
    changes: { from: range.from, to: range.to, insert: `${command}{${text}}` },
    selection: { anchor: range.from + command.length + 1 + text.length + 1 },
  })
}

/** Toggle `%` comments on the selected lines. */
export const toggleComment: KeyBinding = {
  key: 'Mod-/',
  run: (view) => {
    const state = view.state
    const range = state.selection.main
    const fromLine = state.doc.lineAt(range.from)
    const toLine = state.doc.lineAt(range.to)
    const lines: number[] = []
    for (let n = fromLine.number; n <= toLine.number; n++) lines.push(n)

    const allCommented = lines.every((n) => {
      const line = state.doc.line(n)
      return /^\s*%/.test(line.text)
    })

    const changes: Array<{ from: number; to?: number; insert?: string }> = []
    for (const n of lines) {
      const line = state.doc.line(n)
      if (allCommented) {
        const match = /^(\s*)%\s?/.exec(line.text)
        if (match) {
          changes.push({ from: line.from + match[1].length, to: line.from + match[0].length })
        }
      } else if (!/^\s*%/.test(line.text)) {
        changes.push({ from: line.from, insert: '% ' })
      }
    }
    if (changes.length > 0) {
      view.dispatch({ changes })
    }
    return true
  },
}
