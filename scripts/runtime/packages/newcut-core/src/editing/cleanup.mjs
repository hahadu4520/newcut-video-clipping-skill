const DEFAULTS = Object.freeze({
  maxPauseMs: 520,
  keepPauseMs: 180,
  minRemovalMs: 80,
  repeatGapMs: 260,
});

const REPEATABLE_SINGLE_TOKENS = new Set([
  "我", "你", "他", "她", "它", "这", "那", "就", "是", "对", "嗯", "啊", "呃", "也", "还",
]);

const REPEATABLE_PHRASES = new Set([
  "然后", "就是", "这个", "那个", "其实", "因为", "所以", "但是", "可以", "对对",
]);

function mergeRanges(ranges) {
  const sorted = ranges
    .filter(range => range.endMs > range.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.startMs > previous.endMs) {
      merged.push({ ...range, reasons: [range.reason] });
      continue;
    }
    previous.endMs = Math.max(previous.endMs, range.endMs);
    if (!previous.reasons.includes(range.reason)) previous.reasons.push(range.reason);
  }
  return merged;
}

function detectPauseRemovals(words, options) {
  const removals = [];
  for (let index = 0; index < words.length - 1; index += 1) {
    const current = words[index];
    const next = words[index + 1];
    const gap = next.startMs - current.endMs;
    if (gap <= options.maxPauseMs) continue;
    const trimEachSide = options.keepPauseMs / 2;
    const startMs = Math.round(current.endMs + trimEachSide);
    const endMs = Math.round(next.startMs - trimEachSide);
    if (endMs - startMs < options.minRemovalMs) continue;
    removals.push({
      type: "pause",
      startMs,
      endMs,
      removedMs: endMs - startMs,
      reason: `将 ${gap}ms 气口压缩为 ${options.keepPauseMs}ms`,
    });
  }
  return removals;
}

function detectSingleTokenRepeats(words, options) {
  const removals = [];
  let index = 0;
  while (index < words.length - 1) {
    const token = words[index].text.trim();
    if (!REPEATABLE_SINGLE_TOKENS.has(token)) {
      index += 1;
      continue;
    }
    let end = index;
    while (
      end + 1 < words.length
      && words[end + 1].text.trim() === token
      && words[end + 1].startMs - words[end].endMs <= options.repeatGapMs
    ) {
      end += 1;
    }
    if (end > index) {
      removals.push({
        type: "repeat",
        startMs: words[index].startMs,
        endMs: words[end].startMs,
        removedMs: words[end].startMs - words[index].startMs,
        reason: `清理连续口吃式重复“${token}”`,
      });
    }
    index = Math.max(index + 1, end + 1);
  }
  return removals;
}

function detectPhraseRepeats(words, options) {
  const removals = [];
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index + size * 2 <= words.length; index += 1) {
      const first = words.slice(index, index + size);
      const second = words.slice(index + size, index + size * 2);
      const firstText = first.map(word => word.text.trim()).join("");
      const secondText = second.map(word => word.text.trim()).join("");
      if (firstText !== secondText || !REPEATABLE_PHRASES.has(firstText)) continue;
      if (second[0].startMs - first.at(-1).endMs > options.repeatGapMs) continue;
      removals.push({
        type: "repeat",
        startMs: first[0].startMs,
        endMs: second[0].startMs,
        removedMs: second[0].startMs - first[0].startMs,
        reason: `清理口吃式重复短语“${firstText}”`,
      });
      index += size * 2 - 1;
    }
  }
  return removals;
}

export function buildCleanupPlan(words, range, config = {}) {
  const options = { ...DEFAULTS, ...config };
  const scopedWords = words
    .filter(word => word.endMs > range.startMs && word.startMs < range.endMs)
    .sort((a, b) => a.startMs - b.startMs);
  const autoRemovals = [
    ...detectPauseRemovals(scopedWords, options),
    ...detectSingleTokenRepeats(scopedWords, options),
    ...detectPhraseRepeats(scopedWords, options),
  ];
  const manualRemovals = (config.removeSourceRangesMs || []).map(rangeItem => ({
    type: "manual",
    startMs: Number(rangeItem.startMs),
    endMs: Number(rangeItem.endMs),
    removedMs: Number(rangeItem.endMs) - Number(rangeItem.startMs),
    reason: rangeItem.reason || "模型确认的重复或口误",
  }));
  const removals = mergeRanges([...autoRemovals, ...manualRemovals])
    .map(item => ({
      ...item,
      startMs: Math.max(range.startMs, item.startMs),
      endMs: Math.min(range.endMs, item.endMs),
    }))
    .filter(item => item.endMs - item.startMs >= options.minRemovalMs);
  return {
    config: options,
    wordsInspected: scopedWords.length,
    removals,
    totalRemovedMs: removals.reduce((sum, item) => sum + item.endMs - item.startMs, 0),
  };
}

export function subtractRemovalRanges(range, removals, minSpanMs = 40) {
  let cursor = range.startMs;
  const spans = [];
  for (const removal of removals) {
    if (removal.endMs <= cursor || removal.startMs >= range.endMs) continue;
    const keepEnd = Math.max(cursor, Math.min(range.endMs, removal.startMs));
    if (keepEnd - cursor >= minSpanMs) spans.push({ sourceStartMs: cursor, sourceEndMs: keepEnd });
    cursor = Math.max(cursor, removal.endMs);
    if (cursor >= range.endMs) break;
  }
  if (range.endMs - cursor >= minSpanMs) {
    spans.push({ sourceStartMs: cursor, sourceEndMs: range.endMs });
  }
  return spans;
}
