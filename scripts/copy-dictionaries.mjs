#!/usr/bin/env node
/*
 * Copy the Hunspell dictionaries and their licenses from node_modules into
 * resources/dictionaries (not committed; runs on npm install).
 */
import { mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url)) + '/..'
const target = join(root, 'resources', 'dictionaries')
mkdirSync(target, { recursive: true })

const files = [
  ['dictionary-en/index.aff', 'en.aff'],
  ['dictionary-en/index.dic', 'en.dic'],
  ['dictionary-en/license', 'en.LICENSE'],
  ['dictionary-de/index.aff', 'de.aff'],
  ['dictionary-de/index.dic', 'de.dic'],
  ['dictionary-de/license', 'de.LICENSE'],
]

for (const [src, dest] of files) {
  copyFileSync(join(root, 'node_modules', src), join(target, dest))
}
console.log('dictionaries copied')
