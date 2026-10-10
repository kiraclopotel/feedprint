/**
 * The wall-clock budget for a test that spawns a process.
 *
 * WHY THIS EXISTS. vitest's default test timeout is 5s, which is right for a
 * pure-function unit test and wrong for anything that starts a child process.
 * This suite runs 546 files in parallel; a spawn competes with every other
 * worker for CPU, and node's own startup is paid before the test's work begins.
 *
 * Measured on 2026-09-08: tests/unit/demo-export-verifies.test.ts runs the
 * standalone verifier over landing/demo.html (1,500 ECDSA signatures, 1.7 MB).
 * Alone it takes 0.29s. Inside the full run it was clocked at 21,169ms and
 * failed with "Test timed out in 5000ms" — a forensic gate going red because
 * the machine was busy. It had been dismissed as flaky twice before it was
 * reproduced.
 *
 * A timeout sized to the work is not a weakened gate. Every assertion in these
 * tests is unchanged, and a genuine hang — a verifier that never returns, a
 * hook waiting on stdin — still fails here. What this removes is the failure
 * mode where a red forensic gate means nothing but contention, which is the
 * kind of red that teaches people to re-run instead of read.
 */
export const SPAWN_TIMEOUT_MS = 120_000;

/**
 * The budget for a test that reads the whole tree or asks git, without starting node itself.
 *
 * Alone these take a second or two; inside a commit hook while another pass runs they can pass the
 * 5s default and block commits that changed nothing they check. The same reasoning as above: the
 * assertions are unchanged and a real hang still fails.
 */
export const TREE_READ_TIMEOUT_MS = 30_000;
