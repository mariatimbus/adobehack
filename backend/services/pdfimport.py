"""Extract actual PDF objects; screenshots are never called editable vectors.

PyMuPDF keeps coordinates in the PDF's top-left page space. Original raster
layers retain their alpha masks. Card detection groups existing objects only;
it does not trace screenshots or invent vector paths.
"""
from __future__ import annotations
import base64
import hashlib
import math
from pathlib import Path

MAX_PDF_BYTES = 20 * 1024 * 1024
DEFAULT_PINTEREST_PDF = Path(__file__).resolve().parents[3] / "pinterest.pdf"


def _data_url(data: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def _box(rect) -> list[float]:
    return [round(float(rect[0]), 4), round(float(rect[1]), 4), round(float(rect[2] - rect[0]), 4), round(float(rect[3] - rect[1]), 4)]


def _color(rgb) -> str | None:
    if rgb is None:
        return None
    if len(rgb) == 1:
        rgb = rgb * 3
    return "#" + "".join(f"{round(max(0, min(1, v)) * 255):02x}" for v in rgb[:3])


def _path(items) -> str:
    parts = []
    current = None
    def point(p): return f"{p.x:.4f},{p.y:.4f}"
    for item in items:
        if item[0] == "re":
            r = item[1]
            parts.append(f"M{r.x0:.4f},{r.y0:.4f} L{r.x1:.4f},{r.y0:.4f} L{r.x1:.4f},{r.y1:.4f} L{r.x0:.4f},{r.y1:.4f} Z")
            current = None
        elif item[0] == "l":
            if current != item[1]:
                parts.append(f"M{point(item[1])}")
            parts.append(f"L{point(item[2])}")
            current = item[2]
        elif item[0] == "c":
            if current != item[1]:
                parts.append(f"M{point(item[1])}")
            parts.append(f"C{point(item[2])} {point(item[3])} {point(item[4])}")
            current = item[4]
        elif item[0] == "qu":
            q = item[1]
            parts.append(f"M{point(q.ul)} L{point(q.ur)} L{point(q.lr)} L{point(q.ll)} Z")
            current = None
        else:
            raise ValueError(f"Unsupported PDF path command: {item[0]}")
    return " ".join(parts)


def _inside(inner, outer, padding=2):
    x, y, w, h = inner
    ox, oy, ow, oh = outer
    return ox-padding <= x+w/2 <= ox+ow+padding and oy-padding <= y+h/2 <= oy+oh+padding


def extract_pdf(data: bytes, filename: str = "pinterest.pdf") -> dict:
    import pymupdf as fitz
    if not data.startswith(b"%PDF-"):
        raise ValueError("Choose a valid PDF file.")
    if len(data) > MAX_PDF_BYTES:
        raise ValueError("PDF must be smaller than 20 MB.")
    digest = hashlib.sha256(data).hexdigest()[:16]
    pages, cards, warnings = [], [], []
    with fitz.open(stream=data, filetype="pdf") as document:
        if document.needs_pass:
            raise ValueError("Unlock the PDF before importing it.")
        if len(document) > 20:
            raise ValueError("Import up to 20 PDF pages at a time.")
        for page_index, page in enumerate(document):
            number = page_index + 1
            prefix = f"pdf-{digest}-p{number}"
            elements = []
            log = page.get_bboxlog()
            trace = page.get_texttrace()
            used_images = set()
            for index, drawing in enumerate(page.get_drawings()):
                bbox = _box(drawing['rect'])
                if bbox[2] <= 0 or bbox[3] <= 0:
                    # Include zero-height/width strokes with a visible stroke extent.
                    extent = max(drawing.get('width') or 0, .1)
                    bbox[2], bbox[3] = max(bbox[2], extent), max(bbox[3], extent)
                path = _path(drawing['items'])
                if drawing.get('closePath'):
                    path += ' Z'
                elements.append(dict(id=f"{prefix}-vector-{index}", page_number=number, kind="vector", bbox=bbox,
                    order=drawing['seqno'], path_data=path, fill=_color(drawing.get('fill')),
                    stroke=_color(drawing.get('color')), stroke_width=drawing.get('width') or 0,
                    opacity=drawing.get('fill_opacity') if drawing.get('fill') is not None else drawing.get('stroke_opacity', 1),
                    label=f"Vector shape {index+1}", even_odd=drawing.get('even_odd', False)))
            blocks = page.get_text('dict')['blocks']
            for block in blocks:
                if block['type'] == 1:
                    bbox = _box(block['bbox'])
                    pix = fitz.Pixmap(block['image'])
                    if block.get('mask'):
                        pix = fitz.Pixmap(pix, fitz.Pixmap(block['mask']))
                    if pix.colorspace and pix.colorspace.n != 3:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    encoded = pix.tobytes('png')
                    # Page-space image pixels preserve masks, rotations and clipping.
                    # Axis-aligned images in the supplied PDF need no resampling.
                    order = next((i for i, (kind, b) in enumerate(log) if i not in used_images and kind == 'fill-image' and max(abs(a-c) for a,c in zip(b, block['bbox'])) < .1), block['number'] + 2)
                    used_images.add(order)
                    elements.append(dict(id=f"{prefix}-image-{block['number']}", page_number=number, kind="image", bbox=bbox,
                        order=order, image_url=_data_url(encoded), image_width=pix.width, image_height=pix.height,
                        opacity=1, label=f"Image {block['number']+1}", raster=True))
                elif block['type'] == 0:
                    for line_index, line in enumerate(block['lines']):
                        for span_index, span in enumerate(line['spans']):
                            if not span['text'].strip():
                                continue
                            bbox = _box(span['bbox'])
                            overlap_trace = [t for t in trace if t['font'] == span['font'] and _inside(_box(t['bbox']), bbox, 1)]
                            order = min((t['seqno'] for t in overlap_trace), default=block['number'] + 2)
                            elements.append(dict(id=f"{prefix}-text-{block['number']}-{line_index}-{span_index}", page_number=number,
                                kind="text", bbox=bbox, order=order, text=span['text'], font_size=span['size'],
                                font_name=span['font'], bold=bool(span['flags'] & 16), color=f"#{span['color']:06x}",
                                opacity=span.get('alpha', 255)/255, label=span['text'][:90]))
            elements.sort(key=lambda e: e['order'])
            if any(not all(math.isfinite(n) for n in e['bbox']) for e in elements):
                raise ValueError(f"Invalid element geometry on page {number}.")
            preview = _data_url(page.get_pixmap(matrix=fitz.Matrix(.65, .65), alpha=False).tobytes('png'))
            counts = {kind: sum(e['kind'] == kind for e in elements) for kind in ['text', 'vector', 'image']}
            pages.append(dict(id=prefix, page_number=number, width=page.rect.width, height=page.rect.height,
                preview_url=preview, elements=elements, counts=counts))
            texts = [e for e in elements if e['kind'] == 'text']
            candidates = []
            for image in (e for e in elements if e['kind'] == 'image'):
                box = image['bbox']
                enclosed_text = [e for e in texts if _inside(e['bbox'], box)]
                if box[2] >= 70 and box[3] >= 45 and len(enclosed_text) >= 2:
                    candidates.append((image, enclosed_text))
            # Keep the smallest enclosing card, not the whole screenshot behind it.
            candidates = [(img, tx) for img, tx in candidates if not any(other['id'] != img['id'] and other['bbox'][2]*other['bbox'][3] < img['bbox'][2]*img['bbox'][3]*.9 and _inside(other['bbox'], img['bbox']) for other, _ in candidates)]
            for index, (backing, contained) in enumerate(candidates):
                words = ' '.join(e['text'] for e in contained)
                kind = 'pricing_card' if any(word in words.lower() for word in ['choose plan', '/m', 'projects']) else 'article_card' if 'read more' in words.lower() else 'content_card'
                label = next((e['text'] for e in contained if e['text'].strip().lower() in ['free','standard','pro']), contained[0]['text'])
                members = [e['id'] for e in elements if _inside(e['bbox'], backing['bbox']) and e['bbox'][2]*e['bbox'][3] <= backing['bbox'][2]*backing['bbox'][3]*1.05]
                rect = fitz.Rect(backing['bbox'][0], backing['bbox'][1], backing['bbox'][0]+backing['bbox'][2], backing['bbox'][1]+backing['bbox'][3])
                cards.append(dict(id=f"{prefix}-card-{index}", page_number=number, kind=kind, label=label,
                    bbox=backing['bbox'], element_ids=members,
                    preview_url=_data_url(page.get_pixmap(matrix=fitz.Matrix(1.6,1.6), clip=rect, alpha=False).tobytes('png'))))
            if not texts:
                warnings.append(f"Page {number}: artwork is already rasterized; its original images remain individually selectable. No text/vector tracing was invented.")
    counts = {kind: sum(p['counts'][kind] for p in pages) for kind in ['text','vector','image']}
    return dict(filename=Path(filename).name, source_id=digest, pages=pages, cards=cards, counts=counts,
        element_count=sum(counts.values()), warnings=warnings,
        provenance="pdf_object_extraction (original PDF paths, text spans and raster layers; card grouping is heuristic)")
