export const AUTONOMY_LEVELS = {
  READ: 0,
  INTERNAL_WRITE: 1,
  EXTERNAL_ACTION: 2,
  CRITICAL: 3,
} as const

export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[keyof typeof AUTONOMY_LEVELS]

/**
 * Determines if a tool invocation requires human approval before execution.
 * Rules:
 * - Levels 2 (EXTERNAL_ACTION) and 3 (CRITICAL) always require approval regardless of agent level.
 * - Any tool whose level exceeds agentMaxLevel requires approval.
 */
export function requiresApproval(toolLevel: number, agentMaxLevel: number): boolean {
  return toolLevel >= 2 || toolLevel > agentMaxLevel
}

/**
 * Determines if a tool can be assigned to an agent.
 * Rules:
 * - Level 3 tools (CRITICAL - financial/production impact) can only be assigned to agents
 *   with maxAutonomyLevel === 3.
 * - All other tool levels (0, 1, 2) can be assigned to any agent.
 */
export function isToolAssignable(toolLevel: number, agentMaxLevel: number): boolean {
  if (toolLevel === 3 && agentMaxLevel < 3) {
    return false
  }
  return true
}
