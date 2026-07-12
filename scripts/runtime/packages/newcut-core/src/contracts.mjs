export const NEWCUT_PIPELINE_VERSION = 1;

export const JOB_STAGES = Object.freeze([
  "transcribe",
  "select",
  "review",
  "render",
  "qc",
]);

export const JOB_STATUSES = Object.freeze([
  "pending",
  "running",
  "waiting_for_review",
  "completed",
  "failed",
  "cancelled",
]);

export const JOB_ARTIFACTS = Object.freeze({
  sourceInfo: "source-info.json",
  transcript: "transcript.json",
  completeTranscript: "完整转录稿.md",
  semanticSource: "semantic-source.json",
  semanticReview: "语义审阅稿.md",
  selectionBrief: "semantic-selection-brief.json",
  semanticPlan: "semantic-plan.json",
  editPlans: "edit-plans.json",
  resolvedClips: "resolved-clips.json",
  qualityReport: "质检报告.md",
});

function assertInteger(value, label) {
  if (!Number.isInteger(Number(value)) || Number(value) < 0) {
    throw new Error(`${label} 必须是非负整数`);
  }
}

export function validateSemanticPlan(plan) {
  if (!Array.isArray(plan) || !plan.length) throw new Error("语义计划必须是非空数组");
  const indexes = new Set();
  for (const item of plan) {
    assertInteger(item.index, "index");
    if (indexes.has(Number(item.index))) throw new Error(`语义计划包含重复 index：${item.index}`);
    indexes.add(Number(item.index));
    if (!String(item.title || "").trim()) throw new Error(`切片 ${item.index} 缺少 title`);
    assertInteger(item.startUtteranceIndex, `切片 ${item.index} startUtteranceIndex`);
    assertInteger(item.endUtteranceIndex, `切片 ${item.index} endUtteranceIndex`);
    if (Number(item.endUtteranceIndex) < Number(item.startUtteranceIndex)) {
      throw new Error(`切片 ${item.index} 的句段范围倒置`);
    }
    if (!Array.isArray(item.titleLines) || item.titleLines.length < 1 || item.titleLines.length > 2) {
      throw new Error(`切片 ${item.index} 必须提供一到两行 titleLines`);
    }
    if (item.titleLines.some(line => !String(line || "").trim())) {
      throw new Error(`切片 ${item.index} 的 titleLines 包含空行`);
    }
    if (item.hook) {
      assertInteger(item.hook.startUtteranceIndex, `切片 ${item.index} hook.startUtteranceIndex`);
      assertInteger(item.hook.endUtteranceIndex, `切片 ${item.index} hook.endUtteranceIndex`);
      if (
        Number(item.hook.startUtteranceIndex) < Number(item.startUtteranceIndex)
        || Number(item.hook.endUtteranceIndex) > Number(item.endUtteranceIndex)
      ) {
        throw new Error(`切片 ${item.index} 的钩子不在正文范围内`);
      }
    }
  }
  return plan;
}

export function createJobManifest({ jobId, sourcePath, createdAt = new Date().toISOString() }) {
  if (!String(jobId || "").trim()) throw new Error("jobId 不能为空");
  if (!String(sourcePath || "").trim()) throw new Error("sourcePath 不能为空");
  return {
    version: NEWCUT_PIPELINE_VERSION,
    jobId,
    sourcePath,
    stage: JOB_STAGES[0],
    status: JOB_STATUSES[0],
    createdAt,
    updatedAt: createdAt,
    artifacts: {},
    error: null,
  };
}
