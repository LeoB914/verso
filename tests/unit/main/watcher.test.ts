import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isOwnWrite, recordOwnWrite, sha256 } from '../../../src/main/project/watcher'

describe('own-write detection', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'openleaf-ownwrite-'))
    file = join(dir, 'main.tex')
    writeFileSync(file, 'content A\n')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('matches by content hash, not by time', async () => {
    recordOwnWrite(file, 'content B\n')
    writeFileSync(file, 'content B\n')
    expect(await isOwnWrite(file)).toBe(true)
  })

  it('does not suppress an external change that differs from our write', async () => {
    recordOwnWrite(file, 'content B\n')
    // Our write was replaced by someone else.
    writeFileSync(file, 'external change\n')
    expect(await isOwnWrite(file)).toBe(false)
  })

  it('keeps matching multiple watcher events for the same write', async () => {
    recordOwnWrite(file, 'content B\n')
    writeFileSync(file, 'content B\n')
    expect(await isOwnWrite(file)).toBe(true)
    // chokidar may emit a second event for the same save.
    expect(await isOwnWrite(file)).toBe(true)
  })

  it('suppresses an event for an older save while a newer write is in flight', async () => {
    recordOwnWrite(file, 'save 1\n')
    writeFileSync(file, 'save 1\n')
    // The next save is recorded, but its rename has not happened yet: the disk
    // still holds save 1 when the old event arrives.
    recordOwnWrite(file, 'save 2\n')
    expect(await isOwnWrite(file)).toBe(true)
    writeFileSync(file, 'save 2\n')
    expect(await isOwnWrite(file)).toBe(true)
  })

  it('falls back to the timestamp for path-only records (rename/delete)', async () => {
    recordOwnWrite(file)
    expect(await isOwnWrite(file)).toBe(true)
  })

  it('returns false for an unrecorded path', async () => {
    expect(await isOwnWrite(file)).toBe(false)
  })

  it('hashes bytes and strings consistently', () => {
    expect(sha256('abc')).toBe(sha256(Buffer.from('abc', 'utf8')))
  })
})
