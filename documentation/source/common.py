"""Shared helpers for assembling the two manuals."""
import os, html
from PIL import Image

PRINT_DPI = 185            # what the screenshots are downsampled to for print
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.print-cache')
COLUMN_MM = 178.0          # A4 width less the 16mm margins
PAIR_MM = (COLUMN_MM - 4) / 2
TALL_H_MM = 128.0          # how tall a phone screenshot is printed
TALL_H_PAIR_MM = 118.0

ROOT = os.path.abspath(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
SHOTS = os.path.join(ROOT, 'documentation', 'screenshots')
ASSETS = os.path.join(ROOT, 'documentation', 'source', 'assets')
CSS = os.path.join(ROOT, 'documentation', 'source', 'manual.css')

ORG = 'BAKENYE UNITY AND DEVELOPMENT SACCO'
MOTTO = 'Together We Grow, Prosper and Build'
DATE = '24 September 2026'
VERSION = '1.0'


def fig(path, caption, cls='', number=None, in_pair=False):
    """A screenshot with a caption, sized from its own aspect ratio so the page
    layout is predictable: wide screens fill the column, tall phone screens are
    given a fixed printed height."""
    full = os.path.join(SHOTS, path)
    if not os.path.exists(full):
        raise FileNotFoundError(full)
    with Image.open(full) as im:
        w, h = im.size
    ratio = h / w
    if ratio > 1.4:                                   # a phone screen
        height = TALL_H_PAIR_MM if in_pair else TALL_H_MM
        style = f'height:{height:.1f}mm;width:{height / ratio:.1f}mm;margin:0 auto;'
    else:                                             # a desktop screen
        width = PAIR_MM if in_pair else COLUMN_MM
        style = f'width:{width:.1f}mm;height:{width * ratio:.1f}mm;'
    # Downsample to what the printed size actually needs, so the PDF stays small
    # enough to email or share without losing legibility.
    printed_mm = float(style.split('width:')[1].split('mm')[0])
    needed = int(printed_mm / 25.4 * PRINT_DPI)
    src = full
    if w > needed:
        os.makedirs(CACHE, exist_ok=True)
        src = os.path.join(CACHE, f'{needed}-' + path.replace('/', '_'))
        if not os.path.exists(src):
            with Image.open(full) as im:
                out = im.convert('RGB').resize((needed, round(h * needed / w)), Image.LANCZOS)
                out.quantize(colors=256).save(src, 'PNG', optimize=True)
    label = f'<b>Screenshot {number}.</b> ' if number else ''
    return (f'<figure class="{cls}"><img style="{style}" src="file://{src}" alt="">'
            f'<figcaption>{label}{caption}</figcaption></figure>')


def pair(a, b):
    return f'<div class="pair">{a}{b}</div>'


def step(no, title, body):
    return (f'<div class="step"><div class="step__head"><span class="step__no">{no}</span>'
            f'<p class="step__title">{title}</p></div>'
            f'<div class="step__body">{body}</div></div>')


def note(title, body, kind='note'):
    return f'<div class="{kind}"><b>{title}</b>{body}</div>'


def table(headers, rows, cls=''):
    th = ''.join(f'<th>{h}</th>' for h in headers)
    trs = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table class="{cls}"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>'


def cover(title, subtitle, prepared_for):
    return f'''
<div class="cover">
  <div class="cover__top">
    <img class="cover__logo" src="file://{ASSETS}/logo.png" alt="">
    <h1 class="cover__org">{ORG}</h1>
    <p class="cover__motto">{MOTTO}</p>
    <div class="cover__rule"></div>
    <h2 class="cover__title">{title}</h2>
    <p class="cover__subtitle">{subtitle}</p>
    <div class="cover__meta">
      <div><strong>Version:</strong> {VERSION}</div>
      <div><strong>Prepared for:</strong> {prepared_for}</div>
      <div><strong>Date:</strong> {DATE}</div>
    </div>
  </div>
  <img class="cover__photo" src="file://{ASSETS}/cover.jpg" alt="">
  <div class="cover__foot"><span>{ORG}</span><span>Digital SACCO Management System</span></div>
</div>'''


def document(title, body_html):
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<link rel="stylesheet" href="file://{CSS}"></head>
<body>{body_html}</body></html>'''
