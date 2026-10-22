import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectOutline } from '../../../src/main/project/outline'

describe('collectOutline', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openleaf-outline-'))
    mkdirSync(join(root, 'chapters'))
    writeFileSync(
      join(root, 'main.tex'),
      [
        '\\documentclass{article}',
        '\\begin{document}',
        '\\section{Introduction}',
        '\\input{chapters/method}',
        '% \\input{chapters/commented}',
        '\\section{Conclusion}',
        '\\end{document}',
      ].join('\n')
    )
    writeFileSync(
      join(root, 'chapters', 'method.tex'),
      ['\\section{Method}', '\\subsection{Setup}', '\\input{chapters/method-extra}'].join('\n')
    )
    writeFileSync(join(root, 'chapters', 'method-extra.tex'), '\\subsection{Extra details}\n')
    writeFileSync(join(root, 'chapters', 'commented.tex'), '\\section{Should not appear}\n')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('follows \\input recursively, including nested files', async () => {
    const sections = await collectOutline(root, 'main.tex')
    const titles = sections.map((s) => s.title)
    expect(titles).toContain('Introduction')
    expect(titles).toContain('Conclusion')
    expect(titles).toContain('Method')
    expect(titles).toContain('Setup')
    expect(titles).toContain('Extra details')
  })

  it('reports the file each section comes from', async () => {
    const sections = await collectOutline(root, 'main.tex')
    expect(sections.find((s) => s.title === 'Method')?.file).toBe('chapters/method.tex')
    expect(sections.find((s) => s.title === 'Extra details')?.file).toBe(
      'chapters/method-extra.tex'
    )
  })

  it('ignores commented-out includes', async () => {
    const sections = await collectOutline(root, 'main.tex')
    expect(sections.some((s) => s.title === 'Should not appear')).toBe(false)
  })
})
