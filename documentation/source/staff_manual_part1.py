"""Staff & Administrator manual — front matter and sections 1–6."""
from common import fig, pair, step, note, table, VERSION, DATE

n = [0]

def shot(path, caption, in_pair=False):
    n[0] += 1
    return fig(path, caption, number=n[0], in_pair=in_pair)


FRONT = f'''
<h1>Document control</h1>
{table(['Item', 'Detail'], [
    ['Document title', 'Bakenye SACCO Staff &amp; Administrator Manual'],
    ['Version', VERSION],
    ['Publication date', DATE],
    ['Intended audience', 'Authorised staff of Bakenye Unity and Development SACCO: cashiers, '
     'loan officers, field officers, accountants, managers and administrators'],
    ['Purpose', 'To set out how authorised staff use the SACCO system to keep accurate member, '
     'savings, share, loan and financial records, and what each role is permitted to do.'],
    ['Applies to', 'The version of the SACCO system verified on 24 September 2026. Every workflow '
     'in this manual was performed in a test copy of that version before publication.'],
    ['Classification', 'Internal. Not for circulation to members or the public.'],
], cls='docctl')}

<h2>Revision history</h2>
{table(['Version', 'Date', 'Change', 'By'], [
    ['1.0', DATE, 'First issue, following a full review of the working system.', 'Documentation review'],
])}

<h2>How this manual was prepared</h2>
<p>Every screen shown here was photographed from the working application. Every procedure was
carried out from beginning to end before it was written down, using a separate test copy of the
system containing invented members and invented money. No member's real information appears
anywhere in this manual.</p>

{note('Two things in the system need fixing before you rely on this manual for them',
      'A review of the working system found two defects. They are described where they arise, and '
      'summarised again in Section 17 (Troubleshooting). In short: <strong>reversing a savings '
      'payment currently fails</strong>, and <strong>the &ldquo;one installment&rdquo; shortcut on '
      'the repayment screen can enter an amount a hundred times too large</strong>. Both have been '
      'reported to SACCO management.', kind='warn')}

<h2>Your responsibility</h2>
<p>The system records what you tell it. It checks what it can — that an amount is a number, that a
reference has not been used before, that an account will not go below zero — but it cannot know
whether the money in front of you is real, or whether the member you selected is the member who
paid. <strong>That part is yours.</strong> Everything you record is recorded in your name, with the
date and time, and it stays on the record permanently.</p>
'''


SECTIONS = []

def sec(title, body):
    SECTIONS.append((1, title, body))


sec('Introduction', f'''
<p class="lead">The Bakenye SACCO system holds the SACCO's financial record. This manual is how that
record is kept correctly.</p>

<h2>What the system is for</h2>
<p>It is a single, permanent record of every member, every payment and every loan. Its value depends
entirely on the accuracy of what staff put into it.</p>

<h2>Who should read this manual</h2>
{table(['Role', 'Which parts matter most'], [
    ['<strong>Cashier / Teller</strong>', 'Sections 3, 7, 8, 9, 11, 12, 14 &amp; 18'],
    ['<strong>Field Officer</strong>', 'Sections 3, 7, 8, 9, 14 &amp; 18'],
    ['<strong>Loan Officer</strong>', 'Sections 3, 7, 11, 12, 14 &amp; 18'],
    ['<strong>Accountant</strong>', 'Sections 3, 13, 14, 15 &amp; 18'],
    ['<strong>SACCO Manager</strong>', 'All of it'],
    ['<strong>Admin / Super Admin</strong>', 'All of it, and Sections 16 &amp; 17 in particular'],
])}

<h2>Three principles the system is built on</h2>
<ol>
  <li><strong>Nothing is deleted.</strong> A posted transaction cannot be edited or removed by
      anybody, including an administrator, and the database itself refuses. A mistake is corrected
      by a <em>reversal</em> — a new, opposite entry that names the reason. Both stay visible for
      good.</li>
  <li><strong>Balances are never stored.</strong> A member's savings balance, share value and loan
      balance are all worked out from the transactions themselves, every time they are shown. There
      is no separate balance that could drift away from the ledger.</li>
  <li><strong>Every money movement is recorded in somebody's name.</strong> Who did it, when, and —
      where the action is sensitive — why.</li>
</ol>

<h2>What the system cannot do</h2>
{note('There is no payment-provider connection',
      'The system is <strong>not</strong> connected to MTN, Airtel, any bank or any other provider. '
      'Choosing &ldquo;Mobile Money&rdquo; when recording a payment means <em>this money has '
      'already been received and I have checked it</em>. Nothing in the application confirms a '
      'payment that a person has not confirmed. Recording a mobile-money payment without seeing the '
      'confirmation message is the single easiest way to put a wrong figure into the SACCO&rsquo;s '
      'books.', kind='warn')}

<h2>Why role-based access matters</h2>
<p>Each role can reach only the screens its job needs. This is not about trust; it is about limiting
the damage a mistake can do, and making it possible to say afterwards who did what. Never sign in
using somebody else's account, and never let somebody use yours.</p>
''')

sec('Staff roles and what each may do', f'''
<p class="lead">Roles are set up in the system, not fixed in the software. A Super Admin can create
new ones. What follows is how the SACCO's roles were configured when this manual was written — the
live position is always on <strong>Roles &amp; Permissions</strong>.</p>

<h2>The roles</h2>
{table(['Role', 'Whose job it is', 'Opens on'], [
    ['<strong>Super Admin</strong>', 'The system owner. Always holds every permission, so the SACCO '
     'cannot lock itself out.', 'Administration'],
    ['<strong>Admin</strong>', 'Day-to-day administration, including staff accounts.', 'Administration'],
    ['<strong>SACCO Manager</strong>', 'Runs the SACCO: members, categories, approvals, settings, '
     'reports.', 'SACCO overview'],
    ['<strong>Loan Officer</strong>', 'Assesses loan applications and collects repayments.', 'Loans desk'],
    ['<strong>Cashier / Teller</strong>', 'Takes money at the counter and records it.', 'Cashier desk'],
    ['<strong>Accountant</strong>', 'The books: income, expenses, reconciliation, reports.', 'Finance'],
    ['<strong>Field Officer</strong>', 'Collections away from the counter.', 'Collections'],
    ['<strong>Viewer</strong>', 'Read-only access for oversight.', 'SACCO overview'],
    ['<strong>Member</strong>', 'A member&rsquo;s own portal. Not a staff role.', 'Member portal'],
])}

<h2>Who may do what</h2>
<p>● granted&nbsp;&nbsp;·&nbsp;&nbsp;○ held by every staff role automatically&nbsp;&nbsp;·&nbsp;&nbsp;— not held</p>
{table(['Task', 'Super Admin', 'Admin', 'Manager', 'Loan Off.', 'Cashier', 'Acct.', 'Field Off.', 'Viewer'], [
    ['View members, savings, transactions, reports', '●', '○', '○', '○', '○', '○', '○', '○'],
    ['Register a member and take the registration fees', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['Edit a member&rsquo;s official record', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['Change a member&rsquo;s status', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['Allow two members to share a phone number', '●', '●', '—', '—', '—', '—', '—', '—'],
    ['Manage share and savings categories', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['Collect fees', '●', '●', '●', '—', '●', '—', '—', '—'],
    ['Create and edit fees', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['Record savings', '●', '●', '●', '—', '●', '—', '●', '—'],
    ['Waive a savings schedule', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['View shares', '●', '●', '●', '—', '●', '●', '—', '●'],
    ['Sell shares', '●', '●', '●', '—', '●', '—', '—', '—'],
    ['View loans', '●', '●', '●', '●', '●', '●', '—', '●'],
    ['Assess a loan application', '●', '●', '●', '●', '—', '—', '—', '—'],
    ['Approve a loan', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['Disburse a loan', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['Record a loan repayment', '●', '●', '●', '●', '●', '—', '—', '—'],
    ['Manage guarantors', '●', '●', '●', '●', '—', '—', '—', '—'],
    ['Reverse a transaction', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['Record a deposit or withdrawal', '●', '●', '●', '—', '●', '—', '—', '—'],
    ['View Finance', '●', '●', '●', '—', '●', '●', '—', '—'],
    ['Record income and expenses', '●', '●', '●', '—', '●', '●', '—', '—'],
    ['Approve a transfer, payment or expense', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['Reconcile an account', '●', '●', '●', '—', '—', '●', '—', '—'],
    ['Set up financial accounts', '●', '●', '●', '—', '—', '—', '—', '—'],
    ['Produce member statements and reports', '●', '●', '●', '●', '—', '●', '●', '—'],
    ['Manage staff accounts', '●', '●', '—', '—', '—', '—', '—', '—'],
    ['Manage roles and permissions', '●', '—', '—', '—', '—', '—', '—', '—'],
    ['View the audit log', '●', '●', '●', '—', '—', '●', '—', '—'],
    ['View and change settings', '●', '●', '●', '—', '—', '—', '—', '—'],
])}

{note('Rules that cannot be switched off',
      'Only a Super Admin may grant <em>Manage staff accounts</em> or <em>Manage roles &amp; '
      'permissions</em>. The Member role can never be given a staff permission. Nobody may edit the '
      'role they themselves hold. Every grant and withdrawal is written to the audit log with '
      'exactly what changed.')}

<h2>What happens if you open a screen you may not use</h2>
<p>The system does not show an error. It quietly returns you to your own dashboard — the navigation
menu never showed you the link in the first place. This was tested for every role:</p>
{table(['Role', 'Tried to open', 'Ended up on'], [
    ['Cashier', '/staff/users', 'Cashier desk'],
    ['Cashier', '/staff/settings', 'Cashier desk'],
    ['Loan Officer', '/staff/finance', 'Loans desk'],
    ['Manager', '/staff/users', 'SACCO overview'],
    ['Manager', '/staff/roles', 'SACCO overview'],
    ['Field Officer', '/staff/finance', 'Collections'],
])}
<p>If a screen you genuinely need is not opening for you, it is a permissions question for your
manager, not a fault.</p>
''')


