/**
 * Compatibility façade over the shared command registry (Phase 12). The single
 * source of truth is `src/shared/commands.ts`; execution lives in
 * `src/renderer/commands.ts`.
 */
export type { CommandContext, CommandDefinition, CommandScope } from '@shared/commands'
export {
  commandDefinitions,
  detectKeyConflict,
  electronAccelerator,
  formatKeySpec,
  getCommand,
  isMacPlatform,
  keyEventToSpec,
  normalizeKeySpec,
  resolveKeybindings,
} from '@shared/commands'
import type { CommandDefinition } from '@shared/commands'
import { commandDefinitions } from '@shared/commands'

export interface Command extends CommandDefinition {
  /** Attached lazily to keep unit tests free of renderer store imports. */
  run?: () => void
}

export const commandRegistry: Command[] = commandDefinitions.map((command) => ({ ...command }))
export const keybindings: Command[] = commandRegistry
