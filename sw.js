/* Utsaav Stone Art Studio online — service worker.
 * The studio's server runs inside the open page (see src/demo/backend.ts). This worker:
 *  - sends requests for /api/…, share-page images and the print view to that page and returns its answer;
 *  - serves pages with an id in the address (e.g. /projects/abc) from their pre-built template.
 */
const BASE = "/utsaav-stone-art";
const DYNAMIC = ["/compare/[projectId]","/library/[id]","/projects/[id]","/quotes/[id]","/studio/[id]","/try-on/[wallId]","/s/[token]"]; // e.g. ["/projects/[id]", …]
const STATIC = new Set(["/dashboard","/elements","/library","/materials","/onboarding","/projects","/quotes/new","/quotes","/settings/account","/settings/ai","/settings/members","/settings","/settings/rates","/try-on","/upload","/login","/signup","/"]); // e.g. ["/projects", "/quotes/new", …]
const BACKEND = [/^\/api\//, /^\/s\/[^/]+\/(logo|quote|img\/[^/]+|wall\/[^/]+)$/, /^\/quotes\/[^/]+\/print$/];
const PLACEHOLDER = "_";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const alive = new Map(); // clientId -> answers pings

function ping(client) {
  if (alive.get(client.id)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(false), 1500);
    ch.port1.onmessage = () => {
      clearTimeout(t);
      alive.set(client.id, true);
      resolve(true);
    };
    client.postMessage({ type: "studio-ping" }, [ch.port2]);
  });
}

async function backendClient(clientId) {
  const own = clientId ? await self.clients.get(clientId) : null;
  if (own && (await ping(own))) return own;
  const all = await self.clients.matchAll({ type: "window" });
  for (const c of all) if (c.id !== clientId && (await ping(c))) return c;
  return null;
}

async function forward(event) {
  const req = event.request;
  // Not resultingClientId: waiting on a client that is still being created would never finish.
  const client = await backendClient(event.clientId);
  if (!client) {
    return new Response(
      `<!doctype html><meta name="viewport" content="width=device-width"><title>Utsaav Stone Art Studio</title><body style="font-family:system-ui;padding:32px;max-width:520px;margin:auto"><h1>Open the studio first</h1><p>This link opens inside the Utsaav Stone Art Studio. <a href="${BASE}/">Open the studio</a>.</p>`,
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  const body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
  const ch = new MessageChannel();
  const answer = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The studio didn't answer.")), 180000);
    ch.port1.onmessage = (m) => {
      clearTimeout(t);
      resolve(m.data);
    };
  });
  client.postMessage({ type: "studio-request", url: req.url, method: req.method, headers: [...req.headers.entries()], body }, body ? [ch.port2, body] : [ch.port2]);
  try {
    const r = await answer;
    const empty = [101, 204, 205, 304].includes(r.status);
    return new Response(empty ? null : r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: { code: "unavailable", message: String(e && e.message) } }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

/** /projects/abc(.txt|/…) → /projects/_(.txt|/…) when /projects/[id] is a page with an id. */
function mapDynamic(rel) {
  const clean = rel.replace(/\.(txt|html)$/, "");
  if (STATIC.has(clean)) return null;
  const segs = rel.split("/");
  for (const pattern of DYNAMIC) {
    const p = pattern.split("/");
    if (segs.length < p.length) continue;
    let ok = true;
    let changed = false;
    const out = segs.slice();
    for (let i = 1; i < p.length; i++) {
      const seg = segs[i];
      const isLast = i === p.length - 1;
      if (/^\[.+\]$/.test(p[i])) {
        if (seg.startsWith("__next")) {
          ok = false; // a payload file of the parent page, not an id
          break;
        }
        // The id segment may carry the payload suffix: abc.txt
        const m = isLast ? /^([^.]+)(\..+)?$/.exec(seg) : /^([^.]+)$/.exec(seg);
        if (!m) {
          ok = false;
          break;
        }
        if (m[1] !== PLACEHOLDER) {
          out[i] = PLACEHOLDER + (m[2] || "");
          changed = true;
        }
      } else {
        const bare = isLast ? seg.replace(/\..+$/, "") : seg;
        if (bare !== p[i]) {
          ok = false;
          break;
        }
      }
    }
    if (ok && changed) return out.join("/");
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE + "/")) return;
  const rel = url.pathname.slice(BASE.length);
  if (BACKEND.some((r) => r.test(rel))) {
    event.respondWith(forward(event));
    return;
  }
  const method = event.request.method;
  if (method !== "GET" && method !== "HEAD") return;
  // Pages opened directly (reload, bookmark): serve the page file itself. GitHub Pages would otherwise
  // redirect /dashboard to the folder /dashboard/ that holds the page's data files.
  if (event.request.mode === "navigate") {
    const clean = rel.replace(/\/+$/, "");
    if (clean && STATIC.has(clean)) {
      event.respondWith(fetch(BASE + clean + ".html" + url.search, { credentials: "same-origin" }));
      return;
    }
  }
  const mapped = mapDynamic(rel);
  if (!mapped) return;
  const target = BASE + mapped + (event.request.mode === "navigate" && !/\.\w+$/.test(mapped) ? ".html" : "") + url.search;
  event.respondWith(fetch(target, { method, headers: event.request.mode === "navigate" ? undefined : event.request.headers, credentials: "same-origin" }));
});
