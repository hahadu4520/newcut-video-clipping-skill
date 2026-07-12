#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  readTranscript,
  secondsToClock,
  timeToSeconds,
  transcribeAudio,
} from "../packages/newcut-core/src/index.mjs";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROCESS_MAX_BUFFER = Number(process.env.PROCESS_MAX_BUFFER || 100 * 1024 * 1024);

try {
  process.loadEnvFile(join(ROOT, ".env.local"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

function usage() {
  return `
Usage:
  node cli/newcut.mjs process <video> [options]

Options:
  --transcript <path>       Existing transcript: SRT/VTT/JSON/TXT
  --output <dir>            Output directory
  --asr-provider <name>     whisper or doubao, default whisper
  --whisper-model <name>    Whisper model, default tiny
  --doubao-audio-url <url>  Optional production audio URL
  --asr-command <template>  Optional provider command adapter
  --target-count <number>   Preferred final clip count; never used as a recall filter
  --target-duration <sec>   Preferred duration; never used to truncate a viewpoint
  --start <time>            Optional review hint, not a selection boundary
  --end <time>              Optional review hint, not a selection boundary

This command only transcribes and creates semantic-review materials.
Highlight selection must be performed semantically, then rendered with:
  node cli/render-semantic-plan.mjs --video <video> --transcript <semantic-source.json> --plan <plan.json> --output <dir>
`.trim();
}

function parseArgs(argv) {
  const [command, video, ...rest] = argv;
  const options = {
    command,
    video,
    transcript: "",
    output: "",
    asrProvider: "whisper",
    whisperModel: "tiny",
    doubaoAudioUrl: "",
    asrCommand: "",
    targetCount: 6,
    targetDuration: 30,
    start: "",
    end: "",
  };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (key === "--transcript") options.transcript = value;
    else if (key === "--output") options.output = value;
    else if (key === "--asr-provider") options.asrProvider = value;
    else if (key === "--whisper-model") options.whisperModel = value;
    else if (key === "--doubao-audio-url") options.doubaoAudioUrl = value;
    else if (key === "--asr-command") options.asrCommand = value;
    else if (key === "--target-count") options.targetCount = Number(value);
    else if (key === "--target-duration") options.targetDuration = Number(value);
    else if (key === "--start") options.start = value;
    else if (key === "--end") options.end = value;
    else if (key === "--help" || key === "-h") options.help = true;
    else throw new Error(`未知参数：${key}`);
    if (!["--help", "-h"].includes(key)) index += 1;
  }
  return options;
}

function validateOptions(options) {
  if (options.help) return;
  if (options.command !== "process" || !options.video) throw new Error(usage());
  if (!Number.isInteger(options.targetCount) || options.targetCount < 1) {
    throw new Error("--target-count 必须是正整数");
  }
  if (!Number.isFinite(options.targetDuration) || options.targetDuration <= 0) {
    throw new Error("--target-duration 必须大于 0");
  }
  if (!new Set(["whisper", "doubao"]).has(options.asrProvider)) {
    throw new Error("--asr-provider 只支持 whisper 或 doubao");
  }
}

async function probeVideo(videoPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size:stream=index,codec_type,codec_name,width,height",
    "-of", "json",
    videoPath,
  ], { maxBuffer: PROCESS_MAX_BUFFER });
  return JSON.parse(stdout);
}

function normalizeTranscript(rows, sourceDuration) {
  const sorted = rows
    .map(row => ({
      start: Math.max(0, Number(row.start) || 0),
      end: row.end == null ? undefined : Math.max(0, Number(row.end) || 0),
      text: String(row.text || "").replace(/\s+/g, " ").trim(),
    }))
    .filter(row => row.text)
    .sort((a, b) => a.start - b.start);
  return sorted.map((row, index) => {
    const nextStart = sorted[index + 1]?.start;
    const fallbackEnd = nextStart == null ? Math.min(sourceDuration, row.start + 4) : nextStart;
    return {
      ...row,
      end: Math.max(row.start + 0.001, Math.min(sourceDuration, row.end ?? fallbackEnd)),
    };
  });
}

function syntheticSemanticSource(rows) {
  return {
    result: {
      utterances: rows.map(row => ({
        start_time: Math.round(row.start * 1000),
        end_time: Math.round(row.end * 1000),
        text: row.text,
        words: [],
      })),
    },
  };
}

