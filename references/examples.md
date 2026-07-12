# Examples

The skill repository intentionally contains no media, audio, subtitle, transcript, or private production fixture.

## First-time onboarding

Before requesting a video, the skill asks:

```text
开始前请选择转录方式：
1. 本地 Whisper：免费、本地运行，首次需要下载模型。
2. 豆包语音识别 2.0：中文和字级时间戳更稳定，需要自己的 API Key，并按量计费。

请选择“本地 Whisper”或“豆包语音”。
```

If the user chooses Doubao, finish service activation, local `.env.local` configuration, and `doctor` verification first. Ask for the video only after configuration is ready.

## Process a local video with an existing transcript

```bash
node <skill-root>/scripts/newcut.mjs process ./input.mp4 \
  --transcript ./input.srt \
  --output ./output/job-001
```

Expected artifact shape:

```text
output/job-001/
├── source-info.json
├── transcript.json
├── semantic-source.json
├── semantic-selection-brief.json
├── semantic-plan.template.json
├── 完整转录稿.md
└── 语义审阅稿.md
```

After the agent writes `semantic-plan.json`:

```bash
node <skill-root>/scripts/newcut.mjs render \
  --video ./input.mp4 \
  --transcript ./output/job-001/semantic-source.json \
  --plan ./output/job-001/semantic-plan.json \
  --output ./output/job-001/clips
```

Expected render shape:

```text
output/job-001/clips/
├── 01_viewpoint-title.mp4
├── subtitles/
│   └── 01_viewpoint-title.ass
├── edit-plans.json
└── resolved-clips.json
```
