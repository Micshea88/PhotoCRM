/**
 * The override gate — silent-corruption mode B defense.
 *
 * When a recompute pass would overwrite a value, the helper consults
 * this primitive first. If the row carries an `*_overridden` flag set
 * to true, the existing value wins; recompute is a no-op.
 *
 * This is a one-line function but it lives in its own primitive so
 * the rule is grep-able: every recompute call site reads
 * `respectOverride(...)` and the reader knows exactly where the
 * user-intent boundary is.
 */
export interface RespectOverrideInput<T> {
  overridden: boolean
  current: T
  computed: T
}

export function respectOverride<T>({ overridden, current, computed }: RespectOverrideInput<T>): T {
  return overridden ? current : computed
}
