import { StateField, type EditorState } from '@codemirror/state'
import { foldService } from '@codemirror/language'
import {
  parseStructure,
  flattenEnvironments,
  type DocumentStructure,
} from '@shared/latex/structure'

/**
 * Folding support: sections (until next same-or-higher level), environments
 * and %region/%endregion pairs, based on the shared structure parser.
 */

export const structureField = StateField.define<DocumentStructure>({
  create: (state: EditorState) => parseStructure(state.doc.toString()),
  update: (value, transaction) => {
    if (transaction.docChanged) {
      return parseStructure(transaction.state.doc.toString())
    }
    return value
  },
})

export const latexFoldService = foldService.of((state, lineStart) => {
  const structure = state.field(structureField, false)
  if (!structure) return null
  const docLength = state.doc.length

  // Section fold: until the next section of same or higher level.
  for (const section of structure.sections) {
    const line = state.doc.lineAt(section.position)
    if (line.from === lineStart) {
      let end = docLength
      const later = structure.sections
        .filter((s) => s.position > section.position && s.level <= section.level)
        .sort((a, b) => a.position - b.position)
      if (later.length > 0) end = later[0].position
      if (end > line.to) return { from: line.to, to: Math.min(end, docLength) }
    }
  }

  // Environment fold: \begin on this line.
  const flat = flattenEnvironments(structure.environments)
  for (const { node } of flat) {
    const beginLine = state.doc.lineAt(node.beginPosition)
    if (
      beginLine.from === lineStart &&
      node.endPosition !== null &&
      node.endPosition > beginLine.to
    ) {
      const endLine = state.doc.lineAt(node.endPosition)
      return { from: beginLine.to, to: endLine.from }
    }
  }

  // %region fold.
  for (const marker of structure.regionMarkers) {
    if (marker.kind !== 'region') continue
    const markerLine = state.doc.lineAt(marker.position)
    if (markerLine.from !== lineStart) continue
    const close = structure.regionMarkers.find(
      (m) => m.kind === 'endregion' && m.position > marker.position
    )
    if (close) {
      const closeLine = state.doc.lineAt(close.position)
      if (closeLine.from > markerLine.to) {
        return { from: markerLine.to, to: closeLine.from }
      }
    }
  }

  return null
})