async function loadSemanticSource(outputDir, rows) {
  const doubaoResult = join(outputDir, "doubao", "doubao-result.json");
  try {
    const payload = JSON.parse(await readFile(doubaoResult, "utf-8"));
    if (Array.isArray(payload?.result?.utterances)) return payload;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return syntheticSemanticSource(rows);
}

function semanticRows(payload) {
  return (payload?.result?.utterances || []).map((row, rawIndex) => ({
    rawIndex,
    startMs: Number(row.start_time),
    endMs: Number(row.end_time),
    text: String(row.text || "").trim(),
  }));
}

function fullTranscriptMarkdown(videoPath, rows, sourceDuration) {
  const output = [
    "# 完整转录稿",
    "",
    `- 源视频：${videoPath}`,
    `- 视频时长：${secondsToClock(sourceDuration, true)}`,
    `- 有效转录句数：${rows.length}`,
    "- 此文件用于人工核对内容；高光模型应使用带 U 编号的《语义审阅稿》生成计划。",
    "",
  ];
  let section = -1;
  for (const row of rows) {
    const nextSection = Math.floor(row.start / 300);
    if (nextSection !== section) {
      section = nextSection;
      output.push(
        `## ${secondsToClock(section * 300)} - ${secondsToClock(Math.min(sourceDuration, (section + 1) * 300))}`,
        "",
      );
    }
    output.push(`- [${secondsToClock(row.start, true)} - ${secondsToClock(row.end, true)}] ${row.text}`);
  }
  output.push("");
  return output.join("\n");
}

function semanticReviewMarkdown(videoPath, rows, sourceDuration) {
  const spoken = rows.filter(row => row.text);
  const output = [
    "# 全量语义审阅稿",
    "",
    `- 源视频：${videoPath}`,
    `- 视频时长：${secondsToClock(sourceDuration, true)}`,
    `- 原始句段：${rows.length}`,
    `- 有文字句段：${spoken.length}`,
    "- U 编号是最终计划唯一允许引用的边界标识；不得手填四舍五入后的秒数。",
    "",
  ];
  let section = -1;
  for (const row of spoken) {
    const nextSection = Math.floor(row.startMs / 300000);
    if (nextSection !== section) {
      section = nextSection;
      output.push(
        `## ${secondsToClock(section * 300)} - ${secondsToClock(Math.min(sourceDuration, (section + 1) * 300))}`,
        "",
      );
    }
    output.push(
      `- [U${String(row.rawIndex).padStart(4, "0")}] `
      + `[${secondsToClock(row.startMs / 1000, true)} - ${secondsToClock(row.endMs / 1000, true)}] ${row.text}`,
    );
  }
  output.push("");
  return output.join("\n");
}

function selectionBrief(options, files) {
  return {
    version: 2,
    selectionMode: "semantic-only",
    hardRuleScoringEnabled: false,
    files,
    preferences: {
      preferredClipCount: options.targetCount,
      preferredDurationSeconds: options.targetDuration,
      note: "数量和时长只影响最终排序，不得参与观点召回、完整性判断或边界截断。",
      reviewStartHint: options.start ? timeToSeconds(options.start) : null,
      reviewEndHint: options.end ? timeToSeconds(options.end) : null,
    },
    requiredProcess: [
      "通读全量语义审阅稿并为每个时间章节建立话题地图",
      "先枚举所有值得传播的完整观点，不限制数量和时长",
      "对每个观点向前补齐必要背景，向后读到论证、案例和最终回扣全部完成",
      "完成全时间轴覆盖检查后，再根据用户偏好选择最终片段",
      "为每个最终片段从正文中选择一句真实原话作为钩子，并说明吸引力来源",
      "检查最终片段中的整句重复、口误和无效重新起句，并用 U 编号写入 cleanup.removeUtteranceRanges",
      "只使用 startUtteranceIndex/endUtteranceIndex 输出语义计划",
    ],
    forbiddenMethods: [
      "关键词命中打分",
      "固定长度滑动窗口",
      "按停顿直接认定观点结束",
      "在召回阶段使用最大时长过滤",
      "只保存高分候选而丢弃其余时间轴",
      "手填或四舍五入时间戳",
    ],
    planSchema: {
      index: "number",
      title: "string",
      titleLines: ["完整的话题行", "完整的结论行"],
      startUtteranceIndex: "number",
      endUtteranceIndex: "number",
      coreViewpoint: "string",
      argumentChain: ["必要背景", "核心主张", "论据或案例", "最终回扣"],
      hook: {
        startUtteranceIndex: "number",
        endUtteranceIndex: "number",
        appeal: ["反常识/悬念/强情绪/强判断/明确利益/具体结果"],
        reason: "为什么这句最能抓住观众",
      },
      cleanup: {
        enabled: "boolean",
        removeUtteranceRanges: [{
          startUtteranceIndex: "number",
          endUtteranceIndex: "number",
          reason: "为什么属于无效重复、口误或重新起句",
        }],
        removeWordRanges: [{
          startUtteranceIndex: "number",
          startWordIndex: "number",
          endUtteranceIndex: "number",
          endWordIndex: "number",
          reason: "为什么这几个字属于口头禅、口误或废弃重说",
        }],
      },
      subtitleCorrections: [{
        utteranceIndex: "number",
        startWordIndex: "number",
        endWordIndex: "number",
        replacement: "上下文确认后的正确文字",
        reason: "为什么确认是 ASR 错别字而不是说话人原话",
      }],
      reason: "string",
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateOptions(options);
  if (options.help) {
    console.log(usage());
    return;
  }

  const videoPath = resolve(options.video);
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const outputDir = resolve(options.output || join(ROOT, "output", "newcut", `job-${timestamp}`));
  await mkdir(outputDir, { recursive: true });

  console.log("1/4 读取视频信息");
  const sourceInfo = await probeVideo(videoPath);
  const sourceDuration = Number(sourceInfo.format?.duration || 0);

  console.log("2/4 获取完整转录");
  const rawTranscript = options.transcript
    ? await readTranscript(resolve(options.transcript))
    : await transcribeAudio(videoPath, outputDir, options);
  const transcriptRows = normalizeTranscript(rawTranscript, sourceDuration);
  if (!transcriptRows.length) throw new Error("没有可用转录文本");

  console.log("3/4 生成全量语义审阅材料");
  const semanticSource = await loadSemanticSource(outputDir, transcriptRows);
  const reviewRows = semanticRows(semanticSource);
  const files = {
    completeTranscript: "完整转录稿.md",
    semanticReview: "语义审阅稿.md",
    semanticSource: "semantic-source.json",
    selectionBrief: "semantic-selection-brief.json",
    planTemplate: "semantic-plan.template.json",
  };
  await writeFile(join(outputDir, "source-info.json"), JSON.stringify(sourceInfo, null, 2), "utf-8");
  await writeFile(join(outputDir, "transcript.json"), JSON.stringify(transcriptRows, null, 2), "utf-8");
  await writeFile(join(outputDir, files.semanticSource), JSON.stringify(semanticSource, null, 2), "utf-8");
  await writeFile(
    join(outputDir, files.completeTranscript),
    fullTranscriptMarkdown(basename(videoPath), transcriptRows, sourceDuration),
    "utf-8",
  );
  await writeFile(
    join(outputDir, files.semanticReview),
    semanticReviewMarkdown(basename(videoPath), reviewRows, sourceDuration),
    "utf-8",
  );
  await writeFile(
    join(outputDir, files.selectionBrief),
    JSON.stringify(selectionBrief(options, files), null, 2),
    "utf-8",
  );
  await writeFile(join(outputDir, files.planTemplate), "[]\n", "utf-8");

  console.log("4/4 等待模型完成全量语义选择");
  await writeFile(join(outputDir, "report.md"), [
    "# NewCut 语义切片任务",
    "",
    "- 状态：等待模型阅读《语义审阅稿》并生成 semantic plan",
    "- 旧关键词打分、固定窗口、时长上限和停顿闭合规则：已停用",
    `- 偏好数量：${options.targetCount}（仅作最终选择参考）`,
    `- 偏好时长：约 ${options.targetDuration}s（不得截断完整观点）`,
    "",
    "生成计划后使用：",
    "",
    "```bash",
    `node cli/render-semantic-plan.mjs --video ${videoPath} --transcript ${join(outputDir, files.semanticSource)} --plan <semantic-plan.json> --output <clips-dir>`,
    "```",
    "",
  ].join("\n"), "utf-8");
  console.log(`完成语义审阅材料：${outputDir}`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
