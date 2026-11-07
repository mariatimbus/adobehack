"""Deterministic text measurement for overflow checks.

Honesty contract (spec §6 "Text"):
- We cannot measure Adobe's real rendering engine here. When Pillow is
  available we measure with a bundled substitute font (DejaVu) and label the
  method ``estimated_pil_substitute_font``: real deterministic math, but not
  the document's actual typeface — the UI must display this label.
- When Pillow (or font data) is unavailable, ``available()`` is False and the
  validator MUST mark overflow checks ``unknown`` — never ``pass``.
"""

from __future__ import annotations

from functools import lru_cache

METHOD = "estimated_pil_substitute_font"

_available: bool | None = None


def available() -> bool:
    global _available
    if _available is None:
        try:
            from PIL import ImageFont  # noqa: F401
            _available = _check_available()
        except Exception:
            _available = False
    return _available


@lru_cache(maxsize=64)
def _font(px: int):
    from PIL import ImageFont

    candidates = [
        # Linux
        "DejaVuSans.ttf", "DejaVuSans-Bold.ttf",
        # macOS system fonts
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial.ttf",
        # Windows
        "C:/Windows/Fonts/arial.ttf",
    ]
    for name in candidates:
        try:
            return ImageFont.truetype(name, px)
        except Exception:
            continue
    return ImageFont.load_default(px)  # Pillow >= 9.2 scales the default face


def _check_available() -> bool:
    f = _font(24)
    try:
        # a real scalable font must report non-trivial widths
        box = f.getbbox("mmmmmmmmmm")
        return box is not None and (box[2] - box[0]) > 40
    except Exception:
        return False


def text_width(text: str, font_size: float, bold: bool = False) -> float:
    """Single-line rendered width in px at the given font size."""
    f = _font(max(1, int(round(font_size))))
    try:
        box = f.getbbox(text)
        return float(box[2] - box[0])
    except Exception:
        return 0.0


def wrapped_height(text: str, font_size: float, box_width: float, line_height: float = 1.25) -> float:
    """Height of the wrapped text block inside ``box_width`` (word wrap)."""
    words = text.split()
    if not words:
        return 0.0
    space_w = text_width(" ", font_size)
    lines: list[float] = [0.0]
    for w in words:
        ww = text_width(w, font_size)
        if lines[-1] > 0 and lines[-1] + space_w + ww > box_width:
            lines.append(ww)
        else:
            lines[-1] += (space_w if lines[-1] > 0 else 0) + ww
    return len(lines) * font_size * line_height


def fits(text: str, font_size: float, box_width: float, box_height: float,
         pad_px: float = 8.0) -> tuple[bool, float, float]:
    """Return (fits, needed_height, available_height).

    A small padding is subtracted from the box to stay conservative.
    """
    need = wrapped_height(text, font_size, box_width)
    avail = box_height - pad_px
    return need <= avail, need, avail
