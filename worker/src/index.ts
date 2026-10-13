import proxy, { fetchWorker, type Env } from './proxy';

export { LicenseCounter } from './license-counter';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return fetchWorker(request, env, ctx, true);
  },
} satisfies typeof proxy;
