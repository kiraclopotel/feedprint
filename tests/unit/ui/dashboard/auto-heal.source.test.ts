import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { repoPath } from '../../../helpers/repo-root';

// Structural guard (absence of a symbol): there is no behavior to exercise
// for a code path that must not exist, so this stays a source read. The
// paths are constants so a decomposition step is a one-line change; the
// reset modal is scanned alongside the shell since it owns the reset flow.
const DASHBOARD_SHELL = 'src/ui/dashboard/Dashboard.tsx';
const RESET_MODAL = 'src/ui/dashboard/components/ResetChainConfirmModal.tsx';

function source(path: string): string {
  return readSource(path);
}

describe('signature-failure recovery policy', () => {
  it('never re-anchors a signature failure automatically', () => {
    expect(source(DASHBOARD_SHELL)).not.toContain('autoHealKeyMismatch');
    expect(source(RESET_MODAL)).not.toContain('autoHealKeyMismatch');
    expect(source('src/forensics/auto-heal.ts')).not.toMatch(/\breAnchorChain\b/);
  });
});