sec('Signing in, your dashboard, and signing out', f'''
<p class="lead">There is one sign-in form for everybody. You do not choose "staff"; your account
decides where you land.</p>

{step(1, 'Open the SACCO address and sign in', f"""
<p>Type your <strong>phone number</strong> — or your email address, if the SACCO holds one for you —
and your password.</p>
{shot('shared/login-desktop.png', 'The sign-in screen. The same form serves members and staff.')}
""")}

{step(2, 'Choose your own password, the first time', f"""
<p>A new or reset account arrives on a temporary password such as <span class="kbd">WJPV-7625</span>.
The system will not open anything else until you replace it.</p>
{shot('shared/check-after-login.png', 'Choose your password. Type the temporary one, then your own, twice.')}
{note('Nobody at the SACCO knows the password you end up with',
      'The officer who created your account saw the temporary password once. Once you have replaced '
      'it, no member of staff — including the Super Admin — can read your password. They can only '
      'issue you a new temporary one.')}
""")}

{step(3, 'Arrive at your own dashboard', """
<p>Where you land depends on your role, and that is a setting on the role itself:</p>
""" + table(['Role', 'Dashboard'], [
    ['Super Admin, Admin', 'Administration'],
    ['SACCO Manager, Viewer', 'SACCO overview'],
    ['Cashier / Teller', 'Cashier desk'],
    ['Loan Officer', 'Loans desk'],
    ['Accountant', 'Finance'],
    ['Field Officer', 'Collections'],
]))}

<h2>The dashboards</h2>
{pair(shot('admin/walk-dash-overview.png', 'SACCO overview — the whole SACCO at a glance.', in_pair=True),
      shot('staff/cashier-01-desk.png', 'Cashier desk — today&rsquo;s counter work.', in_pair=True))}
{pair(shot('staff/lo-01-desk.png', 'Loans desk — applications, repayments due, arrears.', in_pair=True),
      shot('admin/walk-dash-administration.png', 'Administration — accounts, security and configuration.', in_pair=True))}

<h2>Finding your way around</h2>
<p>The menu down the left is the whole back office. It shows only what your role may use, so two
members of staff sitting side by side will see different menus. On a phone the same menu is behind
the <strong>☰</strong> button at the top.</p>
<p>The <strong>search box</strong> at the top of every screen finds a member by name, member number
or phone number from anywhere in the system.</p>

<h2>Signing out</h2>
<p>Open your name at the top right and choose <strong>Log Out</strong>.</p>
{note('Always sign out before leaving the counter',
      'Anything done while your session is open is recorded as done by <em>you</em>. If you step '
      'away without signing out, and someone else records a payment, the audit log will say it was '
      'you. The system also signs a session out by itself after a period of inactivity, which '
      'management sets under Settings &rarr; Security — but do not rely on it.', kind='warn')}
''')

sec('Member management', f'''
<p class="lead">Everything the SACCO knows about a member, and who may change it.</p>
<p class="who"><strong>Who may use this section:</strong> viewing and searching — every staff role.
Registering, editing and changing status — <span class="role">Admin</span>
<span class="role">Manager</span> <span class="role">Super Admin</span> only.</p>

<h2>Finding a member</h2>
{step(1, 'Open Members', f"""
<p>Choose <strong>Members</strong> from the menu, or type into the search box at the top of any
screen.</p>
{shot('admin/walk-members-list.png', 'The Members screen: search, filter by status, and the register.')}
""")}
{step(2, 'Search', """
<p>You can search by <strong>member number</strong> (BND26006), by <strong>name</strong>, or by
<strong>phone number</strong>. Part of a name is enough.</p>
""")}
{step(3, 'Open the member', f"""
<p>Their page gathers everything: their record, their sign-in account, their categories, their
balances, their loans and their recent transactions.</p>
{shot('staff/member-login-created.png', 'A member&rsquo;s page. Every figure on it is worked out from the ledger.')}
""")}

<h2>Registering a new member</h2>
<p class="who"><strong>Who may do this:</strong> <span class="role">Admin</span>
<span class="role">Manager</span> <span class="role">Super Admin</span></p>
<p>Registration is one operation in five steps. <strong>Nothing at all is saved until the last
step</strong>, so you can go back and correct anything before you finish.</p>

{step(1, 'Members → Register Member: the member&rsquo;s details', f"""
{shot('staff/register-01-step1-empty.png', 'Step 1 of the wizard.')}
<dl class="fields">
  <dt>Full name (required)</dt><dd>Exactly as written on the National ID.</dd>
  <dt>Phone number (required)</dt><dd>07XXXXXXXX or +2567XXXXXXXX. The system stores it in one form,
      so the same person cannot be registered twice under two spellings.</dd>
  <dt>Email address</dt><dd>Optional. Most members have none; it is not needed.</dd>
  <dt>National ID, date of birth, gender</dt><dd>Required or optional depending on what management
      has set under <em>Settings &rarr; Members</em>.</dd>
  <dt>Address, occupation</dt><dd>Free text.</dd>
  <dt>Next of kin</dt><dd>Name, relationship and phone number.</dd>
  <dt>Membership date</dt><dd>Today, unless the member joined earlier. <strong>Share category
      deadlines are counted from this date</strong>, so get it right.</dd>
</dl>
{shot('staff/register-02-step1-filled.png', 'Step 1 completed.')}
{note('If the phone number already belongs to a member',
      'The system stops you. Two live members may share a number only if somebody holding <em>Allow '
      'a shared phone number</em> (Admin or Super Admin) authorises it and records a reason.')}
""")}

{step(2, 'Categories', f"""
<p>Choose a <strong>share category</strong> and a <strong>savings category</strong>. The screen shows
what each one costs and requires, read from the SACCO&rsquo;s own configuration — not from anything
fixed in the software.</p>
{shot('staff/register-03-step2-categories.png', 'The categories on offer, with what each requires.')}
{note('The two categories are independent',
      'A member may hold Gold shares and save at the Diamond rate. Management can require them to '
      'match, under Settings &rarr; Categories, but by default they do not have to.')}
{shot('staff/register-validation-error.png', 'The wizard will not go on until both categories are chosen.')}
""")}

{step(3, 'Fees', f"""
<p>The system totals every fee that applies at registration, at the amount in force today.</p>
{shot('staff/register-05-step3-fees.png', 'The fees due at registration.')}
{note('Fees are configuration, not code',
      'What appears here comes from <em>Settings &rarr; Fees</em>. If the SACCO has no fees set up, '
      'nothing is charged and the screen says so.')}
""")}

{step(4, 'Payment', f"""
{shot('staff/register-06-step4-payment.png', 'Paying now or later, and how the money came in.')}
<ul>
  <li><strong>Paying now</strong> — record the payment with the registration.</li>
  <li><strong>Paying later</strong> — the member is registered as <strong>Pending</strong> and
      becomes Active automatically when the mandatory fees are paid.</li>
</ul>
<p>If they are paying now, say how:</p>
{table(['Method', 'Where the money is recorded'], [
    ['<strong>Cash</strong>', 'Cash at Hand'],
    ['<strong>Merchant / Mobile Money</strong>', 'Cash at Merchant. The confirmation reference is required.'],
    ['<strong>Bank</strong>', 'Cash at Bank. The bank reference is required.'],
])}
{shot('staff/register-07-step4-filled.png', 'Cash chosen and the amount received entered.')}
{note('Type the amount; the system checks it',
      'It must equal the fees due. If it does not, the screen says so and will not go on.')}
""")}

{step(5, 'Confirm, and register', f"""
<p>The last step lists everything you have entered. Read it against the papers in front of you
before you press <strong>Register member</strong>.</p>
{shot('staff/register-08-step5-confirm.png', 'The summary shown before anything is saved.')}
<p><strong>What happens when you press it —</strong> all of this, or none of it:</p>
<ul>
  <li>the next member number is issued (BND + the year + the sequence);</li>
  <li>both categories are set;</li>
  <li>every applicable fee is charged at today&rsquo;s amount;</li>
  <li>the payment is posted to the right account;</li>
  <li>a receipt is issued;</li>
  <li>each fee is booked as income;</li>
  <li>the audit trail is written.</li>
</ul>
{shot('staff/register-09-result.png', 'The result: member number, amount paid, status and receipt number.')}
{note('If something fails, nothing happened',
      'A duplicate phone number, a missing reference, a fee that changed while the form was open — '
      'any of these stops the whole registration. You will never be left with half a member. And if '
      'you press the button twice, the member is registered once.')}
""")}

<h2>Giving the member their portal login</h2>
<p>A member's login is created from their own page.</p>
{pair(shot('staff/member-create-login-dialog.png', 'Create login — the confirmation.', in_pair=True),
      shot('staff/member-reset-password-result.png', 'The temporary password, shown once.', in_pair=True))}
<ol>
  <li>Open the member&rsquo;s page and press <strong>Create login</strong>.</li>
  <li>Confirm. A temporary password is shown <strong>once</strong>.</li>
  <li>Write it down for the member, hand it over, and destroy your note.</li>
  <li>Tell them they will be asked to choose their own password the first time they sign in.</li>
</ol>
{note('Check who you are speaking to first',
      'Before creating a login or resetting a password, check the member&rsquo;s National ID. The '
      'person holding that password can see everything about that member&rsquo;s money.', kind='warn')}

<h2>Resetting a member&rsquo;s password</h2>
<p>Press <strong>Reset password</strong> on the member's page. The old password stops working at
once, a new temporary one is shown once, and the member must replace it at their next sign-in.</p>

<h2>Editing a member&rsquo;s record</h2>
<p class="who"><strong>Who may do this:</strong> <span class="role">Admin</span>
<span class="role">Manager</span> <span class="role">Super Admin</span></p>
{shot('admin/walk-member-edit.png', 'Editing a member. A reason is required.')}
<ul>
  <li>A <strong>reason</strong> is required, and it is kept.</li>
  <li>Every changed field is recorded: what it was, what it became, who changed it, when and why.
      It is all on the member&rsquo;s page under <strong>History</strong>.</li>
  <li>The <strong>member number can never be changed</strong> — by anybody, by any route.</li>
</ul>

<h2>Changing a member&rsquo;s status</h2>
{table(['Status', 'What it means', 'Can they sign in?'], [
    ['<strong>Pending</strong>', 'Registered, mandatory fees not yet paid.', 'Yes'],
    ['<strong>Active</strong>', 'A member in good standing.', 'Yes'],
    ['<strong>Suspended</strong>', 'Membership suspended by management.', 'No — told they are suspended'],
    ['<strong>Inactive</strong>', 'No longer participating.', 'No'],
    ['<strong>Archived</strong>', 'Kept for the record only.', 'No'],
])}
{note('A member is never deleted',
      'Their record and every transaction on it stay in the system for good. Status is how a '
      'membership is ended, and a reason is always required.')}
''')


