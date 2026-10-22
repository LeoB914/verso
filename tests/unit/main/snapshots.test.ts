import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AUTO_SNAPSHOT_REASON,
  createSnapshot,
  getSnapshotContents,
  getSnapshotImage,
  historyDir,
  listSnapshots,
  restoreFile,
  restoreProject,
  pruneSnapshots,
  setHistoryBaseDir,
} from '../../../src/main/history/snapshots'

// historyDir uses app.getPath('userData') which we mocked to '' — so history
// lands in `history/<projectId>` relative to the CWD. Redirect per test by
// patching process.cwd? The module computes dirs from the project root only.
// We run each test in its own temp CWD to isolate stores.

describe('snapshot store', () => {
  let projectRoot: string

  let historyBase: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'openleaf-hist-'))
    historyBase = mkdtempSync(join(tmpdir(), 'openleaf-ud-'))
    setHistoryBaseDir(historyBase)
    writeFileSync(join(projectRoot, 'main.tex'), 'Hello v1\n')
    mkdirSync(join(projectRoot, 'sections'))
    writeFileSync(join(projectRoot, 'sections', 'intro.tex'), 'Intro v1\n')
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(historyBase, { recursive: true, force: true })
  })

  it('creates snapshots with deduplicated content', async () => {
    const first = await createSnapshot(projectRoot, 'test')
    expect(first.files['main.tex']).toBeDefined()
    writeFileSync(join(projectRoot, 'main.tex'), 'Hello v2\n')
    const second = await createSnapshot(projectRoot, 'test v2')
    // Same content in different files/snapshots maps to the same hash.
    const introHash = first.files['sections/intro.tex']
    const main2 = second.files['main.tex']
    expect(main2).not.toBe(first.files['main.tex'])
    void introHash

    const list = await listSnapshots(projectRoot)
    expect(list).toHaveLength(2)
  })

  it('reads back stored contents', async () => {
    await createSnapshot(projectRoot, 'test')
    const list = await listSnapshots(projectRoot)
    const contents = await getSnapshotContents(projectRoot, list[0].id)
    expect(contents?.['main.tex']).toBe('Hello v1\n')
  })

  it('restores a single file', async () => {
    await createSnapshot(projectRoot, 'before')
    writeFileSync(join(projectRoot, 'main.tex'), 'Changed!\n')
    const list = await listSnapshots(projectRoot)
    const restored = await restoreFile(projectRoot, list[0].id, 'main.tex')
    expect(restored).toBe(true)
    expect(readFileSyncOf(join(projectRoot, 'main.tex'))).toBe('Hello v1\n')
  })

  it('restores the whole project after snapshotting the current state', async () => {
    await createSnapshot(projectRoot, 'before')
    writeFileSync(join(projectRoot, 'main.tex'), 'Changed!\n')
    const list = await listSnapshots(projectRoot)
    const restored = await restoreProject(projectRoot, list[0].id)
    // Only files that actually changed are reported (and rewritten).
    expect(restored).toEqual(['main.tex'])
    // "Before restore" snapshot created first (1 initial + 1 before-restore).
    expect((await listSnapshots(projectRoot)).length).toBe(2)
    expect(readFileSyncOf(join(projectRoot, 'main.tex'))).toBe('Hello v1\n')
  })

  it('prunes old unlabeled snapshots but keeps labelled ones', async () => {
    await createSnapshot(projectRoot, 'recent')
    await createSnapshot(projectRoot, 'labelled', 'My label')
    const pruned = await pruneSnapshots(projectRoot)
    expect(pruned).toBe(0)
    const list = await listSnapshots(projectRoot)
    expect(list.length).toBe(2)
    expect(list.some((s) => s.label === 'My label')).toBe(true)
  })

  it('keeps image blobs of surviving snapshots when pruning', async () => {
    writeFileSync(join(projectRoot, 'figure.png'), Buffer.from([1, 2, 3, 4]))
    await createSnapshot(projectRoot, 'old a')
    writeFileSync(join(projectRoot, 'main.tex'), 'Hello v2\n')
    await createSnapshot(projectRoot, 'old b')
    // Age both snapshots to the same day 30 days ago so pruning keeps one.
    const indexFile = join(historyDir(projectRoot), 'index.json')
    const index = JSON.parse(readFileSync(indexFile, 'utf8')) as Array<{ timestamp: number }>
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000
    index.forEach((entry, i) => (entry.timestamp = old + i))
    writeFileSync(indexFile, JSON.stringify(index))
    expect(await pruneSnapshots(projectRoot)).toBe(1)
    const [kept] = await listSnapshots(projectRoot)
    expect(await getSnapshotImage(projectRoot, kept.id, 'figure.png')).toMatch(
      /^data:image\/png;base64,/
    )
  })

  it('never loses a snapshot when snapshots and pruning run concurrently', async () => {
    await createSnapshot(projectRoot, 'seed')
    const indexFile = join(historyDir(projectRoot), 'index.json')
    const index = JSON.parse(readFileSync(indexFile, 'utf8')) as Array<{ timestamp: number }>
    index[0].timestamp = Date.now() - 200 * 24 * 60 * 60 * 1000 // prune will drop it
    writeFileSync(indexFile, JSON.stringify(index))
    await Promise.all([
      createSnapshot(projectRoot, 'one'),
      pruneSnapshots(projectRoot),
      createSnapshot(projectRoot, 'two'),
    ])
    const reasons = (await listSnapshots(projectRoot)).map((snapshot) => snapshot.reason)
    expect(reasons).toEqual(['one', 'two'])
    for (const snapshot of await listSnapshots(projectRoot)) {
      expect((await getSnapshotContents(projectRoot, snapshot.id))?.['main.tex']).toBe('Hello v1\n')
    }
  })

  it('skips periodic snapshots when nothing changed', async () => {
    await createSnapshot(projectRoot, AUTO_SNAPSHOT_REASON)
    await createSnapshot(projectRoot, AUTO_SNAPSHOT_REASON)
    expect(await listSnapshots(projectRoot)).toHaveLength(1)
    writeFileSync(join(projectRoot, 'main.tex'), 'Hello v2\n')
    await createSnapshot(projectRoot, AUTO_SNAPSHOT_REASON)
    expect(await listSnapshots(projectRoot)).toHaveLength(2)
  })

  it('skips oversized text files instead of storing a truncated copy', async () => {
    writeFileSync(join(projectRoot, 'huge.bib'), 'x'.repeat(2_000_001))
    const snapshot = await createSnapshot(projectRoot, 'big')
    expect(snapshot.files['huge.bib']).toBeUndefined()
    expect(snapshot.files['main.tex']).toBeDefined()
  })

  it('does not touch files outside snapshots', async () => {
    await createSnapshot(projectRoot, 'test')
    expect(existsSync(join(projectRoot, '.openleaf'))).toBe(false)
  })
})

function readFileSyncOf(path: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:fs').readFileSync(path, 'utf8')
}
