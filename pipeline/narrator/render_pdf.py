"""Rasterize a PDF deck to per-page PNGs via PyMuPDF (no LibreOffice — input is already PDF)."""

from pathlib import Path

import fitz


def rasterize(pdf_path: Path, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as exc:
        raise RuntimeError(f"Failed to open PDF {pdf_path}: {exc}") from exc

    pngs: list[Path] = []
    try:
        for i, page in enumerate(doc, start=1):
            pix = page.get_pixmap(dpi=144)
            png_path = out_dir / f"slide_{i:03d}.png"
            pix.save(str(png_path))
            pngs.append(png_path)
    finally:
        doc.close()

    return pngs
