"""Supabase Storage wrapper for the pipeline worker.

Bucket: `pptalk-private`. Service role key bypasses RLS so the worker can
read/write any user's project files. The web app uses the anon key + RLS.

Path layout (mirrors web/lib/storage.ts):
    {user_id}/{project_id}/source/deck.{pptx|pdf}
    {user_id}/{project_id}/slides/{NNN}.png
    {user_id}/{project_id}/audio/{NNN}.mp3
    {user_id}/{project_id}/renders/{render_id}.mp4
    {user_id}/{project_id}/renders/{render_id}.srt
"""

from __future__ import annotations

from pathlib import Path
from threading import Lock
from typing import Optional
from uuid import UUID

from supabase import Client, create_client

from .config import settings


BUCKET = "pptalk-private"

_client: Optional[Client] = None
_client_lock = Lock()


# ---------------------------------------------------------------------------
# Client (singleton)
# ---------------------------------------------------------------------------

def get_client() -> Client:
    """Return the singleton Supabase client (service role).

    Lazily reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env on first call.
    """
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        _client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
        )
        return _client


# ---------------------------------------------------------------------------
# Pure path helpers
# ---------------------------------------------------------------------------

def source_path(user_id: str | UUID, project_id: str | UUID, ext: str) -> str:
    ext = ext.lstrip(".").lower()
    return f"{user_id}/{project_id}/source/deck.{ext}"


def slide_png_path(user_id: str | UUID, project_id: str | UUID, idx: int) -> str:
    return f"{user_id}/{project_id}/slides/{idx:03d}.png"


def slide_audio_path(user_id: str | UUID, project_id: str | UUID, idx: int) -> str:
    return f"{user_id}/{project_id}/audio/{idx:03d}.mp3"


def render_mp4_path(
    user_id: str | UUID,
    project_id: str | UUID,
    render_id: str | UUID,
) -> str:
    return f"{user_id}/{project_id}/renders/{render_id}.mp4"


def render_srt_path(
    user_id: str | UUID,
    project_id: str | UUID,
    render_id: str | UUID,
) -> str:
    return f"{user_id}/{project_id}/renders/{render_id}.srt"


# ---------------------------------------------------------------------------
# Storage operations
# ---------------------------------------------------------------------------

def _file_options(content_type: str) -> dict:
    # storage3 wants string values for x-upsert. We always upsert because
    # workers may be retrying jobs and overwriting the same path.
    return {
        "content-type": content_type,
        "upsert": "true",
    }


def upload_file(path: str, local_path: Path, content_type: str) -> None:
    """Upload a local file to `path` in the bucket. Upserts."""
    client = get_client()
    with open(local_path, "rb") as f:
        client.storage.from_(BUCKET).upload(
            path=path,
            file=f,
            file_options=_file_options(content_type),
        )


def upload_bytes(path: str, data: bytes, content_type: str) -> None:
    """Upload raw bytes to `path` in the bucket. Upserts."""
    client = get_client()
    client.storage.from_(BUCKET).upload(
        path=path,
        file=data,
        file_options=_file_options(content_type),
    )


def download_to(path: str, local_path: Path) -> None:
    """Download object at `path` to `local_path` on disk."""
    client = get_client()
    data = client.storage.from_(BUCKET).download(path)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    with open(local_path, "wb") as f:
        f.write(data)


def signed_url(path: str, expires_in_s: int = 3600) -> str:
    """Return a time-limited signed URL for the given object path.

    Used to surface media (slide PNGs, MP4s, audio) to the web UI without
    making the bucket public.
    """
    client = get_client()
    resp = client.storage.from_(BUCKET).create_signed_url(path, expires_in_s)
    # Response keys vary by SDK version; prefer signedURL, fall back to signedUrl.
    if isinstance(resp, dict):
        url = resp.get("signedURL") or resp.get("signedUrl")
        if url:
            return url
    raise RuntimeError(f"Unexpected signed URL response shape: {resp!r}")
