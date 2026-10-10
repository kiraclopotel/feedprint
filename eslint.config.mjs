// FeelingWise ESLint — deliberately MINIMAL.
//
// Holzmann's "Power of Ten" thesis: a small set of mechanically-checkable rules
// beats a hundred style rules nobody follows. So this config enables only the
// rules that catch the SILENT-FAILURE class the audit flagged as FW's dominant
// failure mode (Rule 7) — not a sprawling style preset. Add a rule here only
// when it catches a real bug class and the codebase can be driven to zero.
//
// Enforced (every one is "error" → zero-tolerance, gated in CI):
//   • no-floating-promises — an unhandled promise is a silent failure: a Groq
//     call / IDB write / forensic log whose rejection vanishes. Each promise
//     must be awaited, returned, or explicitly fire-and-forget via `void` +
//     a `.catch`. This is Rule 7 made mechanical.
//   • no-misused-promises    — a promise passed where a sync value is expected
//     (e.g. an async fn as an event handler) silently drops errors.
//   • no-empty (allowEmptyCatch:false) — a truly-empty `catch {}` swallows a
//     failure with no trace. A catch that intentionally ignores must say so
//     with a comment (which this rule accepts) or handle/log.
//   • no-restricted-imports (per folder) — the layer order from the 2026-08-23
//     audit (docs/audits/2026-08-23-objective-audit/wave4-architecture/architecture.md,
//     Proposal C, ARCHITECTURE-1). Since 2026-09-16 the rules are generated from
//     ONE ordered table (LAYERS below, PLAN-2026-09-16 item 8.11): a folder may
//     not import a folder above it, and every upward import that exists today is
//     written in TOLERATED with the reason it is there. Adding a folder to src/
//     without placing it in the table fails tests/repo/architecture-layering.test.ts.
//     Existing violations are seeded as `eslint-disable-next-line` markers tagged
//     "ARCHITECTURE-1 layering violation"; that test also holds the marker count,
//     which may only go down. Do not add a new marker to land new code — route the
//     import through the correct layer instead.
//
// Scope: production code only (src/ + worker/src/). Tests and one-off scripts
// legitimately use fire-and-forget + console and are out of scope for now.
//
// Enforced on every commit that stages code: .githooks/pre-commit runs `npx eslint .`, and
// .github/workflows/ci.yml runs `npm run lint`. The codebase is at zero; a new violation blocks
// the commit.

import tseslint from 'typescript-eslint';

/**
 * The layer order, bottom first. A folder may import anything BELOW it and nothing above.
 *
 *   types        the shapes, and nothing else
 *   i18n         the words
 *   core         the rules that judge text, pure
 *   contracts    what a person agreed to, read and decoded, pure: no browser call, no record write
 *   storage      chrome storage, settings, the licence
 *   ai           the model client
 *   forensics    the record: hashing, signing, the chain, the export
 *   analysis     the decision path over one post or one room
 *   diagnostics  what the product records about itself
 *   content      the page: extraction, overlays, the queue
 *   background   the service worker
 *   ui           popup and dashboard
 *   products     the builds' entry points
 */
export const LAYERS = [
  'types', 'i18n', 'core', 'contracts', 'storage', 'ai', 'forensics',
  'analysis', 'diagnostics', 'content', 'background', 'ui', 'products',
];

/**
 * Upward imports that exist today, each with the reason it is tolerated. They are not exemptions
 * from the rule: every one carries an ARCHITECTURE-1 marker at the import, or is a pair the audit
 * accepted. The list may only shrink (tests/repo/architecture-layering.test.ts checks that each
 * entry is still a real import).
 */
export const TOLERATED = {
  // Not tolerated, on purpose: src/types -> forensics and src/core -> ai, storage, forensics. Those
  // edges exist only inside the two frozen judge files and the one shape they declare, and each
  // carries an ARCHITECTURE-1 marker. Listing them here would make those markers unused directives,
  // and no session may edit a frozen file to remove one. They stay forbidden until the word comes.
  // settings and the licence write through the record store and read the chain's own health.
  storage: ['forensics'],
  // the client asks the scorer for the batch shape, and reports its own timings.
  ai: ['analysis', 'diagnostics'],
  // the export reads what the analysis decided, to print it.
  forensics: ['analysis'],
  // the decision path records its own timings and outcomes.
  analysis: ['diagnostics'],
  // the surface session id is minted by the content script at page load; there is no second source.
  diagnostics: ['content'],
  // the string tables reach one shared UI helper for the four-language plural forms.
  i18n: ['ui'],
};

