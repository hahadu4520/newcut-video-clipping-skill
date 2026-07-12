# Provider Configuration

## Existing transcript

Prefer an existing SRT, VTT, JSON, or timestamped text transcript when available. This mode needs no API credential.

## Local Whisper

Install the `whisper` CLI and FFmpeg. Select it with `--asr-provider whisper`.

## Doubao ASR 2.0

Set credentials in the caller's environment or a `.env.local` in the current working directory:

```dotenv
DOUBAO_API_KEY=
DOUBAO_ASR_RESOURCE_ID=volc.seedasr.auc
TOS_BUCKET=
TOS_REGION=
TOS_ENDPOINT=
```

Do not place `.env.local` inside the skill directory. Never commit or print credential values.

For local media without a public URL, configure `tosutil`, then use:

```bash
node <skill-root>/scripts/newcut.mjs prepare-url <video> --output <url-job-dir>
```

Pass the resulting temporary HTTPS URL to the processing command when required by the provider setup.
