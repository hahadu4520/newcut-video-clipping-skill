import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { parseJsonTranscript, parseReadableTranscript, readTranscript, writeTranscriptArtifacts } from "../transcript-utils.mjs";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const DEFAULT_SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const DEFAULT_QUERY_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";
const DEFAULT_RESOURCE_ID = "volc.seedasr.auc";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function fillCommandTemplate(template, values) {
  return template
    .replaceAll("{input_path}", shellQuote(values.inputPath))
    .replaceAll("{output_dir}", shellQuote(values.outputDir))
    .replaceAll("{language}", shellQuote(values.language || "zh"))
    .replaceAll("{model}", shellQuote(values.model || "seed-asr"));
}

async function findTranscriptOutput(outputDir) {
  const files = await readdir(outputDir);
  const preferred = [
    "transcript.srt",
    "transcript.vtt",
    "transcript.json",
    "transcript.txt",
    "audio.srt",
    "audio.json",
    "audio.txt",
  ];
  const found = preferred.find(file => files.includes(file))
    || files.find(file => /\.(srt|vtt|json|txt)$/i.test(file));
  if (!found) throw new Error(`豆包本地命令没有在 ${outputDir} 生成转录文件`);
  return join(outputDir, found);
}

async function transcribeWithLocalCommand(videoPath, outputDir, options) {
  const command = options.command || process.env.DOUBAO_ASR_COMMAND;
  if (!command) {
    throw new Error("使用 doubao 本地命令模式需要设置 --asr-command 或 DOUBAO_ASR_COMMAND");
  }
  await mkdir(outputDir, { recursive: true });
  const rendered = fillCommandTemplate(command, {
    inputPath: videoPath,
    outputDir,
    language: options.language,
    model: options.model,
  });
  await writeFile(join(outputDir, "doubao-command.txt"), rendered, "utf-8");
  await execAsync(rendered, {
    cwd: outputDir,
    timeout: Number(process.env.DOUBAO_ASR_COMMAND_TIMEOUT_MS || 4 * 60 * 60 * 1000),
    maxBuffer: Number(process.env.PROCESS_MAX_BUFFER || 100 * 1024 * 1024),
  });
  const transcriptPath = await findTranscriptOutput(outputDir);
  const rows = await readTranscript(transcriptPath);
  await writeTranscriptArtifacts(rows, outputDir, "doubao-transcript");
  return rows;
}

function getHeader(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === target) return value;
  }
  return "";
}

function extractRowsFromDoubaoResult(body) {
  const result = body?.result || body;
  const utterances = result?.utterances || result?.segments || body?.utterances || body?.segments;
  if (Array.isArray(utterances) && utterances.length) {
    return utterances
      .map((item, index) => {
        const start = Number(item.start_time ?? item.start ?? item.start_ms);
        const end = Number(item.end_time ?? item.end ?? item.end_ms);
        const usesMilliseconds = item.start_time != null || item.end_time != null
          || item.start_ms != null || item.end_ms != null;
        const scale = usesMilliseconds || Math.max(start || 0, end || 0) > 100000 ? 1000 : 1;
        return {
          start: Number.isFinite(start) ? start / scale : index * 2,
          end: Number.isFinite(end) ? end / scale : undefined,
          text: String(item.text || item.content || "").trim(),
        };
      })
      .filter(row => row.text);
  }

  if (typeof result?.text === "string" && result.text.trim()) {
    const readable = parseReadableTranscript(result.text);
    if (readable.length) return readable;
    return result.text
      .split(/[。！？!?]\s*/)
      .map((text, index) => ({ start: index * 4, end: index * 4 + 4, text: text.trim() }))
      .filter(row => row.text);
  }

  if (typeof body?.text === "string" && body.text.trim()) {
    const readable = parseReadableTranscript(body.text);
    if (readable.length) return readable;
    return [{ start: 0, text: body.text.trim() }];
  }

  const parsedJsonRows = parseJsonTranscript(JSON.stringify(body));
  if (parsedJsonRows.length) return parsedJsonRows;
  throw new Error("无法从豆包 ASR 返回结果中解析转录文本");
}

async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { response, text, json };
}

function buildAuthHeaders() {
  if (process.env.DOUBAO_API_KEY) {
    return { "X-Api-Key": process.env.DOUBAO_API_KEY };
  }

  const appKey = process.env.DOUBAO_APP_KEY;
  const accessToken = process.env.DOUBAO_ACCESS_TOKEN;
  if (appKey && accessToken) {
    return {
      "X-Api-App-Key": appKey,
      "X-Api-Access-Key": accessToken,
    };
  }
  if (appKey) return { "X-Api-Key": appKey };

  throw new Error(
    "缺少豆包语音凭证：新版控制台请填写 DOUBAO_API_KEY；旧版控制台才填写 DOUBAO_APP_KEY 和 DOUBAO_ACCESS_TOKEN",
  );
}

