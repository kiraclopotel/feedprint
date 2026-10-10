// FeelingWise — Page-world bundle entry.
//
// This file is the entry point for the BUILD_TARGET=pageworld Vite
// build that emits dist/page-world.js. The manifest's 2nd
// content_scripts entry (world: "MAIN", run_at: "document_start")
// injects this bundle into the page's JS realm before page scripts
// can monkey-patch fetch.
//
// Kept separate from interceptor.ts so unit tests can import
// installPageWorldInterceptor without triggering a side-effect
// install in the jsdom realm at import time.
//
// The entry installs the interceptor on every platform the manifest injects
// this bundle into, because a text-less post is judged by its room, and the
// platform's own JSON is where the caption, the ad flag and the media of such a
// post live.
//
// The cost stays bounded by the endpoint table in interceptor.ts: only a URL
// that matches its own platform's include list, and none of its skip list, is
// cloned and parsed.

import { installPageWorldInterceptor } from './fetch-interceptor';
import { installPageWorldRouteNotifier } from './route-notifier';

installPageWorldInterceptor();

// G3 (2026-08-04): the route notifier installs UNCONDITIONALLY — unlike
// the wire layer above it does no per-request work (two history wrappers
// + one CustomEvent per navigation), and the isolated-world route
// watcher cannot observe MAIN-world pushState/replaceState from its own
// realm. See route-notifier.ts header.
installPageWorldRouteNotifier();
