// Types for the generator, so the typed test lane can import it.
// The script itself is plain JS because it runs under node with no build step.

/** Produce the exact contents src/forensics/rfc3161-inline.generated.ts should have. */
export declare function generate(): Promise<string>;
