import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/api', () => ({
  api: { invoke: vi.fn(), on: vi.fn(() => () => undefined) },
  invokeOrThrow: vi.fn(async () => ({})),
}))

import { perTabStates, useEditorStore, type OpenFile } from '../../../src/renderer/stores/editor'

const tab = (relPath: string, dirty = false): OpenFile => ({
  relPath,
  diskContent: 'disk',
  content: dirty ? 'unsaved edit' : 'disk',
  mtime: 1,
  crlf: false,
  hadBom: false,
  dirty,
})

describe('open tabs follow file operations', () => {
  beforeEach(() => {
    perTabStates.clear()
    useEditorStore.setState({
      tabs: [tab('main.tex'), tab('chapters/intro.tex', true), tab('chapters/outro.tex')],
      activePath: 'chapters/intro.tex',
      diskConflict: null,
    })
  })

  it('renaming a file keeps its tab, unsaved content and active state', () => {
    useEditorStore.getState().renamePath('chapters/intro.tex', 'chapters/introduction.tex')
    const state = useEditorStore.getState()
    expect(state.activePath).toBe('chapters/introduction.tex')
    const renamed = state.tabs.find((t) => t.relPath === 'chapters/introduction.tex')
    expect(renamed).toMatchObject({ dirty: true, content: 'unsaved edit' })
    expect(state.tabs.map((t) => t.relPath)).not.toContain('chapters/intro.tex')
  })

  it('renaming a folder re-keys every tab inside it (and their editor states)', () => {
    perTabStates.set('chapters/outro.tex', 'state')
    useEditorStore.getState().renamePath('chapters', 'parts')
    expect(useEditorStore.getState().tabs.map((t) => t.relPath)).toEqual([
      'main.tex',
      'parts/intro.tex',
      'parts/outro.tex',
    ])
    expect(perTabStates.get('parts/outro.tex')).toBe('state')
    expect(perTabStates.has('chapters/outro.tex')).toBe(false)
  })

  it('does not touch paths that only share a prefix', () => {
    useEditorStore.setState({ tabs: [tab('chapters-old/a.tex')], activePath: null })
    useEditorStore.getState().renamePath('chapters', 'parts')
    expect(useEditorStore.getState().tabs[0].relPath).toBe('chapters-old/a.tex')
  })

  it('trashing a folder closes the tabs inside it', () => {
    useEditorStore.getState().dropPaths(['chapters'])
    const state = useEditorStore.getState()
    expect(state.tabs.map((t) => t.relPath)).toEqual(['main.tex'])
    expect(state.activePath).toBe('main.tex')
  })
})
