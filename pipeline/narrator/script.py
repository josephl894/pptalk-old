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
