#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenExtensions = new Set([
  ".mp4", ".mov", ".flv", ".mkv", ".mp3", ".wav", ".m4a", ".srt", ".vtt",
]);
const patterns = [
  /DOUBAO_API_KEY[ \t]*=[ \t]*[^ \t#\r\n][^\r\n]*/i,
  /TOS_SECRET_ACCESS_KEY[ \t]*=[ \t]*[^ \t#\r\n][^\r\n]*/i,
  /TOS_ACCESS_KEY_ID[ \t]*=[ \t]*[^ \t#\r\n][^\r\n]*/i,
  /(?:api[_-]?key|access[_-]?token|secret[_-]?key)[ \t]*[:=][ \t]*["']?[A-Za-z0-9_\-]{16,}/i,
];

async function walk(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(child));
    else files.push(child);
  }
  return files;
}

const errors = [];
const files = await walk(root);
for (const file of files) {
  const path = relative(root, file);
  if (/^\.env(?:\.|$)/.test(path) && path !== ".env.example") {
    errors.push(`${path}: environment file is not publishable`);
    continue;
  }
  if (forbiddenExtensions.has(extname(file).toLowerCase())) {
    errors.push(`${path}: media and transcript fixtures are not publishable`);
    continue;
  }
  const content = await readFile(file, "utf8").catch(() => "");
  if (patterns.some(pattern => pattern.test(content))) errors.push(`${path}: possible credential`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Public tree validated: ${files.length} files, no credentials or media fixtures found`);
