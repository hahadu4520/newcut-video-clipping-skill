import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { transcribeWithDoubao } from "./providers/doubao.mjs";
export { transcribeWithDoubao } from "./providers/doubao.mjs";
export {
  parseJsonTranscript,
  parseReadableTranscript,
  parseSrtTranscript,
  readTranscript,
  secondsToClock,
  timeToSeconds,
  writeTranscriptArtifacts,
} from "./transcript-utils.mjs";

const execFileAsync = promisify(execFile);
const PROCESS_MAX_BUFFER = Number(process.env.PROCESS_MAX_BUFFER || 100 * 1024 * 1024);

export async function transcribeWithWhisper(videoPath, outputDir, model) {
  const audioPath = join(outputDir, "audio.wav");
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    audioPath,
  ], { timeout: 30 * 60 * 1000, maxBuffer: PROCESS_MAX_BUFFER });

  await execFileAsync("whisper", [
    audioPath,
    "--model", model,
    "--language", "zh",
    "--output_format", "srt",
    "--output_dir", outputDir,
    "--fp16", "False",
    "--verbose", "False",
  ], { timeout: 4 * 60 * 60 * 1000, maxBuffer: PROCESS_MAX_BUFFER });

  const { readTranscript } = await import("./transcript-utils.mjs");
  return readTranscript(join(outputDir, "audio.srt"));
}

export async function transcribeAudio(videoPath, outputDir, options) {
  if (options.asrProvider === "doubao") {
    return transcribeWithDoubao(videoPath, outputDir, {
      audioUrl: options.doubaoAudioUrl,
      command: options.asrCommand,
      language: "zh",
      model: "seed-asr",
    });
  }
  return transcribeWithWhisper(videoPath, outputDir, options.whisperModel);
}
