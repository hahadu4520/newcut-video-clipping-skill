# Examples

The skill repository intentionally contains no media, audio, subtitle, transcript, or private production fixture.

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
