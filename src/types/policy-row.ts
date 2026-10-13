/**
 * The policy table's row ids (src/core/policy/table.ts POLICY_ROWS, plus T1,
 * the household topic rule decide() applies outside the row list). Lives in
 * the types layer so the strings, the core and the content layers name the
 * same rows without importing each other. tests/unit/core/policy/policy-why-strings.test.ts
 * fails when this list and the table's list drift.
 */
export type PolicyRowId =
  | 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
  | 'P1' | 'P2' | 'P3' | 'P4' | 'P4b' | 'P5'
  | 'J1' | 'J2' | 'J3' | 'J4' | 'J5' | 'J6' | 'J7' | 'J8'
  | 'T1' | 'D1';
