// The one switch between "Strict sends nothing" and "Strict reads with a key" (Silent on the screens). It is true from the
// release that changed Strict's words, screens and cover together (12 Oct 2026 plan, pieces B to D). The gate that decides
// who may send (reading-gate.ts) was built and tested first with this file holding it closed; the file stays as the one
// place that turns Silent's reading off again, with no other change, should it ever have to be. A test closes or opens it
// by mocking this module; nothing else reads it but reading-gate.ts.

export const STRICT_READS_WITH_A_KEY = true;
