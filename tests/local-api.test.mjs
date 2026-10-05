import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { wardrobeImportApi } from "../scripts/import-job-api.mjs";
import { createOutfitHandler } from "../scripts/outfit-api.mjs";
import { createTasteHandler } from "../scripts/taste-api.mjs";

async function call(handler, method, url, metadata = {}) {
  const req = Readable.from([]);
  Object.assign(req, { method, url, headers: { host: "localhost:5173" }, socket: { remoteAddress: "127.0.0.1" } }, metadata);
  const result = { status: 200, headers: {} };
  const res = {
    set statusCode(value) { result.status = value; },
    setHeader(name, value) { result.headers[name] = value; },
    end(bytes) { result.body = bytes; },
  };
  await handler(req, res, () => { result.next = true; });
  return result;
}

async function imports(t) {
  const root = await mkdtemp(path.join(tmpdir(), "wardrobe-api-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = wardrobeImportApi({ env: { WARDROBE_IMPORT_MODE: "api" } });
  await plugin.configResolved({ root });
  let handler;
  plugin.configureServer({ middlewares: { use(fn) { handler = fn; } } });
  return { root, handler };
}

test("private reads and mutations reject remote and cross-site callers across every API", async (t) => {
  const { handler: importer } = await imports(t);
  const outfit = createOutfitHandler({ getState: async () => ({ looks: [] }) });
  const taste = createTasteHandler({ getState: async () => ({}) }, { reconcile: async () => {}, configuration: async () => ({ available: false }) });
  const routes = [
    [importer, "GET", "/api/import/wardrobe"],
    [importer, "GET", "/api/import/library/photo.png"],
    [importer, "POST", "/api/import/jobs"],
    [importer, "DELETE", "/api/import/wardrobe/import-00000000-0000-0000-0000-000000000000"],
    [outfit, "GET", "/api/outfit-studio/identity"],
    [outfit, "POST", "/api/outfit-studio/looks"],
    [taste, "GET", "/api/taste"],
    [taste, "POST", "/api/taste/recommend"],
  ];
  for (const [handler, method, route] of routes) {
    for (const metadata of [
      { socket: { remoteAddress: "192.168.1.20" } },
      { headers: { origin: "https://other.example", host: "localhost:5173" } },
      { headers: { origin: "null", host: "localhost:5173" } },
      { headers: { "sec-fetch-site": "cross-site", host: "localhost:5173" } },
      { headers: { "sec-fetch-site": "same-site", host: "localhost:5173" } },
    ]) assert.equal((await call(handler, method, route, metadata)).status, 403, `${method} ${route}`);
  }
  assert.equal((await call(importer, "GET", "/api/import/wardrobe", { headers: { host: "localhost:5173", origin: "http://localhost:5173", "sec-fetch-site": "same-origin" } })).status, 200);
  assert.equal((await call(outfit, "GET", "/api/outfit-studio")).status, 200);
  assert.equal((await call(taste, "GET", "/api/taste")).status, 200);
});

test("personal library photos are served without persistent shared caching", async (t) => {
  const { root, handler } = await imports(t);
  await mkdir(path.join(root, "data/imported"), { recursive: true });
  await writeFile(path.join(root, "data/imported/photo.png"), "synthetic test photo");
  const result = await call(handler, "GET", "/api/import/library/photo.png");
  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "private, no-store");
  assert.equal(result.body.toString(), "synthetic test photo");
});
