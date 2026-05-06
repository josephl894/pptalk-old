import json
import logging
import subprocess
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)

# Aspect-ratio tolerance: 1% relative deviation is treated as "matching" the
# canonical 16:9 (1.7778) or 4:3 (1.3333) ratio.
_ASPECT_TOLERANCE = 0.01


def get_audio_duration(audio_path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def _even(n: int) -> int:
    """libx264 requires even dimensions."""
    return n if n % 2 == 0 else n - 1


def _pick_target_resolution(width: int, height: int) -> tuple[int, int]:
    """Pick a target output resolution that preserves source aspect ratio.

    16:9 within tolerance -> 1920x1080
    4:3  within tolerance -> 1440x1080
    Otherwise: clamp to max 1920 wide / 1080 tall, preserving aspect, even dims.
    """
    aspect = width / height
    if abs(aspect - 16 / 9) / (16 / 9) <= _ASPECT_TOLERANCE:
        return 1920, 1080
    if abs(aspect - 4 / 3) / (4 / 3) <= _ASPECT_TOLERANCE:
        return 1440, 1080

    # Other aspect: scale to fit within 1920x1080, preserving aspect.
    scale = min(1920 / width, 1080 / height, 1.0)
    target_w = _even(int(round(width * scale)))
    target_h = _even(int(round(height * scale)))
    return target_w, target_h


def _aspect_consistent(pngs: list[Path]) -> bool:
    """Return True if all PNGs share the same aspect ratio (within tolerance)."""
    if not pngs:
        return True
    w0, h0 = Image.open(pngs[0]).size
    base = w0 / h0
    for p in pngs[1:]:
        w, h = Image.open(p).size
        if abs((w / h) - base) / base > _ASPECT_TOLERANCE:
            return False
    return True


def render_video(pngs: list[Path], audios: list[Path], out: Path) -> Path:
    """Single-pass render: PNG+audio pairs -> native-aspect MP4 in one ffmpeg call."""
    if len(pngs) != len(audios):
        raise ValueError(f"pngs ({len(pngs)}) and audios ({len(audios)}) must match")

    n = len(pngs)
    durations = [get_audio_duration(a) for a in audios]

    # Detect source dimensions and pick a native-aspect target resolution.
    src_w, src_h = Image.open(pngs[0]).size
    consistent = _aspect_consistent(pngs)

    if consistent:
        target_w, target_h = _pick_target_resolution(src_w, src_h)
        logger.info(
            "render_video: source %dx%d -> target %dx%d (native aspect)",
            src_w, src_h, target_w, target_h,
        )
        scale_filter = (
            f"scale={target_w}:{target_h}:flags=lanczos,setsar=1"
        )
    else:
        # Fallback: mismatched aspect ratios across slides — use legacy
        # letterbox behavior to avoid crashes/distortion on edge cases.
        logger.warning(
            "render_video: PNG aspects inconsistent; falling back to 1920x1080 letterbox"
        )
        target_w, target_h = 1920, 1080
        scale_filter = (
            "scale=1920:1080:force_original_aspect_ratio=decrease,"
            "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
        )

    inputs: list[str] = []
    for png, dur in zip(pngs, durations):
        inputs.extend(["-loop", "1", "-t", f"{dur:.3f}", "-i", str(png)])
    for audio in audios:
        inputs.extend(["-i", str(audio)])

    filter_parts: list[str] = []
    for i in range(n):
        filter_parts.append(f"[{i}:v]{scale_filter}[v{i}]")
    concat_inputs = "".join(f"[v{i}][{n+i}:a]" for i in range(n))
    filter_parts.append(f"{concat_inputs}concat=n={n}:v=1:a=1[outv][outa]")
    filter_complex = ";".join(filter_parts)

    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y",
            *inputs,
            "-filter_complex", filter_complex,
            "-map", "[outv]",
            "-map", "[outa]",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "stillimage",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            str(out),
        ],
        check=True,
        capture_output=True,
    )
    return out


# NOTE: make_segment + stitch are alternates not in the primary code path
# (render_video is the single-pass primary). They exist as fallbacks; the
# native-aspect logic below mirrors render_video for consistency.
def make_segment(png: Path, audio: Path, out: Path) -> Path:
    duration = get_audio_duration(audio)
    src_w, src_h = Image.open(png).size
    target_w, target_h = _pick_target_resolution(src_w, src_h)

    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-loop", "1", "-i", str(png),
            "-i", str(audio),
            "-c:v", "libx264",
            "-tune", "stillimage",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-vf",
            f"scale={target_w}:{target_h}:flags=lanczos,setsar=1",
            "-shortest",
            "-t", f"{duration:.3f}",
            str(out),
        ],
        check=True,
        capture_output=True,
    )
    return out


def stitch(segments: list[Path], out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    list_file = out.parent / "concat.txt"
    list_file.write_text(
        "\n".join(f"file '{seg.resolve()}'" for seg in segments) + "\n"
    )
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            str(out),
        ],
        check=True,
        capture_output=True,
    )
    list_file.unlink()
    return out
