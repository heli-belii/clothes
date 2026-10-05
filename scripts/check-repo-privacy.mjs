import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

// Exact reviewed README screenshots are intentionally public, with owner consent.
// Retain original upstream hashes for auditing older committed history.
const publicScreenshots = new Map([
  ["docs/screenshots/gallery.png", [
    "c367cbbe25be3bc0844db8dda5a7715a960e4bb352c9fae62d03935721c41687",
    "db2823054e5608a2496a40c7793c2173090aefba5e8f844f693e517677708680",
  ]],
  ["docs/screenshots/editor.png", ["a8de72145d92cdf5dc19b39790ab042ff9d3bed66bbe639c971cec935c4f4942"]],
  ["docs/screenshots/outfits.png", ["9cdba4243485e22e5c7c025a786602041049dc04c63f03d3292f693984ac7a8e"]],
  ["docs/screenshots/taste.png", ["e13811e8227899d51d81f22b3dc9ca042477f024b6377fbaca16826a4aea303d"]],
  ["docs/screenshots/recommendations.png", ["409ce9874e3aa79dab6f7d94c34f1136c63cda728e71896416372905468e56bb"]],
  ["docs/screenshots/color-language.png", ["9669567ca67273b718a351b8cacbfdd9c897e0bfb4b21d3814aab08ac4e6bd4b"]],
]);
const privatePath = /(?:^|\/)(?:data|\.aws|\.codex|node_modules|dist)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;
const mediaPath = /\.(?:png|jpe?g|webp|hei[cf]|gif|avif|tiff?|mov|mp4|dng|bmp|svgz|zip|tar|gz|7z|pdf)$/i;
const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ["OpenAI key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["embedded image", /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/]{100,}/],
];
const git = (...args) => execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 });
const failures = new Set();
const checked = new Set();

function check(name, bytes, source) {
  const label = `${source}: ${name}`;
  if (name !== ".env.example" && privatePath.test(name)) failures.add(`${label} — private/generated file`);
  const approved = publicScreenshots.get(name);
  const image = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    || /^GIF8/.test(bytes.subarray(0, 4).toString())
    || (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP")
    || (bytes.subarray(4, 8).toString() === "ftyp");
  if (approved) {
    if (!approved.includes(createHash("sha256").update(bytes).digest("hex"))) failures.add(`${label} — screenshot differs from the reviewed version`);
  } else if (mediaPath.test(name) || image) {
    failures.add(`${label} — unreviewed media/archive; keep personal files in data/`);
  }
  if (!bytes.includes(0)) {
    const content = bytes.toString("utf8");
    for (const [kind, pattern] of secretPatterns) {
      if (pattern.test(content)) failures.add(`${label} — possible ${kind} (value redacted)`);
    }
  }
}

// Inspect committed history and staged contents, including files later deleted.
const commits = git("rev-list", "--all").toString().trim().split("\n").filter(Boolean);
function checkTree(tree, source) {
  for (const entry of tree.toString().split("\0").filter(Boolean)) {
    const separator = entry.indexOf("\t"), name = entry.slice(separator + 1);
    const [mode, type, oid] = entry.slice(0, separator).split(" ");
    if (type !== "blob") { failures.add(`${source}: ${name} — unreviewed submodule`); continue; }
    const key = `${oid}:${name}`;
    if (checked.has(key)) continue;
    checked.add(key);
    if (mode === "120000") failures.add(`${source}: ${name} — unreviewed symbolic link`);
    check(name, git("cat-file", "blob", oid), source);
  }
}
for (const commit of commits) checkTree(git("ls-tree", "-rz", commit), `history ${commit.slice(0, 8)}`);
const staged = git("ls-files", "--stage", "-z").toString().split("\0").filter(Boolean);
checkTree(Buffer.from(staged.map((entry) => entry.replace(/^(\d+) ([a-f0-9]+) \d+\t/, "$1 blob $2\t")).join("\0")), "index");

// Inspect edits and new non-ignored files before they are staged.
const workingFiles = new Set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").toString().split("\0").filter(Boolean));
for (const name of workingFiles) {
  try {
    if (lstatSync(name).isSymbolicLink()) failures.add(`working tree: ${name} — unreviewed symbolic link`);
    else check(name, readFileSync(name), "working tree");
  }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
if (failures.size) {
  console.error("Repository privacy check failed:\n" + [...failures].map((failure) => `- ${failure}`).join("\n"));
  console.error("Do not publish until these files are reviewed. Ignore rules do not remove files from Git history.");
  process.exitCode = 1;
} else {
  console.log(`Repository privacy check passed (${commits.length} available commits, index and ${workingFiles.size} working files).`);
  console.log("No private paths, unreviewed media or recognized secret patterns found. This is a guard, not a complete secret scanner.");
}