/** What a folder may not import: everything above it, minus what is tolerated today. */
function forbiddenFor(layer) {
  const above = LAYERS.slice(LAYERS.indexOf(layer) + 1);
  const tolerated = TOLERATED[layer] ?? [];
  return above.filter((l) => !tolerated.includes(l));
}

// One rule instance per folder. Patterns match the raw specifier text, so they catch every
// relative depth ('../ai/x', '../../ai/x', ...) regardless of how deep the importing file sits.
// The rule name stays written out as a literal key: the frozen files' suppressions and a gate
// test's regex both name it.
function layerRule(forbidden) {
  return [
    'error',
    {
      patterns: [
        {
          regex: `^(\.\./)+(${forbidden.join('|')})(/|$)`,
          message:
            'Cross-layer import forbidden by the architecture layering rule (ARCHITECTURE-1, Proposal C). ' +
            'If this is new code, route it through the correct layer instead of suppressing the rule.',
        },
      ],
    },
  ];
}

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'worker/dist/**',
      'coverage/**',
      // Build output, the copies of the source that scripts write, and private data, all of which
      // git ignores. None of it is source, and one file there that does not parse fails every lint.
      'dist-off/**',
      'worker/.wrangler/**',
      'public-snapshot/**',
      'release/**',
      '.verify/**',
      '.audit-cache/**',
      'docs/archive/**',
      // tests/ is linted since 2026-09-16 (PLAN-2026-09-16 item 7.8): a floating promise in a test
      // is a test that can pass before its own assertion runs, which is the failure mode a suite
      // cannot see in itself. scripts/ stays out: the research lane is one-off code by design.
      'scripts/**',
      // Other checkouts of this repository (worktrees) and the folders that are not linted
      // code: the site and the generated verifier. Without these, `eslint .` in the
      // main checkout parsed every worktree's copy of the verifier (PLAN-2026-09-16 item 1.10).
      '.claude/worktrees/**',
      '.worktrees/**',
      'landing/**',
      'verifier/**',
      'corpus/.prep/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'worker/src/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    // The tests, parsed with their own tsconfig so type-aware rules work here too. One rule to
    // start: a promise nobody waits for (PLAN-2026-09-16 item 7.8).
    files: ['tests/**/*.{ts,tsx}'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.tests.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  // One block per layer, generated from the table above: the top layer forbids nothing, so it is
  // left out rather than given an empty pattern.
  ...LAYERS.filter((layer) => forbiddenFor(layer).length > 0).map((layer) => ({
    files: [`src/${layer}/**/*.{ts,tsx}`],
    rules: {
      '@typescript-eslint/no-restricted-imports': layerRule(forbiddenFor(layer)),
    },
  })),

  {
    // The Contracts domain is pure: it reads what it is handed (a string, a document object, a list of
    // records) and returns data. The browser, the network and the record belong to the product shell
    // in src/products/contracts/, so nothing here can reach them by accident. A page reader takes its
    // Document as an argument, so the type is free to use and only the globals are refused.
    files: ['src/contracts/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error',
        ...['chrome', 'browser', 'fetch', 'XMLHttpRequest', 'WebSocket', 'indexedDB', 'localStorage', 'sessionStorage',
          'document', 'window', 'location', 'navigator'].map((name) => ({
          name,
          message: 'src/contracts is pure: pass what it needs in, and do the browser call in src/products/contracts.',
        })),
      ],
    },
  },

  {
    // The free filter's own code: the Off entry points and the engagement controller's modules.
    // Off keeps no record and makes no model call, and this is what makes that structural rather
    // than a promise: these folders may not import the recorder's layers at all (PLAN-2026-09-16
    // item 9.1). A shape both products need goes to types/; a rule both products apply goes to
    // core/. The count of breaks here is zero and the rule is an error, so it stays zero.
    files: ['src/products/**/*.{ts,tsx}', 'src/content/engagement/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(\.\./)+(forensics|ai|analysis)(/|$)',
              message:
                'The free filter (Off) may not import the recorder: no forensics, no ai, no analysis. '
                + 'Put a shared shape in src/types and a shared rule in src/core instead.',
            },
          ],
        },
      ],
    },
  },
);
