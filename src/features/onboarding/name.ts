/**
 * Name-field rules for onboarding.
 *
 * Kept free of React Native imports so the rules can be exercised directly in
 * Node by `npm run verify:logic` — the UTF-16 edge cases here are exactly the
 * kind that never show up until someone types in a script you did not test.
 */

/** Minimum name length, counted in characters a reader would recognise. */
export const NAME_MIN_LENGTH = 2;

/**
 * Compose a name to a canonical form before measuring or storing it.
 *
 * "é" can arrive as one code point or as "e" plus a combining accent
 * depending on the keyboard — visually identical, different lengths, and
 * different bytes on the wire. NFC collapses both to the same single code
 * point, so the length check cannot disagree with what the user sees and the
 * backend never receives two spellings of one name.
 *
 * `normalize` is guarded because it depends on the ICU data compiled into the
 * JS engine; where it is unavailable the trimmed string is still usable.
 */
export function canonicalName(value: string): string {
  const trimmed = value.trim();
  return typeof trimmed.normalize === 'function'
    ? trimmed.normalize('NFC')
    : trimmed;
}

/**
 * Length in Unicode code points rather than UTF-16 code units.
 *
 * JavaScript strings are UTF-16, so `.length` counts surrogate halves: "😀"
 * and "𠀋" each report 2, which let a single character satisfy a
 * two-character minimum. Iterating the string yields whole code points
 * instead.
 */
export function nameLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Whether a name is long enough to accept.
 *
 * Deliberately script-agnostic: there is no allowed-character list, because
 * any such list eventually rejects somebody's real name. The only question
 * asked is how much was typed.
 */
export function isValidName(value: string): boolean {
  return nameLength(canonicalName(value)) >= NAME_MIN_LENGTH;
}
