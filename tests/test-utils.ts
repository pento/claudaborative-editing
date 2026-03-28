/**
 * Shared test utilities available to all test files.
 */

/**
 * Type-narrowing assertion that a value is not null or undefined.
 * Use instead of the `!` non-null assertion operator.
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Expected value to be defined, but got ' + String(value));
  }
}
