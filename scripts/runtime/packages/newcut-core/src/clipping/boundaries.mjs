export const DEFAULT_BOUNDARY_OPTIONS = Object.freeze({
  preRollMs: 200,
  postRollMs: 450,
  previousGuardMs: 80,
  nextGuardMs: 120,
});

export function roundMilliseconds(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

export function applyBoundaryPadding(clips, transcriptRows, sourceDuration, options = {}) {
  const config = { ...DEFAULT_BOUNDARY_OPTIONS, ...options };

  return clips.map(clip => {
    const semanticStart = clip.start;
    const semanticEnd = clip.end;
    const firstIndex = transcriptRows.findIndex(row => (
      row.end > semanticStart - 0.001 && row.start <= semanticStart + 0.001
    ));
    const lastIndex = transcriptRows.findLastIndex(row => (
      row.start < semanticEnd + 0.001 && row.end <= semanticEnd + 0.001
    ));
    if (firstIndex < 0 || lastIndex < firstIndex) {
      throw new Error(`切片 ${clip.index ?? "?"} 的语义边界无法对应到转录句段`);
    }

    const first = transcriptRows[firstIndex];
    const last = transcriptRows[lastIndex];
    const previous = firstIndex > 0 ? transcriptRows[firstIndex - 1] : null;
    const next = transcriptRows[lastIndex + 1] || null;

    let renderStart = first.start - config.preRollMs / 1000;
    if (previous && previous.end < first.start) {
      renderStart = Math.max(renderStart, previous.end + config.previousGuardMs / 1000);
    }
    renderStart = Math.max(0, Math.min(first.start, renderStart));

    let renderEnd = last.end + config.postRollMs / 1000;
    if (next && next.start > last.end) {
      renderEnd = Math.min(renderEnd, next.start - config.nextGuardMs / 1000);
    }
    renderEnd = Math.min(sourceDuration, Math.max(last.end, renderEnd));

    const start = roundMilliseconds(renderStart);
    const end = roundMilliseconds(renderEnd);
    const resolved = {
      ...clip,
      semanticStart: roundMilliseconds(first.start),
      semanticEnd: roundMilliseconds(last.end),
      start,
      end,
      startMs: Math.round(start * 1000),
      endMs: Math.round(end * 1000),
      duration: roundMilliseconds(end - start),
      boundaryPadding: {
        beforeMs: Math.round((first.start - start) * 1000),
        afterMs: Math.round((end - last.end) * 1000),
      },
    };

    validateResolvedBoundary(resolved, next);
    return resolved;
  });
}

export function validateResolvedBoundary(clip, nextRow = null) {
  if (clip.start > clip.semanticStart) {
    throw new Error(`切片 ${clip.index ?? "?"} 的开头晚于首句起点`);
  }
  if (clip.end < clip.semanticEnd) {
    throw new Error(`切片 ${clip.index ?? "?"} 的结尾早于末句终点`);
  }
  if (clip.end <= clip.start) {
    throw new Error(`切片 ${clip.index ?? "?"} 的时间范围无效`);
  }
  if (nextRow && nextRow.start > clip.semanticEnd && clip.end > nextRow.start) {
    throw new Error(`切片 ${clip.index ?? "?"} 的收尾侵入下一句`);
  }
}
