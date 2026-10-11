// The keys that may sign a repair file (signed.ts). Public halves only; the private halves live outside the repository.
// To rotate: add the next key here, ship the package, then sign with it. Remove a key only after no installed package
// needs it. Made with the repair key script.

import type { RepairPublicKey } from './signed';

export const REPAIR_PUBLIC_KEYS: readonly RepairPublicKey[] = [
  { id: 'r1', publicKeyB64: 'Tg2i5imaTww5ZoLMeiApar33z6Nl0tL4YSNdJBUdZwY=' },
];
