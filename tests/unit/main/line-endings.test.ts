import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileInProject, writeFileInProject } from '../../../src/main/project/files'
import { replaceAllInProject } from '../../../src/main/project/search'
import { applyReferenceUpdates } from '../../../src/shared/latex/references'
import { setCurrentProjectForTests } from '../../../src/main/ipc/handlers'

const CRLF_BOM = '\uFEFF\\input{chapters/old}\r\nline two\r\nline three\r\n'

describe('line endings and BOM', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openleaf-eol-'))
    writeFileSync(join(root, 'crlf.tex'), CRLF_BOM)
    setCurrentProjectForTests({
      root,
      info: {
        path: root,
        name: 'eol-test',
        config: {
          mainFile: 'crlf.tex',
          compiler: 'pdflatex',
          shellEscape: false,
          spellLanguage: 'en',
          autoCompile: false,
          spellEnabled: false,
        },
      },
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads CRLF files as LF and reports the flags', async () => {
    const file = await readFileInProject(root, 'crlf.tex')
    expect(file.content).toBe('\\input{chapters/old}\nline two\nline three\n')
    expect(file.crlf).toBe(true)
    expect(file.hadBom).toBe(true)
  })

  it('round-trips CRLF + BOM exactly once (never \\r\\r)', async () => {
    const file = await readFileInProject(root, 'crlf.tex')
    await writeFileInProject(
      root,
      'crlf.tex',
      file.content.replace('line two', 'line 2'),
      file.mtime,
      {
        crlf: file.crlf,
        bom: file.hadBom,
      }
    )
    const bytes = readFileSync(join(root, 'crlf.tex'), 'utf8')
    expect(bytes).toBe('\uFEFF\\input{chapters/old}\r\nline 2\r\nline three\r\n')
    expect(bytes.includes('\r\r')).toBe(false)
  })

  it('keeps LF files LF', async () => {
    writeFileSync(join(root, 'lf.tex'), 'a\nb\n')
    const file = await readFileInProject(root, 'lf.tex')
    await writeFileInProject(root, 'lf.tex', 'a\nc\n', file.mtime, {
      crlf: file.crlf,
      bom: file.hadBom,
    })
    expect(readFileSync(join(root, 'lf.tex'), 'utf8')).toBe('a\nc\n')
  })

  it('reference updates keep CRLF without doubling', async () => {
    const file = await readFileInProject(root, 'crlf.tex')
    const updated = applyReferenceUpdates({ 'crlf.tex': file.content }, [
      {
        relPath: 'crlf.tex',
        line: 1,
        oldKey: 'chapters/old',
        newKey: 'chapters/new',
        message: 'update',
      },
    ])
    await writeFileInProject(root, 'crlf.tex', updated['crlf.tex'], file.mtime, {
      crlf: file.crlf,
      bom: file.hadBom,
    })
    const bytes = readFileSync(join(root, 'crlf.tex'), 'utf8')
    expect(bytes).toContain('\\input{chapters/new}\r\n')
    expect(bytes.includes('\r\r')).toBe(false)
    expect(bytes.charCodeAt(0)).toBe(0xfeff)
  })

  it('replace-all keeps CRLF without doubling', async () => {
    await replaceAllInProject(
      'line two',
      { caseSensitive: true, wholeWord: false, regex: false },
      'line 2'
    )
    const bytes = readFileSync(join(root, 'crlf.tex'), 'utf8')
    expect(bytes).toContain('line 2\r\n')
    expect(bytes.includes('\r\r')).toBe(false)
    expect(bytes.charCodeAt(0)).toBe(0xfeff)
  })
})
