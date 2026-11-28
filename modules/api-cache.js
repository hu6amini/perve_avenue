// =============================================
// FORUMFREE API CACHE - shared /api.php response cache
// =============================================
//
// Loaded synchronously, before media-dimensions.js and media-optimizer.js.
// Exposes a global `ForumApiCache`. Same storage contract used previously by
// both scripts independently:
//
//   sessionStorage['mfs_api:<endpoint>'] = JSON { ts, data }
//
// Endpoints must start with '/api.php' (relative path, same origin).
//
// API:
//   .get(endpoint)        -> Promise<data|null>    cached or fetched (dedupes inflight)
//   .peek(endpoint)       -> data|undefined        sync, memory-or-storage, no fetch
//   .set(endpoint, data)  -> void                  manually seed (e.g. after custom fetch)
//   .invalidate(endpoint) -> void                  drop one entry (memory + storage)
//   .clear()              -> void                  drop all entries
//   .getStats()           -> { hits, misses, fetches, errors, inflightJoins, memorySize }
//   .ttlMs, .storageKeyPrefix
//
// Behaviour:
//   - Never rejects. Returns null on network error or non-2xx.
//   - Stale entries (> TTL) are treated as missing.
//   - Guest access works — no cookies required (verified against live API).
//   - Same-origin only. Absolute / cross-origin URLs are rejected.

'use strict';

if (!globalThis.ForumApiCache) {
    globalThis.ForumApiCache = (function () {
        var TTL_MS = 3 * 60 * 1000;
        var STORAGE_PREFIX = 'mfs_api:';
        var ENDPOINT_PREFIX = '/api.php';

        var memory = new Map();
        var inflight = new Map();
        var stats = {
            hits: 0,
            misses: 0,
            fetches: 0,
            errors: 0,
            inflightJoins: 0
        };

        function isValidEndpoint(ep) {
            return typeof ep === 'string' && ep.indexOf(ENDPOINT_PREFIX) === 0;
        }

        function readStorage(ep) {
            try {
                var raw = sessionStorage.getItem(STORAGE_PREFIX + ep);
                if (!raw) return null;
                var parsed = JSON.parse(raw);
                if (!parsed || !parsed.ts || typeof parsed.data === 'undefined') return null;
                if (Date.now() - parsed.ts > TTL_MS) return null;
                return parsed;
            } catch (e) {
                return null;
            }
        }

        function writeStorage(ep, ts, data) {
            try {
                sessionStorage.setItem(
                    STORAGE_PREFIX + ep,
                    JSON.stringify({ ts: ts, data: data })
                );
            } catch (e) {}
        }

        function peek(ep) {
            if (!isValidEndpoint(ep)) return undefined;
            var mem = memory.get(ep);
            if (mem && Date.now() - mem.ts < TTL_MS) return mem.data;
            var stored = readStorage(ep);
            if (stored) {
                memory.set(ep, stored);
                return stored.data;
            }
            return undefined;
        }

        function get(ep) {
            if (!isValidEndpoint(ep)) return Promise.resolve(null);

            var mem = memory.get(ep);
            if (mem && Date.now() - mem.ts < TTL_MS) {
                stats.hits++;
                return Promise.resolve(mem.data);
            }

            var stored = readStorage(ep);
            if (stored) {
                memory.set(ep, stored);
                stats.hits++;
                return Promise.resolve(stored.data);
            }

            if (inflight.has(ep)) {
                stats.inflightJoins++;
                return inflight.get(ep);
            }

            stats.misses++;
            var promise = fetch(ep, { credentials: 'same-origin' })
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (data) {
                    var entry = { ts: Date.now(), data: data };
                    memory.set(ep, entry);
                    writeStorage(ep, entry.ts, data);
                    stats.fetches++;
                    inflight.delete(ep);
                    return data;
                })
                .catch(function () {
                    stats.errors++;
                    inflight.delete(ep);
                    return null;
                });

            inflight.set(ep, promise);
            return promise;
        }

        function set(ep, data) {
            if (!isValidEndpoint(ep)) return;
            var entry = { ts: Date.now(), data: data };
            memory.set(ep, entry);
            writeStorage(ep, entry.ts, data);
        }

        function invalidate(ep) {
            if (!isValidEndpoint(ep)) return;
            memory.delete(ep);
            inflight.delete(ep);
            try {
                sessionStorage.removeItem(STORAGE_PREFIX + ep);
            } catch (e) {}
        }

        function clear() {
            memory.clear();
            inflight.clear();
            try {
                var keys = [];
                for (var i = 0; i < sessionStorage.length; i++) {
                    var k = sessionStorage.key(i);
                    if (k && k.indexOf(STORAGE_PREFIX) === 0) keys.push(k);
                }
                for (var j = 0; j < keys.length; j++) {
                    sessionStorage.removeItem(keys[j]);
                }
            } catch (e) {}
        }

        function getStats() {
            return {
                hits: stats.hits,
                misses: stats.misses,
                fetches: stats.fetches,
                errors: stats.errors,
                inflightJoins: stats.inflightJoins,
                memorySize: memory.size,
                inflightSize: inflight.size
            };
        }

        return {
            get: get,
            peek: peek,
            set: set,
            invalidate: invalidate,
            clear: clear,
            getStats: getStats,
            ttlMs: TTL_MS,
            storageKeyPrefix: STORAGE_PREFIX
        };
    })();
}
