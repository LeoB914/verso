import { describe, expect, it } from 'vitest'
import {
  flattenEnvironments,
  parseStructure,
  scanRegions,
  sectionFoldRanges,
} from '../../../src/shared/latex/structure'
import { bibEntrySummary, parseBibFile } from '../../../src/shared/latex/bib-parser'

describe('scanRegions', () => {
  it('marks comments but not escaped percent', () => {
    const text = 'Hello % a comment\nEscaped \\% not a comment\nAnother % comment'
    const regions = scanRegions(text)
    expect(regions.commentRanges.length).toBe(2)
    expect(text.slice(regions.commentRanges[0].start, regions.commentRanges[0].end)).toBe(
      '% a comment'
    )
  })

  it('marks verbatim environments', () => {
    const text = 'before\n\\begin{verbatim}\n100% not comment \\section{no}\n\\end{verbatim}\nafter'
    const regions = scanRegions(text)
    expect(regions.verbatimRanges.length).toBe(1)
  })

  it('marks \\verb with delimiters', () => {
    const text = 'x \\verb|%foo%| y \\verb!bar! z'
    const regions = scanRegions(text)
    expect(regions.verbatimRanges.length).toBe(2)
  })
})

describe('parseStructure — sections', () => {
  it('extracts sections with levels and titles', () => {
    const text = [
      '\\section{Introduction}',
      'text',
      '\\subsection{Background}',
      'text',
      '\\section*{Starred}',
      '\\chapter{Chapter One}',
    ].join('\n')
    const { sections } = parseStructure(text)
    expect(sections.map((s) => [s.title, s.level])).toEqual([
      ['Introduction', 2],
      ['Background', 3],
      ['Starred', 2],
      ['Chapter One', 1],
    ])
  })

  it('supports optional short titles and nested braces', () => {
    const text = '\\section[Short]{The {Long} Title \\textbf{bold}}'
    const { sections } = parseStructure(text)
    expect(sections[0].title).toContain('Long')
    expect(sections[0].title).toContain('bold')
  })

  it('ignores sections in comments and verbatim', () => {
    const text = [
      '% \\section{Commented}',
      '\\begin{verbatim}',
      '\\section{InVerbatim}',
      '\\end{verbatim}',
    ].join('\n')
    const { sections } = parseStructure(text)
    expect(sections).toHaveLength(0)
  })
})

describe('parseStructure — environments', () => {
  it('nests environments and computes ranges', () => {
    const text = [
      '\\begin{figure}',
      '\\begin{center}',
      'inner',
      '\\end{center}',
      '\\end{figure}',
    ].join('\n')
    const { environments } = parseStructure(text)
    expect(environments).toHaveLength(1)
    expect(environments[0].name).toBe('figure')
    expect(environments[0].children[0].name).toBe('center')
    expect(environments[0].endPosition).not.toBeNull()
  })

  it('handles unbalanced environments gracefully', () => {
    const text = '\\begin{itemize}\n\\item x\n\\begin{itemize}\n\\item y\n\\end{itemize}'
    const { environments } = parseStructure(text)
    expect(environments[0].endPosition).toBeNull()
    expect(environments[0].children[0].endPosition).not.toBeNull()
  })

  it('flattens in document order with depth', () => {
    const text = ['\\begin{a}', '\\begin{b}', '\\end{b}', '\\end{a}'].join('\n')
    const flat = flattenEnvironments(parseStructure(text).environments)
    expect(flat.map((f) => [f.node.name, f.depth])).toEqual([
      ['a', 0],
      ['b', 1],
    ])
  })
})

