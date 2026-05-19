/**
 * The override gate — silent-corruption mode B. The recompute helper
 * MUST respect manually-overridden values (a user-edited due_date,
 * a user-edited amount). If recompute touches an overridden row, the
 * user's intent is silently rolled back.
 *
 * The integration test that actually catches this is
 * tests/integration/project-recompute-task-dates.test.ts (it asserts
 * the overridden task's updated_at is UNCHANGED). This unit test pins
 * down the primitive in isolation.
 */
import { describe, it, expect } from "vitest"
import { respectOverride } from "@/lib/recompute/override"

describe("respectOverride", () => {
  it("returns the original value when overridden=true", () => {
    expect(
      respectOverride({ overridden: true, current: "2026-05-19", computed: "2026-05-20" }),
    ).toBe("2026-05-19")
  })

  it("returns the computed value when overridden=false", () => {
    expect(
      respectOverride({ overridden: false, current: "2026-05-19", computed: "2026-05-20" }),
    ).toBe("2026-05-20")
  })

  it("works for nullable fields — null computed is allowed when not overridden", () => {
    expect(respectOverride({ overridden: false, current: "2026-05-19", computed: null })).toBeNull()
    expect(respectOverride({ overridden: true, current: null, computed: "2026-05-19" })).toBeNull()
  })
})
