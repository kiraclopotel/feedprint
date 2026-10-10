// The backup-folder "written" line is cleared on every refresh instead of outliving the mirror
// that wrote it.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'src/ui/dashboard/components/ExportTab.tsx'), 'utf8');
describe('the folder message', () => {
  it('is cleared at the start of every refresh', () => {
    const body = src.slice(src.indexOf('const refreshFolderWire = async'), src.indexOf('const refreshFolderWire = async') + 600);
    expect(body.indexOf("setFolderMsg('')")).toBeGreaterThan(-1);
    expect(body.indexOf("setFolderMsg('')")).toBeLessThan(body.indexOf('await getBackupFolderWireStatus()'));
  });
});