sec('Categories and shares', f'''
<p class="lead">Categories decide what a member is expected to save and how many shares they should
own. They are rows the SACCO edits, not figures fixed in the software.</p>
<p class="who"><strong>Viewing:</strong> every staff role. <strong>Creating and editing:</strong>
<span class="role">Admin</span> <span class="role">Manager</span> <span class="role">Super Admin</span></p>

<h2>The Categories screen</h2>
{shot('admin/walk-categories.png', 'Categories: the share tiers, the savings tiers and the share price.')}
<p>A <strong>share category</strong> holds how many shares the member should own and, if the SACCO
sets one, the number of months from joining in which to buy them. A <strong>savings
category</strong> holds an amount and how often it is collected.</p>

{note('There is one share price',
      'A share category stores only <em>how many shares</em>. What that comes to in shillings is '
      'worked out from the single share price the SACCO has set. Change the price and every '
      'category total changes with it — and no purchase already made is affected, because every '
      'share bought records the price at the moment of sale.')}

<h2>Share capital</h2>
{shot('admin/walk-shares.png', 'The share register: total capital held and every member&rsquo;s standing.')}

<h2>Recording a share purchase</h2>
<p class="who"><strong>Who may do this:</strong> <span class="role">Cashier</span>
<span class="role">Manager</span> <span class="role">Admin</span> <span class="role">Super Admin</span></p>

{step(1, 'Shares → Record Share Purchase', f"""
{shot('staff/shares-01-sell-form.png', 'The share purchase screen.')}
""")}
{step(2, 'Find the member', f"""
{shot('staff/shares-02-member-found.png', 'Searching for the member who is buying.')}
<p><strong>Check the member number and the name against what the member has told you</strong> before
you go on.</p>
""")}
{step(3, 'Enter the number of shares and how they paid', f"""
<p>Shares are bought in <strong>whole units</strong>. The screen multiplies by the share price and
shows the total — you do not calculate anything.</p>
{shot('staff/shares-03-filled.png', 'Five shares, paid in cash.')}
<p>For mobile money or a bank transfer, the confirmation reference is required.</p>
""")}
{step(4, 'Review, then record', f"""
{shot('staff/shares-04-confirm.png', 'The confirmation summary.')}
{shot('staff/shares-05-result.png', 'The result, with the SHR receipt reference.')}
<p><strong>Expected result:</strong> a receipt reference beginning <span class="kbd">SHR</span>, the
member&rsquo;s share value increased, and their progress towards their share category updated.</p>
""")}

{note('There is no "sell back" or "adjust" for shares',
      'A share purchase recorded in error is corrected by a <strong>reversal</strong> (Section 12), '
      'by somebody who holds that permission. Do not try to balance it with a second, opposite '
      'purchase.', kind='warn')}
''')

sec('Savings: collecting and recording', f'''
<p class="lead">This is the counter's main job, and the screen is built around it: find the member,
see what their category expects, record what they actually brought.</p>
<p class="who"><strong>Who may record savings:</strong> <span class="role">Cashier</span>
<span class="role">Field Officer</span> <span class="role">Manager</span>
<span class="role">Admin</span> <span class="role">Super Admin</span>. Everybody else may look.</p>

{step(1, 'Open Savings → Collect Savings', f"""
{shot('staff/collect-01-open.png', 'The collection screen, waiting for a member.')}
""")}

{step(2, 'Find the member', f"""
<p>Search by member number, name or phone number. The result shows the member, their category and
what they owe, before you open them.</p>
{shot('staff/collect-02-search.png', 'A search result showing what the member owes.')}
""")}

{step(3, 'Check that this is the right member', f"""
{shot('staff/collect-03-member.png', 'The member panel: category, current cycle, expected, paid and outstanding.')}
<p><strong>Before you take the money, read back to the member:</strong></p>
<ul>
  <li>their <strong>name</strong> and <strong>member number</strong>;</li>
  <li>their <strong>savings category</strong> and what it expects;</li>
  <li>the <strong>outstanding</strong> figure for the current cycle.</li>
</ul>
{note('If the member says any of that is wrong, stop',
      'Do not record anything. Two members with similar names is the commonest way money ends up on '
      'the wrong account. Check the member number against something they carry.', kind='warn')}
""")}

{step(4, 'Press Record payment', f"""
{shot('staff/collect-04-record-dialog.png', 'The Record payment form.')}
<dl class="fields">
  <dt>Amount received (required)</dt><dd>What is actually in your hand. The screen shows what is
      outstanding and offers a full or half shortcut, but <strong>type what you received</strong>.</dd>
  <dt>Payment method (required)</dt><dd>Cash, Mobile Money, Bank Transfer or Cheque.</dd>
  <dt>Transaction reference</dt><dd>Required for mobile money and bank. Type it from the confirmation
      message. The same reference cannot be used twice.</dd>
  <dt>Payment date (required)</dt><dd>Today by default. It may be backdated to the day the money was
      actually received; a future date is refused.</dd>
  <dt>Note</dt><dd>Optional, and useful when something about the payment needs explaining.</dd>
</dl>
""")}

{step(5, 'Enter what was received', f"""
{shot('staff/collect-05-filled.png', 'UGX 100,000 by mobile money, with the provider reference.')}
{note('Choosing "Mobile Money" records money already received',
      'It does not ask the provider for anything. Type the reference from the confirmation message '
      'in front of you. If you cannot see a confirmation message, do not record the payment.', kind='warn')}
""")}

{step(6, 'Review', f"""
{shot('staff/collect-06-confirm.png', 'The confirmation summary. Nothing has been saved yet.')}
<p>Check the member, the amount and the reference once more. Press <strong>Back</strong> to change
anything.</p>
""")}

{step(7, 'Record it', f"""
{shot('staff/collect-07-result.png', 'The member panel afterwards: the outstanding figure has fallen.')}
<p><strong>Expected result:</strong> one entry in the ledger with a <span class="kbd">SAV</span>
reference, the member&rsquo;s schedule recalculated, the money in the right account (mobile money
&rarr; Cash at Merchant, cash &rarr; Cash at Hand, bank &rarr; Cash at Bank), and an audit entry in
your name.</p>
""")}

{step(8, 'Give the member their receipt', f"""
{shot('staff/collect-08-receipt.png', 'The receipt, with its receipt number and transaction reference.')}
<p>It can be printed, saved as a PDF or shown to the member on screen.</p>
""")}

<h2>Schedules, arrears and waivers</h2>
{shot('admin/walk-savings-schedules.png', 'Savings schedules: paid, part paid, pending and missed.')}
<p>A schedule is what a member is <em>expected</em> to bring in a given week or month. It is raised
before the money is due, so a member who pays nothing produces a <strong>missed</strong> schedule
that can be counted — rather than no record at all.</p>
{table(['Status', 'What it means'], [
    ['<strong>Paid</strong>', 'The full expected amount was received.'],
    ['<strong>Partial</strong>', 'Something was received, but not all of it.'],
    ['<strong>Pending</strong>', 'Not yet due, or nothing received yet.'],
    ['<strong>Missed</strong>', 'The cycle closed with nothing paid.'],
    ['<strong>Waived</strong>', 'A manager excused this cycle, with a written reason.'],
])}
{note('Waiving a cycle',
      'Only <span class="role">Manager</span> <span class="role">Admin</span> '
      '<span class="role">Super Admin</span> may waive, a written reason is required, and a cycle '
      'that has already had money paid against it cannot be waived at all.')}

<h2>Savings performance</h2>
{shot('admin/walk-savings-performance.png', 'Savings performance by category: expected, collected and the collection rate.')}
<p>Every figure here is a sum over the member schedules and the ledger. A category has no balance of
its own, so what this screen shows can never disagree with what members see on their own phones.</p>
''')


sec('Finding the right member before you take money', f'''
<p class="lead">Almost every serious error in a SACCO's books starts the same way: the money was
real, and the member was wrong. This short section is the habit that prevents it.</p>

<h2>The check, every time</h2>
{table(['#', 'Do this', 'Why'], [
    ['1', 'Ask the member for their <strong>member number</strong> — do not offer it.',
     'A member who knows their own number is almost certainly that member.'],
    ['2', 'Search by that number, not by name.',
     'Names repeat. BND26006 does not.'],
    ['3', 'Read the <strong>name on the screen</strong> back to them.',
     'They will correct you if it is wrong.'],
    ['4', 'Check the <strong>phone number</strong> shown matches theirs.',
     'A second, independent check.'],
    ['5', 'Read the <strong>outstanding amount</strong> aloud before taking the money.',
     'Members notice when the figure is not what they expected.'],
    ['6', 'Count the money, then enter that figure.',
     'Enter what you received, not what was expected.'],
    ['7', 'Read the confirmation summary before confirming.',
     'It is the last moment at which nothing has been saved.'],
])}

{note('Two members with similar names',
     'If a search brings back more than one similar name, do not guess. Open each and compare the '
     'phone number and the National ID. If you are still unsure, ask a supervisor.', kind='warn')}

<h2>If you notice the wrong member <em>before</em> confirming</h2>
<p>Press <strong>Back</strong> or close the form. Nothing has been saved and nothing needs
correcting.</p>

<h2>If you notice <em>after</em> confirming</h2>
<ol>
  <li>Stop. Do not record a second, opposite payment to cancel it.</li>
  <li>Write down the transaction reference, the member it went to, the member it should have gone
      to, and the amount.</li>
  <li>Tell your supervisor or the manager <strong>the same day</strong>.</li>
  <li>A Manager, Admin or Super Admin corrects it with a <strong>reversal</strong> (Section 12),
      and then the payment is recorded against the right member.</li>
</ol>

{note('A savings reversal currently fails',
      'At the time this manual was written, reversing a <em>savings</em> transaction fails with a '
      'system error. Other kinds reverse normally. Report the error to SACCO management and to '
      'whoever supports the system — and keep your written note of the transaction until it is '
      'corrected.', kind='warn')}
''')

