#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  allTimedWords,
  applyBoundaryPadding,
  buildCleanupPlan,
  buildEditTimeline,
  captionsToAss,
  groupCaptions,
  mapWordsToOutput,
  readSourceUtterances,
  resolveUtteranceRange,
  spokenUtterances,
  validateEditTimeline,
  validateSemanticPlan,
} from "../packages/newcut-core/src/index.mjs";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 100 * 1024 * 1024;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    options[argv[index]?.replace(/^--/, "")] = argv[index + 1];
  }
  for (const required of ["video", "transcript", "plan", "output"]) {
    if (!options[required]) throw new Error(`缺少 --${required}`);
  }
  return options;
}

function safeName(value) {
  return String(value || "clip")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function parseRate(value) {
  const [numerator, denominator] = String(value || "24/1").split("/").map(Number);
  return denominator ? numerator / denominator : numerator || 24;
}

async function probeVideo(videoPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=index,codec_type,width,height,avg_frame_rate,sample_rate,channel_layout",
    "-of", "json",
    videoPath,
  ], { maxBuffer: MAX_BUFFER });
  const data = JSON.parse(stdout);
  const video = data.streams.find(stream => stream.codec_type === "video");
  const audio = data.streams.find(stream => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("源文件必须同时包含视频流和音频流");
  return {
    duration: Number(data.format?.duration),
    width: Number(video.width),
    height: Number(video.height),
    fps: parseRate(video.avg_frame_rate),
    sampleRate: Number(audio.sample_rate || 44100),
    channelLayout: audio.channel_layout || "stereo",
  };
}

function resolveSemanticSelections(plan, utterances) {
  return plan.map((item, index) => {
    const range = resolveUtteranceRange(
      utterances,
      item.startUtteranceIndex,
      item.endUtteranceIndex,
      `计划第 ${index + 1} 段`,
    );
    return {
      ...item,
      index: item.index || index + 1,
      start: range.startMs / 1000,
      end: range.endMs / 1000,
      text: range.text,
    };
  });
}

function resolveHook(item, utterances, bodyRange) {
  if (!item.hook) return null;
  const range = resolveUtteranceRange(
    utterances,
    item.hook.startUtteranceIndex,
    item.hook.endUtteranceIndex,
    `切片 ${item.index} 的钩子`,
  );
  const startMs = Math.max(bodyRange.startMs, range.startMs - 120);
  const endMs = Math.min(bodyRange.endMs, range.endMs + 180);
  if (startMs >= endMs) throw new Error(`切片 ${item.index} 的钩子不在正文范围内`);
  return {
    startMs,
    endMs,
    semanticStartMs: range.startMs,
    semanticEndMs: range.endMs,
    text: range.text,
    reason: item.hook.reason || "",
    appeal: item.hook.appeal || [],
  };
}

function resolveCleanupConfig(item, utterances, hookRange) {
  const cleanup = item.cleanup || {};
  const semanticRemovals = (cleanup.removeUtteranceRanges || []).map((range, index) => {
    const resolved = resolveUtteranceRange(
      utterances,
      range.startUtteranceIndex,
      range.endUtteranceIndex,
      `切片 ${item.index} 的重复语删除项 ${index + 1}`,
    );
    if (hookRange && resolved.startMs < hookRange.semanticEndMs && resolved.endMs > hookRange.semanticStartMs) {
      throw new Error(`切片 ${item.index} 的重复语删除项 ${index + 1} 覆盖了钩子原句`);
    }
    return {
      startMs: resolved.startMs,
      endMs: resolved.endMs,
      reason: range.reason || "模型确认的整句重复或无效重新起句",
    };
  });
  const wordRemovals = (cleanup.removeWordRanges || []).map((range, index) => {
    const startUtterance = utterances[Number(range.startUtteranceIndex)];
    const endUtterance = utterances[Number(range.endUtteranceIndex ?? range.startUtteranceIndex)];
    const startWord = startUtterance?.words?.[Number(range.startWordIndex)];
    const endWord = endUtterance?.words?.[Number(range.endWordIndex ?? range.startWordIndex)];
    if (!startWord || !endWord || endWord.endMs <= startWord.startMs) {
      throw new Error(`切片 ${item.index} 的字词删除项 ${index + 1} 引用了无效范围`);
    }
    if (hookRange && startWord.startMs < hookRange.semanticEndMs && endWord.endMs > hookRange.semanticStartMs) {
      throw new Error(`切片 ${item.index} 的字词删除项 ${index + 1} 覆盖了钩子原句`);
    }
    return {
      startMs: startWord.startMs,
      endMs: endWord.endMs,
      reason: range.reason || "模型确认的口头禅、口误或废弃重说",
    };
  });
  return {
    ...cleanup,
    removeSourceRangesMs: [
      ...(cleanup.removeSourceRangesMs || []),
      ...semanticRemovals,
      ...wordRemovals,
    ],
  };
}

