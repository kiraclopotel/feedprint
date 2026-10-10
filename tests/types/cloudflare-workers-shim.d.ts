// Typed-test lane shim for the Cloudflare Workers runtime types.
//
// tests/unit/worker-*.test.ts import worker/src/proxy.ts, which pulls in
// worker/src/license-counter.ts (a Durable Object). The real types live in
// worker/node_modules/@cloudflare/workers-types, but including that global
// declaration here would replace the DOM lib's Response/fetch typing for every
// src/ file the tests compile. This shim declares only the surface
// license-counter.ts uses; the worker's own tsconfig still checks it against
// the real types (npm run worker:typecheck).

declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    constructor(ctx: DurableObjectState, env: Env);
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
  }
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
}
