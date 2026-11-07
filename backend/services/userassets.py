"""User-provided asset services (bring-your-own mode).

Honesty contract:
- Brand guideline parsing is rule-based text extraction (regex over common
  guideline phrasing). Labeled ``rule_based_extraction`` — NOT AI.
- Style-reference image analysis is deterministic computer vision (Pillow:
  dominant palette, luminance/saturation stats, edge density). Labeled
  ``heuristic_vision`` — NOT live multimodal AI. It informs palette/mood
  context; it never overrides hard-rule validation.
"""

from __future__ import annotations

import io
import re
from dataclasses import asdict, dataclass, field

_HEX_RE = re.compile(r"#([0-9a-fA-F]{6})\b")
_FONT_RE = re.compile(
    r"(?:font|typeface|type family|font family)\s*[:\-]\s*[\"']?"
    r"([A-Za-z0-9][A-Za-z0-9\- ]{1,38}?"
    r"(?=\s*(?:,|\.| and\b| for\b| as\b|$)))", re.I)
_FONT_SUFFIX_RE = re.compile(r"\s+(?:for|as)\b.*$", re.I)
_MIN_FONT_RE = re.compile(
    r"(?:minimum|min\.?|at least|no smaller than)\s+(\d{1,3})\s*(?:pt|point|px|pixels?)", re.I)
_LOCKED_RESIZE_RE = re.compile(
    r"(?:never|do not|must not|don't)\s+(?:move|resize|reposition|change|alter)\s+(?:the\s+)?([\w \-]+)", re.I)
_FORBIDDEN_LEAD_RE = re.compile(
    r"(?:forbidden|prohibited|never say|do not say|banned|avoid)\s*[:\-]?\s*(.+)", re.I)

ROLE_HINTS = {
    "logo": "brand", "brand": "brand", "headline": "headline", "title": "headline",
    "product": "hero", "hero": "hero", "packshot": "hero", "image": "hero",
    "cta": "cta", "button": "cta", "subhead": "subhead", "tagline": "subhead",
}


@dataclass
class BrandGuidelines:
    name: str = "Custom brand"
    wordmark: str = ""
    tagline: str = ""
    colors: list[dict] = field(default_factory=list)
    typography: dict[str, dict] = field(default_factory=dict)
    sample_copy: dict[str, str] = field(default_factory=dict)
    visual_rules: list[str] = field(default_factory=list)
    copy_rules: list[str] = field(default_factory=list)
    tone: str = ""
    palette: list[str] = field(default_factory=list)
    fonts: list[str] = field(default_factory=list)
    min_font_size: dict[str, float] = field(default_factory=dict)
    locked_roles: list[str] = field(default_factory=list)
    forbidden_phrases: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    provenance: str = "rule_based_extraction"
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def parse_brand_guidelines(text: str) -> BrandGuidelines:
    g = BrandGuidelines()
    low = text.lower()
    title = re.search(r"^#\s+(.+?)(?:\s+[—–-]\s+Brand Guidelines|\s+Brand Guidelines)\s*$", text, re.M | re.I)
    if title:
        g.name = title.group(1).strip()
    logo = re.search(r"Primary logo:\s*([^\n]+)", text, re.I)
    mark = re.search(r"`([^`]+)`", logo.group(1)) if logo else None
    g.wordmark = mark.group(1) if mark else g.name
    tagline = re.search(r"\*\*Tagline:\*\*\s*(.+)", text)
    if tagline:
        g.tagline = tagline.group(1).strip(" *")
    # Markdown tables are read by column, so usage survives alongside each HEX.
    for line in text.splitlines():
        cells = [c.strip().strip("`*") for c in line.strip().strip("|").split("|")]
        if len(cells) >= 4 and re.fullmatch(r"#[0-9a-fA-F]{6}", cells[2]):
            g.colors.append(dict(role=cells[0], name=cells[1], hex=cells[2].lower(), usage=cells[3]))
    for role, pattern in [("headline", "Headlines"), ("body", "Body/UI")]:
        m = re.search(r"\*\*" + re.escape(pattern) + r":\*\*\s*([^\n]+)", text)
        if m:
            value = m.group(1)
            family = value.split(",")[0].split("(")[0].strip().rstrip(".")
            fallback = re.search(r"fallback:\s*([^\)]+)", value)
            g.typography[role] = {"family": family, "fallback": fallback.group(1).strip() if fallback else "Arial"}
    for label, key in [("Hero headline", "headline"), ("Supporting text", "body"), ("CTA", "cta")]:
        m = re.search(r"\*\*" + label + r":\*\*\s*([^\n]+)", text)
        if m:
            g.sample_copy[key] = m.group(1).strip()
    for heading, target in [("Copy rules", g.copy_rules), ("Photography", g.visual_rules), ("Photography and illustration", g.visual_rules), ("Graphic elements", g.visual_rules), ("Color rules", g.visual_rules)]:
        section = re.search(r"^### " + re.escape(heading) + r"\s*\n(.*?)(?=^#{1,3} |\Z)", text, re.M | re.S)
        if section:
            target.extend(line.strip().lstrip("- ") for line in section.group(1).splitlines() if line.strip())
    tone = re.search(r"### Tone of voice\s*\n\s*([^\n]+)", text)
    g.tone = tone.group(1).strip() if tone else ""

    seen: set[str] = set()
    for m in _HEX_RE.finditer(text):
        c = "#" + m.group(1).lower()
        if c not in seen:
            seen.add(c)
            g.palette.append(c)
    if not g.palette:
        g.warnings.append("no hex colors found (expected #rrggbb values)")

    for m in _FONT_RE.finditer(text):
        name = _FONT_SUFFIX_RE.sub("", m.group(1).strip().strip("\"'"))
        if name and name.lower() not in {f.lower() for f in g.fonts}:
            g.fonts.append(name)
    for style in g.typography.values():
        for name in [style["family"], style["fallback"]]:
            if name.lower() not in {f.lower() for f in g.fonts}:
                g.fonts.append(name)

    for m in _MIN_FONT_RE.finditer(low):
        px = float(m.group(1)) * (1.333 if "pt" in m.group(0) or "point" in m.group(0) else 1.0)
        g.min_font_size.setdefault("headline", round(px, 1))
        break  # first explicit minimum wins; role attribution is heuristic

    for m in _LOCKED_RESIZE_RE.finditer(text):
        hint = m.group(1).strip().lower()
        for word, role in ROLE_HINTS.items():
            if word in hint:
                if role not in g.locked_roles:
                    g.locked_roles.append(role)
                break
        else:
            g.warnings.append(f"lock target '{hint}' not mapped to a known role")

    for m in _FORBIDDEN_LEAD_RE.finditer(text):
        payload = m.group(1).strip().strip(".")
        if "|" in payload:
            continue  # A channel-table's Avoid column is not forbidden copy.
        # split compound sections: "Forbidden: X. Prohibited: Y" -> X, Y
        for frag in re.split(r"\.\s+|\n|;\s*(?=(?:prohibited|forbidden|never|avoid|banned|do not)\b)", payload, flags=re.I):
            frag = re.sub(r"^(?:prohibited|forbidden|never say|do not say|banned|avoid)\s*[:\-]?\s*", "", frag, flags=re.I).strip().strip(".")
            if 0 < len(frag) < 120 and frag.lower() not in {p.lower() for p in g.forbidden_phrases}:
                g.forbidden_phrases.append(frag)
    # Quoted phrases in explicit negative copy rules are exact-copy checks.
    for line in g.copy_rules:
        if re.search(r"\b(?:never|avoid|no |do not)\b", line, re.I):
            for phrase in re.findall(r'"([^"\n]+)"', line):
                phrase = phrase.strip(" ,.;")
                if phrase.lower() not in {p.lower() for p in g.forbidden_phrases}:
                    g.forbidden_phrases.append(phrase)

    g.notes.append(
        "Extracted by deterministic rules, not AI; review before relying on it.")
    if not g.forbidden_phrases:
        g.warnings.append("no forbidden-phrase section recognized")
    return g