function sourceSeconds(milliseconds, inputSeekMs) {
  return Math.max(0, (milliseconds - inputSeekMs) / 1000).toFixed(3);
}

function escapeFilterPath(path) {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function buildFilterGraph(editPlan, clip, video, assPath) {
  const filters = [];
  const concatInputs = [];
  const hookSegments = editPlan.timeline.filter(segment => segment.kind === "hook");
  const bodySegments = editPlan.timeline.filter(segment => segment.kind === "body");
  const hookLast = hookSegments.at(-1);
  const bodyFirst = bodySegments[0];
  const fadeDuration = 0.12;

  editPlan.timeline.forEach((segment, index) => {
    const videoLabel = `v${index}`;
    const audioLabel = `a${index}`;
    if (segment.kind === "transition") {
      const duration = (segment.durationMs / 1000).toFixed(3);
      filters.push(
        `color=c=black:s=${video.width}x${video.height}:r=${video.fps.toFixed(3)}:d=${duration},format=yuv420p,setsar=1[${videoLabel}]`,
      );
      filters.push(
        `anullsrc=r=${video.sampleRate}:cl=${video.channelLayout},atrim=duration=${duration},aformat=sample_fmts=fltp:sample_rates=${video.sampleRate}:channel_layouts=${video.channelLayout}[${audioLabel}]`,
      );
    } else {
      const start = sourceSeconds(segment.sourceStartMs, clip.startMs);
      const end = sourceSeconds(segment.sourceEndMs, clip.startMs);
      const duration = segment.durationMs / 1000;
      const videoEffects = [
        `trim=start=${start}:end=${end}`,
        "setpts=PTS-STARTPTS",
        `fps=${video.fps.toFixed(3)}`,
        "format=yuv420p",
        "setsar=1",
      ];
      const audioEffects = [
        `atrim=start=${start}:end=${end}`,
        "asetpts=PTS-STARTPTS",
        `aformat=sample_fmts=fltp:sample_rates=${video.sampleRate}:channel_layouts=${video.channelLayout}`,
      ];
      if (segment === hookLast) {
        videoEffects.push(`fade=t=out:st=${Math.max(0, duration - fadeDuration).toFixed(3)}:d=${fadeDuration}`);
        audioEffects.push(`afade=t=out:st=${Math.max(0, duration - fadeDuration).toFixed(3)}:d=${fadeDuration}`);
      }
      if (segment === bodyFirst && hookSegments.length) {
        videoEffects.push(`fade=t=in:st=0:d=${fadeDuration}`);
        audioEffects.push(`afade=t=in:st=0:d=${fadeDuration}`);
      }
      filters.push(`[0:v]${videoEffects.join(",")}[${videoLabel}]`);
      filters.push(`[0:a]${audioEffects.join(",")}[${audioLabel}]`);
    }
    concatInputs.push(`[${videoLabel}][${audioLabel}]`);
  });

  filters.push(`${concatInputs.join("")}concat=n=${editPlan.timeline.length}:v=1:a=1[vcat][aout]`);
  if (assPath) {
    filters.push(`[vcat]ass='${escapeFilterPath(assPath)}'[vout]`);
  } else {
    filters.push("[vcat]null[vout]");
  }
  return filters.join(";");
}

async function render(videoPath, outputPath, clip, editPlan, video, assPath) {
  const filterGraph = buildFilterGraph(editPlan, clip, video, assPath);
  await execFileAsync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", String(clip.start),
    "-i", videoPath,
    "-filter_complex", filterGraph,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-profile:v", "high",
    "-b:v", "2800k",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ], { timeout: 30 * 60 * 1000, maxBuffer: MAX_BUFFER });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const videoPath = resolve(options.video);
  const outputDir = resolve(options.output);
  const subtitleDir = join(outputDir, "subtitles");
  const payload = JSON.parse(await readFile(resolve(options.transcript), "utf-8"));
  const plan = validateSemanticPlan(JSON.parse(await readFile(resolve(options.plan), "utf-8")));
  const utterances = readSourceUtterances(payload);
  const spoken = spokenUtterances(utterances);
  const words = allTimedWords(utterances);
  const video = await probeVideo(videoPath);
  const transcriptRows = spoken.map(row => ({
    start: row.startMs / 1000,
    end: row.endMs / 1000,
    text: row.text,
  }));
  const semanticClips = resolveSemanticSelections(plan, utterances);
  const clips = applyBoundaryPadding(semanticClips, transcriptRows, video.duration);

  await mkdir(outputDir, { recursive: true });
  await mkdir(subtitleDir, { recursive: true });
  const resolvedPlans = [];

  for (const clip of clips) {
    const bodyRange = { startMs: clip.startMs, endMs: clip.endMs };
    const hookRange = resolveHook(clip, utterances, bodyRange);
    const cleanupConfig = resolveCleanupConfig(clip, utterances, hookRange);
    const cleanup = clip.cleanup?.enabled === false
      ? { config: {}, wordsInspected: 0, removals: [], totalRemovedMs: 0 }
      : buildCleanupPlan(words, bodyRange, cleanupConfig);
    const editPlan = buildEditTimeline({
      bodyRange,
      hookRange,
      removals: cleanup.removals,
      transitionDurationMs: Number(clip.transition?.durationMs || 300),
    });
    validateEditTimeline(editPlan);

    const mappedWords = mapWordsToOutput(utterances, editPlan.timeline, clip.subtitleCorrections || []);
    const captions = groupCaptions(mappedWords, clip.subtitles || {});
    const ass = captionsToAss(captions, video, {
      ...(clip.subtitles || {}),
      fontSize: clip.subtitles?.fontSize || 58,
      title: clip.title || clip.coreViewpoint,
      titleLines: clip.titleLines,
      durationMs: editPlan.outputDurationMs,
    });
    const baseName = `${String(clip.index).padStart(2, "0")}_${safeName(clip.title)}`;
    const assPath = join(subtitleDir, `${baseName}.ass`);
    const videoFile = join(outputDir, `${baseName}.mp4`);
    await writeFile(assPath, ass, "utf-8");
    await render(videoPath, videoFile, clip, editPlan, video, captions.length ? assPath : null);

    resolvedPlans.push({
      ...clip,
      hook: hookRange,
      cleanup,
      editPlan,
      captions,
      subtitleFile: assPath,
      videoFile,
    });
  }

  await writeFile(join(outputDir, "edit-plans.json"), JSON.stringify(resolvedPlans, null, 2), "utf-8");
  await writeFile(join(outputDir, "resolved-clips.json"), JSON.stringify(clips, null, 2), "utf-8");
  console.log(`完成：${outputDir}`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
