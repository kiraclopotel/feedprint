// The models and providers that answered the AI calls made under one abort signal.
//
// The client's module-wide last call is overwritten by every later call in the tab (a rewrite
// after a judge, another post's call in flight), so a caller that must name what answered its own
// calls passes a signal of its own and reads the answer back here.
//
// Every distinct model that answered is kept, in the order it answered, because a verdict the
// judge pair reached was read by both and the record's decision block names both. Joined with
// '+', the value names only the models that did answer.
//
// A text that came in one reply was written by that reply's model alone. latestModelFor names it:
// the model of the last call under the signal that returned text. Naming every model would name a
// model that only read the item, such as the triage call before the Teen and Child judge, as one
// that wrote the words.

const bySignal = new WeakMap<AbortSignal, { models: string[]; providers: string[]; latest: string }>();

/** Called by the client when a call made under `signal` returned text. */
export function noteCallProvenance(
  signal: AbortSignal | undefined,
  provenance: { model: string; provider: string },
): void {
  if (!signal) return;
  const seen = bySignal.get(signal) ?? { models: [], providers: [], latest: provenance.model };
  if (!seen.models.includes(provenance.model)) seen.models.push(provenance.model);
  if (!seen.providers.includes(provenance.provider)) seen.providers.push(provenance.provider);
  seen.latest = provenance.model;
  bySignal.set(signal, seen);
}

/** Every model and provider that answered a call under `signal`, or null when none did. */
export function callProvenanceFor(signal: AbortSignal): { model: string; provider: string } | null {
  const seen = bySignal.get(signal);
  return seen ? { model: seen.models.join('+'), provider: seen.providers.join('+') } : null;
}

/** The model that answered the last call under `signal` to return text, or null when none did. */
export function latestModelFor(signal: AbortSignal): string | null {
  return bySignal.get(signal)?.latest ?? null;
}
