import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checker = fileURLToPath(new URL("../scripts/check-repo-privacy.mjs", import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wardrobe-privacy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "--quiet");
  git("config", "user.name", "Privacy test"); git("config", "user.email", "test@example.invalid");
  const write = (name, value) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), value); };
  const run = () => spawnSync(process.execPath, [checker], { cwd: root, encoding: "utf8" });
  write("README.md", "Public source repository\n"); git("add", "README.md"); git("commit", "--quiet", "-m", "Safe starting point");
  return { root, git, write, run };
}

test("privacy audit allows source and an empty credential template", (t) => {
  const { git, write, run } = fixture(t);
  write(".env.example", "OPENAI_API_KEY=\n"); git("add", ".env.example");
  assert.equal(run().status, 0);
});

test("privacy audit blocks staged personal data and env files", (t) => {
  const { git, write, run } = fixture(t);
  write("data/library.json", "[]"); write(".env", "SETTING=private\n"); git("add", "data/library.json", ".env");
  const result = run(); assert.equal(result.status, 1);
  assert.match(result.stderr, /data\/library.json/); assert.match(result.stderr, /private\/generated file/);
});

test("privacy audit detects photos renamed to a text extension", (t) => {
  const { git, write, run } = fixture(t);
  write("photo.txt", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])); git("add", "photo.txt");
  assert.equal(run().status, 1);
});

test("privacy audit checks new non-ignored files before staging", (t) => {
  const { write, run } = fixture(t);
  write("new-file.txt", Buffer.from([255, 216, 255, 0]));
  const result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /working tree: new-file.txt/);
});

test("privacy audit finds deleted private files in committed history", (t) => {
  const { git, write, run } = fixture(t);
  write("data/private.txt", "Personal record\n"); git("add", "data/private.txt"); git("commit", "--quiet", "-m", "Accidental data");
  git("rm", "data/private.txt"); git("commit", "--quiet", "-m", "Delete data");
  const result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /history .*data\/private.txt/);
});

test("privacy audit checks unstaged secrets and redacts values", (t) => {
  const { write, run } = fixture(t);
  const fakeKey = ["sk", "proj", "A".repeat(40)].join("-");
  write("README.md", fakeKey);
  const result = run(); assert.equal(result.status, 1);
  assert.match(result.stderr, /possible OpenAI key/); assert.ok(!result.stderr.includes(fakeKey));
});

test("privacy audit allows only unchanged public upstream screenshots", (t) => {
  const { git, write, run } = fixture(t);
  const name = "docs/screenshots/gallery.png";
  write(name, readFileSync(new URL(`../${name}`, import.meta.url))); git("add", name);
  assert.equal(run().status, 0);
  write(name, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
  const result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /differs from the reviewed public original/);
});
