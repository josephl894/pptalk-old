"""Build a small 3-page PDF fixture for SPEC-7 tests.

Idempotent: regenerates the file at fixtures/three_page.pdf with three text-only
pages so the parse path's PyMuPDF step has real text to extract per page.

Usage (from pipeline/ in any worktree):
    uv run python /Users/joseph/Desktop/pptalk/.claude/qa/spec-7/fixtures/build_fixture.py
or from the qa worktree:
    cd pipeline && uv run python ../.claude/qa/spec-7/fixtures/build_fixture.py
"""

from pathlib import Path
import fitz


def build(out_path: Path) -> None:
    doc = fitz.open()
    pages = [
        ("SPEC-7 fixture page 1", "Title slide for the parse test."),
        ("SPEC-7 fixture page 2", "Body slide; expects body extraction."),
        ("SPEC-7 fixture page 3", "Closing slide for end-state assertions."),
    ]
    for title, body in pages:
        page = doc.new_page(width=720, height=540)
        page.insert_text((40, 80), title, fontsize=28)
        page.insert_text((40, 140), body, fontsize=14)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)
    doc.close()


if __name__ == "__main__":
    here = Path(__file__).parent
    build(here / "three_page.pdf")
    print(f"wrote {here / 'three_page.pdf'}")
