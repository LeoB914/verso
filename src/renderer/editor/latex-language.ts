import { StreamLanguage } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'

/** LaTeX highlighting baseline: the classic `stex` mode via StreamLanguage. */
export const latexLanguage = StreamLanguage.define(stex)
