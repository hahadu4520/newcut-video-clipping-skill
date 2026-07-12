# Quality Check

## Content

- Read every selected range in context.
- Preserve necessary question, subject, evidence, example, and final conclusion.
- Do not truncate a viewpoint to hit a preferred duration.
- Confirm the hook is a verbatim quote and appears again in the body.

## Boundaries

- Preserve natural pre-roll and tail padding.
- Confirm the first and last spoken characters are audible.
- Confirm the ending includes the final semantic conclusion, not only a grammatical stop.

## Cleanup

- Review every model-marked deletion.
- Reject deletions that alter meaning, emphasis, or the hook.
- Listen for abrupt audio or visual jumps after cleanup.

## Captions and titles

- Bottom captions stay on one line.
- Caption edges contain no punctuation.
- Caption chunks are complete phrases and do not split words.
- Explicit title lines each express complete meaning.
- Title and captions remain inside safe areas and do not cover faces.

## Output

- FFprobe can parse every MP4.
- Duration is positive and plausible.
- No unexpected black frames, silence, or A/V drift.
- Keep edit plans and resolved clip JSON for audit.
