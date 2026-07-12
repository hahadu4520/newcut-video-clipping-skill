function attachPunctuation(utterance) {
  const text = String(utterance.text || "");
  const tokens = utterance.words.map(word => ({ ...word, displayText: word.text }));
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const needle = token.text.trim();
    const found = needle ? text.indexOf(needle, cursor) : -1;
    if (found < 0) continue;
    const between = text.slice(cursor, found);
    if (index > 0) tokens[index - 1].displayText += between;
    else token.displayText = between + token.displayText;
    cursor = found + needle.length;
  }
  if (tokens.length && cursor < text.length) tokens.at(-1).displayText += text.slice(cursor);
  return tokens;
}

function applySubtitleCorrections(tokens, corrections, utteranceIndex) {
  const scoped = corrections
    .filter(item => Number(item.utteranceIndex) === utteranceIndex)
    .sort((a, b) => Number(b.startWordIndex) - Number(a.startWordIndex));
  for (const correction of scoped) {
    const start = Number(correction.startWordIndex);
    const end = Number(correction.endWordIndex ?? start);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= tokens.length) {
      throw new Error(`字幕修正引用了无效字词范围：U${utteranceIndex} W${start}-W${end}`);
    }
    const trailingPunctuation = String(tokens[end].displayText || "").match(/[，。！？、；：,.!?\s]+$/u)?.[0] || "";
    tokens.splice(start, end - start + 1, {
      ...tokens[start],
      endMs: tokens[end].endMs,
      text: String(correction.replacement || ""),
      displayText: `${String(correction.replacement || "").trim()}${trailingPunctuation}`,
      correctionReason: correction.reason || "修正 ASR 错别字",
    });
  }
  return tokens;
}

function sourceTokens(utterances, corrections = []) {
  return utterances.flatMap(utterance => (
    applySubtitleCorrections(attachPunctuation(utterance), corrections, utterance.rawIndex)
  ));
}

export function mapWordsToOutput(utterances, timeline, corrections = []) {
  const words = sourceTokens(utterances, corrections);
  const mapped = [];
  for (let segmentIndex = 0; segmentIndex < timeline.length; segmentIndex += 1) {
    const segment = timeline[segmentIndex];
    if (segment.kind === "transition") continue;
    for (const word of words) {
      const midpoint = (word.startMs + word.endMs) / 2;
      if (midpoint < segment.sourceStartMs || midpoint >= segment.sourceEndMs) continue;
      const sourceStartMs = Math.max(word.startMs, segment.sourceStartMs);
      const sourceEndMs = Math.min(word.endMs, segment.sourceEndMs);
      mapped.push({
        ...word,
        part: segment.kind,
        segmentIndex,
        outputStartMs: segment.outputStartMs + sourceStartMs - segment.sourceStartMs,
        outputEndMs: segment.outputStartMs + sourceEndMs - segment.sourceStartMs,
      });
    }
  }
  return mapped.sort((a, b) => a.outputStartMs - b.outputStartMs);
}

function visibleLength(text) {
  return String(text || "").replace(/\s+/g, "").length;
}

function cleanCaptionEdges(text) {
  return String(text || "")
    .trim()
    .replace(/^[，。！？、；：,.!?\s]+/u, "")
    .replace(/[，。！？、；：,.!?\s]+$/u, "")
    .trim();
}

function wrapTitle(text, maxChars = 9) {
  const clean = cleanCaptionEdges(text);
  if (visibleLength(clean) <= maxChars) return clean;
  const midpoint = clean.length / 2;
  const boundaries = [...new Intl.Segmenter("zh-CN", { granularity: "word" }).segment(clean)]
    .map(segment => segment.index + segment.segment.length)
    .filter(index => index > 0 && index < clean.length)
    .sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint));
  const split = boundaries[0] || Math.ceil(clean.length / 2);
  return `${clean.slice(0, split)}\\N${clean.slice(split)}`;
}

function titleToAss(text, maxChars, titleLines = null) {
  const explicitLines = Array.isArray(titleLines)
    ? titleLines.map(cleanCaptionEdges).filter(Boolean)
    : [];
  if (explicitLines.length > 2) throw new Error("观点标题最多允许两行");
  const [lead, conclusion] = explicitLines.length
    ? explicitLines
    : wrapTitle(text, maxChars).split("\\N");
  if (!conclusion) return escapeAss(lead);
  return `${escapeAss(lead)}\\N{\\c&H0038E8FF&}${escapeAss(conclusion)}`;
}

