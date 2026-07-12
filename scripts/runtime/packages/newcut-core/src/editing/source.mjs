export function readSourceUtterances(payload) {
  const raw = payload?.result?.utterances || payload?.utterances;
  if (!Array.isArray(raw)) throw new Error("转录 JSON 中没有 result.utterances");

  let globalWordIndex = 0;
  return raw.map((row, rawIndex) => {
    const words = Array.isArray(row.words) ? row.words : [];
    return {
      rawIndex,
      startMs: Number(row.start_time),
      endMs: Number(row.end_time),
      text: String(row.text || "").trim(),
      words: words
        .filter(word => Number(word.start_time) >= 0 && Number(word.end_time) >= Number(word.start_time))
        .map((word, wordIndex) => ({
          globalWordIndex: globalWordIndex++,
          utteranceIndex: rawIndex,
          wordIndex,
          startMs: Number(word.start_time),
          endMs: Number(word.end_time),
          text: String(word.text || ""),
        }))
        .filter(word => word.text.trim()),
    };
  });
}

export function spokenUtterances(utterances) {
  return utterances.filter(row => row.text && Number.isFinite(row.startMs) && Number.isFinite(row.endMs));
}

export function allTimedWords(utterances) {
  return utterances.flatMap(utterance => utterance.words);
}

export function resolveUtteranceRange(utterances, startIndex, endIndex, label = "范围") {
  const first = utterances[Number(startIndex)];
  const last = utterances[Number(endIndex)];
  if (!first?.text || !last?.text || Number(endIndex) < Number(startIndex)) {
    throw new Error(`${label}的句段编号无效：${startIndex}-${endIndex}`);
  }
  return {
    startMs: first.startMs,
    endMs: last.endMs,
    text: utterances
      .slice(Number(startIndex), Number(endIndex) + 1)
      .filter(row => row.text)
      .map(row => row.text)
      .join(" "),
  };
}
