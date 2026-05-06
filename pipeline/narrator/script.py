import base64
import time
from pathlib import Path

import anthropic

from .config import settings
from .parse import Slide
from .usage import log_anthropic

_client = anthropic.Anthropic(
    api_key=settings.anthropic_api_key,
    max_retries=8,
)

MODEL = "claude-haiku-4-5"

SYSTEM_PROMPT = """You write the spoken narration for a single slide in an instructional video. The narration is read aloud by a TTS voice for an adult-learner audience.

Output rules:
- Output ONLY the narration text. No stage directions, no markdown, no slide numbers, no preambles like "On this slide we see..." or "Now let's look at...".
- Length: 60-120 words for content slides. 20-40 words for title or section/transition slides. Target ~140 words-per-minute spoken pace.
- Tone: clear, professional, lecturer-style. A subject-matter expert delivering training to adult learners. Not chatty, not academic, not sales-y.
- Read the visible content. Where the slide implies more than it states, add the natural connective explanation a good lecturer would speak.
- For charts, diagrams, or images with little text: describe what is visible and explain what it means in context. Do NOT invent specific numerical values, percentages, or labels not present.
- Use natural transitions when given prior-slide context.
- Avoid filler. Every sentence earns its place."""

BATCH_SYSTEM_PROMPT = SYSTEM_PROMPT + """

Batched-deck rules (when given multiple slides at once):
- Return narrations for ALL slides, in order. Do not skip any.
- Use natural transitions between slides since you can see the full deck.
- Output format: prefix each narration with a delimiter line `<<<SLIDE N>>>` on its own line, where N is the slide's 1-based index, then the narration text, then a blank line before the next delimiter.
- Do not output anything before the first `<<<SLIDE 1>>>` delimiter or after the last narration."""

# Haiku 4.5 hard ceiling on output tokens.
_HAIKU_MAX_OUTPUT_TOKENS = 8192


def summarize_deck(slides: list[Slide]) -> str:
    titles = "\n".join(f"  Slide {s.index}: {s.title or '(no title)'}" for s in slides)
    sample_bodies = "\n\n".join(
        f"Slide {s.index} body:\n{s.body[:300]}"
        for s in slides[:5]
        if s.body
    )
    prompt = f"""In 2-3 sentences, summarize what this deck is about and who its intended audience is. Output only the summary, no preamble.

Slide titles:
{titles}

Sample of body content from the first slides:
{sample_bodies}"""

    start = time.monotonic()
    msg = _client.messages.create(
        model=MODEL,
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )
    log_anthropic(
        model=MODEL,
        call_type="deck_summary",
        usage=msg.usage,
        duration_seconds=time.monotonic() - start,
    )
    return msg.content[0].text.strip()


def generate_slide_script(
    slide: Slide,
    png_path: Path,
    deck_summary: str,
) -> str:
    img_b64 = base64.standard_b64encode(png_path.read_bytes()).decode()

    user_text = f"""Deck summary: {deck_summary}

This is slide {slide.index}.
Visible title: {slide.title or "(none)"}
Visible body text:
{slide.body or "(none -- visual content only)"}"""

    start = time.monotonic()
    msg = _client.messages.create(
        model=MODEL,
        max_tokens=400,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": img_b64,
                    },
                },
                {"type": "text", "text": user_text},
            ],
        }],
    )
    log_anthropic(
        model=MODEL,
        call_type="slide_script",
        usage=msg.usage,
        duration_seconds=time.monotonic() - start,
        slide_index=slide.index,
    )
    return msg.content[0].text.strip()


def generate_all_scripts(
    slides: list[Slide],
    png_paths: list[Path],
    deck_summary: str,
) -> dict[int, str]:
    """Generate narrations for every slide in a single batched Haiku call.

    The model receives all slide images interleaved with their text in one user
    message and returns all narrations delimited by `<<<SLIDE N>>>` markers.
    Returns `{slide.index: narration}` keyed by 1-based slide index.
    """
    if len(slides) != len(png_paths):
        raise ValueError(f"slides ({len(slides)}) and png_paths ({len(png_paths)}) length mismatch")
    if not slides:
        return {}

    content: list[dict] = [{
        "type": "text",
        "text": f"Deck summary: {deck_summary}\n\nNarrate all {len(slides)} slides below in order.",
    }]
    for slide, png in zip(slides, png_paths):
        img_b64 = base64.standard_b64encode(png.read_bytes()).decode()
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": img_b64,
            },
        })
        content.append({
            "type": "text",
            "text": (
                f"Slide {slide.index}\n"
                f"Title: {slide.title or '(none)'}\n"
                f"Body:\n{slide.body or '(none -- visual content only)'}"
            ),
        })

    requested_max = max(2000, 200 * len(slides))
    if requested_max > _HAIKU_MAX_OUTPUT_TOKENS:
        raise RuntimeError(
            f"Batched narration would exceed Haiku 4.5 output ceiling "
            f"({_HAIKU_MAX_OUTPUT_TOKENS} tokens) for {len(slides)} slides; "
            "chunked-batch fallback not yet implemented."
        )

    start = time.monotonic()
    msg = _client.messages.create(
        model=MODEL,
        max_tokens=requested_max,
        system=[
            {
                "type": "text",
                "text": BATCH_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": content}],
    )
    log_anthropic(
        model=MODEL,
        call_type="batched_slide_scripts",
        usage=msg.usage,
        duration_seconds=time.monotonic() - start,
    )

    raw = msg.content[0].text
    return _parse_batched_response(raw, [s.index for s in slides])


def _parse_batched_response(raw: str, expected_indices: list[int]) -> dict[int, str]:
    """Split a batched narration response on `<<<SLIDE N>>>` markers.

    Validates that every expected slide index is present.
    """
    import re

    pattern = re.compile(r"<<<SLIDE\s+(\d+)\s*>>>", re.IGNORECASE)
    matches = list(pattern.finditer(raw))
    if not matches:
        raise RuntimeError(
            "Batched narration response missing `<<<SLIDE N>>>` delimiters. "
            f"First 200 chars: {raw[:200]!r}"
        )

    out: dict[int, str] = {}
    for i, m in enumerate(matches):
        idx = int(m.group(1))
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(raw)
        out[idx] = raw[body_start:body_end].strip()

    missing = [i for i in expected_indices if i not in out]
    if missing:
        raise RuntimeError(
            f"Batched narration response missing slides: {missing}. "
            f"Got indices: {sorted(out.keys())}"
        )
    return out
