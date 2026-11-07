import base64
import io
from pathlib import Path

import pymupdf as fitz
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import app
from backend.services.pdfimport import extract_pdf, DEFAULT_PINTEREST_PDF


def sample_pdf():
    with fitz.open() as pdf:
        page = pdf.new_page(width=400, height=500)
        page.draw_rect(fitz.Rect(30, 40, 220, 250), color=(0, 0, 0), fill=(.4, 1, 1))
        page.insert_text((50, 90), 'Standard', fontsize=18)
        page.insert_text((50, 120), '$9.99/m', fontsize=16)
        image = Image.new('RGBA', (80, 40), (0, 0, 0, 0))
        image.putpixel((20, 20), (50, 90, 160, 255))
        data = io.BytesIO(); image.save(data, format='PNG')
        page.insert_image(fitz.Rect(50, 150, 130, 190), stream=data.getvalue())
        return pdf.tobytes()


def test_extracts_real_pdf_text_paths_and_alpha_images():
    result = extract_pdf(sample_pdf(), 'references.pdf')
    assert result['counts'] == {'text': 2, 'vector': 1, 'image': 1}
    assert result['element_count'] == 4
    assert result['pages'][0]['width'] == 400
    elements = result['pages'][0]['elements']
    vector = next(e for e in elements if e['kind'] == 'vector')
    assert 'M30.0000,40.0000' in vector['path_data']
    assert vector['fill'] == '#66ffff'
    assert {e['text'] for e in elements if e['kind'] == 'text'} == {'Standard', '$9.99/m'}
    raster = next(e for e in elements if e['kind'] == 'image')
    decoded = Image.open(io.BytesIO(base64.b64decode(raster['image_url'].split(',')[1])))
    assert decoded.mode == 'RGBA' and decoded.getpixel((0, 0))[3] == 0
    assert raster['raster'] is True


def test_supplied_pinterest_pdf_exposes_every_object_and_six_cards():
    result = extract_pdf(DEFAULT_PINTEREST_PDF.read_bytes())
    assert len(result['pages']) == 4
    assert result['counts'] == {'text': 61, 'vector': 8, 'image': 54}
    assert result['element_count'] == 123
    assert len(result['cards']) == 6
    pricing = [c for c in result['cards'] if c['kind'] == 'pricing_card']
    assert {c['label'] for c in pricing} == {'Free', 'Standard', 'Pro'}
    for card in result['cards']:
        ids = {e['id'] for p in result['pages'] for e in p['elements']}
        assert len(card['element_ids']) >= 2
        assert set(card['element_ids']) <= ids
    assert len(result['warnings']) == 2
    assert result['source_id'] == extract_pdf(DEFAULT_PINTEREST_PDF.read_bytes())['source_id']


def test_pdf_import_routes_use_bounded_uploads_and_original_file():
    client = TestClient(app)
    response = client.post('/api/v1/import/pdf', files={'file': ('x.pdf', sample_pdf(), 'application/pdf')})
    assert response.status_code == 200 and response.json()['element_count'] == 4
    bad = client.post('/api/v1/import/pdf', files={'file': ('fake.pdf', b'not a pdf', 'application/pdf')})
    assert bad.status_code == 400
    supplied = client.get('/api/v1/import/pinterest-pdf')
    assert supplied.status_code == 200 and supplied.json()['element_count'] == 123