describe('parseStructure — references', () => {
  it('extracts labels and refs', () => {
    const text =
      '\\label{sec:intro}\nSee \\ref{sec:intro} and \\cref{fig:x,fig:y} on page \\pageref{p1}.'
    const { references } = parseStructure(text)
    const labels = references.filter((r) => r.kind === 'label')
    const refs = references.filter((r) => r.kind === 'ref')
    expect(labels.map((l) => l.key)).toEqual(['sec:intro'])
    expect(refs.map((r) => r.key)).toEqual(['sec:intro', 'fig:x', 'fig:y', 'p1'])
  })

  it('splits multi-key citations', () => {
    const text = '\\cite{knuth1984, goossens93}'
    const { references } = parseStructure(text)
    expect(references.map((r) => r.key)).toEqual(['knuth1984', 'goossens93'])
  })

  it('extracts input/include/includegraphics and bib commands', () => {
    const text = [
      '\\input{sections/intro}',
      '\\include{chapters/two}',
      '\\includegraphics[width=3cm]{fig.png}',
      '\\bibliography{refs,more-refs}',
      '\\addbibresource{bib/main.bib}',
    ].join('\n')
    const { references } = parseStructure(text)
    expect(references.filter((r) => r.kind === 'input').map((r) => r.key)).toEqual([
      'sections/intro',
      'chapters/two',
    ])
    expect(references.filter((r) => r.kind === 'includegraphics').map((r) => r.key)).toEqual([
      'fig.png',
    ])
    expect(references.filter((r) => r.kind === 'bibliography').map((r) => r.key)).toEqual([
      'refs',
      'more-refs',
    ])
    expect(references.filter((r) => r.kind === 'bibresource').map((r) => r.key)).toEqual([
      'bib/main.bib',
    ])
  })
})

describe('parseStructure — definitions', () => {
  it('extracts newcommand with arg counts', () => {
    const text = [
      '\\newcommand{\\foo}[2]{#1 #2}',
      '\\renewcommand\\bar{baz}',
      '\\DeclareMathOperator{\\spn}{span}',
    ].join('\n')
    const { definitions } = parseStructure(text)
    expect(definitions.map((d) => [d.name, d.argCount])).toEqual([
      ['foo', 2],
      ['bar', 0],
      ['spn', 0],
    ])
  })

  it('extracts newenvironment', () => {
    const text = '\\newenvironment{myenv}[1]{start}{end}'
    const { definitions } = parseStructure(text)
    expect(definitions[0]).toMatchObject({ kind: 'environment', name: 'myenv', argCount: 1 })
  })
})

describe('sectionFoldRanges', () => {
  it('ends a section at the next section of same or higher level', () => {
    const text = '\\section{A}\nbody\n\\subsection{A1}\nbody\n\\section{B}\nbody'
    const { sections } = parseStructure(text)
    const ranges = sectionFoldRanges(sections, text.length, 7)
    expect(ranges).toHaveLength(3)
    expect(sections[0].position < ranges[0].end).toBe(true)
  })
})

describe('region markers', () => {
  it('finds %region and %endregion', () => {
    const text = '%region data\nx\n%endregion\n'
    const { regionMarkers } = parseStructure(text)
    expect(regionMarkers.map((m) => m.kind)).toEqual(['region', 'endregion'])
  })
})

describe('parseBibFile', () => {
  it('parses entries with fields', () => {
    const bib = [
      '@book{knuth1984,',
      '  author = {Knuth, Donald E.},',
      '  title = {The {TeX}book},',
      '  year = {1984},',
      '}',
      '',
      '@article{goossens93, author="Goossens, M.", title="LaTeX Companion", year=1993}',
    ].join('\n')
    const entries = parseBibFile(bib)
    expect(entries).toHaveLength(2)
    expect(entries[0].key).toBe('knuth1984')
    expect(entries[0].fields.title).toBe('The TeXbook')
    expect(entries[1].fields.year).toBe('1993')
  })

  it('skips @comment and @string', () => {
    const bib = '@comment{ignore me}\n@string{me = "value"}\n@misc{real, title={Real}}'
    const entries = parseBibFile(bib)
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe('real')
  })

  it('summarizes entries for display', () => {
    const bib = '@book{knuth1984, author={Knuth, Donald E.}, title={The TeXbook}, year={1984}}'
    const summary = bibEntrySummary(parseBibFile(bib)[0])
    expect(summary).toContain('Knuth')
    expect(summary).toContain('1984')
    expect(summary).toContain('TeXbook')
  })
})
