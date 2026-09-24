#!/usr/bin/env python3
"""Automated QA pass over a manual PDF: look for blank pages, overflow, missing
images, placeholders, and very sparse pages."""
import sys, re
import pymupdf

path = sys.argv[1]
doc = pymupdf.open(path)
W, H = doc[0].rect.width, doc[0].rect.height
LEFT, RIGHT = 16 * 2.835, W - 16 * 2.835        # the 16mm margins, in points
TOP, BOTTOM = 20 * 2.835, H - 18 * 2.835

issues = []
stats = {'pages': doc.page_count, 'images': 0, 'sparse': [], 'blank': [], 'overflow': [],
         'placeholder': [], 'tiny_text': []}

PLACEHOLDERS = ['<!--TOC-->', 'TODO', 'FIXME', 'Lorem ipsum', '[Insert', 'undefined',
                'None', '{{', '}}', 'nan']

for i, page in enumerate(doc, 1):
    text = page.get_text()
    images = page.get_images(full=True)
    stats['images'] += len(images)
    blocks = page.get_text('blocks')
    ink = len(text.strip())

    if i > 1 and ink < 60 and not images:
        stats['blank'].append(i)
    elif i > 3 and ink < 400 and not images:
        stats['sparse'].append(i)

    for b in blocks:
        x0, y0, x1, y1 = b[:4]
        if x1 > RIGHT + 6 or x0 < LEFT - 6:
            stats['overflow'].append((i, round(x0), round(x1), b[4][:40].replace('\n', ' ')))
            break

    for ph in PLACEHOLDERS:
        if re.search(r'\b' + re.escape(ph) + r'\b', text) if ph.isalpha() else ph in text:
            stats['placeholder'].append((i, ph))

    for span in [s for blk in page.get_text('dict')['blocks'] if 'lines' in blk
                 for line in blk['lines'] for s in line['spans']]:
        if span['size'] < 5.5 and span['text'].strip():
            stats['tiny_text'].append((i, round(span['size'], 1), span['text'][:30]))
            break

print(f'== {path}')
print(f'pages: {stats["pages"]}   embedded images: {stats["images"]}')
print(f'blank pages (after the cover): {stats["blank"] or "none"}')
print(f'very sparse pages: {stats["sparse"] or "none"}')
print(f'content outside the margins: {stats["overflow"][:8] or "none"}')
print(f'unresolved placeholders: {stats["placeholder"] or "none"}')
print(f'text below 5.5pt: {stats["tiny_text"][:5] or "none"}')