function boundaryScore(words, endIndex, maxChars) {
  const chunk = words.slice(0, endIndex);
  const text = chunk.map(word => word.displayText).join("").trim();
  const fullText = words.map(word => word.displayText).join("").trim();
  const next = words[endIndex];
  const length = visibleLength(text);
  const gapMs = next ? next.outputStartMs - chunk.at(-1).outputEndMs : 0;
  let score = 40 - Math.abs(maxChars - length) * 2;

  if (next) {
    const wordBoundaries = new Set(
      [...new Intl.Segmenter("zh-CN", { granularity: "word" }).segment(fullText)]
        .map(segment => segment.index + segment.segment.length),
    );
    if (!wordBoundaries.has(text.length)) score -= 180;
  }

  if (/[。！？.!?]\s*$/.test(text)) score += 120;
  else if (/[，、；：,;:]\s*$/.test(text)) score += 85;
  if (gapMs >= 420) score += 80;
  else if (gapMs >= 220) score += 45;
  else if (gapMs >= 120) score += 18;

  const cleanEnd = cleanCaptionEdges(text);
  const nextText = String(next?.displayText || "").trim();
  if (next && cleanEnd.at(-1) === cleanCaptionEdges(nextText).at(0)) score -= 180;
  if (next && /(因为|所以|但是|不过|然后|如果|而且|以及|比如|就是|其实|另外|同时)$/.test(cleanEnd)) score -= 140;
  if (next && /^(的|了|呢|吧|吗|啊|呀|着|过|得|地|嘛|呗)/.test(nextText)) score -= 140;
  if (next && /^(因为|所以|但是|不过|然后|如果|而且|比如|就是|其实|另外|同时)/.test(nextText)) score += 35;
  if (length < Math.min(6, maxChars)) score -= 45;
  return score;
}

function takeSemanticChunk(words, options) {
  const candidates = [];
  let chars = 0;
  for (let index = 0; index < words.length; index += 1) {
    const nextChars = visibleLength(words[index].displayText);
    if (index > 0 && chars + nextChars > options.maxChars) break;
    chars += nextChars;
    const durationMs = words[index].outputEndMs - words[0].outputStartMs;
    candidates.push({
      endIndex: index + 1,
      score: boundaryScore(words, index + 1, options.maxChars)
        - Math.max(0, durationMs - options.maxDurationMs) / 20,
    });
  }
  if (!candidates.length) return words.splice(0, 1);
  candidates.sort((a, b) => b.score - a.score || b.endIndex - a.endIndex);
  return words.splice(0, candidates[0].endIndex);
}

export function groupCaptions(words, config = {}) {
  const options = {
    maxChars: 16,
    maxDurationMs: 3400,
    minDisplayMs: 700,
    ...config,
  };
  const captions = [];
  const groups = [];
  for (const word of words) {
    const key = `${word.part}:${word.utteranceIndex}`;
    const current = groups.at(-1);
    if (!current || current.key !== key) groups.push({ key, words: [word] });
    else current.words.push(word);
  }

  for (const group of groups) {
    let remainingWords = [...group.words];
    while (remainingWords.length) {
      const chunk = takeSemanticChunk(remainingWords, options);
      captions.push({
        startMs: Math.max(0, chunk[0].outputStartMs - 60),
        endMs: Math.max(chunk.at(-1).outputEndMs + 120, chunk[0].outputStartMs + options.minDisplayMs),
        text: cleanCaptionEdges(chunk.map(word => word.displayText).join("")),
        part: chunk[0].part,
      });
    }
  }

  for (let index = 0; index < captions.length - 1; index += 1) {
    captions[index].endMs = Math.min(captions[index].endMs, captions[index + 1].startMs - 40);
    captions[index].endMs = Math.max(captions[index].endMs, captions[index].startMs + 300);
  }
  return captions.filter(caption => caption.text && caption.endMs > caption.startMs);
}

function assTime(milliseconds) {
  const totalCentiseconds = Math.max(0, Math.round(milliseconds / 10));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAss(text) {
  return String(text || "")
    .replace(/[{}]/g, "")
    .replace(/\r?\n/g, "\\N");
}

export function captionsToAss(captions, video, config = {}) {
  const fontName = config.fontName || "Hiragino Sans GB W6";
  const fontSize = config.fontSize || 58;
  const marginV = config.marginV || 260;
  const title = cleanCaptionEdges(config.title || "");
  const titleFontName = config.titleFontName || "LXGW Marker Gothic";
  const titleFontSize = config.titleFontSize || 108;
  const titleMarginV = config.titleMarginV || 105;
  const titleMaxChars = config.titleMaxChars || 9;
  const titleLines = config.titleLines || null;
  const durationMs = Number(config.durationMs || 0);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${video.width}
PlayResY: ${video.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},&H00FAFAFA,&H000000FF,&H760B0E12,&H760B0E12,0,0,0,0,100,100,0,0,3,8,0,2,90,90,${marginV},1
Style: Title,${titleFontName},${titleFontSize},&H00FFFFFF,&H000000FF,&H00000000,&H70000000,-1,0,0,0,105,105,1,0,1,6,9,8,45,45,${titleMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = [];
  if (title && durationMs > 0) {
    events.push(`Dialogue: 1,0:00:00.00,${assTime(durationMs)},Title,,0,0,0,,${titleToAss(title, titleMaxChars, titleLines)}`);
  }
  events.push(...captions.map(caption => (
    `Dialogue: 0,${assTime(caption.startMs)},${assTime(caption.endMs)},Default,,0,0,0,,${escapeAss(caption.text)}`
  )));
  return `${header}\n${events.join("\n")}\n`;
}
