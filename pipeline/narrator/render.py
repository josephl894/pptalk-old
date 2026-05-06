import os
import subprocess
from pathlib import Path

import fitz

SOFFICE = os.environ.get("LIBREOFFICE_PATH") or "/Applications/LibreOffice.app/Contents/MacOS/soffice"


def rasterize(pptx_path: Path, out_dir: Path) -> list[Path]:
    if not os.path.exists(SOFFICE):
        raise RuntimeError(
            f"LibreOffice binary not found at {SOFFICE}. "
            "Set LIBREOFFICE_PATH environment variable to override the default macOS path."
        )
    out_dir.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(
        [SOFFICE, "--headless", "--convert-to", "pdf", "--outdir", str(out_dir), str(pptx_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"LibreOffice conversion failed:\n{result.stderr}")

    pdf_path = out_dir / (pptx_path.stem + ".pdf")
    if not pdf_path.exists():
        raise RuntimeError(f"Expected PDF not produced: {pdf_path}")

    doc = fitz.open(str(pdf_path))
    pngs: list[Path] = []
    try:
        for i, page in enumerate(doc, start=1):
            pix = page.get_pixmap(dpi=144)
            png_path = out_dir / f"slide_{i:03d}.png"
            pix.save(str(png_path))
            pngs.append(png_path)
    finally:
        doc.close()

    pdf_path.unlink()
    return pngs
