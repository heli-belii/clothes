import { isLocalRequest } from "./local-request.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createOutfitStore, LOOK_ID, REQUEST_ID } from "./outfit-store.mjs";
import { createCodexOutfitGenerator } from "./codex-outfit-generator.mjs";

const API = "/api/outfit-studio";
function json(res, status, value) { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(value)); }
async function body(req, limit = 256 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error("Request body too large."), { status: 413 }); chunks.push(chunk); }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw Object.assign(new Error("Expected JSON."), { status: 400 }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Object.assign(new Error("Expected an object."), { status: 400 });
  return input;
}

export function createOutfitHandler(store, generator = null) {
  return async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== API && !url.pathname.startsWith(API + "/")) return next();
    if (!isLocalRequest(req)) return json(res, 403, { error: "Access your wardrobe from the local website on this computer." });
    try {
      const route = url.pathname.slice(API.length).split("/").filter(Boolean);
      if (!route.length && req.method === "GET") {
        await generator?.reconcile();
        return json(res, 200, { ...await store.getState(), codex: generator ? await generator.configuration() : { available: false, reason: "The local Codex connection is not enabled." } });
      }
      if (route.length === 1 && route[0] === "identity" && req.method === "GET") {
        const bytes = await sharp(await store.identityFile()).resize({ width: 240, height: 300, fit: "inside", withoutEnlargement: true }).png().toBuffer();
        res.setHeader("Content-Type", "image/png"); res.setHeader("Cache-Control", "no-store"); return res.end(bytes);
      }
      if (route.length === 1 && route[0] === "preferences" && req.method === "PUT") return json(res, 200, await store.savePreferences(await body(req)));
      if (route.length === 1 && route[0] === "looks" && req.method === "POST") return json(res, 201, await store.saveLook(await body(req)));
      if (route[0] === "looks" && LOOK_ID.test(route[1] || "")) {
        if (route.length === 2 && req.method === "PUT") return json(res, 200, await store.saveLook(await body(req), route[1]));
        if (route.length === 2 && req.method === "DELETE") return json(res, 200, await store.archiveLook(route[1]));
        if (route.length === 3 && route[2] === "restore" && req.method === "POST") return json(res, 200, await store.archiveLook(route[1], true));
        if (route.length === 3 && route[2] === "request" && req.method === "POST") return json(res, 201, await store.prepareRequest(route[1]));
      }
      if (route[0] === "requests" && REQUEST_ID.test(route[1] || "") && route.length === 3 && route[2] === "generate" && req.method === "POST") {
        if (!generator) return json(res, 503, { error: "The local Codex connection is not enabled." });
        return json(res, 202, await generator.start(route[1]));
      }
      if (route[0] === "requests" && REQUEST_ID.test(route[1] || "") && route.length === 3 && route[2] === "preview") {
        if (req.method === "GET") {
          const job = await store.request(route[1]);
          if (job.status !== "accepted" || !/^modeled-[a-f0-9]{16}\.png$/.test(job.image || "")) return json(res, 404, { error: "The modeled preview is not ready yet." });
          res.setHeader("Content-Type", "image/png"); res.setHeader("Cache-Control", "no-store"); return res.end(await readFile(path.join(store.requestDir(job.id), job.image)));
        }
        if (req.method === "POST") {
          const input = await body(req, 30 * 1024 * 1024), match = typeof input.imageDataUrl === "string" && input.imageDataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/);
          if (!match) return json(res, 400, { error: "Choose a PNG modeled photo." });
          return json(res, 200, await store.attachPreview(route[1], Buffer.from(match[1], "base64")));
        }
      }
      return json(res, 404, { error: "Outfit route not found." });
    } catch (error) { return json(res, error.status || (error.code === "ENOENT" ? 404 : 500), { error: error.status ? error.message : "The outfit could not be loaded or saved. Please try again." }); }
  };
}

export function wardrobeOutfitApi(options = {}) {
  let handler, generator;
  return {
    name: "wardrobe-outfit-studio",
    configResolved(config) { const store = createOutfitStore(config.root); generator = createCodexOutfitGenerator(store, { command: options.env?.WARDROBE_CODEX_COMMAND }); handler = createOutfitHandler(store, generator); },
    configureServer(server) { server.middlewares.use((req, res, next) => handler(req, res, next)); server.httpServer?.once("close", () => { void generator.close(); }); },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => handler(req, res, next)); server.httpServer?.once("close", () => { void generator.close(); }); },
  };
}
