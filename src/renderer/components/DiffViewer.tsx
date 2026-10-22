import { useEffect, useRef } from 'react'
import { MergeView } from '@codemirror/merge'
import { EditorView, basicSetup } from 'codemirror'
import { latexLanguage } from '../editor/latex-language'
import { themeExtensions } from '../editor/editor-themes'

interface DiffViewerProps {
  before: string
  after: string
  dark: boolean
  collapsed?: boolean
}

/** Side-by-side diff of two file versions via @codemirror/merge. */
export function DiffViewer({
  before,
  after,
  dark,
  collapsed = false,
}: DiffViewerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<MergeView | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const view = new MergeView({
      a: {
        doc: before,
        extensions: [
          basicSetup,
          latexLanguage,
          ...themeExtensions(dark ? 'openleaf-dark' : 'openleaf-light'),
          EditorView.editable.of(false),
        ],
      },
      b: {
        doc: after,
        extensions: [
          basicSetup,
          latexLanguage,
          ...themeExtensions(dark ? 'openleaf-dark' : 'openleaf-light'),
          EditorView.editable.of(false),
        ],
      },
      parent: containerRef.current,
      collapseUnchanged: collapsed ? { margin: 3, minSize: 4 } : undefined,
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [before, after, dark, collapsed])

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto text-[14px]"
      data-testid="diff-viewer"
    />
  )
}
