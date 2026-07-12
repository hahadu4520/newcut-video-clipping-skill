# NewCut Video Clipping Skill

把中文直播、访谈和长视频自动整理成可发布的观点切片。

## 功能

- 豆包 ASR、Whisper 或已有字幕转录
- 基于完整语义选择独立高光观点，不按关键词和固定时长硬切
- 从原话中提取钩子，并保留正文中的原句
- 清理气口、口吃、口误和无效重说
- 修正 ASR 错别字，生成单行语义字幕
- 生成醒目的两行观点标题
- FFmpeg 批量渲染并保存可审计的编辑计划

## 安装

需要 Node.js 20+、FFmpeg 和 FFprobe。

```bash
git clone https://github.com/hahadu4520/newcut-video-clipping-skill.git \
  ~/.codex/skills/newcut-video-clipping

node ~/.codex/skills/newcut-video-clipping/scripts/newcut.mjs doctor
```

## 使用

当用户只提供视频、没有提供转录稿时，Skill 会先说明并询问使用哪种转录方式：

| 方式 | 特点 |
| --- | --- |
| 本地 Whisper | 免费、本地运行；首次需要下载模型，长视频速度取决于电脑性能 |
| 豆包语音识别 2.0 | 中文和字级时间戳更稳定；需要自行开通火山引擎服务和 API Key，按量计费 |

Skill 必须等待用户选择，不会默认替用户决定。

使用已有字幕：

```bash
node ~/.codex/skills/newcut-video-clipping/scripts/newcut.mjs process input.mp4 \
  --transcript input.srt \
  --output output/job-001
```

使用豆包 ASR：

```bash
cp ~/.codex/skills/newcut-video-clipping/.env.example .env.local
# 在 .env.local 填写自己的凭证，禁止提交该文件

node ~/.codex/skills/newcut-video-clipping/scripts/newcut.mjs process input.mp4 \
  --asr-provider doubao \
  --output output/job-001
```

豆包申请与字段填写见 [Provider Configuration](references/provider-config.md)。API Key 只保存在本机 `.env.local`，不要发送到聊天或提交到 Git。

让 Codex 使用 `$newcut-video-clipping` 阅读 `语义审阅稿.md` 并生成 `semantic-plan.json`，然后渲染：

```bash
node ~/.codex/skills/newcut-video-clipping/scripts/newcut.mjs render \
  --video input.mp4 \
  --transcript output/job-001/semantic-source.json \
  --plan output/job-001/semantic-plan.json \
  --output output/job-001/clips
```

详细计划格式见 [Semantic Plan Contract](references/semantic-plan.md)。

## 案例

### 转行 AI：先找可迁移能力

![转行 AI：先找可迁移能力](examples/01-transferable-skills.gif)

[▶ 播放带声音的完整视频](https://hahadu4520.github.io/newcut-video-clipping-skill/examples/01-transferable-skills.mp4)

### 比较 AI 工具：就跑同一个任务

![比较 AI 工具：就跑同一个任务](examples/02-compare-ai-tools.gif)

[▶ 播放带声音的完整视频](https://hahadu4520.github.io/newcut-video-clipping-skill/examples/02-compare-ai-tools.mp4)

GIF 会在 README 中直接播放；完整视频保留声音和完整时长。

## 安全

仓库不包含 API Key、测试素材或完整转录数据。运行以下命令可检查待发布内容：

```bash
node scripts/validate-public.mjs
```

License: MIT
