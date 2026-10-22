import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { latexCommands, latexEnvironments, latexPackages } from './latex-data'
import { useProjectIndex } from '../stores/projectIndex'
import { useProjectStore } from '../stores/project'

/**
 * LaTeX completion sources: commands, environments, user-defined commands,
 * labels, citation keys, file paths and package names.
 */

function option(label: string, detail: string, type = 'variable'): Completion {
  return { label, detail, type }
}

function snippetCompletionFor(cmd: (typeof latexCommands)[number]): Completion {
  return snippetCompletion(cmd.apply, {
    label: cmd.label,
    detail: cmd.detail,
    type: 'function',
  })
}

/** Build the combined LaTeX completion source. */
export const latexCompletionSource: CompletionSource = (
  context: CompletionContext
): CompletionResult | null => {
  const line = context.state.doc.lineAt(context.pos)
  const textBefore = line.text.slice(0, context.pos - line.from)

  // 1. \begin{ / \end{ → environments
  const beginMatch = /\\(?:begin|end)\{([^}]*)$/.exec(textBefore)
  if (beginMatch) {
    const userEnvs = useProjectIndex
      .getState()
      .definitions.filter((d) => d.kind === 'environment')
      .map((d) => option(d.name, 'user-defined environment', 'class'))
    return {
      from: context.pos - beginMatch[1].length,
      options: [
        ...userEnvs,
        ...latexEnvironments.map((env) => option(env.label, env.detail, 'class')),
      ],
      validFor: /^[a-zA-Z*]*$/,
    }
  }

  // 2. \ref{ family → labels
  const refMatch = /\\(?:ref|eqref|autoref|cref|Cref|pageref|vref)\{([^}]*)$/.exec(textBefore)
  if (refMatch) {
    const labels = useProjectIndex.getState().labels
    return {
      from: context.pos - refMatch[1].length,
      options: labels.map((l) => ({
        label: l.key,
        detail: l.section ? `${l.relPath} · ${l.section}` : l.relPath,
        type: 'keyword',
      })),
      validFor: /^[^}]*$/,
    }
  }

  // 3. \cite{ family → bib keys
  const citeMatch = /\\[a-zA-Z]*cite[a-zA-Z]*\{([^}]*)$/.exec(textBefore)
  if (citeMatch) {
    const bibEntries = useProjectIndex.getState().bibEntries
    return {
      from: context.pos - citeMatch[1].length,
      options: [...bibEntries.values()].map((entry) => ({
        label: entry.key,
        detail: [entry.fields.author, entry.fields.title].filter(Boolean).join(' — ').slice(0, 100),
        type: 'text',
      })),
      validFor: /^[^,}]*$/,
    }
  }

  // 4. \usepackage{ → package names
  const pkgMatch = /\\usepackage(?:\[[^\]]*\])?\{([^}]*)$/.exec(textBefore)
  if (pkgMatch) {
    return {
      from: context.pos - pkgMatch[1].length,
      options: latexPackages.map((p) => option(p, 'package', 'namespace')),
      validFor: /^[a-zA-Z-]*$/,
    }
  }

  // 5. \input{ \include{ \includegraphics{ → file paths from the tree
  const fileMatch = /\\(?:input|include|subfile|includegraphics)\{([^}]*)$/.exec(textBefore)
  if (fileMatch) {
    return {
      from: context.pos - fileMatch[1].length,
      options: fileOptionsFromTree(),
      validFor: /^[^}]*$/,
    }
  }

  // 6. Commands: \foo
  const cmdMatch = context.matchBefore(/\\[a-zA-Z]*$/)
  if (cmdMatch) {
    if (cmdMatch.from === cmdMatch.to && !context.explicit) return null
    const userCommands = useProjectIndex
      .getState()
      .definitions.filter((d) => d.kind === 'command' || d.kind === 'operator')
      .map((d) => ({
        label: '\\' + d.name,
        detail: `user-defined${d.argCount ? `, ${d.argCount} arg${d.argCount === 1 ? '' : 's'}` : ''}`,
        type: 'function',
        apply: '\\' + d.name,
      }))
    return {
      from: cmdMatch.from,
      options: [...userCommands, ...latexCommands.map(snippetCompletionFor)],
      validFor: /^[a-zA-Z]*$/,
    }
  }

  return null
}

function fileOptionsFromTree(): Completion[] {
  const tree = useProjectStore.getState().fileTree
  const options: Completion[] = []
  function walk(node: NonNullable<typeof tree>, prefix: string): void {
    if (!node.children) return
    for (const child of node.children) {
      const path = prefix ? `${prefix}/${child.name}` : child.name
      if (child.type === 'dir') {
        walk(child, path)
      } else {
        // LaTeX allows omitting .tex extensions.
        const label = path.replace(/\.tex$/i, '')
        options.push(option(label, path, 'file'))
      }
    }
  }
  if (tree) walk(tree, '')
  return options
}
