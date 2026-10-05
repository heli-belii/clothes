import { isLocalRequest } from "./local-request.mjs";
import { createTasteStore } from "./taste-store.mjs";
import { createCodexTasteRunner } from "./codex-taste-runner.mjs";

const API = "/api/taste";
const json = (res, status, value) => { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(value)); };
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 512 * 1024) throw Object.assign(new Error("Taste request too large."), { status: 413 }); chunks.push(chunk); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw Object.assign(new Error("Expected JSON."), { status: 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Expected an object."), { status: 400 });
  return value;
}
export function createTasteHandler(store, runner) {
  return async (req, res, next) => {
    const route = new URL(req.url, "http://localhost").pathname;
    if (route !== API && !route.startsWith(API + "/")) return next();
    if (!isLocalRequest(req)) return json(res, 403, { error: "Access your wardrobe from the local website on this computer." });
    try {
      if (route === API && req.method === "GET") { await runner.reconcile(); return json(res, 200, { ...await store.getState(), codex: await runner.configuration() }); }
      if ([API + "/analyze", API + "/recommend"].includes(route) && req.method === "POST") {
        const input = await body(req), config = await runner.configuration();
        if (!config.available) return json(res, 503, { error: config.reason });
        await runner.reconcile();
        const job = await store.prepare("analysis", input.preferences, input.wardrobe ?? null, route.endsWith("recommend"));
        await runner.start(job.id);
        return json(res, 202, await store.getState());
      }
      return json(res, 404, { error: "Taste route not found." });
    } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : "Taste could not load or save this request. Please retry." }); }
  };
}
export function wardrobeTasteApi(options = {}) {
  let handler, runner;
  const attach = (server) => { server.middlewares.use((req, res, next) => handler(req, res, next)); server.httpServer?.once("close", () => { void runner.close(); }); };
  return {
    name: "wardrobe-taste",
    configResolved(config) { const store = createTasteStore(config.root); runner = createCodexTasteRunner(store, { command: options.env?.WARDROBE_CODEX_COMMAND }); handler = createTasteHandler(store, runner); },
    configureServer: attach, configurePreviewServer: attach,
  };
}
