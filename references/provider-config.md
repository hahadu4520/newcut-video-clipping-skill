# Provider Configuration

## Ask before transcribing

If the user has not provided a transcript, always present the two choices below and wait for a selection:

| Choice | Cost | Setup | Privacy and speed | Best for |
| --- | --- | --- | --- | --- |
| Local Whisper | No API usage fee | Install Whisper; first run downloads a model | Runs locally; slower on long videos | Privacy, offline use, quick experiments |
| Doubao ASR 2.0 | Usage billed by Volcengine | Activate service and create API Key | Uploads compressed audio; async cloud processing | Chinese accuracy, mixed Chinese/English, word timestamps |

## Existing transcript

Prefer an existing SRT, VTT, JSON, or timestamped text transcript when available. This mode needs no API credential.

## Local Whisper

Install FFmpeg and the OpenAI Whisper CLI:

```bash
python3 -m pip install -U openai-whisper
```

The first transcription downloads the selected model. The download is free, but it uses local disk space and compute.

- `small`: faster and smaller; suitable for the first local test.
- `medium`: slower and larger; usually better for Chinese.

```bash
node <skill-root>/scripts/newcut.mjs process <video> \
  --asr-provider whisper \
  --whisper-model small \
  --output <job-dir>
```

## Doubao ASR 2.0

Official links:

- [Doubao Speech console](https://console.volcengine.com/speech/app)
- [Speech recognition API documentation](https://www.volcengine.com/docs/6561/1354867?lang=zh)
- [Console parameter FAQ](https://www.volcengine.com/docs/6561/196768)

Setup steps:

1. Register or sign in to Volcengine and complete any account verification requested by the console.
2. Open the Doubao Speech console.
3. In service activation, enable the speech-recognition large model and recording-file recognition 2.0.
4. Open API Key management and create an API Key for the current project.
5. In the directory where the command will run, copy `.env.example` to `.env.local`.
6. Fill only your own values locally. Do not paste them into chat and do not commit `.env.local`.

Required fields for the new console:

```dotenv
DOUBAO_API_KEY=
DOUBAO_ASR_RESOURCE_ID=volc.seedasr.auc
```

Paste the API Key as the value of `DOUBAO_API_KEY` in your local file.

`DOUBAO_API_KEY` comes from API Key management. `DOUBAO_ASR_RESOURCE_ID` is the fixed resource identifier for recording-file recognition 2.0; it is not the Secret Access Key.

Older console accounts may expose App ID and Access Token instead. Only for that legacy flow, use:

```dotenv
DOUBAO_APP_KEY=
DOUBAO_ACCESS_TOKEN=
DOUBAO_ASR_RESOURCE_ID=volc.seedasr.auc
```

Verify without printing the secret:

```bash
node <skill-root>/scripts/newcut.mjs doctor
```

Then transcribe:

```bash
node <skill-root>/scripts/newcut.mjs process <video> \
  --asr-provider doubao \
  --output <job-dir>
```

For ordinary local videos, NewCut extracts mono 16 kHz MP3 audio and submits it directly. A public URL is not normally required.

Do not place `.env.local` inside the skill directory. Never commit or print credential values.

If the compressed audio exceeds the direct-upload limit, configure TOS and create a temporary URL:

```dotenv
TOS_BUCKET=
TOS_REGION=
TOS_ENDPOINT=
```

```bash
node <skill-root>/scripts/newcut.mjs prepare-url <video> --output <url-job-dir>
```

Pass the resulting temporary HTTPS URL to the processing command when required by the provider setup.
