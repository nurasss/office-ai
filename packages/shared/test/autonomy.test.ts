import { describe, expect, it } from 'vitest'
import {
  AUTONOMY_LEVELS,
  requiresApproval,
  isToolAssignable,
} from '../src/autonomy.js'

describe('Autonomy Semantics (packages/shared)', () => {
  it('covers full 16-combination truth table for requiresApproval and isToolAssignable', () => {
    const levels = [
      AUTONOMY_LEVELS.READ,
      AUTONOMY_LEVELS.INTERNAL_WRITE,
      AUTONOMY_LEVELS.EXTERNAL_ACTION,
      AUTONOMY_LEVELS.CRITICAL,
    ]

    for (const toolLevel of levels) {
      for (const agentMax of levels) {
        const approval = requiresApproval(toolLevel, agentMax)
        const assignable = isToolAssignable(toolLevel, agentMax)

        // Expected approval logic:
        // Levels 2 & 3 always require approval; OR toolLevel > agentMax
        const expectedApproval = toolLevel >= 2 || toolLevel > agentMax
        expect(approval).toBe(expectedApproval)

        // Expected assignable logic:
        // Level 3 tool cannot be assigned to agents with maxAutonomyLevel < 3
        const expectedAssignable = !(toolLevel === 3 && agentMax < 3)
        expect(assignable).toBe(expectedAssignable)
      }
    }
  })

  it('verifies specific key autonomy scenarios', () => {
    // Read tool (0) with read agent (0) -> no approval
    expect(requiresApproval(0, 0)).toBe(false)
    // Internal write (1) with read agent (0) -> requires approval
    expect(requiresApproval(1, 0)).toBe(true)
    // Internal write (1) with write agent (1) -> no approval
    expect(requiresApproval(1, 1)).toBe(false)
    // External action (2) with autonomous agent (3) -> always requires approval
    expect(requiresApproval(2, 3)).toBe(true)
    // Critical (3) with critical agent (3) -> always requires approval
    expect(requiresApproval(3, 3)).toBe(true)

    // Assigning critical (3) to agent with max 1 -> rejected
    expect(isToolAssignable(3, 1)).toBe(false)
    // Assigning critical (3) to agent with max 2 -> rejected
    expect(isToolAssignable(3, 2)).toBe(false)
    // Assigning critical (3) to agent with max 3 -> allowed
    expect(isToolAssignable(3, 3)).toBe(true)
    // Assigning external (2) to agent with max 1 -> allowed (with requiresApproval: true)
    expect(isToolAssignable(2, 1)).toBe(true)
  })
})
