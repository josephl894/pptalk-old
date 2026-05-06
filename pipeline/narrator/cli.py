import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import typer
from rich.console import Console


def _emit(event: str, **kwargs) -> None:
    """Emit a JSON status event to stderr for machine-readable progress."""
    sys.stderr.write(json.dumps({"event": event, **kwargs}) + "\n")
    sys.stderr.flush()

NARRATE_CONCURRENCY = 3
TTS_CONCURRENCY = 8

from .parse import parse
from .render import rasterize
from .script import generate_slide_script, summarize_deck
from .tts import synthesize
from .usage import (
    CSV_PATH as USAGE_CSV,
    RUNS_CSV_PATH as RUNS_CSV,
    get_run_total,
    log_run,
    start_run,
)
from .video import render_video


@contextmanager
def _timed(times: dict, name: str):
    t = time.monotonic()
    try:
        yield
    finally:
        times[name] = time.monotonic() - t


def _video_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            str(path),
        ],
    )
    return float(json.loads(out)["format"]["duration"])

app = typer.Typer(add_completion=False)
console = Console()


@app.command()
def render(
    pptx: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    out: Path = typer.Option(..., "--out", "-o", help="Output MP4 path"),
    voice: str = typer.Option("onyx", "--voice", "-v", help="OpenAI TTS voice"),
    work_dir: Path = typer.Option(None, "--work-dir", help="Intermediate artifacts directory"),
    max_slides: int = typer.Option(0, "--max-slides", help="Limit to first N slides (0 = all)"),
):
    """Render a PPTX into a narrated MP4 (one-shot, no DB / Storage)."""
    work = work_dir or out.parent / f"{out.stem}_work"
    work.mkdir(parents=True, exist_ok=True)

    run_id = start_run(pptx.name)
    timestamp_utc = datetime.now(timezone.utc).isoformat()
    console.print(f"[dim]Run id: {run_id}[/]")
    _emit("run_start", run_id=run_id, pptx=pptx.name)

    times: dict[str, float] = {}
    t_wall = time.monotonic()

    console.print(f"[bold cyan]Parsing[/] {pptx.name}")
    _emit("phase_start", phase="parse")
    with _timed(times, "parse"):
        slides = parse(pptx)
    console.print(f"  -> {len(slides)} slides")
    _emit("phase_done", phase="parse", duration=times["parse"], num_slides=len(slides))

    console.print(f"[bold cyan]Rasterizing slides[/] (LibreOffice -> PDF -> PNG)")
    _emit("phase_start", phase="rasterize")
    with _timed(times, "rasterize"):
        pngs = rasterize(pptx, work / "slides")
    console.print(f"  -> {len(pngs)} PNGs")
    _emit("phase_done", phase="rasterize", duration=times["rasterize"])

    if max_slides > 0:
        slides = slides[:max_slides]
        pngs = pngs[:max_slides]
        console.print(f"  -> limited to first {max_slides} slides")

    if len(slides) != len(pngs):
        raise RuntimeError(
            f"Slide count mismatch: parsed {len(slides)}, rasterized {len(pngs)}"
        )

    console.print(f"[bold cyan]Summarizing deck[/]")
    _emit("phase_start", phase="summarize")
    with _timed(times, "summarize"):
        summary = summarize_deck(slides)
    console.print(f"  -> {summary}")
    _emit("phase_done", phase="summarize", duration=times["summarize"], summary=summary)

    console.print(f"[bold cyan]Generating narration[/] (parallel x{NARRATE_CONCURRENCY})")
    _emit("phase_start", phase="narrate", total=len(slides))
    scripts_by_idx: dict[int, str] = {}
    with _timed(times, "narrate"):
        with ThreadPoolExecutor(max_workers=NARRATE_CONCURRENCY) as ex:
            futures = {
                ex.submit(generate_slide_script, slide, png, summary): slide
                for slide, png in zip(slides, pngs)
            }
            for fut in as_completed(futures):
                slide = futures[fut]
                scripts_by_idx[slide.index] = fut.result()
                preview = scripts_by_idx[slide.index][:120]
                console.print(f"  Slide {slide.index}: {preview[:80]}...")
                _emit(
                    "slide_done",
                    phase="narrate",
                    index=slide.index,
                    title=slide.title or "",
                    preview=preview,
                )
    scripts = [scripts_by_idx[s.index] for s in slides]
    _emit("phase_done", phase="narrate", duration=times["narrate"])

    console.print(f"[bold cyan]Synthesizing audio[/] (voice={voice}, parallel x{TTS_CONCURRENCY})")
    _emit("phase_start", phase="tts", total=len(slides))
    audio_dir = work / "audio"
    mp3s_by_idx: dict[int, Path] = {}

    def _tts_one(slide, text):
        mp3_path = audio_dir / f"slide_{slide.index:03d}.mp3"
        synthesize(text, mp3_path, voice=voice, slide_index=slide.index)
        return slide.index, mp3_path

    with _timed(times, "tts"):
        with ThreadPoolExecutor(max_workers=TTS_CONCURRENCY) as ex:
            futures = {
                ex.submit(_tts_one, slide, scripts_by_idx[slide.index]): slide
                for slide in slides
            }
            for fut in as_completed(futures):
                idx, mp3_path = fut.result()
                mp3s_by_idx[idx] = mp3_path
                console.print(f"  Slide {idx}: {mp3_path.name}")
                _emit("slide_done", phase="tts", index=idx)
    mp3s = [mp3s_by_idx[s.index] for s in slides]
    _emit("phase_done", phase="tts", duration=times["tts"])

    console.print(f"[bold cyan]Encoding video[/] (single-pass ffmpeg, ultrafast)")
    _emit("phase_start", phase="encode")
    out.parent.mkdir(parents=True, exist_ok=True)
    with _timed(times, "encode"):
        render_video(pngs, mp3s, out)
    _emit("phase_done", phase="encode", duration=times["encode"])

    wall = time.monotonic() - t_wall
    video_dur = _video_duration(out)
    video_bytes = out.stat().st_size
    cost = get_run_total(run_id)

    console.print(f"[bold green]Done[/] -> {out}")
    console.print()
    console.print("[bold]Time breakdown[/]")
    for name in ("parse", "rasterize", "summarize", "narrate", "tts", "encode"):
        console.print(f"  {name:11s} {times.get(name, 0):7.2f}s")
    console.print(f"  {'wall_clock':11s} {wall:7.2f}s")
    console.print(
        f"[dim]Run cost: ${cost:.4f}  |  Output: {video_dur:.1f}s, {video_bytes/1_000_000:.1f}MB[/]"
    )
    console.print(f"[dim]Logs: {USAGE_CSV}, {RUNS_CSV}[/]")

    _emit(
        "done",
        run_id=run_id,
        out=str(out.resolve()),
        wall_clock=wall,
        cost_usd=cost,
        video_duration=video_dur,
        video_bytes=video_bytes,
    )

    log_run({
        "timestamp_utc": timestamp_utc,
        "run_id": run_id,
        "pptx": pptx.name,
        "num_slides": len(slides),
        "wall_clock_seconds": f"{wall:.3f}",
        "parse_seconds": f"{times.get('parse', 0):.3f}",
        "rasterize_seconds": f"{times.get('rasterize', 0):.3f}",
        "summarize_seconds": f"{times.get('summarize', 0):.3f}",
        "narrate_seconds": f"{times.get('narrate', 0):.3f}",
        "tts_seconds": f"{times.get('tts', 0):.3f}",
        "encode_seconds": f"{times.get('encode', 0):.3f}",
        "video_duration_seconds": f"{video_dur:.3f}",
        "video_bytes": video_bytes,
        "total_cost_usd": f"{cost:.6f}",
    })


@app.command()
def worker(
    worker_id: str = typer.Option(None, "--worker-id", help="Override worker id (default hostname-pid)"),
    kinds: str = typer.Option(
        None,
        "--kinds",
        help="Comma-separated job kinds to claim (default: all). "
             "Choose from: parse_only, full_render, slide_script_regen, slide_tts",
    ),
    poll_interval: float = typer.Option(1.5, "--poll-interval", help="Seconds to sleep when queue is empty"),
):
    """Run the long-lived worker that polls render_jobs and processes them."""
    from .worker import Worker
    kind_list = [k.strip() for k in kinds.split(",")] if kinds else None
    w = Worker(worker_id=worker_id, poll_interval_s=poll_interval, kinds=kind_list)
    w.run()


if __name__ == "__main__":
    app()
