// Tearing an IndexedDB database down between tests (PLAN-2026-09-16 item 7.2).
//
// Twelve files carried the same six lines. They matter more than their size: a delete that is
// BLOCKED (a connection still open from the last test) resolves nowhere, and a copy that forgot
// onblocked left the next test running against the previous test's data, which reads as a flake.
// The shared version refuses blocked and says which database, so the failure names itself.

/** Delete one IndexedDB database, rejecting when a connection is still holding it open. */
export function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`delete blocked: ${name}`));
  });
}

/** Delete several, in order, so one blocked database names itself rather than hiding in a race. */
export async function deleteDbs(...names: string[]): Promise<void> {
  for (const name of names) await deleteDb(name);
}
