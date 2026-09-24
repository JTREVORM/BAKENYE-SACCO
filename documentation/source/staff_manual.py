#!/usr/bin/env python3
"""Assemble the BAKENYE SACCO Staff & Administrator Manual."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import cover, document
import staff_manual_part1 as P


def build():
    parts = [cover('STAFF &amp; ADMINISTRATOR<br>MANUAL', 'Digital SACCO Management System',
                   'Authorised Staff and Administrators')]
    parts.append(f'<div class="section">{P.FRONT}</div>')
    parts.append('<div class="section" id="toc"><h1>Contents</h1><!--TOC--></div>')
    for i, (_level, title, body) in enumerate(P.SECTIONS, 1):
        parts.append(f'<div class="section"><h1>{i}. {title}</h1>{body}</div>')
    return (document('Bakenye SACCO Staff & Administrator Manual', '\n'.join(parts)),
            [t for _, t, _ in P.SECTIONS])


if __name__ == '__main__':
    html_out, titles = build()
    out = sys.argv[1] if len(sys.argv) > 1 else '/var/tmp/bud-docs-stack/staff.html'
    open(out, 'w').write(html_out)
    print(f'{out}: {len(titles)} sections, {P.n[0]} screenshots')
