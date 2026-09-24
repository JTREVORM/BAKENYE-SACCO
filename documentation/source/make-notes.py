#!/usr/bin/env python3
"""Derive screenshot notes from the walk logs plus a hand-written map for the workflow captures."""
import json, glob, os, re

notes = {}

ROLE_BY_LOG = {
    'walk-log.json': ('admin', 'walk-', 'Super Admin'),
    'walk-member.json': ('member', 'm-', 'Member'),
    'walk-member-full.json': ('member', 'mf-', 'Member'),
    'walk-cashier.json': ('staff', '', 'Cashier / Teller'),
    'walk-lo.json': ('staff', '', 'Loan Officer'),
    'walk-mgr.json': ('staff', '', 'SACCO Manager'),
    'walk-acc.json': ('staff', '', 'Accountant'),
    'walk-fo.json': ('staff', '', 'Field Officer'),
    'walk-after.json': ('staff', '', 'Cashier / Teller'),
    'walk-reports.json': ('staff', '', 'Super Admin'),
}

def module_of(path):
    p = path.split('?')[0]
    table = [
        ('/staff/members', 'Member management'), ('/staff/savings', 'Savings'),
        ('/staff/shares', 'Shares'), ('/staff/loans', 'Loans'),
        ('/staff/transactions', 'Transactions'), ('/staff/finance', 'Finance'),
        ('/staff/reports', 'Reports'), ('/staff/categories', 'Categories'),
        ('/staff/users', 'User management'), ('/staff/roles', 'Roles & permissions'),
        ('/staff/settings', 'Settings'), ('/staff/audit', 'Audit log'),
        ('/staff/notifications', 'Notifications'), ('/staff/profile', 'Staff profile'),
        ('/staff/desk', 'Dashboard'), ('/staff/loans-desk', 'Dashboard'),
        ('/staff/admin', 'Dashboard'), ('/staff', 'Dashboard'),
        ('/savings', 'Member savings'), ('/shares', 'Member shares'),
        ('/loans', 'Member loans'), ('/transactions', 'Member transactions'),
        ('/statements', 'Member statements'), ('/reports', 'Member reports'),
        ('/guarantees', 'Guarantees'), ('/notifications', 'Notifications'),
        ('/profile', 'Member profile'), ('/more', 'Member portal'),
        ('/login', 'Sign in'), ('/forgot-password', 'Sign in'), ('/help', 'Sign in'),
        ('/', 'Member dashboard'),
    ]
    for prefix, mod in table:
        if p == prefix or p.startswith(prefix + '/') or p.startswith(prefix + '?'):
            return mod
    return '—'

for log, (folder, prefix, role) in ROLE_BY_LOG.items():
    p = f'/var/tmp/bud-docs-stack/{log}'
    if not os.path.exists(p):
        continue
    for r in json.load(open(p)):
        key = f"{folder}/{prefix}{r['name']}.png"
        heading = (r.get('heading') or '').replace('\n', ' ').strip()
        notes[key] = {
            'module': module_of(r['path']),
            'role': role,
            'step': 'Screen overview',
            'description': f"`{r['path']}` — {heading}" if heading else f"`{r['path']}`",
            'verified': 'Loaded and screenshotted in the running application',
        }

# Hand-written entries for the workflow captures and the public pages.
MANUAL = json.load(open('documentation/source/workflow-notes.json'))
notes.update(MANUAL)

json.dump(notes, open('documentation/source/screenshot-notes.json', 'w'), indent=1, sort_keys=True)
print(len(notes), 'notes written')