sec('Loans', f'''
<p class="lead">A loan moves through fixed stages, and different roles own different stages. Nobody
can skip one.</p>

<h2>The stages</h2>
{table(['Stage', 'What it means', 'Who moves it on'], [
    ['<strong>Applied</strong>', 'An application has been captured.', 'Loan Officer or above'],
    ['<strong>Under review</strong>', 'Being assessed.', '<span class="role">Loan Officer</span> <span class="role">Manager</span> <span class="role">Admin</span>'],
    ['<strong>Approved</strong>', 'Agreed, money not yet handed over.', '<span class="role">Manager</span> <span class="role">Admin</span> <span class="role">Super Admin</span>'],
    ['<strong>Disbursed / Active</strong>', 'Money handed over; repayments due.', '<span class="role">Manager</span> <span class="role">Admin</span> <span class="role">Super Admin</span>'],
    ['<strong>Completed</strong>', 'Fully repaid. The system sets this itself.', '—'],
    ['<strong>Rejected</strong>', 'Not approved. A reason is recorded.', '<span class="role">Manager</span> <span class="role">Admin</span>'],
    ['<strong>Defaulted</strong>', 'Seriously in arrears. The nightly job flags it.', '—'],
])}

<h2>Loan products</h2>
<p class="who"><strong>Viewing:</strong> anybody who may see loans. <strong>Editing:</strong> a role
with <em>Change settings</em>.</p>
{shot('admin/walk-loan-products.png', 'Loan products: the terms members may borrow under.')}
<p>A product carries its name and code, the interest rate and method, the smallest and largest
amounts, the shortest and longest terms, any processing fee, and how many guarantors are required.
<strong>Every one of these is configuration.</strong> Nothing about a loan&rsquo;s terms is fixed in
the software, and this manual does not state the SACCO&rsquo;s rates — read them here.</p>

<h2>Capturing an application</h2>
<p class="who"><strong>Who may do this:</strong> <span class="role">Loan Officer</span>
<span class="role">Manager</span> <span class="role">Admin</span> <span class="role">Super Admin</span></p>
{shot('admin/walk-loans-new.png', 'New Loan Application.')}
<ol>
  <li>Choose the member.</li>
  <li>Choose the product. The screen shows its limits and refuses an amount outside them.</li>
  <li>Enter the amount and the number of months.</li>
  <li>Enter the purpose, and its category.</li>
  <li>Add the guarantors the product requires. You can search other members by name or number; you
      will see their name and member number only, never their savings or shares.</li>
  <li>Submit.</li>
</ol>
{note('One live loan per member',
      'The system refuses a second application while one is running, and says so at the start '
      'rather than after the form has been filled in. This limit is a setting management controls.')}

<h2>Assessing an application</h2>
<p class="who"><strong>Who may do this:</strong> <span class="role">Loan Officer</span>
<span class="role">Manager</span> <span class="role">Admin</span> <span class="role">Super Admin</span></p>
{step(1, 'Open the Loans desk', f"""
{shot('staff/loan-01-officer-desk.png', 'The Loans desk: what is waiting, what is due, what is late.')}
""")}
{step(2, 'Open the application', f"""
{shot('staff/loan-02-application.png', 'A loan application in full.')}
<p>Read the amount and term, the purpose, the guarantors and their standing, and the member&rsquo;s
own savings and share record.</p>
""")}
{step(3, 'Start the review', f"""
{shot('staff/loan-03-under-review.png', 'The loan after the review has been started.')}
<p>This marks the loan as being worked on, so two officers do not assess the same application.</p>
""")}

<h2>Approving or declining</h2>
<p class="who"><strong>Who may do this:</strong> <span class="role">Manager</span>
<span class="role">Admin</span> <span class="role">Super Admin</span> — never a Loan Officer.</p>
{pair(shot('staff/loan-04-approve-dialog.png', 'Approving. A reason is required.', in_pair=True),
      shot('staff/loan-05-approved.png', 'Approved, and now offering Disburse funds.', in_pair=True))}
{note('Approval is a decision, not a formality',
      'It is recorded in your name with your reason, permanently. Declining works the same way and '
      'the reason matters just as much — it is what the member is told.')}

<h2>Disbursing</h2>
<p class="who"><strong>Who may do this:</strong> <span class="role">Manager</span>
<span class="role">Admin</span> <span class="role">Super Admin</span></p>
{step(1, 'Press Disburse funds and say how the money is being handed over', f"""
{shot('staff/loan-06-disburse-dialog.png', 'The disbursement form: method and date.')}
<p>The account the money leaves is decided by the method: cash leaves Cash at Hand, a bank transfer
leaves Cash at Bank, mobile money leaves Cash at Merchant.</p>
""")}
{step(2, 'Confirm', f"""
{shot('staff/loan-07-disbursed.png', 'The loan is Active, with its balance and schedule.')}
<p><strong>Expected result:</strong> a <span class="kbd">LDS</span> ledger entry, the loan set to
Active, the repayment schedule generated, any processing fee charged, and the guarantors&rsquo;
commitments engaged.</p>
{note('Only disburse when the money is actually being handed over',
      'Disbursing moves money out of a SACCO account in the books. If the cash has not left the '
      'drawer, the books and the drawer no longer agree.', kind='warn')}
""")}

<h2>Recording a repayment</h2>
<p class="who"><strong>Who may do this:</strong> <span class="role">Cashier</span>
<span class="role">Loan Officer</span> <span class="role">Manager</span>
<span class="role">Admin</span> <span class="role">Super Admin</span></p>

{step(1, 'Open the loan and press Record repayment', f"""
{shot('staff/repay-01-form.png', 'The repayment screen: outstanding balance and schedule.')}
""")}
{step(2, 'Type the amount received', f"""
{shot('staff/repay-02-filled.png', 'The amount typed in and the method chosen.')}
{note('Type the amount — do not trust the shortcut buttons',
      'The <em>One installment</em> and <em>Full balance</em> shortcuts fill the amount for you. '
      'Where an installment is not a whole number of shillings, the shortcut currently enters an '
      'amount <strong>one hundred times too large</strong> (for example UGX 196,666.67 becomes '
      '19,666,667). Always read the figure in the box before you go on. This has been reported for '
      'correction.', kind='warn')}
""")}
{step(3, 'Review and confirm', f"""
{pair(shot('staff/repay-03-confirm.png', 'The confirmation summary.', in_pair=True),
      shot('staff/repay-04-result.png', 'The result, with the LRP receipt reference.', in_pair=True))}
<p><strong>Expected result:</strong> a <span class="kbd">LRP</span> ledger entry, the money applied
to <strong>interest first and then principal</strong>, the schedule and balance recalculated, and —
if that was the last of it — the loan marked Completed and its guarantors released.</p>
""")}

<h2>Overdue loans and collections</h2>
{shot('staff/report-09-overdue-loans.png', 'Loans in arrears.')}
<p>Filter the Loans screen by <strong>Overdue</strong> to see the loans behind on their schedule,
with the member, the amount in arrears and how far behind they are. Open a loan to find the
member&rsquo;s phone number and their repayment history.</p>
<p>A collection is recorded exactly like any other repayment, using the screen above. If the money
was collected some days ago, set the <strong>payment date</strong> to the day it was received — the
reference number will carry today&rsquo;s date, and the entry will be dated the day of collection.</p>
{note('Money collected but not yet recorded',
      'Record it as soon as you are back at a computer, with the correct date and, if you issued a '
      'manual receipt, its number in the note. Do not leave collected money unrecorded overnight; '
      'and never record a collection you have not actually received.', kind='warn')}
''')


sec('Deposits, withdrawals and the cashier desk', f'''
<p class="lead">Beyond scheduled savings, the counter also takes ordinary deposits and pays out
withdrawals.</p>
<p class="who"><strong>Who may do this:</strong> <span class="role">Cashier</span>
<span class="role">Manager</span> <span class="role">Admin</span> <span class="role">Super Admin</span></p>

{pair(shot('staff/cashier-01-desk.png', 'The Cashier desk: today&rsquo;s collections and the quick actions.', in_pair=True),
      shot('admin/walk-transactions-cash.png', 'Record Deposit.', in_pair=True))}

<h2>Recording a deposit</h2>
<ol>
  <li>Open <strong>Transactions &rarr; Record Deposit</strong>, or use the quick action on your desk.</li>
  <li>Find the member and check the name and number.</li>
  <li>Enter the amount you counted and the method.</li>
  <li>For mobile money or bank, type the confirmation reference.</li>
  <li>Review, confirm, and give the member their receipt.</li>
</ol>

<h2>Recording a withdrawal</h2>
<p>The same screen, choosing <strong>Withdraw</strong>.</p>
{note('Checks the system applies to a withdrawal',
      'It refuses to take a member below the minimum savings balance management has set, and it '
      'refuses to take a SACCO account below zero unless management allows it. Both limits are '
      'settings, not fixed rules.')}
{note('Count the money out in front of the member',
      'And have them confirm the amount before you confirm on the screen.', kind='warn')}

<h2>Fees</h2>
<p class="who"><strong>Collecting a fee:</strong> <span class="role">Cashier</span>
<span class="role">Manager</span> <span class="role">Admin</span>. <strong>Creating a fee:</strong>
<span class="role">Manager</span> <span class="role">Admin</span> <span class="role">Super Admin</span>.</p>
<p>Fees a member owes are shown on their own page and can be collected from there. A fee charged to
a member keeps the name and amount it had on the day it was charged, so raising a fee later never
changes an earlier receipt.</p>
''')

