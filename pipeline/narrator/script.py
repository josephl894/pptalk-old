import base64
import re
import time
from pathlib import Path
from typing import Callable

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

# Largest slide count safe to fit in a single batched call under the
# `max(2000, 200 * N)` output budget. Tune here if the budget changes.
BATCH_CHUNK_SIZE = 40


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
    *,
    previous_context: str | None = None,
) -> dict[int, str]:
    """Generate narrations for the given slides in a single batched Haiku call.

    The model receives all slide images interleaved with their text in one user
    message and returns all narrations delimited by `<<<SLIDE N>>>` markers.
    Returns `{slide.index: narration}` keyed by 1-based slide index.

    `previous_context`, when set, is the last narration of the previous chunk
    in a chunked-batch run; it's passed to the model as a transition hint so
    the first slide in this chunk flows naturally from the prior chunk's end.

    Raises if `len(slides)` would push `max_tokens` above Haiku's 8K output
    ceiling — callers handling decks larger than `BATCH_CHUNK_SIZE` should use
    `generate_all_scripts_chunked` instead.
    """
    if len(slides) != len(png_paths):
        raise ValueError(f"slides ({len(slides)}) and png_paths ({len(png_paths)}) length mismatch")
    if not slides:
        return {}

    first_idx = slides[0].index
    last_idx = slides[-1].index
    intro = f"Deck summary: {deck_summary}\n\n"
    if previous_context:
        intro += (
            "You already narrated earlier slides; the previous narration ended:\n"
            f'"""{previous_context.strip()}"""\n'
            "Continue naturally from there.\n\n"
        )
    intro += (
        f"Narrate the {len(slides)} slides below in order. "
        f"Each slide carries its 1-based deck index in its 'Slide N' header — "
        f"use that exact number in the `<<<SLIDE N>>>` delimiter you emit "
        f"(this batch covers indices {first_idx} through {last_idx})."
    )

    content: list[dict] = [{"type": "text", "text": intro}]
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
            f"use generate_all_scripts_chunked() (chunk_size <= {BATCH_CHUNK_SIZE})."
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
    # NOTE: usage_events.csv has no `chunk_index` column today; chunked runs
    # write one row per chunk all under `call_type="batched_slide_scripts"`.
    # Add a column if/when we want per-chunk attribution.
    log_anthropic(
        model=MODEL,
        call_type="batched_slide_scripts",
        usage=msg.usage,
        duration_seconds=time.monotonic() - start,
    )

    raw = msg.content[0].text
    return _parse_batched_response(raw, [s.index for s in slides])


def generate_all_scripts_chunked(
    slides: list[Slide],
    png_paths: list[Path],
    deck_summary: str,
    *,
    chunk_size: int = BATCH_CHUNK_SIZE,
    on_chunk_done: Callable[[list[Slide], dict[int, str]], None] | None = None,
) -> dict[int, str]:
    """Batched narration that splits decks larger than `chunk_size` into chunks.

    For decks of size <= `chunk_size`, this is a single call to
    `generate_all_scripts`. For larger decks, slides are split into sequential
    chunks of size <= `chunk_size`, each run as one batched call. The previous
    chunk's last narration is passed forward as a transition hint so continuity
    survives the chunk boundary.

    `on_chunk_done(chunk_slides, chunk_scripts)` (optional) fires after each
    chunk completes — useful for streaming progress / persisting partial state.
    """
    if len(slides) != len(png_paths):
        raise ValueError(f"slides ({len(slides)}) and png_paths ({len(png_paths)}) length mismatch")
    if chunk_size <= 0 or chunk_size > BATCH_CHUNK_SIZE:
        raise ValueError(f"chunk_size must be in 1..{BATCH_CHUNK_SIZE}, got {chunk_size}")
    if not slides:
        return {}

    out: dict[int, str] = {}
    prev_tail: str | None = None
    for start in range(0, len(slides), chunk_size):
        chunk_slides = slides[start:start + chunk_size]
        chunk_pngs = png_paths[start:start + chunk_size]
        chunk_scripts = generate_all_scripts(
            chunk_slides, chunk_pngs, deck_summary,
            previous_context=prev_tail,
        )
        out.update(chunk_scripts)
        prev_tail = chunk_scripts[chunk_slides[-1].index]
        if on_chunk_done is not None:
            try:
                on_chunk_done(chunk_slides, chunk_scripts)
            except Exception:
                pass
    return out


_DELIMITER_RE = re.compile(r"<<<SLIDE\s+(\d+)\s*>>>", re.IGNORECASE)


def _parse_batched_response(raw: str, expected_indices: list[int]) -> dict[int, str]:
    """Split a batched narration response on `<<<SLIDE N>>>` markers.

    Validates that every expected slide index is present and that the response
    contains no unexpected (extra) slide indices.
    """
    matches = list(_DELIMITER_RE.finditer(raw))
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

    expected_set = set(expected_indices)
    missing = sorted(expected_set - set(out))
    extra = sorted(set(out) - expected_set)
    if missing or extra:
        raise RuntimeError(
            f"Batched narration response slide-index mismatch. "
            f"missing={missing} extra={extra} got={sorted(out.keys())}"
        )
    return out
