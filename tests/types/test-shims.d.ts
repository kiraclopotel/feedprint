// Ambient shims for the TESTS/scripts TypeScript program ONLY
// (tsconfig.tests.json). Not part of any runtime bundle.
//
// Cloudflare Workers globals: tests import worker/src/proxy.ts, whose real
// build is bundled by wrangler against @cloudflare/workers-types. Pulling
// that package into this mixed DOM program would conflict with lib.dom
// (Request/Response redefinitions), so we declare the two names proxy.ts
// actually references, shaped to the members it actually calls.
interface KVNamespace {
  get(key: string, options?: unknown): Promise<string | null>;
  put(key: string, value: string, options?: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Untyped dev-time modules used by individual tests.
declare module 'madge';

// Minimal typed surface: landing-home.test.ts needs a real `Document` back
// so its querySelectorAll<T>() generics resolve against lib.dom.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: unknown);
    window: Window & typeof globalThis;
  }
}
