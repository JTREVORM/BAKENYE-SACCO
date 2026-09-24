#!/usr/bin/env python3
"""Two-pass manual build: render once to find where each section falls, write the
contents page with real page numbers, render again, then stamp footers and
PDF bookmarks."""
import json, os, re, subprocess, sys

ROOT = '/home/user/BAKENYE-SACCO'
STACK = '/var/tmp/bud-docs-stack'
SRC = f'{ROOT}/documentation/source'


def render(html_path, pdf_path):
    subprocess.run(['node', f'{SRC}/render-pdf.mjs', html_path, pdf_path],
                   check=True, cwd=ROOT, capture_output=True)


def page_of(doc, needle):
    """The 1-based page a heading first appears on."""
    for i, page in enumerate(doc):
        if page.search_for(needle, quads=False):
            return i + 1
    return None


def build(module, out_html, out_pdf, footer_title):
    sys.path.insert(0, SRC)
    mod = __import__(module)
    html, titles = mod.build()
    open(out_html, 'w').write(html)

    draft = f'{STACK}/_draft.pdf'
    render(out_html, draft)

    import pymupdf
    doc = pymupdf.open(draft)
    entries, toc_rows = [], []
    for i, title in enumerate(titles, 1):
        heading = f'{i}. {title}'
        p = page_of(doc, heading)
        entries.append({'level': 1, 'title': heading, 'page': p or 1})
        toc_rows.append(f'<li class="toc__sec">{heading}'
                        f'<span style="float:right">{p}</span></li>')
    # Front matter and contents themselves
    front = page_of(doc, 'Document control') or 2
    contents = page_of(doc, 'Contents') or 3
    doc.close()

    toc_html = ('<ol>'
                f'<li class="toc__sec">Document control<span style="float:right">{front}</span></li>'
                + ''.join(toc_rows) + '</ol>')
    html = html.replace('<!--TOC-->', f'<div class="toc">{toc_html}</div>')
    open(out_html, 'w').write(html)

    render(out_html, out_pdf)

    bookmarks = [{'level': 1, 'title': 'Cover', 'page': 1},
                 {'level': 1, 'title': 'Document control', 'page': front},
                 {'level': 1, 'title': 'Contents', 'page': contents}] + entries
    bm_path = f'{STACK}/_bookmarks.json'
    json.dump(bookmarks, open(bm_path, 'w'))
    subprocess.run(['python3', f'{SRC}/stamp.py', out_pdf, footer_title, bm_path], check=True)

    import pymupdf as fitz
    d = fitz.open(out_pdf)
    print(f'{out_pdf}: {d.page_count} pages, {len(titles)} sections')
    d.close()


if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
