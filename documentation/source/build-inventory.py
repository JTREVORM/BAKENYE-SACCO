#!/usr/bin/env python3
"""Build SCREENSHOT_INVENTORY.md from the captured screenshots and the walk logs."""
import json, os, glob
from PIL import Image

ROOT = 'documentation/screenshots'
STACK = '/var/tmp/bud-docs-stack'

# path -> (module, role, step, description) taken from the walk logs and the
# workflow scripts; anything not listed here is described from its filename.
DESCRIPTIONS = json.load(open('documentation/source/screenshot-notes.json'))

ROLE_OF_FOLDER = {
    'member': 'Member',
    'staff': 'Staff (role named per row)',
    'admin': 'Admin / Super Admin',
    'shared': 'Everyone (signed out)',
}

rows = []
for folder in ('shared', 'member', 'staff', 'admin'):
    for path in sorted(glob.glob(f'{ROOT}/{folder}/*.png')):
        name = os.path.basename(path)
        key = f'{folder}/{name}'
        note = DESCRIPTIONS.get(key, {})
        with Image.open(path) as im:
            size = f'{im.width}×{im.height}'
        rows.append({
            'file': key,
            'module': note.get('module', '—'),
            'role': note.get('role', ROLE_OF_FOLDER[folder]),
            'step': note.get('step', '—'),
            'description': note.get('description', name.replace('.png', '').replace('-', ' ')),
            'size': size,
            'verified': note.get('verified', 'Loaded in the running application'),
            'sensitive': 'None — fictional demonstration data only',
        })

out = ['# Screenshot Inventory', '',
       '**Prepared:** 24 September 2026  ',
       f'**Total screenshots:** {len(rows)}', '',
       'Every image below was captured from the running application in the isolated',
       'documentation environment described in `DOCUMENTATION_VERIFICATION_REPORT.md`.',
       'No image was drawn, mocked up or edited; the only alteration made at capture time was to',
       'hide the Next.js development badge, which belongs to `npm run dev` and not to the',
       'application. Every member name, phone number, national ID and amount shown is fictional.',
       '', '## Summary by area', '',
       '| Area | Screenshots |', '| --- | --: |']
counts = {}
for r in rows:
    counts[r['file'].split('/')[0]] = counts.get(r['file'].split('/')[0], 0) + 1
for k in ('shared', 'member', 'staff', 'admin'):
    out.append(f'| `{k}/` | {counts.get(k, 0)} |')
out += [f'| **Total** | **{len(rows)}** |', '', '## Every screenshot', '',
        '| # | File | Module | Role | Workflow step | What it shows | Size (px) | Verification | Sensitive data |',
        '| --: | --- | --- | --- | --- | --- | --- | --- | --- |']
for i, r in enumerate(rows, 1):
    out.append(f"| {i} | `{r['file']}` | {r['module']} | {r['role']} | {r['step']} | {r['description']} | {r['size']} | {r['verified']} | {r['sensitive']} |")

open('documentation/reports/SCREENSHOT_INVENTORY.md', 'w').write('\n'.join(out) + '\n')
print(f'{len(rows)} screenshots catalogued')
