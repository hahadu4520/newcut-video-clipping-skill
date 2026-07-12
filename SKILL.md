---
name: newcut-video-clipping
description: Transcribe long Chinese videos, semantically select complete standalone highlights, create real-quote hooks, clean pauses and reviewed speech mistakes, generate single-line subtitles and strong viewpoint titles, render clips with FFmpeg, and produce QC artifacts. Use when a user asks to cut livestreams, interviews, podcasts, talks, or other long Chinese videos into publishable short clips.
---

# NewCut Video Clipping

Create polished clips through a reviewable pipeline. Prefer complete viewpoints over fixed durations and never select highlights by keyword scores.

## Prerequisites

Run the doctor before processing:

```bash
node <skill-root>/scripts/newcut.mjs doctor
```

Required: Node.js 20+ and FFmpeg/FFprobe. For transcription, use an existing timestamped transcript, local Whisper, or user-provided Doubao/TOS credentials.

For Doubao setup, read [provider-config.md](references/provider-config.md). Never print, copy, or commit credential values.

## Mandatory onboarding before requesting video

For a first-time user, choose and verify the transcription setup before asking them to upload or provide a video. Do not wait until a video has already been uploaded. Do not run any media command during onboarding.

Use this order exactly:

```text
choose transcription provider
-> complete provider setup
-> verify the setup
-> ask for the video
-> transcribe
```

First explain both choices in the user's language and ask them to choose:

```text
开始前请选择转录方式：

1. 本地 Whisper
   - 不收取 API 费用，音视频不上传到第三方
   - 首次使用需要下载模型文件
   - 使用本机计算，长视频可能较慢
   - 中文准确率和字级时间戳通常不如豆包稳定

2. 豆包语音识别 2.0
   - 中文和中英混合识别、字级时间戳更适合视频剪辑
   - 需要注册火山引擎、开通服务并申请自己的 API Key
   - 按火山引擎实际用量计费

请选择“本地 Whisper”或“豆包语音”。
```

Wait for the user's answer. Do not silently select a provider. Skip this question only when the user supplied a transcript or explicitly chose a provider in the current request.

After the choice:

- For Whisper, explain that the first run downloads the selected model. Recommend `small` for a faster start or `medium` for better Chinese accuracy. Install or verify Whisper and FFmpeg first. Only after the environment is ready should you ask the user for a video.
- For Doubao, open or link [provider-config.md](references/provider-config.md), guide the user through service activation and `.env.local`, and verify configuration before asking for a video. Never ask the user to paste a secret into chat.

For Doubao onboarding, complete these checkpoints in order:

1. The user has opened the Doubao Speech console and activated recording-file recognition 2.0.
2. The user has created an API Key in the console.
3. The user has filled `DOUBAO_API_KEY` and `DOUBAO_ASR_RESOURCE_ID` in a local `.env.local` file.
4. Run `node <skill-root>/scripts/newcut.mjs doctor` without printing secret values.
5. If required, run a credential connection check that does not need the user's production video.
6. Confirm that configuration is ready.
7. Only now ask the user to upload or provide the video file.

If setup is incomplete, remain in onboarding. Do not ask for the production video merely to discover that credentials are missing.

## Workflow

### 1. Transcribe and prepare semantic review

With an existing transcript:

```bash
node <skill-root>/scripts/newcut.mjs process <video> \
  --transcript <transcript.srt|json|txt> \
  --output <job-dir>
```

With Doubao ASR:

```bash
node <skill-root>/scripts/newcut.mjs process <video> \
  --asr-provider doubao \
  --output <job-dir>
```

The command creates the complete transcript, semantic review, source JSON, selection brief, and plan template. It does not select highlights by itself.

### 2. Read the complete transcript

Read `<job-dir>/语义审阅稿.md` from beginning to end. Build a topic map and enumerate all complete viewpoints before selecting by count or preferred duration.

Do not use:

- Keyword scores.
- Fixed sliding windows.
- Silence as proof that a viewpoint ended.
- Maximum duration during recall.
- Rounded manual timestamps.

### 3. Write the semantic plan

Write `<job-dir>/semantic-plan.json` using raw utterance indexes. Every final clip must include:

- A complete standalone argument.
- Explicit `titleLines` with one or two semantically complete lines.
- A hook copied from a real sentence inside the body.
- Reviewed cleanup ranges for false starts, speech mistakes, or complex repetitions.
- Timestamp-addressed subtitle corrections for confirmed ASR errors.

Read [semantic-plan.md](references/semantic-plan.md) before authoring the plan.

### 4. Render

```bash
node <skill-root>/scripts/newcut.mjs render \
  --video <video> \
  --transcript <job-dir>/semantic-source.json \
  --plan <job-dir>/semantic-plan.json \
  --output <clips-dir>
```

The fixed render order is:

```text
copied real-quote hook -> transition -> cleaned full body -> remapped subtitles
```

The hook remains in its original body position.

### 5. Quality check

Verify each output is playable and inspect hook, middle, and ending frames. Confirm:

- The viewpoint starts with enough context and ends after its final conclusion.
- No first or last spoken character is cut.
- Captions stay on one line and have no punctuation at either edge.
- Caption chunks represent complete semantic phrases.
- Title lines are semantically complete and stay inside the safe area.
- Cleanup does not change the speaker's meaning or remove the original hook.
- ASR corrections change subtitle display only, not spoken content.

Read [quality-check.md](references/quality-check.md) for the full checklist.

## Examples

Read [examples.md](references/examples.md) for command and JSON examples. The repository intentionally ships no test media or transcript corpus.
