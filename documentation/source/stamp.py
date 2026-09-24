#!/usr/bin/env python3
"""Stamp a running footer (title + page number) on every page of a manual PDF
except the cover, and add PDF bookmarks for the sections."""
import sys, json
import pymupdf

pdf_path, title, toc_json = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else None)

doc = pymupdf.open(pdf_path)
total = doc.page_count
NAVY = (0.051, 0.137, 0.341)
GREY = (0.357, 0.404, 0.459)

for i, page in enumerate(doc):
    if i == 0:
        continue                                  # the cover carries no footer
    w, h = page.rect.width, page.rect.height
    y = h - 30
    page.draw_line(pymupdf.Point(45, y - 10), pymupdf.Point(w - 45, y - 10),
                   color=(0.843, 0.867, 0.902), width=0.6)
    page.insert_text(pymupdf.Point(45, y + 2), title, fontname="helv", fontsize=7.5, color=GREY)
    label = f"Page {i + 1} of {total}"
    tw = pymupdf.get_text_length(label, fontname="helv", fontsize=7.5)
    page.insert_text(pymupdf.Point(w - 45 - tw, y + 2), label, fontname="helv", fontsize=7.5, color=NAVY)

if toc_json:
    entries = json.load(open(toc_json))
    doc.set_toc([[e["level"], e["title"], e["page"]] for e in entries])

doc.saveIncr() if doc.can_save_incrementally() else doc.save(pdf_path + ".tmp")
try:
    import os
    if os.path.exists(pdf_path + ".tmp"):
        os.replace(pdf_path + ".tmp", pdf_path)
except Exception as e:
    print("save:", e)
print(f"stamped {total} pages")
