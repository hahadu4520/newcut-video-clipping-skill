import { subtractRemovalRanges } from "./cleanup.mjs";

function appendSourceSpans(timeline, spans, kind, cursorRef) {
  for (const span of spans) {
    const durationMs = span.sourceEndMs - span.sourceStartMs;
    timeline.push({
      kind,
      sourceStartMs: span.sourceStartMs,
      sourceEndMs: span.sourceEndMs,
      outputStartMs: cursorRef.value,
      outputEndMs: cursorRef.value + durationMs,
      durationMs,
    });
    cursorRef.value += durationMs;
  }
}

export function buildEditTimeline({
  bodyRange,
  hookRange = null,
  removals = [],
  transitionDurationMs = 300,
}) {
  const timeline = [];
  const cursor = { value: 0 };

  if (hookRange) {
    const hookSpans = subtractRemovalRanges(hookRange, removals);
    appendSourceSpans(timeline, hookSpans, "hook", cursor);
    timeline.push({
      kind: "transition",
      outputStartMs: cursor.value,
      outputEndMs: cursor.value + transitionDurationMs,
      durationMs: transitionDurationMs,
    });
    cursor.value += transitionDurationMs;
  }

  const bodySpans = subtractRemovalRanges(bodyRange, removals);
  appendSourceSpans(timeline, bodySpans, "body", cursor);

  return {
    version: 1,
    rule: "hook-copy-plus-full-body",
    bodyRange,
    hookRange,
    transitionDurationMs: hookRange ? transitionDurationMs : 0,
    removals,
    timeline,
    outputDurationMs: cursor.value,
  };
}

export function validateEditTimeline(editPlan) {
  let cursor = 0;
  for (const segment of editPlan.timeline) {
    if (segment.outputStartMs !== cursor) throw new Error("编辑时间轴存在空洞或重叠");
    if (segment.outputEndMs <= segment.outputStartMs) throw new Error("编辑时间轴包含无效片段");
    cursor = segment.outputEndMs;
  }
  if (cursor !== editPlan.outputDurationMs) throw new Error("编辑时间轴总时长不一致");
  if (editPlan.hookRange) {
    const bodySegments = editPlan.timeline.filter(segment => segment.kind === "body");
    const bodyStartsBeforeHook = bodySegments.some(segment => segment.sourceStartMs <= editPlan.hookRange.startMs);
    const bodyEndsAfterHook = bodySegments.some(segment => segment.sourceEndMs >= editPlan.hookRange.endMs);
    if (!bodyStartsBeforeHook || !bodyEndsAfterHook) {
      throw new Error("正文没有完整保留钩子原句所在位置");
    }
  }
}