async function buildAudioInput(videoPath, outputDir, audioUrl) {
  if (audioUrl) {
    const format = (process.env.DOUBAO_ASR_AUDIO_FORMAT
      || extname(new URL(audioUrl).pathname).slice(1)
      || "mp3").toLowerCase();
    return { format, url: audioUrl };
  }

  const audioPath = join(outputDir, "doubao-input.mp3");
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-b:a", "64k",
    audioPath,
  ], {
    timeout: 30 * 60 * 1000,
    maxBuffer: Number(process.env.PROCESS_MAX_BUFFER || 100 * 1024 * 1024),
  });

  const audioBuffer = await readFile(audioPath);
  const maxBytes = Number(process.env.DOUBAO_ASR_LOCAL_MAX_BYTES || 90 * 1024 * 1024);
  if (audioBuffer.length > maxBytes) {
    throw new Error(
      `压缩后的音频为 ${Math.ceil(audioBuffer.length / 1024 / 1024)}MB，超过本地直传限制；请改用 TOS 临时 URL`,
    );
  }
  return { format: "mp3", data: audioBuffer.toString("base64") };
}

async function transcribeWithHttp(videoPath, outputDir, options) {
  const audioUrl = options.audioUrl || process.env.DOUBAO_ASR_AUDIO_URL;

  const submitUrl = process.env.DOUBAO_ASR_SUBMIT_URL || DEFAULT_SUBMIT_URL;
  const queryUrl = process.env.DOUBAO_ASR_QUERY_URL || DEFAULT_QUERY_URL;
  const resourceId = process.env.DOUBAO_ASR_RESOURCE_ID || DEFAULT_RESOURCE_ID;
  const requestId = process.env.DOUBAO_ASR_REQUEST_ID || randomUUID();
  const authHeaders = buildAuthHeaders();
  const audioInput = await buildAudioInput(videoPath, outputDir, audioUrl);

  const commonHeaders = {
    ...authHeaders,
    "X-Api-Resource-Id": resourceId,
    "X-Api-Request-Id": requestId,
  };

  const submitBody = {
    user: { uid: process.env.DOUBAO_ASR_UID || "newcut-local" },
    audio: audioInput,
    request: {
      model_name: process.env.DOUBAO_ASR_MODEL_NAME || "bigmodel",
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
      show_utterances: true,
    },
  };

  const submit = await postJson(submitUrl, {
    ...commonHeaders,
    "X-Api-Sequence": "-1",
  }, submitBody);
  await writeFile(join(outputDir, "doubao-submit-response.json"), JSON.stringify({
    status: submit.response.status,
    headers: Object.fromEntries(submit.response.headers.entries()),
    body: submit.json,
  }, null, 2), "utf-8");

  const submitCode = getHeader(submit.response.headers, "x-api-status-code");
  if (!submit.response.ok || (submitCode && submitCode !== "20000000")) {
    throw new Error(`豆包 ASR 提交失败：HTTP ${submit.response.status}, X-Api-Status-Code ${submitCode || "missing"}`);
  }

  const pollIntervalMs = Number(process.env.DOUBAO_ASR_POLL_INTERVAL_MS || 5000);
  const timeoutMs = Number(process.env.DOUBAO_ASR_TIMEOUT_MS || 60 * 60 * 1000);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    const query = await postJson(queryUrl, commonHeaders, {});
    const statusCode = getHeader(query.response.headers, "x-api-status-code");
    await writeFile(join(outputDir, "doubao-query-latest.json"), JSON.stringify({
      status: query.response.status,
      statusCode,
      headers: Object.fromEntries(query.response.headers.entries()),
      body: query.json,
    }, null, 2), "utf-8");

    if (statusCode === "20000000") {
      const rows = extractRowsFromDoubaoResult(query.json);
      await writeFile(join(outputDir, "doubao-result.json"), JSON.stringify(query.json, null, 2), "utf-8");
      await writeTranscriptArtifacts(rows, outputDir, "doubao-transcript");
      return rows;
    }
    if (statusCode === "20000001" || statusCode === "20000002") continue;
    throw new Error(`豆包 ASR 查询失败：HTTP ${query.response.status}, X-Api-Status-Code ${statusCode || "missing"}`);
  }

  throw new Error(`豆包 ASR 超时：${Math.round(timeoutMs / 1000)} 秒内没有完成`);
}

export async function transcribeWithDoubao(videoPath, outputDir, options = {}) {
  const mode = process.env.DOUBAO_ASR_MODE || (options.command || process.env.DOUBAO_ASR_COMMAND ? "command" : "http");
  const providerDir = join(outputDir, "doubao");
  await mkdir(providerDir, { recursive: true });
  await writeFile(join(providerDir, "input.json"), JSON.stringify({
    videoPath,
    inputFile: basename(videoPath),
    mode,
    hasAudioUrl: Boolean(options.audioUrl || process.env.DOUBAO_ASR_AUDIO_URL),
    resourceId: process.env.DOUBAO_ASR_RESOURCE_ID || DEFAULT_RESOURCE_ID,
  }, null, 2), "utf-8");

  const rows = mode === "command"
    ? await transcribeWithLocalCommand(videoPath, providerDir, options)
    : await transcribeWithHttp(videoPath, providerDir, options);
  if (!rows.length) throw new Error("豆包 ASR 没有返回有效转录文本");
  return rows;
}