sec('Transactions and corrections', f'''
<p class="lead">One ledger holds every money movement in the SACCO. It cannot be edited. This section
is how to read it, and how a mistake is put right.</p>

<h2>The transaction register</h2>
<p class="who"><strong>Viewing:</strong> every staff role.</p>
{shot('admin/walk-transactions.png', 'The transaction register, with its filters.')}
<p>Filter by date, by type, by payment method or by status, and search by reference, member number
or member name.</p>

<h2>Reference numbers</h2>
<p>Every entry carries a reference of a fixed shape: three letters, the date, and that day's
sequence for that kind of document.</p>
{table(['Prefix', 'Document', 'Example'], [
    ['<span class="kbd">SAV</span>', 'Savings', 'SAV260924133'],
    ['<span class="kbd">SHR</span>', 'Shares', 'SHR260924013'],
    ['<span class="kbd">LRP</span>', 'Loan repayment', 'LRP260924015'],
    ['<span class="kbd">LDS</span>', 'Loan disbursement', 'LDS260924002'],
    ['<span class="kbd">RCT</span>', 'Receipt', 'RCT260924168'],
    ['<span class="kbd">PAY</span> / <span class="kbd">EXP</span>', 'Payment / expense', 'EXP260924006'],
    ['<span class="kbd">INC</span>', 'Income', 'INC260924004'],
    ['<span class="kbd">TRF</span>', 'Transfer between accounts', 'TRF260924001'],
    ['<span class="kbd">DEP</span> / <span class="kbd">WDL</span>', 'Bank deposit / withdrawal', 'DEP260924001'],
    ['<span class="kbd">FEE</span>', 'Fee', 'FEE260924003'],
    ['<span class="kbd">REV</span>', 'Reversal', 'REV260924001'],
    ['<span class="kbd">REC</span>', 'Reconciliation', 'REC260924001'],
])}
<p>Reading <span class="kbd">SAV260924133</span>: a savings entry, issued on 24 September 2026, the
133rd savings document that day.</p>
{note('The date in the reference is the day it was issued',
      'Not the day it is accounted for. A payment recorded today for money received last Friday '
      'carries today&rsquo;s reference and Friday&rsquo;s payment date. Both are on the face of it.')}

<h2>Opening a transaction</h2>
{shot('admin/walk-transaction-detail.png', 'One transaction: the full receipt, and who recorded it.')}
<p>The detail shows the member, the amount, the method, the provider or bank reference, which account
the money went into, the date and time, who recorded it, and the status.</p>

<h2>Correcting a mistake: reversal</h2>
<p class="who"><strong>Who may reverse:</strong> <span class="role">Manager</span>
<span class="role">Admin</span> <span class="role">Super Admin</span> only.</p>

{note('A posted transaction cannot be edited or deleted',
      'Not by a cashier, not by a manager, not by an administrator, and not by anyone with access to '
      'the database. The only correction is a reversal.')}

<p><strong>What a reversal does:</strong></p>
<ul>
  <li>writes a new, opposite entry with a <span class="kbd">REV</span> reference;</li>
  <li>marks the original <em>Reversed</em> and links the two;</li>
  <li>rolls back the balances, schedules and account movements it affected;</li>
  <li>records the reason, which is required;</li>
  <li>leaves both entries visible to the member and to staff for good.</li>
</ul>

<p><strong>How to reverse:</strong></p>
<ol>
  <li>Open the transaction from the register.</li>
  <li>Press <strong>Reverse</strong>.</li>
  <li>Type a reason that explains what actually happened — a person reading it in a year&rsquo;s
      time should understand it without asking you.</li>
  <li>Confirm.</li>
  <li>If the money now needs to go somewhere else, record that as a new transaction, correctly.</li>
</ol>

{note('Reversing a savings payment currently fails',
      'At the time of writing, reversing a transaction of type <em>savings</em> stops with a system '
      'error and nothing is changed. Reversing other kinds works normally. If you hit this: do not '
      'try to correct it with an opposite entry of your own. Record the transaction reference, the '
      'member, the amount and what should have happened, tell SACCO management, and have the defect '
      'reported to whoever supports the system.', kind='warn')}

{note('Never correct an error with an opposite entry',
      'Recording a matching withdrawal to cancel a wrong deposit leaves both on the member&rsquo;s '
      'record with no link between them and no reason. The balance may come out right; the record '
      'becomes untrue.', kind='warn')}
''')

sec('Finance: Cash at Merchant, Cash at Bank, Cash at Hand', f'''
<p class="lead">The SACCO's money sits in three kinds of place, and the system keeps them apart.</p>
<p class="who"><strong>Viewing:</strong> <span class="role">Cashier</span>
<span class="role">Accountant</span> <span class="role">Manager</span> <span class="role">Admin</span>.
<strong>Setting accounts up:</strong> <span class="role">Manager</span>
<span class="role">Admin</span> <span class="role">Super Admin</span>.</p>

{shot('admin/walk-finance.png', 'The Finance overview: what is in each account.')}

{table(['Account', 'What it holds', 'What goes into it'], [
    ['<strong>Cash at Merchant</strong>', 'The SACCO&rsquo;s mobile-money wallet.',
     'Anything recorded as Mobile Money.'],
    ['<strong>Cash at Bank</strong>', 'The SACCO&rsquo;s bank account(s).',
     'Anything recorded as a bank transfer or cheque.'],
    ['<strong>Cash at Hand</strong>', 'Physical cash at the office.',
     'Anything recorded as Cash.'],
])}

{note('A system record is not the same as the real account',
      'These figures are what has been <em>recorded</em>. Whether they match the real wallet, the '
      'real bank statement and the real cash box is what <strong>reconciliation</strong> is for '
      '(below). The system does not check the outside world for you.', kind='warn')}

<h2>Setting up accounts</h2>
{shot('admin/walk-finance-accounts.png', 'Accounts &amp; Setup.')}
<p>A merchant account needs its provider and merchant code; a bank account needs the bank and the
account number. Until a manager creates them, the Finance screens say so rather than inventing one.
Only a zero-balance <em>Cash at Hand</em> account exists to begin with.</p>

<h2>Moving money between accounts</h2>
{shot('admin/walk-finance-new-transfer.png', 'Recording a transfer, for example Merchant to Bank.')}
<p>Merchant &rarr; Bank, Cash &rarr; Bank, Bank &rarr; Cash and Bank &rarr; Bank are all
<strong>transfers</strong>. A transfer is one entry that takes money out of one account and puts it
into another.</p>
{note('A transfer is not income and not an expense',
      'Total SACCO funds do not change. Transfers are deliberately left out of the cashbook and the '
      'Receipts &amp; Payments report, so that moving your own money between your own accounts never '
      'looks like trading.')}
{note('Transfers may need approval',
      'If management has switched on <em>Transfers and payments need approval</em>, a transfer '
      'recorded by somebody who cannot approve it waits for a manager. There may also be an amount '
      'above which approval is always needed, and a four-eyes rule under which a second person '
      'always approves.')}

<h2>Income and expenses</h2>
<p class="who"><strong>Recording:</strong> <span class="role">Cashier</span>
<span class="role">Accountant</span> <span class="role">Manager</span> <span class="role">Admin</span>.
<strong>Approving:</strong> <span class="role">Manager</span> <span class="role">Admin</span>
<span class="role">Super Admin</span>.</p>

{step(1, 'Finance → Expenses → Record expense', f"""
{shot('staff/expense-01-form.png', 'The expense form.')}
<dl class="fields">
  <dt>Category (required)</dt><dd>From the SACCO&rsquo;s own list of expense categories.</dd>
  <dt>Amount (required)</dt><dd>What was actually spent.</dd>
  <dt>Description (required)</dt><dd>What the money was for, in plain words.</dd>
  <dt>Paid from (required)</dt><dd>Which account the money leaves.</dd>
  <dt>Payee</dt><dd>Who was paid.</dd>
  <dt>Date</dt><dd>When it was spent.</dd>
  <dt>Reference</dt><dd>The supplier&rsquo;s invoice or receipt number.</dd>
  <dt>Supporting document</dt><dd>An attachment. <strong>This was not verified for this manual</strong>
      and is not described as a working step.</dd>
</dl>
{shot('staff/expense-02-filled.png', 'An expense, filled in.')}
""")}
{step(2, 'Review, then file it', f"""
{pair(shot('staff/expense-03-confirm.png', 'The confirmation summary.', in_pair=True),
      shot('staff/expense-04-result.png', 'Filed for approval. No money has moved.', in_pair=True))}
{note('Recording an expense does not spend the money',
      'It is filed as <em>Awaiting approval</em>. Nothing leaves the account until a manager '
      'approves it.')}
""")}
{step(3, 'A manager approves it', f"""
{shot('staff/expense-05-awaiting-approval.png', 'The approval queue, with the month to date by category above it.')}
{shot('staff/expense-06-approve-confirm.png', 'The confirmation, which states plainly what approving will do.')}
<p><strong>Expected result:</strong> the ledger is posted, the account balance falls, and the expense
appears in the cashbook and the income-and-expenditure account.</p>
{note('An expense is what the money was spent on',
      'A bank withdrawal is not an expense — it is a transfer from Bank to Cash. The expense is what '
      'the cash is then spent on. Recording a withdrawal as an expense overstates spending and '
      'loses the cash.', kind='warn')}
""")}
<p>Income the SACCO receives that is not a member payment — interest on the bank account, for
instance — is recorded the same way under <strong>Finance &rarr; Income</strong>.</p>

<h2>Reconciliation</h2>
<p class="who"><strong>Who may do this:</strong> <span class="role">Accountant</span>
<span class="role">Manager</span> <span class="role">Admin</span> <span class="role">Super Admin</span></p>
{step(1, 'Finance → Reconciliation → Reconcile an account', f"""
{shot('staff/recon-01-form.png', 'The reconciliation form.')}
<dl class="fields">
  <dt>Account (required)</dt><dd>Cash at Merchant, Cash at Bank or Cash at Hand.</dd>
  <dt>Date (required)</dt><dd>The date the count or statement relates to. The system works out its
      own balance <strong>as at that date</strong>, not as at this moment.</dd>
  <dt>Actual balance (required)</dt><dd>What is really there: the wallet, the bank statement, or the
      cash you counted.</dd>
  <dt>Statement reference</dt><dd>The statement or count sheet you are working from.</dd>
  <dt>Reason</dt><dd><strong>Required if there is a difference.</strong></dd>
</dl>
""")}
{step(2, 'Enter what is really there', f"""
{shot('staff/recon-02-filled.png', 'A cash count entered, with the reason for the difference.')}
""")}
{step(3, 'Review and record', f"""
{pair(shot('staff/recon-03-confirm.png', 'The confirmation, showing the variance before it is saved.', in_pair=True),
      shot('staff/recon-04-result.png', 'Recorded, with its REC reference.', in_pair=True))}
<p><strong>Expected result:</strong> a <span class="kbd">REC</span> record holding the system
balance, the balance you counted, the difference and your reason. In the example above the count was
UGX 4,999.67 short.</p>
""")}
{shot('staff/recon-05-history.png', 'The reconciliation history for each account.')}
{note('Reconciliation never changes a balance',
      'It records what you found. A difference is investigated — a missing entry, a payment recorded '
      'twice, a bank charge nobody entered — and put right with a proper entry or a reversal. The '
      'reconciliation itself is a note, not a correction.', kind='warn')}

{note('A reconciliation is worked out as at the date you give it',
      'The system balance it compares against is the balance <em>on that date</em>, not the balance '
      'at this moment. An entry dated after that date is correctly left out — so if a figure '
      'surprises you, check the dates on the recent entries before assuming the count is wrong.')}
''')


