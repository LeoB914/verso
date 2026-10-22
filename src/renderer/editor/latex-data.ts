import latexData from '../../../resources/latex-commands.json'

export interface LatexCommand {
  label: string
  detail: string
  apply: string
  snippet: boolean
}

export interface LatexEnv {
  label: string
  detail: string
}

const data = latexData as {
  commands: LatexCommand[]
  environments: LatexEnv[]
  packages: string[]
}

export const latexCommands: LatexCommand[] = data.commands
export const latexEnvironments: LatexEnv[] = data.environments
export const latexPackages: string[] = data.packages
