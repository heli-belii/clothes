import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const CHATGPT_CONFIG = ["-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"'];
export function codexEnvironment(source = process.env) {
  const env = { ...source };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.CODEX_THREAD_ID;
  return env;
}

export function createCodexConfiguration({ command, env, runCommand = execute, requireImages = false }) {
  let readiness = null, expires = 0;
  return async () => {
    if (!readiness || Date.now() > expires) {
      expires = Date.now() + 30000;
      readiness = (async () => {
        try {
          const auth = await runCommand(command, [...CHATGPT_CONFIG, "login", "status"], { env, timeout: 15000, maxBuffer: 128 * 1024 });
          if (!/Logged in using ChatGPT/i.test(`${auth.stdout}\n${auth.stderr}`)) return { available: false, reason: "Sign in to Codex with your ChatGPT account on this Mac, then refresh." };
          if (requireImages) {
            const features = await runCommand(command, [...CHATGPT_CONFIG, "features", "list"], { env, timeout: 15000, maxBuffer: 128 * 1024 });
            if (!/^image_generation\s+\S+\s+true\s*$/m.test(features.stdout)) return { available: false, reason: "Built-in image generation is not enabled in this Codex installation. You can use the request in your Codex chat." };
          }
          return { available: true, billing: "chatgpt", reason: null };
        } catch { return { available: false, reason: "Codex is not ready on this Mac. Sign in with ChatGPT, then refresh." }; }
      })();
    }
    return readiness;
  };
}
