#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROCESS_MAX_BUFFER = Number(process.env.PROCESS_MAX_BUFFER || 100 * 1024 * 1024);

function usage() {
  return `
Usage:
  node cli/prepare-asr-url.mjs <video> [options]

Options:
  --output <dir>       Output directory, default output/asr-url/<timestamp>
  --bucket <name>      TOS bucket, default TOS_BUCKET
  --prefix <path>      TOS object prefix, default TOS_PREFIX or newcut/asr
  --expires <seconds>  Presigned URL expiry, default 3600
  --format <format>    Audio format, default mp3
  --tosutil <path>     tosutil binary, default tosutil

Required environment:
  TOS_BUCKET

Optional environment:
  TOS_PREFIX
  TOSUTIL_BIN

Before running, configure tosutil credentials:
  tosutil config
`.trim();
}

function parseArgs(argv) {
  const [video, ...rest] = argv;
  const options = {
    video,
    output: "",
    bucket: process.env.TOS_BUCKET || "",
    prefix: process.env.TOS_PREFIX || "newcut/asr",
    expires: Number(process.env.TOS_PRESIGN_EXPIRES || 3600),
    format: "mp3",
    tosutil: process.env.TOSUTIL_BIN || "tosutil",
  };

  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    const value = rest[i + 1];
    if (key === "--output") {
      options.output = value;
      i += 1;
    } else if (key === "--bucket") {
      options.bucket = value;
      i += 1;
    } else if (key === "--prefix") {
      options.prefix = value;
      i += 1;
    } else if (key === "--expires") {
      options.expires = Number(value);
      i += 1;
    } else if (key === "--format") {
      options.format = value;
      i += 1;
    } else if (key === "--tosutil") {
      options.tosutil = value;
      i += 1;
    } else {
      throw new Error(`未知参数：${key}\n\n${usage()}`);
    }
  }

  if (!video) throw new Error(usage());
  if (!options.bucket) throw new Error("缺少 TOS_BUCKET，或传 --bucket");
  if (!Number.isFinite(options.expires) || options.expires < 60) {
    throw new Error("--expires 必须大于等于 60 秒");
  }
  if (!["mp3", "wav", "m4a"].includes(options.format)) {
    throw new Error("--format 只支持 mp3、wav、m4a");
  }
  return options;
}

function safeName(value) {
  return String(value || "audio")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function objectPath(prefix, videoPath, format) {
  const cleanPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const base = safeName(basename(videoPath, extname(videoPath)));
  return `${cleanPrefix}/${stamp}_${base}.${format}`;
}

async function run(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    maxBuffer: PROCESS_MAX_BUFFER,
    ...options,
  });
  return `${stdout || ""}${stderr || ""}`.trim();
}

function extractUrl(text) {
  const urls = String(text || "").match(/https?:\/\/\S+/g) || [];
  if (!urls.length) return "";
  return urls[urls.length - 1].replace(/[)\],。]+$/, "");
}

async function extractAudio(videoPath, audioPath, format) {
  const codecArgs = format === "wav"
    ? ["-ac", "1", "-ar", "16000"]
    : ["-ac", "1", "-ar", "16000", "-b:a", "64k"];
  await run("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    ...codecArgs,
    audioPath,
  ], { timeout: 30 * 60 * 1000 });
}

async function uploadToTos(tosutil, audioPath, tosUri) {
  try {
    return await run(tosutil, ["cp", audioPath, tosUri], {
      timeout: 60 * 60 * 1000,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`找不到 ${tosutil}。请先安装火山 TOS CLI，并运行 tosutil config。`);
    }
    throw error;
  }
}

async function presignUrl(tosutil, tosUri, expires) {
  const attempts = [
    ["presign", tosUri, "-expires", String(expires)],
    ["presign", tosUri, "--expires", String(expires)],
    ["presign", tosUri, "-e", String(expires)],
    ["presign", tosUri],
  ];
  const errors = [];
  for (const args of attempts) {
    try {
      const output = await run(tosutil, args);
      const url = extractUrl(output);
      if (url) return { url, command: `${tosutil} ${args.join(" ")}`, output };
      errors.push(`${args.join(" ")}: 未找到 URL\n${output}`);
    } catch (error) {
      errors.push(`${args.join(" ")}: ${error.message}`);
    }
  }
  throw new Error(`生成预签名 URL 失败。\n${errors.join("\n\n")}\n\n请运行：${tosutil} help presign`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const videoPath = resolve(options.video);
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const outputDir = resolve(options.output || join(ROOT, "output", "asr-url", `job-${timestamp}`));
  await mkdir(outputDir, { recursive: true });

  const audioPath = join(outputDir, `audio.${options.format}`);
  const key = objectPath(options.prefix, videoPath, options.format);
  const tosUri = `tos://${options.bucket}/${key}`;

  console.log("1/4 提取音频");
  await extractAudio(videoPath, audioPath, options.format);

  console.log("2/4 上传到 TOS");
  const uploadOutput = await uploadToTos(options.tosutil, audioPath, tosUri);

  console.log("3/4 生成预签名 URL");
  const presign = await presignUrl(options.tosutil, tosUri, options.expires);

  console.log("4/4 写入结果");
  const result = {
    audioPath,
    tosUri,
    url: presign.url,
    expiresSeconds: options.expires,
    audioFormat: options.format,
    uploadOutput,
    presignCommand: presign.command,
  };
  await writeFile(join(outputDir, "asr-url.json"), JSON.stringify(result, null, 2), "utf-8");
  await writeFile(join(outputDir, "asr-url.env"), [
    `DOUBAO_ASR_AUDIO_URL=${presign.url}`,
    `DOUBAO_ASR_AUDIO_FORMAT=${options.format}`,
    "",
  ].join("\n"), "utf-8");

  console.log(`完成：${outputDir}`);
  console.log(`DOUBAO_ASR_AUDIO_URL=${presign.url}`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
