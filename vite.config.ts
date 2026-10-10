import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, basename, dirname } from 'path';
import { SOURCE_DIGEST_ENV, versionName } from './scripts/version-name.mjs';

/**
 * The build id for THIS build run, shared by every vite invocation in it.
 *
 * `scripts/new-build-id.mjs` mints one id per run into `.fw-build-id`; the
 * four invocations of `npm run build` (main / bootstrap / content / pageworld)
 * all read it, so the service worker and the content script carry the same id
 * by construction. When the file is absent (a bare `vite build` with no
 * prebuild step) one is minted here so a build never ships an empty id — it is
 * then per-invocation, so the bundles of that one build may carry different ids;
 * every real build (npm run build, build:off, the reproducible build) mints or
 * pins the file first.
 */
function readBuildId(): string {
  const file = resolve(__dirname, '.fw-build-id');
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').trim();
    if (/^fwbid-[a-z0-9]+-[a-z0-9]+$/.test(existing)) return existing;
  }
  const fresh = `fwbid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(file, `${fresh}\n`, 'utf8');
  return fresh;
}

/**
 * Whether this build bakes the dev-reload secret at all.
 *
 * It used to, always, including in the build that becomes the store zip: a read
 * of release/receipts-2.5.11.zip on 2026-09-19 found `fwsec-…` in
 * `build-id.json` and again inside `service-worker.js`. In a reproducible build
 * that value is a throwaway derived from the commit, but a zip cut straight
 * after `npm run build` carries the developer's own machine token. It is not
 * exploitable by a store user, because dev reload also needs
 * `installType === 'development'` and a server on their own 127.0.0.1, and the
 * live listings have passed review with this code three times; it is a
 * disclosure with no purpose, which is reason enough not to ship it.
 *
 * The developer's reload loop is `npm run build` too, not just `npm run dev`,
 * so the gate cannot be "is this a watch build". It is an explicit opt-out that
 * only the two packaging paths set: `npm run package` and
 * scripts/reproducible-build.mjs. Every other build behaves exactly as before.
 * With no secret baked, `shouldReloadForBuildId` returns false on the empty
 * side and the dev-reload poll can never act.
 */
const BAKE_DEV_SECRET = process.env.FW_DEV_RELOAD !== '0';

/** Per-machine dev-reload secret, `fwsec-<10 chars>`, kept in `.fw-dev-secret`
 *  (gitignored) so it survives rebuilds. See the `define` block below. */
function readOrCreateDevSecret(): string {
  if (!BAKE_DEV_SECRET) return '';
  const file = resolve(__dirname, '.fw-dev-secret');
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').trim();
    if (/^fwsec-[a-z0-9]{10}$/.test(existing)) return existing;
  }
  const fresh = `fwsec-${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}`;
  writeFileSync(file, `${fresh}\n`, 'utf8');
  return fresh;
}

/**
 * Flatten HTML outputs so e.g. dist/src/ui/popup/index.html → dist/popup.html.
 * Uses writeBundle (post-write) since Vite 8 / Rolldown doesn't support
 * direct bundle object mutation in generateBundle.
 */
function flattenHtml(): Plugin {
  return {
    name: 'flatten-html',
    enforce: 'post',
    writeBundle(options) {
      const outDir = options.dir!;
      const nestedRoot = join(outDir, 'src');
      if (!existsSync(nestedRoot)) return;

      // Every `<dir>/index.html` under dist/src/ becomes dist/<dir>.html, so
      // src/ui/popup/ and src/products/off/popup/ both land as popup.html in
      // their own dist.
      const findIndexHtml = (dir: string): string[] => {
        const found: string[] = [];
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) found.push(...findIndexHtml(full));
          else if (entry === 'index.html') found.push(full);
        }
        return found;
      };
      for (const htmlPath of findIndexHtml(nestedRoot)) {
        const subDir = basename(dirname(htmlPath));
        let html = readFileSync(htmlPath, 'utf-8');
        // Fix asset paths: from nested location, Vite writes relative
        // paths like "../../../assets/foo.js" — rewrite to "assets/foo.js"
        html = html.replace(/(?:\.\.\/)+assets\//g, 'assets/');
        const flatPath = join(outDir, `${subDir}.html`);
        writeFileSync(flatPath, html);
      }

      // Remove the leftover nested src/ directory
      rmSync(join(outDir, 'src'), { recursive: true, force: true });
    },
  };
}

/**
 * Custom plugin that copies manifest.json to dist/ with .ts paths
 * rewritten to their compiled .js output paths.
 */
function chromeExtensionManifest(manifestFile = 'manifest.json'): Plugin {
  return {
    name: 'chrome-extension-manifest',
    enforce: 'post',
    generateBundle(_, bundle) {
      // Read the source manifest
      const manifest = JSON.parse(
        readFileSync(resolve(__dirname, manifestFile), 'utf-8'),
      );

      // Build a map from input source paths to output file names
      const inputToOutput: Record<string, string> = {};
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (
          chunk.type === 'chunk' &&
          chunk.isEntry &&
          chunk.facadeModuleId
        ) {
          // Normalize: strip the project root to get relative source path
          const relativeSrc = chunk.facadeModuleId
            .replace(resolve(__dirname) + '/', '');
          inputToOutput[relativeSrc] = fileName;
        }
      }

      // Rewrite service_worker path
      const swSrc = manifest.background?.service_worker;
      if (swSrc && inputToOutput[swSrc]) {
        manifest.background.service_worker = inputToOutput[swSrc];
      }

      // Rewrite action.default_popup path
      // flattenHtml moves src/ui/popup/index.html → popup.html in writeBundle,
      // so use the flattened name directly.
      if (manifest.action?.default_popup) {
        manifest.action.default_popup = 'popup.html';
      }

      // Which code this is, on chrome://extensions and on page one of every export. Only a
      // reproducible build sets the source digest.
      const sourceDigest = process.env[SOURCE_DIGEST_ENV] || undefined;
      manifest.version_name = versionName({ version: manifest.version, buildId: readBuildId(), sourceDigest });

      // Emit the manifest to the output bundle
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
}

/**
 * Copies the product's icons into dist/assets/icons/ so the manifest icon
 * paths resolve in the built extension: assets/icons/ is Feedprint's fp tile
 * (docs/design/logos/icons/export-icons.mjs), assets/icons-off/ is Off's
 * (scripts/store/brand-assets.mjs).
 */
function copyStaticAssets(): Plugin {
  return {
    name: 'copy-static-assets',
    enforce: 'post',
    writeBundle(options) {
      const outDir = options.dir!;

      // The licences of what the bundles carry ask for their notice in every copy, and the store
      // zip is a copy cut from this folder; the repository alone does not travel with it.
      copyFileSync(resolve(__dirname, 'THIRD-PARTY-NOTICES.md'), join(outDir, 'THIRD-PARTY-NOTICES.md'));

      const srcDir = resolve(__dirname, 'assets', isOffBuild || isOffContentBuild ? 'icons-off' : 'icons');
      const destDir = join(outDir, 'assets', 'icons');

      if (!existsSync(srcDir)) {
        console.warn('[copy-static-assets] assets/icons/ not found — skipping');
        return;
      }

      mkdirSync(destDir, { recursive: true });

      for (const file of readdirSync(srcDir)) {
        if (file.endsWith('.png')) {
          copyFileSync(join(srcDir, file), join(destDir, file));
        }
      }
      console.log('[copy-static-assets] Copied icons to dist/assets/icons/');

      // The store name and short description are localised: both manifests
      // read them through __MSG_ keys from _locales/<code>/messages.json, one
      // folder shared by the two products (keys prefixed by product).
      const localesSrc = resolve(__dirname, '_locales');
      if (existsSync(localesSrc)) {
        for (const code of readdirSync(localesSrc)) {
          const messages = join(localesSrc, code, 'messages.json');
          if (!existsSync(messages)) continue;
          mkdirSync(join(outDir, '_locales', code), { recursive: true });
          copyFileSync(messages, join(outDir, '_locales', code, 'messages.json'));
        }
        console.log('[copy-static-assets] Copied _locales/');
      }
    },
  };
}

// Six builds controlled by the BUILD_TARGET env var: four for Receipts into dist/
// (main, bootstrap, content, page-world) and two for Off into dist-off/ (off and
// off-content, below).
// 1. Main build (default): HTML pages + service worker (ESM format)
// 2. Bootstrap build (BUILD_TARGET=bootstrap): tiny document-start IIFE
// 3. Content script build (BUILD_TARGET=content): IIFE, self-contained, no WebLLM
// 4. Page-world build (BUILD_TARGET=pageworld): IIFE, ZERO imports — runs in the
//    page's MAIN world to wrap fetch/XHR before any content script can. Per
//    docs/history/archive/V15_PAGE_WORLD_DESIGN.md substrate swap.
// A watch build must never empty dist/. `npm run dev` runs four watchers in
// parallel and the main one is configured with emptyOutDir: true, so its first
// build deleted everything the other three had just written — and page-world.js,
// which no watcher rebuilds, stayed deleted. dist/manifest.json declares
// page-world.js as a MAIN-world content script, so Load unpacked then failed
// with "Could not load javascript 'page-world.js'" and the extension did not run
// at all: every dev session started by breaking the extension it was meant to
// serve. A one-shot `npm run build` still empties, which is where that belongs.
const isWatch = process.argv.includes('--watch') || process.argv.includes('-w');
const isContentBuild = process.env.BUILD_TARGET === 'content';
const isPageWorldBuild = process.env.BUILD_TARGET === 'pageworld';
const isBootstrapBuild = process.env.BUILD_TARGET === 'bootstrap';
// Off, the filter product: two builds into dist-off/ (BUILD_TARGET=off for
// the popup + manifest, BUILD_TARGET=off-content for the content script).
// See src/product.ts for what the product constant switches.
const isOffBuild = process.env.BUILD_TARGET === 'off';
const isOffContentBuild = process.env.BUILD_TARGET === 'off-content';
const productDefine = {
  __FW_PRODUCT__: JSON.stringify(isOffBuild || isOffContentBuild ? 'off' : 'receipts'),
  // Baked into EVERY bundle, not just the service worker. The content script
  // needs its own copy: a tab opened before an extension reload keeps running
  // the old content script while the service worker is already the new build,
  // and comparing the two ids is the only way either side can notice.
  __FW_BUILD_ID__: JSON.stringify(readBuildId()),
};

export default defineConfig(isOffContentBuild ? {
  // --- Off content script build (IIFE, self-contained, no record) ---
  define: productDefine,
  build: {
    outDir: 'dist-off',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/products/off/content.ts'),
      },
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
        inlineDynamicImports: true,
      },
    },
  },
} : isOffBuild ? {
  // --- Off main build (popup + manifest; no service worker) ---
  base: '',
  plugins: [react(), flattenHtml(), chromeExtensionManifest('manifest.off.json'), copyStaticAssets()],
  define: {
    ...productDefine,
    __FW_BUILD_SECRET__: JSON.stringify(readOrCreateDevSecret()),
  },
  build: {
    outDir: 'dist-off',
    emptyOutDir: !isWatch,
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/products/off/popup/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
} : isPageWorldBuild ? {
  // --- Page-world interceptor build (IIFE, zero deps) ---
  define: productDefine,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        'page-world': resolve(__dirname, 'src/content/page-world/main.ts'),
      },
      output: {
        format: 'iife',
        entryFileNames: 'page-world.js',
        inlineDynamicImports: true,
      },
    },
  },
} : isBootstrapBuild ? {
  // --- Document-start bootstrap build (IIFE, isolated world) ---
  define: productDefine,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        bootstrap: resolve(__dirname, 'src/content/bootstrap.ts'),
      },
      output: {
        format: 'iife',
        entryFileNames: 'bootstrap.js',
        inlineDynamicImports: true,
      },
    },
  },
} : isContentBuild ? {
  // --- Content script build (IIFE, self-contained) ---
  define: productDefine,
  build: {
    outDir: 'dist',
    emptyOutDir: false, // Don't clear the main build output
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
        inlineDynamicImports: true,
      },
    },
  },
} : {
  // --- Main build (ESM - service worker, HTML pages, manifest) ---
  base: '',
  plugins: [react(), flattenHtml(), chromeExtensionManifest(), copyStaticAssets()],
  // Unique per-build id and a per-machine secret baked into the service worker
  // for the dev-only self-reload (src/background/dev-reload.ts).
  // check-sw-bundle.mjs extracts these exact literals from
  // dist/service-worker.js into dist/build-id.json, so the disk copy and the
  // running bundle can never disagree by construction. The fwbid- and fwsec-
  // prefixes are the extraction anchors.
  //
  // The secret must be STABLE across builds: the running bundle compares its
  // baked secret with the one the token server reads from the NEW build's
  // dist/build-id.json, and only a match lets an id mismatch reload the
  // extension. A per-build random secret (2d1ff26) made that comparison fail
  // on every rebuild, so the self-reload never fired again (found
  // 2026-09-02). It now lives in `.fw-dev-secret` at the repo root, created
  // once, never committed.
  define: {
    ...productDefine,
    __FW_BUILD_SECRET__: JSON.stringify(readOrCreateDevSecret()),
    // False in a store build (FW_DEV_RELOAD=0): src/background/dev-reload.ts then folds away its probe address and its poll.
    __FW_DEV_RELOAD__: JSON.stringify(BAKE_DEV_SECRET),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: !isWatch,
    // §BZ (2026-05-02) — disable vite's `__vite_preload__` helper injection.
    // The helper uses `document.getElementsByTagName('link')`, `document.head.appendChild`,
    // etc. for browser-window module-preload optimization. When a chunk has
    // dynamic imports (e.g., `src/forensics/store.ts:629` `await import('./signing')`
    // for cycle-avoidance), vite injects the helper into that chunk. The chunk
    // is then imported by `service-worker.ts`, where MV3 SW context lacks
    // `document` → `Uncaught ReferenceError: document is not defined` →
    // `Service worker registration failed. Status code: 15`. Diagnosed in §BZ.
    // For an extension build module-preload optimization is irrelevant
    // (bundles ship with the package); disabling the polyfill removes the
    // helper entirely without behavioral cost.
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/ui/popup/index.html'),
        dashboard: resolve(__dirname, 'src/ui/dashboard/index.html'),
        // §BY (2026-05-02) — `v3-metrics` bundle entry removed; surface
        // deleted as part of Phase A v3 cleanup. Phase B (v3 runtime path)
        // gets its own dedicated removal session.
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'service-worker') return 'service-worker.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
