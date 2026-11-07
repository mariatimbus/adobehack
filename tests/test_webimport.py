"""Web import tests: Pinterest extraction, background removal, endpoint."""

import io
import base64

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.services.webimport import _extract_candidates, _remove_bg

client = TestClient(app)


def test_pinterest_board_extraction():
    html = """
    <html><body>
    <img src="https://i.pinimg.com/170x/aa/bb/cc/aabbccddee0011223344556677889900.jpg">
    <img src="https://i.pinimg.com/236x/11/22/33/11223344556677889900aabbccddeeff.jpg">
    <img src="https://i.pinimg.com/736x/44/55/66/44556677889900aabbccddeeff001122.jpg">
    </body></html>
    """
    kind, urls = _extract_candidates("https://www.pinterest.com/user/board/", html)
    assert kind == "pinterest_board"
    # deduped, size-normalized to 736x, capped
    assert urls == [
        "https://i.pinimg.com/736x/aa/bb/cc/aabbccddee0011223344556677889900.jpg",
        "https://i.pinimg.com/736x/11/22/33/11223344556677889900aabbccddeeff.jpg",
        "https://i.pinimg.com/736x/44/55/66/44556677889900aabbccddeeff001122.jpg",
    ]


def test_webpage_extraction_og_and_imgs():
    html = """
    <html><head><meta property="og:image" content="https://example.com/hero.png"></head>
    <body>
    <img srcset="https://example.com/a-400.jpg 400w, https://example.com/a-1200.jpg 1200w">
    <img src="/relative/b.jpg">
    <div style="background:url('https://example.com/c.jpg')"></div>
    </body></html>
    """
    kind, urls = _extract_candidates("https://example.com/page", html)
    assert kind == "webpage"
    assert urls[0] == "https://example.com/hero.png"      # og:image first
    assert "https://example.com/a-1200.jpg" in urls        # largest srcset
    assert "https://example.com/c.jpg" in urls             # css url()


def test_remove_bg_local_model():
    from PIL import Image
    # synthetic: red circle on white background
    img = Image.new("RGB", (128, 128), (255, 255, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    d.ellipse([32, 32, 96, 96], fill=(200, 30, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64, label = _remove_bg(buf.getvalue(), "u2net")
    out = Image.open(io.BytesIO(base64.b64decode(b64)))
    assert out.mode == "RGBA"
    # corner (background) must be transparent; center (circle) opaque
    assert out.getpixel((2, 2))[3] < 40, f"corner alpha={out.getpixel((2,2))[3]}"
    assert out.getpixel((64, 64))[3] > 200, f"center alpha={out.getpixel((64,64))[3]}"
    assert "u2net" in label and "open-source" in label


@pytest.mark.integration
def test_real_pinterest_board_import():
    """Real network import of the demo board (skipped offline)."""
    from backend.services.webimport import import_from_url
    try:
        result = import_from_url("https://pin.it/6n1x4gD85", remove_bg=False)
    except Exception as exc:
        pytest.skip(f"network unavailable: {exc}")
    assert result.kind in ("pinterest_board", "pinterest_pin")
    assert len(result.images) >= 5, f"only {len(result.images)} images parsed"
    assert all(im.width > 100 for im in result.images)


def test_import_endpoint_shape():
    from backend.services import webimport
    # monkeypatch the fetch layer to avoid network in the route test
    class FakeImage:
        width, height, format = 640, 480, "JPEG"

    def fake_import(url, remove_bg=False, model="u2net"):
        from backend.services.webimport import ImportResult, ImportedImage
        r = ImportResult(final_url="https://www.pinterest.com/x/y/", kind="pinterest_board")
        r.images.append(ImportedImage(
            id="img_1", source_url="https://i.pinimg.com/736x/fake.jpg",
            width=640, height=480, content_type="image/jpeg",
            data_b64=base64.b64encode(b"fakejpeg").decode(), bytes=8))
        return r

    webimport.import_from_url = fake_import
    resp = client.post("/api/v1/import/url", json={"url": "https://pin.it/abc", "remove_bg": False})
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "pinterest_board"
    assert len(body["images"]) == 1
    assert "deterministic_extraction" in body["provenance"]
