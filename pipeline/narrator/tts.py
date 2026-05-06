import time
from pathlib import Path

from openai import OpenAI

from .config import settings
from .usage import log_openai_tts

_client = OpenAI(api_key=settings.openai_api_key)
_MODEL = "gpt-4o-mini-tts"


def synthesize(
    text: str,
    out_path: Path,
    voice: str = "onyx",
    slide_index: int | None = None,
) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    with _client.audio.speech.with_streaming_response.create(
        model=_MODEL,
        voice=voice,
        input=text,
        response_format="mp3",
    ) as response:
        response.stream_to_file(str(out_path))
    duration = time.monotonic() - start
    log_openai_tts(
        model=_MODEL,
        text=text,
        output_bytes=out_path.stat().st_size,
        duration_seconds=duration,
        slide_index=slide_index,
    )
    return out_path
