"""Generate the 6 voice-picker preview MP3s and upload to Supabase Storage.

Each file is a short same-phrase sample so a user can A/B compare voices in
the Voice card play button and the Voice library overlay. The web UI fetches
them by composing the public Storage URL client-side from
`NEXT_PUBLIC_SUPABASE_URL` — no signed URL needed because the bucket is
public-read.

Bucket: `voice-samples` (public). One bucket dedicated to these samples
keeps them out of `pptalk-private`, which holds user-owned content and stays
private. The script creates the bucket on first run if it doesn't exist.

Idempotent: re-running uploads with `upsert=True` and overwrites existing
samples cleanly.

Run from the pipeline directory:
    uv run python scripts/generate_voice_samples.py

Cost is ~$0.001 per voice (about 50 chars × $15/MChar on gpt-4o-mini-tts).
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from narrator.storage import get_client
from narrator.tts import synthesize


BUCKET = "voice-samples"

# Codename → friendly name. Codename keys are canonical (must match the
# `<codename>.mp3` paths the web UI requests); friendly name is only used
# inside the spoken phrase. Keep in sync with `VOICES` in
# `web/components/editor/VoiceLibraryOverlay.tsx`.
VOICES: dict[str, str] = {
    "alloy": "Alloy",
    "echo": "Echo",
    "fable": "Fable",
    "nova": "Nova",
    "onyx": "Onyx",
    "shimmer": "Shimmer",
}


def phrase_for(name: str) -> str:
    return f"Hi, I'm {name}. I'll narrate your slides."


def ensure_bucket(client) -> None:
    """Create the `voice-samples` bucket as public-read if it doesn't exist."""
    try:
        client.storage.create_bucket(BUCKET, options={"public": True})
        print(f"  created bucket {BUCKET!r} (public)")
    except Exception as e:
        # Most likely "already exists" — Supabase returns a 409 / Duplicate
        # error. Other errors propagate.
        msg = str(e).lower()
        if "exists" in msg or "duplicate" in msg or "already" in msg:
            print(f"  bucket {BUCKET!r} already exists")
            return
        raise


def main() -> None:
    client = get_client()
    ensure_bucket(client)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        for codename, name in VOICES.items():
            local = tmp / f"{codename}.mp3"
            text = phrase_for(name)
            print(f"  → {codename} ({name}): {text!r}")
            synthesize(text=text, out_path=local, voice=codename)
            with open(local, "rb") as f:
                client.storage.from_(BUCKET).upload(
                    path=f"{codename}.mp3",
                    file=f,
                    file_options={"content-type": "audio/mpeg", "upsert": "true"},
                )
            print(f"    uploaded {local.stat().st_size:,} bytes → {BUCKET}/{codename}.mp3")

    print(f"\n✓ Uploaded {len(VOICES)} samples to {BUCKET} (public bucket)")


if __name__ == "__main__":
    main()
