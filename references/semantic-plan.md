# Semantic Plan Contract

Use raw `U` indexes from `语义审阅稿.md`. Do not type rounded seconds.

```json
[
  {
    "index": 1,
    "title": "Short grounded viewpoint title",
    "titleLines": ["Complete topic line", "Complete conclusion line"],
    "coreViewpoint": "One-sentence claim grounded in the selected transcript",
    "startUtteranceIndex": 120,
    "endUtteranceIndex": 138,
    "hook": {
      "startUtteranceIndex": 131,
      "endUtteranceIndex": 132,
      "appeal": ["counterintuitive", "clear benefit"],
      "reason": "Why this exact quote is the strongest opening"
    },
    "transition": {
      "durationMs": 300,
      "preset": "dip-to-black"
    },
    "cleanup": {
      "enabled": true,
      "removeUtteranceRanges": [],
      "removeWordRanges": []
    },
    "subtitleCorrections": [],
    "reason": "Why this complete viewpoint is worth publishing"
  }
]
```

## Cleanup

Use `removeUtteranceRanges` for a fully invalid repeated sentence. Use `removeWordRanges` for a filler, false start, or speech mistake inside an otherwise useful utterance.

```json
{
  "startUtteranceIndex": 125,
  "startWordIndex": 3,
  "endUtteranceIndex": 125,
  "endWordIndex": 7,
  "reason": "Abandoned false start repeated correctly immediately afterward"
}
```

Never remove a range that overlaps the hook. Do not mechanically delete every filler word; preserve emphasis, rhythm, and meaning.

## Subtitle corrections

Corrections fix confirmed ASR display errors and do not modify audio:

```json
{
  "utteranceIndex": 127,
  "startWordIndex": 12,
  "endWordIndex": 13,
  "replacement": "Correct product name",
  "reason": "The surrounding discussion identifies this product unambiguously"
}
```

Never use global string replacement for names or technical terms.
