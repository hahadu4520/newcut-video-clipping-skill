import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

export function timeToSeconds(value) {
  const text = String(value || "0").replace(",", ".").trim();
  if (!text) return 0;
  const parts = text.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(text) || 0;
}

export function secondsToClock(value, ms = false) {
  const seconds = Math.max(0, Number(value) || 0);
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  if (!ms) return base;
  const millis = Math.round((seconds - whole) * 1000);
  return `${base}.${String(millis).padStart(3, "0")}`;
}

function srtClock(value) {
  return secondsToClock(value, true).replace(".", ",");
}

export function parseReadableTranscript(text) {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^\[(\d{2}:\d{2}(?::\d{2})?)\]\s*(.+)$/);
      if (!match) return null;
      return { start: timeToSeconds(match[1]), text: match[2].trim() };
    })
    .filter(Boolean);
}

export function parseSrtTranscript(text) {
  const normalized = String(text || "").replace(/\r/g, "").trim();
  if (!normalized) return [];
  return normalized
    .split(/\n{2,}/)
    .map(block => {
      const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
      const timeLine = lines.find(line => line.includes("-->"));
      if (!timeLine) return null;
      const [start, end] = timeLine.split("-->").map(item => item.trim());
      const timeIndex = lines.indexOf(timeLine);
      const text = lines.slice(timeIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim();
      if (!text) return null;
      return { start: timeToSeconds(start), end: timeToSeconds(end), text };
    })
    .filter(Boolean);
}

export function parseJsonTranscript(text) {
  const data = JSON.parse(text);
  const rows = Array.isArray(data) ? data : data.segments || data.transcript || data.rows || data.utterances || [];
  return rows
    .map(row => ({
      start: Number(row.start ?? row.start_time ?? row.startSeconds ?? timeToSeconds(row.time)),
      end: row.end == null && row.end_time == null && row.endSeconds == null
        ? undefined
        : Number(row.end ?? row.end_time ?? row.endSeconds),
      text: String(row.text || row.content || row.message || "").trim(),
    }))
    .filter(row => Number.isFinite(row.start) && row.text);
}

export async function readTranscript(path) {
  const text = await readFile(path, "utf-8");
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return parseJsonTranscript(text);
  if ([".srt", ".vtt"].includes(ext)) return parseSrtTranscript(text);
  const readable = parseReadableTranscript(text);
  return readable.length ? readable : parseSrtTranscript(text);
}

export async function writeTranscriptArtifacts(rows, outputDir, basename = "transcript") {
  await writeFile(join(outputDir, `${basename}.json`), JSON.stringify(rows, null, 2), "utf-8");
  const srt = rows.map((row, index) => {
    const start = Number(row.start) || 0;
    const end = Number(row.end) || start + 2;
    return `${index + 1}\n${srtClock(start)} --> ${srtClock(end)}\n${row.text}\n`;
  }).join("\n");
  await writeFile(join(outputDir, `${basename}.srt`), srt, "utf-8");
}
