"""Parse a PDF deck into Slide objects via PyMuPDF plain-text extraction (one page = one slide)."""

from enum import Enum
from pathlib import Path

import fitz

from .parse import Slide


class SourceKind(str, Enum):
    PPTX = "pptx"
    PDF = "pdf"


def detect_source_kind(path: Path) -> SourceKind:
    """Heuristic by file extension. Raises if neither pptx nor pdf."""
    ext = path.suffix.lower().lstrip(".")
    if ext == "pptx":
        return SourceKind.PPTX
    if ext == "pdf":
        return SourceKind.PDF
    raise ValueError(f"Unsupported source extension: .{ext}")


def parse(pdf_path: Path) -> list[Slide]:
    try:
        doc = fitz.open(str(pdf_path))
    except Exception as exc:
        raise RuntimeError(f"Failed to open PDF {pdf_path}: {exc}") from exc

    slides: list[Slide] = []
    try:
        for i, page in enumerate(doc.pages()):
            try:
                raw = page.get_text("text") or ""
            except Exception as exc:
                raise RuntimeError(f"Failed to extract text from page {i} of {pdf_path}: {exc}") from exc

            # Split into stripped, non-empty lines preserving order.
            lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
            if lines:
                title = lines[0]
                body = "\n".join(lines[1:]).strip()
            else:
                title = ""
                body = ""

            slides.append(Slide(index=i, title=title, body=body, speaker_notes=""))
    finally:
        doc.close()

    return slides