# ---------------------------------------------------------------------------
# style reference analysis (heuristic vision)
# ---------------------------------------------------------------------------


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rgb


def analyze_style_reference(image_bytes: bytes) -> dict:
    from PIL import Image, ImageFilter, ImageStat

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    w, h = img.size
    small = img.copy()
    small.thumbnail((160, 160))

    # dominant palette via adaptive quantization
    q = small.quantize(colors=5, method=Image.Quantize.MEDIANCUT)
    palette = q.getpalette()[:15]
    counts = sorted(q.getcolors(), reverse=True)
    total = sum(c for c, _ in counts) or 1
    colors = []
    for count, idx in counts[:5]:
        r, g, b = palette[idx * 3: idx * 3 + 3]
        colors.append({"hex": _rgb_to_hex((r, g, b)), "share": round(count / total, 3)})

    stat = ImageStat.Stat(small)
    mean_rgb = stat.mean[:3]
    luminance = sum(m * c for m, c in zip(mean_rgb, (0.2126, 0.7152, 0.0722))) / 255

    sat = ImageStat.Stat(small.convert("HSV")).mean[1] / 255

    warm = sum(1 for px in small.getdata() if px[0] > px[2] + 12) / (small.width * small.height)

    edges = small.convert("L").filter(ImageFilter.FIND_EDGES)
    edge_density = ImageStat.Stat(edges).mean[0] / 255

    return {
        "width": w,
        "height": h,
        "orientation": "portrait" if h > w else "landscape" if w > h else "square",
        "dominant_colors": colors,
        "mean_luminance": round(luminance, 3),
        "mean_saturation": round(sat, 3),
        "warm_pixel_share": round(warm, 3),
        "edge_density": round(edge_density, 3),
        "mood": _mood(luminance, sat, warm, edge_density),
        "provenance": "heuristic_vision (deterministic Pillow analysis — not live multimodal AI)",
    }


def _mood(lum: float, sat: float, warm: float, edge: float) -> str:
    parts = []
    parts.append("light" if lum > 0.6 else "dark" if lum < 0.35 else "mid-tone")
    parts.append("vivid" if sat > 0.45 else "muted" if sat < 0.2 else "balanced-saturation")
    parts.append("warm" if warm > 0.55 else "cool" if warm < 0.4 else "neutral-temperature")
    parts.append("busy" if edge > 0.18 else "clean")
    return ", ".join(parts)


def summarize_references(analyses: list[dict]) -> str:
    if not analyses:
        return ""
    n = len(analyses)
    avg_lum = sum(a["mean_luminance"] for a in analyses) / n
    avg_sat = sum(a["mean_saturation"] for a in analyses) / n
    avg_warm = sum(a["warm_pixel_share"] for a in analyses) / n
    palettes = [c["hex"] for a in analyses for c in a["dominant_colors"][:2]]
    top = sorted(set(palettes), key=palettes.count, reverse=True)[:5]
    return (
        f"{n} reference image(s): avg luminance {avg_lum:.2f}, saturation {avg_sat:.2f}, "
        f"warm share {avg_warm:.2f}; recurring colors: {', '.join(top) or 'none'}"
    )