sec('Reports', f'''
<p class="lead">Every report is produced from the ledger at the moment you open it. There are no
stored totals, so a report cannot disagree with the transactions behind it.</p>
<p class="who"><strong>Viewing reports:</strong> every staff role. <strong>Member statements and
member reports:</strong> <span class="role">Loan Officer</span> <span class="role">Accountant</span>
<span class="role">Field Officer</span> <span class="role">Manager</span>
<span class="role">Admin</span> <span class="role">Super Admin</span>. <strong>Finance reports:</strong>
roles that may view Finance.</p>

{shot('staff/report-01-index.png', 'The Reports screen: every report, grouped by subject.')}

<h2>What is available</h2>
{table(['Report', 'What it answers', 'Where'], [
    ['<strong>Member register</strong>', 'Who the members are, their categories and standing.', 'Reports'],
    ['<strong>Member statement</strong>', 'One member&rsquo;s savings over a period.', 'Reports'],
    ['<strong>Member financial ledger</strong>', 'Every transaction for one member.', "The member&rsquo;s page"],
    ['<strong>Savings performance</strong>', 'Expected against collected, by category.', 'Savings'],
    ['<strong>Savings schedules</strong>', 'Who is paid up and who is behind.', 'Savings'],
    ['<strong>Share register</strong>', 'Share capital held, by member.', 'Shares'],
    ['<strong>Loan portfolio</strong>', 'Every loan at every stage.', 'Loans'],
    ['<strong>Overdue loans</strong>', 'Loans in arrears.', 'Loans'],
    ['<strong>Loan repayments</strong>', 'Every repayment received.', 'Transactions'],
    ['<strong>Cash &amp; Bank report</strong>', 'Opening, movements and closing, per account.', 'Finance'],
    ['<strong>Consolidated cash position</strong>', 'All accounts side by side.', 'Finance'],
    ['<strong>Receipts &amp; payments</strong>', 'Money in and out over a period.', 'Finance'],
    ['<strong>Income &amp; expenses</strong>', 'The income and expenditure account.', 'Finance'],
    ['<strong>Profit &amp; loss</strong>', 'Surplus or deficit for the year to date.', 'Finance'],
    ['<strong>Transaction register</strong>', 'The complete ledger.', 'Transactions'],
    ['<strong>Audit log</strong>', 'Who changed what, when and why.', 'Audit Log'],
])}

<h2>Using a report</h2>
{pair(shot('staff/report-05-cash-bank.png', 'The Cash &amp; Bank report.', in_pair=True),
      shot('staff/report-07-profit-loss.png', 'Income and expenses for the year to date.', in_pair=True))}
<ol>
  <li>Open the report.</li>
  <li>Set the <strong>period</strong> — today, this week, this month, this year, or dates you choose.</li>
  <li>Apply any filter the report offers (category, status, account, member).</li>
  <li>Read the totals at the top; they always reflect the filter you have applied.</li>
</ol>

<h2>Printing, or saving as a PDF</h2>
<p>Press <strong>Download PDF</strong>, or use your browser's own print option, and choose
<em>Save as PDF</em> as the destination.</p>
{pair(shot('staff/print-01-member-statement.png', 'A member statement as it prints.', in_pair=True),
      shot('staff/print-02-member-register.png', 'The member register as it prints.', in_pair=True))}
<p>The printed document carries the SACCO's crest and full registered name, what the document is,
what it is about, the period, the headline totals, when it was produced and <strong>by
whom</strong>. The menus and buttons are dropped, and a table that runs over a page repeats its
headings.</p>

<h2>Exporting to a spreadsheet</h2>
<p>Where <strong>Export CSV</strong> appears, it downloads the same rows for Excel. It is a CSV file,
which Excel opens directly.</p>

<h2>Checking that a report is right</h2>
{table(['Check', 'How'], [
    ['Does the period cover what you meant?', 'The dates are printed on the report.'],
    ['Does the total match the entries?', 'The report lists the entries it has totalled — count a '
     'small one through by hand.'],
    ['Do two reports agree?', 'The Cash &amp; Bank closing balance should equal the Finance overview '
     'for the same date.'],
    ['Are reversals excluded?', 'Reversed entries are excluded from income and expense totals and '
     'shown separately.'],
    ['Are transfers excluded?', 'A transfer between the SACCO&rsquo;s own accounts is neither income '
     'nor expense and is left out of the cashbook.'],
])}
{note('A report cannot be corrected',
      'If a report looks wrong, the entries behind it are wrong. Find them in the transaction '
      'register and put those right; the report will follow.')}
''')

sec('User management', f'''
<p class="lead">Staff accounts, their roles, and how access is ended.</p>
<p class="who"><strong>Who may do this:</strong> <span class="role">Admin</span>
<span class="role">Super Admin</span> only. Not a SACCO Manager.</p>

{shot('admin/users-list.png', 'Users: every staff account, its role, status and last sign-in.')}

<h2>Creating a staff account</h2>
{step(1, 'Users → Add staff account', f"""
{shot('admin/users-add-staff-dialog.png', 'The new staff account form.')}
<dl class="fields">
  <dt>Full name (required)</dt><dd>The person&rsquo;s real name — it appears on everything they record.</dd>
  <dt>Phone number</dt><dd>What they will sign in with. Members of staff without an email use this.</dd>
  <dt>Email address</dt><dd>Optional. If present, they may sign in with it and can use the emailed
      password reset.</dd>
  <dt>Role (required)</dt><dd>Give the <strong>least</strong> access the job needs. It can be changed later.</dd>
</dl>
""")}
{step(2, 'Hand over the temporary password', f"""
{shot('admin/users-temporary-password.png', 'The temporary password, shown once.')}
<p>Give it to the person directly. They must replace it at their first sign-in, and until they do,
the account can do nothing else.</p>
{note('Do not send a temporary password by SMS or WhatsApp to a number you have not verified',
      'And do not write it in a shared book. It is shown once for a reason.', kind='warn')}
""")}

<h2>Changing a role</h2>
<p>Open the account on the Users screen and change its role. It takes effect at once — including for
a session already open. Every change is audited.</p>
{note('You cannot change your own role',
      'Nobody can, including a Super Admin. Ask another Super Admin.')}

<h2>Ending somebody&rsquo;s access</h2>
<p>When a member of staff leaves, or changes job, <strong>deactivate the account</strong> on the
Users screen. A deactivated account cannot sign in, and an open session stops working on its next
request.</p>
{note('Deactivate, never share and never re-use',
      'An account is a person. Everything done under it is recorded as done by that person. Never '
      'hand a leaver&rsquo;s account to their replacement — create a new one and deactivate the old.', kind='warn')}

<h2>Resetting a member of staff&rsquo;s password</h2>
<p>Press <strong>Reset password</strong> on their account. A new temporary password is shown once,
the old one stops working immediately, and they must choose a new one at their next sign-in.</p>

<h2>Least privilege, in practice</h2>
{table(['Situation', 'The right role'], [
    ['Takes money at the counter', 'Cashier / Teller'],
    ['Collects in the field, records nothing else', 'Field Officer'],
    ['Assesses loans, does not approve them', 'Loan Officer'],
    ['Keeps the books, does not touch the counter', 'Accountant'],
    ['Runs the SACCO day to day', 'SACCO Manager'],
    ['Needs to see everything, change nothing', 'Viewer'],
    ['Looks after staff accounts', 'Admin'],
    ['Looks after the system itself', 'Super Admin — as few as possible'],
])}
''')

sec('Administrator functions', f'''
<p class="lead">Configuration, roles and oversight. These screens change how the system behaves for
everybody, so they belong to a small number of people.</p>

<h2>Settings</h2>
<p class="who"><strong>Who may use this:</strong> <span class="role">Manager</span>
<span class="role">Admin</span> <span class="role">Super Admin</span></p>
{shot('admin/walk-settings.png', 'Settings, by section.')}
{table(['Section', 'What it controls'], [
    ['<strong>Organisation</strong>', 'The SACCO&rsquo;s name, registration, motto and contact '
     'details — what appears on receipts and letterheads.'],
    ['<strong>Fees</strong>', 'Every fee: amount, when it applies, and whether it is mandatory.'],
    ['<strong>Financial</strong>', 'Currency, and the smallest and largest amounts allowed.'],
    ['<strong>Loans</strong>', 'How many loans a member may hold at once, guarantor requirements, '
     'grace periods and late penalties.'],
    ['<strong>Members</strong>', 'Which registration fields are required, the minimum age, and '
     'whether fees must be paid before a member becomes Active.'],
    ['<strong>Savings</strong>', 'Minimum amounts, and whether part payments are allowed.'],
    ['<strong>Categories</strong>', 'Whether a member&rsquo;s savings category must match their share category.'],
    ['<strong>Cash &amp; Bank</strong>', 'Approval rules, the approval threshold, the four-eyes rule, '
     'whether an account may go below zero, and balance alerts.'],
    ['<strong>Notifications</strong>', 'Which events notify members.'],
    ['<strong>Security</strong>', 'Session timeout, minimum password length, failed-attempt limits '
     'and lock-out length, and whether a reversal needs a reason.'],
    ['<strong>System</strong>', 'Receipt and statement footers.'],
    ['<strong>Loan Products</strong>', 'The products members may borrow under.'],
    ['<strong>Users &amp; Roles</strong>', 'A way through to staff accounts and permissions.'],
    ['<strong>Change History</strong>', 'Every settings change, and who made it.'],
])}
{note('Settings change what everybody sees, at once',
      'Changing the minimum password length, the session timeout or the approval threshold affects '
      'every member of staff immediately. Agree the change before you make it, and note why.', kind='warn')}

<h2>Fees</h2>
{pair(shot('admin/settings-fees-create-dialog.png', 'Creating a fee.', in_pair=True),
      shot('admin/settings-fees-list.png', 'The fees in force.', in_pair=True))}
<ul>
  <li>A fee is never deleted — it is made <strong>inactive</strong>, so history stays intact.</li>
  <li>Each member&rsquo;s charge keeps the name and amount it had when it was made, so raising a fee
      changes what the next member pays and nothing that has already happened.</li>
</ul>

<h2>Roles and permissions</h2>
<p class="who"><strong>Who may use this:</strong> <span class="role">Super Admin</span> only.</p>
{shot('admin/walk-roles.png', 'Roles &amp; Permissions: every role, and every permission it holds.')}
<p>Switching a permission off here switches it off everywhere — the menu, the screens and the
database all ask the same question. A new role can be created, given permissions and told which
dashboard it opens on, without any change to the software.</p>
{note('What cannot be configured away',
      'Super Admin always holds everything. The Member role can only ever hold member-portal '
      'permissions. Only a Super Admin may grant <em>Manage staff accounts</em> or <em>Manage roles '
      '&amp; permissions</em>. Nobody may edit their own role. Every change is audited.')}

<h2>The audit log</h2>
<p class="who"><strong>Who may view it:</strong> <span class="role">Accountant</span>
<span class="role">Manager</span> <span class="role">Admin</span> <span class="role">Super Admin</span></p>
{shot('admin/walk-audit.png', 'The audit log.')}
<p>Every action that matters is here: the person, the action, the module, the record, the time, and —
for sensitive actions — the reason and the values before and after. Sign-ins, failed sign-ins,
sign-outs, password changes and resets are all recorded too, under <em>Security</em>. The log is
append-only; nobody can edit or remove an entry.</p>
<p>Use it to answer: who recorded this payment? who changed this member&rsquo;s phone number, and
why? who approved this expense? who was signed in on Tuesday afternoon?</p>

<h2>Nightly maintenance</h2>
<p>A scheduled job runs once a night. It opens the day's savings schedules, marks cycles missed
where nothing was paid, and flags loans that have fallen into default. It is set up when the system
is installed and is not something staff run.</p>
{note('If schedules stop appearing, or loans are never flagged overdue',
      'The nightly job may not be running. This is a matter for whoever supports the system, not '
      'something to work around by entering data by hand.', kind='warn')}
''')


