#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(skillRoot, "scripts", "runtime");

try {
  process.loadEnvFile(resolve(process.cwd(), ".env.local"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

function commandExists(command, args = ["-version"]) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

function doctor() {
  const checks = [
    ["node >= 20", Number(process.versions.node.split(".")[0]) >= 20],
    ["ffmpeg", commandExists("ffmpeg")],
    ["ffprobe", commandExists("ffprobe")],
    ["runtime", (() => {
      try {
        accessSync(join(runtimeRoot, "cli", "newcut.mjs"), constants.R_OK);
        return true;
      } catch {
        return false;
      }
    })()],
  ];
  for (const [name, passed] of checks) console.log(`${passed ? "OK" : "MISSING"} ${name}`);
  console.log(`${process.env.DOUBAO_API_KEY ? "OK" : "OPTIONAL"} Doubao credential configured`);
  console.log(`${process.env.TOS_BUCKET ? "OK" : "OPTIONAL"} TOS bucket configured`);
  if (checks.some(([, passed]) => !passed)) process.exitCode = 1;
}

const [command, ...args] = process.argv.slice(2);
if (command === "doctor") {
  doctor();
} else {
  const targets = {
    process: ["newcut.mjs", args],
    render: ["render-semantic-plan.mjs", args],
    "prepare-url": ["prepare-asr-url.mjs", args],
  };
  const target = targets[command];
  if (!target) {
    console.error("Usage: newcut.mjs <doctor|process|render|prepare-url> [...args]");
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [join(runtimeRoot, "cli", target[0]), ...target[1]], {
    env: process.env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}
