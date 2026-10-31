#!/usr/bin/env python3
"""Build the Invenio Field Platform booklet (docs/booklet) as a PDF.

    python3 scripts/build-booklet.py [output.pdf]

The booklet is docs/booklet/booklet.html with its stylesheet and the SVG
diagrams in docs/booklet/diagrams, which the build inlines where the page
says <!-- svg:name -->, and the logos in docs/booklet/images, inlined where
an img says src="images/name.png". It prints the page with headless Google Chrome, finds
the page each chapter starts on with poppler's pdftotext, writes those numbers
into the contents, and prints again. CHROME overrides Chrome's path. Last, it
replaces the browser's name in the PDF's creator and producer fields with the
guide's own, so the file names no tools.
Without pdftotext the contents are printed without page numbers.
"""
import base64
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from html import unescape as html_unescape

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'docs' / 'booklet'
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')


def assemble(page_numbers):
    html = (ROOT / 'booklet.html').read_text(encoding='utf-8')
    html = html.replace('<!-- css -->', '<style>\n' + (ROOT / 'booklet.css').read_text(encoding='utf-8') + '</style>')
    html = re.sub(r'<!--\s*svg:([a-z0-9-]+)\s*-->',
                  lambda m: (ROOT / 'diagrams' / f'{m.group(1)}.svg').read_text(encoding='utf-8'), html)
    html = re.sub(r'src="images/([a-z0-9-]+)\.png"',
                  lambda m: 'src="data:image/png;base64,' + base64.b64encode((ROOT / 'images' / f'{m.group(1)}.png').read_bytes()).decode() + '"', html)
    return re.sub(r'<span class="toc-page" data-for="([a-z0-9-]+)"></span>',
                  lambda m: f'<span class="toc-page" data-for="{m.group(1)}">{page_numbers.get(m.group(1), "")}</span>', html)


def render(html, pdf):
    with tempfile.TemporaryDirectory() as folder:
        page = pathlib.Path(folder) / 'booklet.html'
        page.write_text(html, encoding='utf-8')
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--generate-pdf-document-outline',
                        f'--print-to-pdf={pdf}', page.as_uri()], check=True, capture_output=True, timeout=180)


def chapter_pages(pdf, html):
    """Each chapter's id and heading come from <h2 data-toc="id">, number and
    title together (part pages list titles without numbers); its page is the
    first page after the contents that has that heading."""
    if not shutil.which('pdftotext'):
        return {}
    titles = {m.group(1): re.sub(r'<[^>]+>', ' ', m.group(2))
              for m in re.finditer(r'<h2 data-toc="([a-z0-9-]+)"[^>]*>(.*?)</h2>', html, re.S)}
    text = subprocess.run(['pdftotext', '-layout', str(pdf), '-'], check=True, capture_output=True, text=True).stdout
    # NFKC turns ligatures such as "ﬃ" back into letters.
    pages = [re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', p)) for p in text.split('\f')]
    contents = next((i for i, p in enumerate(pages) if 'Contents' in p[:200]), 0)
    found = {}
    for key, title in titles.items():
        wanted = re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', html_unescape(title))).strip()
        for number, page in enumerate(pages, start=1):
            if number - 1 > contents and wanted in page:
                found[key] = number
                break
    return found


def clean_metadata(pdf):
    """Overwrite the document information dictionary in place, padded to the
    same length so the cross-reference offsets stay valid."""
    data = pdf.read_bytes()
    ref = re.search(rb'/Info (\d+) 0 R', data[data.rfind(b'trailer'):])
    start = data.find(b'\n' + ref.group(1) + b' 0 obj\n') if ref else -1
    if start < 0:
        return
    head = data.index(b'<<', start)
    tail = data.index(b'>>\nendobj', head) + 2
    old = data[head:tail]
    title = re.search(rb'/Title (\((?:\\.|[^\\)])*\))', old)
    dates = re.findall(rb'/(?:CreationDate|ModDate) \([^)]*\)', old)
    new = (b'<</Title ' + (title.group(1) if title else b'(Invenio Field Platform field guide)')
           + b'\n/Author (Kindred Industrial Services and Invenio Technologies)'
           + b'\n/Creator (Invenio Field Platform)\n/Producer (Invenio Field Platform)\n' + b'\n'.join(dates))
    if len(new) + 2 > len(old):
        return
    pdf.write_bytes(data[:head] + new + b' ' * (len(old) - len(new) - 2) + b'>>' + data[tail:])


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'Invenio-Field-Platform-booklet.pdf').resolve()
    render(assemble({}), out)
    numbers = chapter_pages(out, (ROOT / 'booklet.html').read_text(encoding='utf-8'))
    if numbers:
        render(assemble(numbers), out)
    clean_metadata(out)
    print(f'{out} ({len(numbers)} chapters numbered)')


if __name__ == '__main__':
    main()
