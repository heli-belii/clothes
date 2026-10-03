import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile } from "node:fs/promises";
import path from "node:path";

const execute = promisify(execFile);
const CHATGPT_CONFIG = ["-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"'];
const fail = (message, status = 503) => { throw Object.assign(new Error(message), { status }); };

export function codexEnvironment(source = process.env) {
  const env = { ...source };
  // This runner uses ChatGPT sign-in even when the optional importer has an API key.
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.CODEX_THREAD_ID;
  return env;
}

export function createCodexOutfitGenerator(store, options = {}) {
  const command = options.command || process.env.WARDROBE_CODEX_COMMAND || "codex";
  const env = codexEnvironment(options.env || process.env);
  const runCommand = options.execute || execute, spawnProcess = options.spawn || spawn;
  const alive = options.alive || ((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
  let readiness = null, expires = 0, active = null, closed = false;

  async function configuration() {
    if (!readiness || Date.now() > expires) {
      expires = Date.now() + 30000;
      readiness = (async () => {
        try {
          const auth = await runCommand(command, [...CHATGPT_CONFIG, "login", "status"], { env, timeout: 15000, maxBuffer: 128 * 1024 });
          if (!/Logged in using ChatGPT/i.test(`${auth.stdout}\n${auth.stderr}`)) return { available: false, reason: "Sign in to Codex with your ChatGPT account on this Mac, then refresh." };
          const features = await runCommand(command, [...CHATGPT_CONFIG, "features", "list"], { env, timeout: 15000, maxBuffer: 128 * 1024 });
          if (!/^image_generation\s+\S+\s+true\s*$/m.test(features.stdout)) return { available: false, reason: "Built-in image generation is not enabled in this Codex installation. You can use the request in your Codex chat." };
          return { available: true, billing: "chatgpt", reason: null };
        } catch {
          return { available: false, reason: "Codex is not ready on this Mac. Sign in with ChatGPT, or open the prepared request in the Codex app." };
        }
      })();
    }
    return readiness;
  }

  async function reconcile() {
    const state = await store.getState();
    for (const look of state.looks) {
      const generation = look.request?.generation;
      if (look.request?.status === "accepted" || generation?.status !== "running" || active?.id === look.request.id) continue;
      if (!generation.pid || !alive(generation.pid)) await store.setGeneration(look.request.id, { status: "failed", message: "Generation was interrupted. Click Generate with Codex to retry.", finishedAt: new Date().toISOString(), pid: null });
    }
  }

  async function launch(entry) {
    const job = await store.request(entry.id);
    if (job.status === "accepted") return job;
    if (job.generation?.status === "running" && job.generation.pid && alive(job.generation.pid)) return job;
    const state = await store.getState();
    if (state.looks.some((look) => look.request?.id !== job.id && look.request?.status !== "accepted" && look.request?.generation?.status === "running" && look.request.generation.pid && alive(look.request.generation.pid))) fail("Another outfit is being generated. Wait for it to finish before starting this one.", 409);
    const config = await configuration();
    if (!config.available) fail(config.reason);
    if (closed) fail("The wardrobe server is restarting. Refresh and try again.");

    const dir = store.requestDir(job.id), log = path.join(dir, "generation.log");
    const args = [...CHATGPT_CONFIG, "exec", "--json", "--sandbox", "workspace-write", "--approve-for-me", "--cd", store.root];
    for (const reference of job.references) args.push("--image", path.resolve(store.root, reference));
    args.push("-");
    const prompt = `$imagegen ${job.handoff}\n\nThis is an explicitly requested outfit, not a request to curate different looks. Read ${path.relative(store.root, path.join(dir, "request.json"))} and AGENTS.md. Inspect every identity reference and every selected individual garment snapshot. Use only the built-in image generation tool and the exact saved prompt and references. Use the current ChatGPT sign-in; never use an API key, image API, Python image-generation CLI, subprocess API client, or other generation fallback. If the built-in tool is unavailable or limits are reached, stop and report the issue. Review identity and garment accuracy before attaching the accepted PNG with the provided helper. Only modify files in this request directory; do not modify application code, wardrobe records, preferences, or source photos. One accepted modeled photo is the deliverable. Attach it before finishing.\n`;
    const child = spawnProcess(command, args, { cwd: store.root, env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    entry.child = child;
    let spawnError = null, pending = "", finishing = false;
    const logLine = (value) => appendFile(log, `${new Date().toISOString()} ${value}\n`).catch(() => {});
    child.on("error", (error) => { spawnError = error; });
    child.stdin.on("error", () => {});
    child.stderr.on("data", (bytes) => { logLine(bytes.toString().slice(0, 4000)); });
    child.stdout.on("data", (bytes) => {
      pending += bytes.toString();
      const lines = pending.split("\n"); pending = lines.pop();
      if (pending.length > 12 * 1024 * 1024) pending = "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "thread.started") logLine(`Codex thread ${event.thread_id}`);
          else if (event.type === "error" || event.type === "turn.failed") logLine(`Codex error: ${JSON.stringify(event.message || event.error || "Turn failed").slice(0, 3000)}`);
          else if (event.type?.startsWith("item.")) logLine(`${event.type}: ${event.item?.type || "work"}`);
        } catch { /* Do not expose raw model output or image payloads in the UI. */ }
      }
    });
    entry.finished = new Promise((resolve) => {
      child.on("close", async (code) => {
        if (finishing) return; finishing = true; clearTimeout(entry.timer);
        try {
          const result = await store.request(job.id);
          if (result.status === "accepted") await store.setGeneration(job.id, { status: "completed", message: "Your modeled photo is ready.", finishedAt: new Date().toISOString(), pid: null });
          else await store.setGeneration(job.id, { status: "failed", message: entry.cancelled ? "Generation was interrupted when the server stopped. You can retry." : spawnError ? "Codex could not start. Check your local Codex installation and try again." : code ? "Codex could not finish this photo. Check your sign-in or usage limits, or open the request in Codex." : "Codex finished without attaching a photo. Open the request in Codex or try again.", finishedAt: new Date().toISOString(), pid: null });
        } catch (error) { await logLine(`Could not update generation status: ${error.message}`); }
        finally { if (active === entry) active = null; resolve(); }
      });
    });
    await store.setGeneration(job.id, { status: "running", message: "Codex is creating and reviewing your modeled photo…", startedAt: new Date().toISOString(), finishedAt: null, pid: child.pid || null });
    entry.timer = setTimeout(() => { entry.cancelled = true; child.kill("SIGTERM"); }, options.timeoutMs || 20 * 60 * 1000);
    entry.timer.unref?.();
    child.stdin.end(prompt);
    return store.request(job.id);
  }

  return {
    configuration, reconcile,
    start(id) {
      // Reserve before awaiting anything, so double clicks never launch two generations.
      if (active) {
        if (active.id === id) return active.started;
        return Promise.reject(Object.assign(new Error("Another outfit is being generated. Wait for it to finish before starting this one."), { status: 409 }));
      }
      const entry = { id, child: null, finished: null, timer: null, cancelled: false };
      active = entry;
      entry.started = launch(entry).then((job) => { if (!entry.child && active === entry) active = null; return job; }).catch((error) => { if (active === entry) active = null; throw error; });
      return entry.started;
    },
    async idle() { const entry = active; if (!entry) return; await entry.started.catch(() => {}); await entry.finished; },
    async close() { closed = true; const entry = active; if (!entry) return; entry.cancelled = true; entry.child?.kill("SIGTERM"); await entry.started.catch(() => {}); entry.child?.kill("SIGTERM"); await entry.finished; },
  };
}
