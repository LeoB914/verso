#!/usr/bin/env node
/* Generate the keyboard-shortcuts table in docs/keyboard-shortcuts.md from the command registry. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Transpile-free import of the registry: read and eval the exported array.
const source = readFileSync(join(root, 'src/shared/commands.ts'), 'utf8')
const entries = [...source.matchAll(/\{\s*id:\s*'([^']+)'([\s\S]*?)\},/g)]
  .map((match) => {
    const body = match[2]
    const label = /label:\s*'([^']+)'/.exec(body)?.[1]
    const category = /category:\s*'([^']+)'/.exec(body)?.[1]
    const keys = /keys:\s*'([^']+)'/.exec(body)?.[1]
    return label && keys ? { id: match[1], label, keys, category } : null
  })
  .filter(Boolean)
const byCategory = new Map()
for (const { id, label, keys, category } of entries) {
  const cat = category ?? 'Other'
  byCategory.set(cat, [...(byCategory.get(cat) ?? []), { id, label, keys }])
}

const isMac = '⌘ on macOS, Ctrl elsewhere'
const render = (keys) => keys.replace(/Mod/g, '`Cmd/Ctrl`').replace(/\+/g, ' + ')

let table = '| Command | Shortcut |\n| --- | --- |\n'
for (const [category, commands] of [...byCategory.entries()].sort()) {
  table += `| **${category}** | |\n`
  for (const command of commands) {
    table += `| ${command.label} | ${render(command.keys)} |\n`
  }
}

const readmePath = join(root, 'docs', 'keyboard-shortcuts.md')
let readme = readFileSync(readmePath, 'utf8')
const begin = '<!-- SHORTCUTS:BEGIN -->'
const end = '<!-- SHORTCUTS:END -->'
const block = `${begin}\n\n${table}\n${end}`
if (readme.includes(begin)) {
  readme = readme.replace(new RegExp(`${begin}[\\s\\S]*${end}`), block)
} else {
  readme += `\n## Keyboard shortcuts\n\n(${isMac})\n\n${block}\n`
}
writeFileSync(readmePath, readme)
console.log('shortcuts table written:', entries.length, 'commands')