sec('Role workflows at a glance', f'''
<p class="lead">What a normal day looks like for each role, and where each task is described in full.</p>

<h2>Cashier / Teller</h2>
{pair(shot('staff/cashier-01-desk.png', 'The Cashier desk.', in_pair=True),
      shot('staff/cashier-02-collect.png', 'Collect Savings, as a Cashier sees it.', in_pair=True))}
{table(['Task', 'Where', 'Section'], [
    ['Record a savings collection', 'Savings &rarr; Collect Savings', '6'],
    ['Record a deposit or a withdrawal', 'Transactions &rarr; Record Deposit', '9'],
    ['Sell shares', 'Shares &rarr; Record Share Purchase', '5'],
    ['Record a loan repayment', 'Loans &rarr; the loan &rarr; Record repayment', '8'],
    ['Collect a fee', 'The member&rsquo;s page', '9'],
    ['Print a receipt', 'The transaction', '10'],
    ['Check today&rsquo;s takings', 'Cashier desk', '9'],
])}
<p>A Cashier cannot approve, reverse, register a member, change a record or open Settings or Users.</p>

<h2>Field Officer</h2>
{pair(shot('staff/fo-01-collections.png', 'Collections, as a Field Officer sees it.', in_pair=True),
      shot('staff/fo-03-schedules.png', 'Schedules — who is behind.', in_pair=True))}
<p>A Field Officer records savings and reads schedules, members and reports. They cannot sell shares,
take loan repayments, or open Finance.</p>
{note('Recording a collection made earlier',
      'Set the <strong>payment date</strong> to the day you actually received the money. Record it '
      'the same day you return, not later.')}

<h2>Loan Officer</h2>
{pair(shot('staff/lo-01-desk.png', 'The Loans desk.', in_pair=True),
      shot('staff/lo-02-loans.png', 'The loan portfolio.', in_pair=True))}
{table(['Task', 'Where', 'Section'], [
    ['Capture an application', 'Loans &rarr; New Loan Application', '8'],
    ['Assess an application', 'Loans desk &rarr; the application &rarr; Start review', '8'],
    ['Manage guarantors', 'The loan', '8'],
    ['Record a repayment', 'The loan &rarr; Record repayment', '8'],
    ['Work the arrears list', 'Loans, filtered by Overdue', '8'],
])}
<p>A Loan Officer <strong>cannot approve or disburse</strong> a loan — that is deliberate, so that
the person who assesses is not the person who decides. They also cannot open Finance.</p>

<h2>Accountant</h2>
{pair(shot('staff/acc-01-finance.png', 'Finance, as an Accountant sees it.', in_pair=True),
      shot('staff/acc-02-ledger.png', 'The transaction ledger.', in_pair=True))}
<p>An Accountant records income and expenses, reconciles accounts, reads every report and the audit
log. They cannot approve their own entries, take money at the counter, or register members.</p>

<h2>SACCO Manager</h2>
{pair(shot('staff/mgr-01-overview.png', 'The SACCO overview.', in_pair=True),
      shot('staff/mgr-08-audit.png', 'The audit log.', in_pair=True))}
<p>A Manager does everything above, and in addition: registers members, edits records and statuses,
manages categories and fees, approves and disburses loans, approves expenses and transfers, reverses
transactions, and changes Settings. A Manager <strong>cannot</strong> manage staff accounts or roles.</p>

<h2>Admin and Super Admin</h2>
{shot('admin/walk-dash-administration.png', 'The Administration dashboard.')}
<p>An Admin adds everything a Manager can do plus staff accounts. A Super Admin adds Roles &amp;
Permissions and always holds every permission.</p>
''')

sec('Keeping the records accurate', f'''
<p class="lead">The system enforces what a computer can enforce. These are the habits that cover the
rest.</p>

<h2>Before you record anything</h2>
{table(['Do', 'Why'], [
    ['Identify the member by their <strong>member number</strong>, and read the name back.',
     'Names repeat; numbers do not.'],
    ['Count the money before you type a figure.', 'Type what you received, not what was expected.'],
    ['For mobile money or bank, read the reference from the confirmation message.',
     'It is what lets the payment be matched at reconciliation, and it cannot be used twice.'],
    ['Check the date if the money was received earlier.', 'The entry should be dated when the money '
     'arrived, not when you got to a computer.'],
    ['Read the confirmation summary.', 'It is the last moment before the record becomes permanent.'],
])}

<h2>After you record it</h2>
{table(['Do', 'Why'], [
    ['Check the result screen names the right member and the right amount.',
     'Catching it now is far easier than catching it at month end.'],
    ['Give the member their receipt.', 'It is their evidence, and yours.'],
    ['If it is wrong, report it the same day.', 'A reversal on the day is routine; a reversal a month '
     'later is an investigation.'],
])}

<h2>Avoiding duplicates</h2>
<ul>
  <li>Do not press a confirm button twice because the screen is slow. The system is built to record
      a double press once, but the habit is a bad one.</li>
  <li>Before recording a payment a member says they already made, <strong>search for it</strong>.
      The reference from their confirmation message will find it.</li>
  <li>The same mobile-money or bank reference cannot be recorded twice on the same account. If the
      system refuses a reference, the payment is probably already recorded — find it.</li>
</ul>

<h2>What the system does not check</h2>
{note('The system cannot know',
      'whether the money in front of you is real; whether the member who paid is the member you '
      'selected; whether the reference you typed is the reference on the message; or whether a '
      'transfer you recorded actually happened at the bank. Those are yours.', kind='warn')}

<h2>Supporting records</h2>
<p>Keep the paper: mobile-money confirmations, bank slips, supplier invoices, manual receipt books
used in the field. The system holds the reference; your file holds the evidence behind it. An
auditor will ask for both.</p>

<h2>Escalating</h2>
{table(['Situation', 'Who to tell', 'When'], [
    ['Money recorded against the wrong member', 'Your supervisor or the Manager', 'Same day'],
    ['An amount recorded wrongly', 'Your supervisor or the Manager', 'Same day'],
    ['A reconciliation difference you cannot explain', 'The Accountant and the Manager', 'Same day'],
    ['A member disputes a balance', 'Your supervisor', 'At once, with the member present'],
    ['Cash on hand does not match the system', 'The Manager', 'Before you leave'],
    ['You suspect misuse of an account', 'The Manager or a Super Admin', 'At once'],
    ['A system error stops you finishing something', 'The Manager, and whoever supports the system',
     'At once, with a note of what you were doing'],
])}
''')

sec('Troubleshooting', f'''
{table(['Problem', 'Likely cause', 'What to do'], [
    ['A menu item I need is missing.', 'Your role does not hold that permission.',
     'Ask your manager. Roles are changed on Users &rarr; Roles &amp; Permissions by a Super Admin.'],
    ['I opened a link and was sent back to my dashboard.', 'Same — the route is not open to your role.',
     'Not a fault. Ask your manager if you genuinely need it.'],
    ['A member cannot be found.', 'Spelling, or the wrong number; or the member is archived.',
     'Search by phone number instead, and clear any status filter. If still nothing, they may not be '
     'registered.'],
    ['A transaction I recorded is not in the list.', 'The filter, not the record.',
     'Clear the date and type filters, or search by the reference from the receipt.'],
    ['<em>This reference has already been used.</em>', 'That mobile-money or bank reference is '
     'already recorded on that account.', 'Search for it. The payment is almost certainly already in '
     'the system — do not record it again.'],
    ['A loan balance does not look right.', 'A repayment missing, or one recorded against the wrong loan.',
     'Open the loan and read its repayment history against the member&rsquo;s receipts.'],
    ['<em>This member already has a loan in progress.</em>', 'The one-loan-at-a-time rule.',
     'Complete or close the existing loan first. The limit is a setting management controls.'],
    ['A form will not submit and a field is red.', 'A required field, or a value outside the allowed range.',
     'Read the message under the field; it names what is wrong.'],
    ['<em>Payment of UGX &hellip; exceeds the outstanding balance.</em>', 'Usually the repayment '
     'quick-fill defect (see below).', 'Read the amount in the box. Type the correct figure.'],
    ['Reversing a savings payment fails with a system error.', '<strong>A known defect.</strong>',
     'Do not attempt a correcting entry of your own. Note the reference, the member and the amount, '
     'and report it to the Manager and to system support.'],
    ['An expense was approved but the balance has not changed.', 'Looking at the wrong account, or '
     'the wrong period.', 'Check which account it was paid from, and the report&rsquo;s date range.'],
    ['A report will not load.', 'Too wide a date range, or a slow connection.',
     'Narrow the period and try again.'],
    ['I cannot sign in.', 'Wrong password; or too many attempts; or the account is deactivated.',
     'Wait out the pause, then try once. If it still fails, an Admin must reset the password.'],
    ['I was signed out while working.', 'The session timed out after a period of inactivity.',
     'Sign in again. Nothing you had already confirmed is lost; anything you had only typed is.'],
])}

<h2>Known defects at the time of writing</h2>
{table(['#', 'What happens', 'What to do instead'], [
    ['<strong>1</strong>', 'Reversing a <em>savings</em> transaction fails with a system error. '
     'Nothing is changed. Other kinds of transaction reverse normally.',
     'Report it. Do not attempt a correcting entry by hand. Keep a written note of the transaction '
     'until it is put right.'],
    ['<strong>2</strong>', 'On the repayment screen, the <em>One installment</em> shortcut enters an '
     'amount one hundred times too large when the installment is not a whole number of shillings.',
     'Type the amount yourself and read the figure in the box before you continue.'],
])}
{note('Both defects have been reported to SACCO management',
      'Until they are fixed, the instructions above are the safe way to work. Neither can cause a '
      'wrong amount to be posted if the confirmation summary is read before confirming.')}
''')

