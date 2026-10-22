import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSnapshot,
  getSnapshotContents,
  listSnapshots,
  restoreFile,
  setHistoryBaseDir,
} from '../../../src/main/history/snapshots'

describe('single-file restore safety', () => {
  let root: string
  let historyBase: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openleaf-restore-'))
    historyBase = mkdtempSync(join(tmpdir(), 'openleaf-restore-ud-'))
    setHistoryBaseDir(historyBase)
    writeFileSync(join(root, 'main.tex'), 'version one\n')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(historyBase, { recursive: true, force: true })
  })

  it('snapshots the current content before overwriting it', async () => {
    const original = await createSnapshot(root, 'Project opened')
    writeFileSync(join(root, 'main.tex'), 'version two (unsaved work)\n')

    expect(await restoreFile(root, original.id, 'main.tex')).toBe(true)
    expect(readFileSync(join(root, 'main.tex'), 'utf8')).toBe('version one\n')

    // A "Before restore" snapshot now holds the pre-restore content.
    const snapshots = await listSnapshots(root)
    const beforeRestore = snapshots.find((s) => s.reason === 'Before restore')
    expect(beforeRestore).toBeDefined()
    const contents = await getSnapshotContents(root, beforeRestore!.id)
    expect(contents?.['main.tex']).toBe('version two (unsaved work)\n')

    // Restoring that safety snapshot brings the work back.
    expect(await restoreFile(root, beforeRestore!.id, 'main.tex')).toBe(true)
    expect(readFileSync(join(root, 'main.tex'), 'utf8')).toBe('version two (unsaved work)\n')
  })

  it('includes a dirty editor buffer passed as an override', async () => {
    const original = await createSnapshot(root, 'Project opened')
    const restored = await restoreFile(root, original.id, 'main.tex', {
      'main.tex': 'typing that was never saved\n',
    })
    expect(restored).toBe(true)
    const snapshots = await listSnapshots(root)
    const beforeRestore = snapshots.find((s) => s.reason === 'Before restore')
    const contents = await getSnapshotContents(root, beforeRestore!.id)
    expect(contents?.['main.tex']).toBe('typing that was never saved\n')
  })
})
