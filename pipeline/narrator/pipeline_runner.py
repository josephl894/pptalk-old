"""Pure pipeline functions — no DB, no Storage.

This module is the I/O-free core of the render pipeline. It takes paths and
data, returns paths and data. It is shared between the one-shot CLI
(`cli.py`'s `render` command) and the worker (`worker.py`).

The worker handles all DB writes and Storage transfers; this module only
calls the underlying domain modules (parse / render / script / tts / video).
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from .parse import Slide, parse as parse_pptx
from .parse_pdf import SourceKind, parse as parse_pdf
from .render import rasterize as rasterize_pptx
from .render_pdf import rasterize as rasterize_pdf
from .script import generate_slide_script, summarize_deck
from .tts import synthesize
from .video import render_video


# Default parallelism (mirrors cli.py defaults pre-1C).
NARRATE_CONCURRENCY = 3
TTS_CONCURRENCY = 8


@dataclass
class ParseResult:
    slides: list[Slide]
    pngs: list[Path]
    aspect_w: int
    aspect_h: int


def parse_and_rasterize(
    source_path: Path,
    source_kind: SourceKind | str,
    work_dir: Path,
) -> ParseResult:
    """Dispatch to the right parser + rasterizer; return slides + PNGs + aspect.

    `work_dir` is where slide PNGs will be written (under `work_dir/slides/`).
    Aspect is read from the first PNG.
    """
    kind = source_kind if isinstance(source_kind, SourceKind) else SourceKind(source_kind)

    if kind == SourceKind.PPTX:
        slides = parse_pptx(source_path)
        pngs = rasterize_pptx(source_path, work_dir / "slides")
    elif kind == SourceKind.PDF:
        slides = parse_pdf(source_path)
        pngs = rasterize_pdf(source_path, work_dir / "slides")
    else:
        raise ValueError(f"Unsupported source_kind: {kind}")

    if len(slides) != len(pngs):
        raise RuntimeError(
            f"Slide count mismatch after parse+rasterize: parsed {len(slides)}, rasterized {len(pngs)}"
        )

    if not pngs:
        raise RuntimeError("Parsed deck has zero slides")

    w, h = Image.open(pngs[0]).size
    return ParseResult(slides=slides, pngs=pngs, aspect_w=w, aspect_h=h)


def generate_scripts(
    slides: list[Slide],
    pngs: list[Path],
    summary: str | None = None,
    *,
    parallel: int = NARRATE_CONCURRENCY,
    on_slide_done=None,
) -> dict[int, str]:
    """Per-slide script generation (parallel). Returns {slide.index: script}.

    If `summary` is None, computes it via `summarize_deck`. Caller can pre-
    compute the summary once across multiple regen calls if desired.

    `on_slide_done(slide, script)` (optional) is invoked from the main thread
    after each slide completes — useful for progress events / DB writes.
    """
    if summary is None:
        summary = summarize_deck(slides)

    if len(slides) != len(pngs):
        raise ValueError(f"slides ({len(slides)}) and pngs ({len(pngs)}) length mismatch")

    scripts: dict[int, str] = {}
    with ThreadPoolExecutor(max_workers=parallel) as ex:
        futures = {
            ex.submit(generate_slide_script, slide, png, summary): slide
            for slide, png in zip(slides, pngs)
        }
        for fut in as_completed(futures):
            slide = futures[fut]
            text = fut.result()
            scripts[slide.index] = text
            if on_slide_done is not None:
                try:
                    on_slide_done(slide, text)
                except Exception:
                    pass
    return scripts


def synthesize_audio(
    scripts: dict[int, str],
    slides: list[Slide],
    voice: str,
    work_dir: Path,
    *,
    parallel: int = TTS_CONCURRENCY,
    on_slide_done=None,
) -> dict[int, Path]:
    """Per-slide TTS (parallel). Returns {slide.index: mp3_path}.

    Files are written to `work_dir/audio/slide_{NNN}.mp3`.
    """
    audio_dir = work_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    def _one(slide: Slide) -> tuple[int, Path]:
        mp3 = audio_dir / f"slide_{slide.index:03d}.mp3"
        synthesize(scripts[slide.index], mp3, voice=voice, slide_index=slide.index)
        return slide.index, mp3

    out: dict[int, Path] = {}
    with ThreadPoolExecutor(max_workers=parallel) as ex:
        futures = {ex.submit(_one, slide): slide for slide in slides if slide.index in scripts}
        for fut in as_completed(futures):
            slide = futures[fut]
            idx, mp3 = fut.result()
            out[idx] = mp3
            if on_slide_done is not None:
                try:
                    on_slide_done(slide, mp3)
                except Exception:
                    pass
    return out


def encode_video(pngs: list[Path], audio_paths: list[Path], out_path: Path) -> Path:
    """Wrap video.render_video. Returns out_path."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    return render_video(pngs, audio_paths, out_path)