sec('Security and responsible administration', f'''
{table(['Rule', 'Why'], [
    ['<strong>Your account is yours alone.</strong> Never share your password, and never let '
     'somebody work under your session.',
     'Everything recorded under your account is recorded as done by you.'],
    ['<strong>Sign out before you leave the counter.</strong>',
     'Locking the screen is not enough if somebody else can reach the keyboard.'],
    ['<strong>Never ask a member for their password.</strong>',
     'You do not need it, and no member of staff ever should. Reset it instead.'],
    ['<strong>Check identity before creating or resetting a login.</strong>',
     'A National ID, every time. That password opens everything about that member&rsquo;s money.'],
    ['<strong>Give the least access the job needs.</strong>',
     'Fewer people able to do a thing means fewer ways for it to go wrong.'],
    ['<strong>Deactivate leavers the day they leave.</strong>',
     'An account nobody is using is an account nobody is watching.'],
    ['<strong>Treat member information as confidential.</strong>',
     'Balances, phone numbers and National IDs are not to be discussed outside the work they are needed for.'],
    ['<strong>Protect what you export.</strong>',
     'A downloaded report or a screenshot has no permissions on it. Do not send one over WhatsApp, '
     'and delete it when you are done.'],
    ['<strong>Report anything odd.</strong>',
     'An entry nobody recognises, a sign-in at an impossible hour, a balance that will not '
     'reconcile — the audit log is there to be used.'],
])}

<h2>What the system does, and does not, protect against</h2>
{table(['The system does', 'The system does not'], [
    ['Stop a posted transaction being edited or deleted, by anybody', 'Know whether the money you '
     'were handed was real'],
    ['Hide and block screens a role may not use', 'Stop somebody using a colleague&rsquo;s open session'],
    ['Pause sign-in after repeated failures', 'Stop somebody who has genuinely been told a password'],
    ['Refuse a duplicate payment reference on an account', 'Notice two different entries for the same money'],
    ['Record who did what, when, and why', 'Read that record for you — somebody has to look'],
    ['Sign an idle session out', 'Replace signing out yourself'],
])}
''')

sec('Frequently asked questions', f'''
<h3>A member says they paid by mobile money but their balance has not changed. Why?</h3>
<p>Because the payment has not been recorded. The system is not connected to any mobile-money
provider. Ask for the confirmation message, search the reference, and if it really is not there,
record it with that reference and the date it was received.</p>

<h3>Can I edit a transaction I recorded with the wrong amount?</h3>
<p>No — nobody can. A Manager, Admin or Super Admin reverses it with a reason, and then the correct
entry is recorded. See Section 10.</p>

<h3>Why can I see Finance but not record anything there?</h3>
<p>Viewing and recording are separate permissions. Ask your manager.</p>

<h3>A member wants to change their phone number.</h3>
<p>An Admin or Manager edits their record, on sight of the National ID, giving a reason. The change
is kept field by field under History on the member's page.</p>

<h3>Can a member be deleted?</h3>
<p>No. Set their status to Inactive or Archived, with a reason. Their record and transactions stay.</p>

<h3>Why does a new member show as Pending?</h3>
<p>Because mandatory fees have not been paid, and management has set <em>Mandatory fees must be paid
before a member is active</em>. They become Active automatically when the fees are paid or waived.</p>

<h3>What is the difference between a withdrawal and an expense?</h3>
<p>A bank withdrawal moves the SACCO's own money from Bank to Cash — a transfer. An expense is what
that cash is then spent on. Recording a withdrawal as an expense overstates spending and loses the
cash.</p>

<h3>Why does my expense say "Awaiting approval"?</h3>
<p>Because expenses are approved before the money moves. A Manager, Admin or Super Admin approves it.</p>

<h3>Two members have the same phone number. What now?</h3>
<p>Only an Admin or Super Admin, holding <em>Allow a shared phone number</em>, can authorise it, and
a reason is recorded. In most cases it means one of the numbers is wrong — check first.</p>

<h3>The savings schedules have not appeared this week.</h3>
<p>The nightly job may not be running. Report it; do not enter schedules by hand.</p>

<h3>How do I find out who recorded a particular payment?</h3>
<p>Open the transaction — it names who recorded it — or search the audit log by the reference.</p>

<h3>A member says the SACCO has lost their money.</h3>
<p>Take it seriously and work from evidence: ask for the confirmation message or receipt, search the
reference in the transaction register, and check their member ledger. Involve your manager early.
Never promise a correction you are not authorised to make.</p>
''')

sec('Appendix', f'''
<h2>Glossary</h2>
{table(['Term', 'Meaning'], [
    ['<strong>Arrears</strong>', 'Money due and not paid.'],
    ['<strong>Audit log</strong>', 'The permanent record of who did what, when and why.'],
    ['<strong>Cash at Bank / Merchant / Hand</strong>', 'The SACCO&rsquo;s three kinds of account.'],
    ['<strong>Disbursement</strong>', 'Handing a loan over to the member.'],
    ['<strong>Four eyes</strong>', 'A rule under which a second person approves an entry.'],
    ['<strong>Guarantor</strong>', 'A member who stands for another member&rsquo;s loan.'],
    ['<strong>Idempotency</strong>', 'Recording the same submission twice produces one entry.'],
    ['<strong>Ledger</strong>', 'The single, permanent list of every money movement.'],
    ['<strong>Permission</strong>', 'One thing a role is allowed to do.'],
    ['<strong>Reconciliation</strong>', 'Comparing what the system says an account holds with what '
     'it really holds.'],
    ['<strong>Reversal</strong>', 'A correcting entry that cancels an earlier one. Both remain.'],
    ['<strong>Role</strong>', 'A named set of permissions given to a member of staff.'],
    ['<strong>Savings category</strong>', 'How much a member saves, and how often.'],
    ['<strong>Schedule / cycle</strong>', 'One week or month of expected savings for one member.'],
    ['<strong>Share category</strong>', 'How many shares a member should own, and by when.'],
    ['<strong>Temporary password</strong>', 'A one-time password issued by the office, which the '
     'holder must replace at their first sign-in.'],
    ['<strong>Transfer</strong>', 'Money moved between the SACCO&rsquo;s own accounts. Neither '
     'income nor expense.'],
    ['<strong>Waiver</strong>', 'A manager excusing a savings cycle, with a written reason.'],
])}

<h2>Reference prefixes</h2>
{table(['Prefix', 'Document'], [
    ['SAV', 'Savings'], ['SHR', 'Shares'], ['LRP', 'Loan repayment'],
    ['LDS', 'Loan disbursement'], ['LN', 'Loan account'], ['RCT', 'Receipt'],
    ['PAY', 'Payment'], ['EXP', 'Expense'], ['INC', 'Income'], ['TRF', 'Transfer'],
    ['DEP', 'Bank deposit'], ['WDL', 'Bank withdrawal'], ['FEE', 'Fee'],
    ['PEN', 'Penalty'], ['REV', 'Reversal'], ['REC', 'Reconciliation'],
])}
<p>Member numbers take the form <strong>BND</strong> + the two-digit year of registration + that
year's sequence — BND26006 is the sixth member registered in 2026. The sequence starts again at 001
each January. A member number is issued once and can never be changed.</p>

<h2>Daily and periodic checks</h2>
{table(['When', 'Who', 'What'], [
    ['End of each day', 'Cashier', 'Count the cash box and compare it with Cash at Hand. Report any '
     'difference before leaving.'],
    ['End of each day', 'Cashier', 'Check today&rsquo;s collections on the Cashier desk against your '
     'receipt book.'],
    ['Weekly', 'Loan Officer', 'Work the overdue loans list.'],
    ['Weekly', 'Manager', 'Review the savings schedules for members falling behind.'],
    ['At least monthly', 'Accountant', 'Reconcile Cash at Merchant, Cash at Bank and Cash at Hand.'],
    ['Monthly', 'Manager', 'Review the income and expenditure account, and the approval queue.'],
    ['Monthly', 'Admin', 'Review the Users list — deactivate anybody who has left.'],
    ['Quarterly', 'Manager / Super Admin', 'Review Roles &amp; Permissions against who does what.'],
])}

<h2>Where to find things</h2>
{table(['I want to&hellip;', 'Go to'], [
    ['Record a savings payment', 'Savings &rarr; Collect Savings'],
    ['Register a member', 'Members &rarr; Register Member'],
    ['Give a member a portal login', "The member&rsquo;s page &rarr; Create login"],
    ['Reset a member&rsquo;s password', "The member&rsquo;s page &rarr; Reset password"],
    ['Sell shares', 'Shares &rarr; Record Share Purchase'],
    ['Capture a loan application', 'Loans &rarr; New Loan Application'],
    ['Approve or disburse a loan', 'Loans &rarr; the loan'],
    ['Record a repayment', 'Loans &rarr; the loan &rarr; Record repayment'],
    ['Record an expense', 'Finance &rarr; Expenses &rarr; Record expense'],
    ['Approve an expense', 'Finance &rarr; Expenses &rarr; Awaiting approval'],
    ['Move money between accounts', 'Finance &rarr; Transfers'],
    ['Reconcile an account', 'Finance &rarr; Reconciliation'],
    ['Print a member statement', 'Reports &rarr; Member Statement'],
    ['Reverse a transaction', 'Transactions &rarr; the transaction &rarr; Reverse'],
    ['Add a member of staff', 'Users &rarr; Add staff account'],
    ['Change what a role may do', 'Users &rarr; Roles &amp; Permissions'],
    ['Change a fee', 'Settings &rarr; Fees'],
    ['See who did something', 'Audit Log'],
])}

<h2>Revision history</h2>
{table(['Version', 'Date', 'Change'], [
    ['1.0', DATE, 'First issue, following a full review of the working system.'],
])}
''')
