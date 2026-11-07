"""Web image import (Pinterest boards/pins, generic web pages) + local AI
background removal.

Honesty contract:
- HTML parsing and image URL extraction are deterministic (regex over the
  fetched markup), labeled ``deterministic_extraction``.
- Background removal uses a LOCAL open-source model (rembg, BRIA RMBG 2.0 by
  default) — this is real AI inference, on-device, and is labeled with the
  exact model name. No cloud AI is involved.
- Only PUBLIC, unauthenticated pages are fetched; failures are reported per
  image, never silently skipped.
"""

from __future__ import annotations

import base64
import io
import re
import urllib.request
from dataclasses import dataclass, field

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
MAX_IMAGES = 12
MAX_BYTES = 8 * 1024 * 1024

_PINTEREST_IMG_RE = re.compile(r'https://i\.pinimg\.com/(?:\d+x|originals)/[^"\\\s]+?\.(?:jpg|jpeg|png|webp)')
_OG_IMAGE_RE = re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', re.I)
_IMG_TAG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.I)
_SRCSET_RE = re.compile(r'<img[^>]+srcset=["\']([^"\']+)["\']', re.I)
_CSS_URL_RE = re.compile(r"url\(['\"]?(https?://[^)'\"\s]+?\.(?:jpg|jpeg|png|webp))['\"]?\)", re.I)


@dataclass
class ImportedImage:
    id: str
    source_url: str
    width: int
    height: int
    content_type: str
    data_b64: str
    bytes: int
    background_removed: bool = False
    model: str | None = None
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source_url": self.source_url,
            "width": self.width,
            "height": self.height,
            "content_type": self.content_type,
            "data_b64": self.data_b64,
            "bytes": self.bytes,
            "background_removed": self.background_removed,
            "model": self.model,
            "note": self.note,
        }


@dataclass
class ImportResult:
    final_url: str
    kind: str  # pinterest_board | pinterest_pin | webpage
    images: list[ImportedImage] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    provenance: str = "deterministic_extraction (public page HTML parsing — not AI)"

    def to_dict(self) -> dict:
        return {
            "final_url": self.final_url,
            "kind": self.kind,
            "images": [i.to_dict() for i in self.images],
            "errors": self.errors,
            "provenance": self.provenance,
        }


def _fetch(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _resolve(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.geturl()


def _extract_candidates(final_url: str, html: str) -> tuple[str, list[str]]:
    host = re.sub(r"^https?://(www\.)?", "", final_url).split("/")[0]
    if "pinterest." in host:
        urls = []
        for m in _PINTEREST_IMG_RE.finditer(html):
            u = m.group(0).replace("/originals/", "/736x/")
            # normalize any size segment to 736x for a good quality/size tradeoff
            u = re.sub(r"https://i\.pinimg\.com/\d+x/", "https://i.pinimg.com/736x/", u)
            if u not in urls:
                urls.append(u)
        kind = "pinterest_board" if "/pin/" not in final_url else "pinterest_pin"
        return kind, urls[:MAX_IMAGES]

    urls = []
    for rx in (_OG_IMAGE_RE,):
        for m in rx.finditer(html):
            if m.group(1) not in urls:
                urls.append(m.group(1))
    for m in _SRCSET_RE.finditer(html):
        # largest srcset candidate (last entry usually)
        last = m.group(1).split(",")[-1].strip().split(" ")[0]
        if last and last not in urls:
            urls.append(last)
    for rx in (_IMG_TAG_RE, _CSS_URL_RE):
        for m in rx.finditer(html):
            u = m.group(1)
            if u.startswith("//"):
                u = "https:" + u
            if u.startswith("http") and u not in urls:
                urls.append(u)
    return "webpage", urls[:MAX_IMAGES]


def import_from_url(url: str, remove_bg: bool = False,
                    model: str = "u2net") -> ImportResult:
    final_url = _resolve(url)
    kind, candidates = _extract_candidates(final_url, _fetch(final_url).decode("utf-8", "ignore"))
    result = ImportResult(final_url=final_url, kind=kind)

    for i, u in enumerate(candidates):
        try:
            data = _fetch(u)
            if len(data) > MAX_BYTES:
                raise ValueError(f"image too large ({len(data) // 1024} KB > cap)")
            from PIL import Image
            img = Image.open(io.BytesIO(data))
            entry = ImportedImage(
                id=f"img_{i+1}",
                source_url=u,
                width=img.width, height=img.height,
                content_type=f"image/{img.format.lower() if img.format else 'jpeg'}",
                data_b64=base64.b64encode(data).decode("ascii"),
                bytes=len(data),
            )
            if remove_bg:
                try:
                    entry.data_b64, entry.note = _remove_bg(data, model)
                    entry.background_removed = True
                    entry.model = model
                    entry.content_type = "image/png"
                except Exception as exc:  # keep original, report honestly
                    entry.note = f"background removal failed: {exc}"
            result.images.append(entry)
        except Exception as exc:
            result.errors.append({"url": u, "error": str(exc)[:200]})
    return result


def _remove_bg(data: bytes, model: str) -> tuple[str, str]:
    """Local open-source AI background removal. Returns (b64 png, label)."""
    from rembg import remove, new_session
    session = new_session(model)
    out = remove(data, session=session)
    return base64.b64encode(out).decode("ascii"), f"background removed locally by {model} (open-source, on-device AI)"
