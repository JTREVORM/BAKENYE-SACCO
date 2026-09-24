#!/usr/bin/env python3
"""Assemble the BAKENYE SACCO Member User Guide."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import cover, document, fig, pair, step, note, table, ORG, DATE, VERSION

S = []          # (level, title, html) — level 1 = numbered section
n = [0]         # screenshot counter


def shot(path, caption, cls='', in_pair=False):
    n[0] += 1
    return fig(path, caption, cls=cls, number=n[0], in_pair=in_pair)


def sec(title, html_body):
    S.append((1, title, html_body))


# ---------------------------------------------------------------- front matter
FRONT = f'''
<h1>Document control</h1>
{table(['Item', 'Detail'], [
    ['Document title', 'Bakenye SACCO Member User Guide'],
    ['Version', VERSION],
    ['Publication date', DATE],
    ['Intended audience', 'Registered members of Bakenye Unity and Development SACCO'],
    ['Purpose', 'To show members how to sign in to the SACCO system and read their own savings, '
                'shares, loan and transaction records safely and correctly.'],
    ['Applies to', 'The version of the SACCO system verified on 24 September 2026.'],
    ['Prepared by', 'Documentation review of the live application'],
], cls='docctl')}

<h2>Revision history</h2>
{table(['Version', 'Date', 'Change', 'By'], [
    ['1.0', DATE, 'First issue. Every screen and step in this guide was checked against the working '
                  'system before publication.', 'Documentation review'],
])}

<h2>About this guide</h2>
<p>This guide describes what the Bakenye SACCO system actually does today. Every picture in it is a
photograph of a real screen from the system, taken on a test copy that holds made-up members and
made-up money, so that no real member's private information appears anywhere in this book.</p>
<p>The names, telephone numbers and amounts you will see in the pictures — Musoke John, BND26006,
UGX 600,000 and so on — are examples only. Your own screen will show your own details.</p>

{note('If something in this guide does not match your screen',
      'The SACCO may have updated the system since this guide was printed. Where the guide and the '
      'screen disagree, the screen is right. Please tell SACCO staff, so the guide can be corrected.')}

<h2>What this guide does not cover</h2>
<ul>
  <li>Anything only SACCO staff can do. Recording payments, registering members and approving loans
      are staff tasks, and they are described in the separate <em>Staff &amp; Administrator
      Manual</em>.</li>
  <li>SACCO policy — interest rates, fees, savings amounts and deadlines are decided by the SACCO
      and set up in the system by management. This guide shows you where to read them on your own
      screen; it does not state them as rules.</li>
</ul>
'''

# ------------------------------------------------------------------- sections
sec('Introduction', f'''
<p class="lead">The Bakenye SACCO system is the SACCO's record of your money, and it lets you look
at that record yourself, on your own phone, at any hour.</p>

<h2>What the system is</h2>
<p>Everything the SACCO holds for you — what you have saved, the shares you own, any loan you are
repaying, and every payment that has been recorded against your name — is kept in one place. The
member portal is your window on to that record.</p>

<h2>Why the SACCO uses it</h2>
<ul>
  <li><strong>You can check for yourself.</strong> You no longer have to come to the office simply
      to ask what your balance is.</li>
  <li><strong>Nothing is lost.</strong> Every payment carries its own reference number and stays on
      your record permanently.</li>
  <li><strong>Mistakes can be found.</strong> If a payment you made is missing, you can see that it
      is missing and report it while the evidence is still fresh.</li>
</ul>

<h2>Who can use the member portal</h2>
<p>Any registered member of Bakenye Unity and Development SACCO whom the office has given a login.
Your membership must be <strong>Active</strong>. If your membership has been suspended, made
inactive or archived, the system will tell you so when you try to sign in, and you will need to
speak to SACCO staff.</p>

<h2>What you can and cannot do</h2>
{table(['You can', 'You cannot'], [
    ['See your savings balance and history', 'Record a payment yourself'],
    ['See your shares and how close you are to your share category', 'Buy shares inside the app'],
    ['See your loan, its balance and its repayment schedule', 'Change your own name, phone number or member number'],
    ['Apply for a loan, if the SACCO has this switched on for members', 'Approve or disburse a loan'],
    ['Read and print your statement', 'See another member&rsquo;s records'],
    ['Change your own password', 'Undo or correct a transaction'],
])}

{note('Why you cannot record your own payments',
      'The system has no connection to MTN, Airtel or any bank. It cannot see that money has '
      'arrived. A member of staff checks the money, then records it. That is what protects every '
      'member&rsquo;s balance from being changed by somebody simply typing a number in.')}

<h2>Look after your login</h2>
<p>Your password is yours alone. No member of SACCO staff will ever ask you for it, and no member of
staff can see it. If you tell somebody your password, they can see everything about your money.</p>
''')

sec('What you need before you start', f'''
{table(['You need', 'Detail'], [
    ['A phone, tablet or computer', 'Any smartphone that can open websites will do. The system was '
     'built for ordinary Android phones and works on a small screen.'],
    ['An internet connection', 'Mobile data or Wi-Fi. The pages are deliberately light, so they '
     'load on a slow connection.'],
    ['A web browser', 'Google Chrome, Firefox, Samsung Internet, Safari or Microsoft Edge.'],
    ['The web address of the SACCO system', 'Ask at the SACCO office. It is the same address for '
     'everyone.'],
    ['A registered, active membership', 'You must already be a registered member.'],
    ['Your login', 'Your member number (for example BND26006) or the phone number the SACCO holds '
     'for you, plus a password.'],
], cls='docctl')}

<h2>If you do not have a login yet</h2>
<p>Only SACCO staff can create a member login. Go to the SACCO office and take your
<strong>National ID</strong>. Staff will check who you are, create the login and give you a
<strong>temporary password</strong> — four letters, a dash and four numbers, such as
<span class="kbd">KQPM-4827</span>. The temporary password is shown to the officer once and handed
to you; it is not written down anywhere afterwards.</p>

{note('The temporary password only lets you in once',
      'The first time you sign in with it, the system will stop and ask you to choose a password of '
      'your own. Until you do, nothing else will open. This is deliberate: it means the password '
      'you actually use is one nobody at the SACCO has ever seen.')}

<h2>Add it to your home screen</h2>
<p>The system can be added to your phone's home screen like an app, so you do not have to type the
address every time. In Chrome, open the address, tap the menu (⋮) and choose <em>Add to Home
screen</em>.</p>
''')

sec('Signing in and signing out', f'''
<p class="lead">There is one sign-in form for everybody — members and staff alike. You do not have
to say which you are; the system works it out from your account.</p>

{step(1, 'Open the SACCO web address', f"""
<p>Type the address into your browser. The sign-in screen appears. On a phone the form comes first,
so the <strong>Sign In</strong> button is on screen without scrolling.</p>
{pair(shot('shared/login-phone.png', 'The sign-in screen on a phone.', in_pair=True),
      shot('shared/login-desktop.png', 'The same screen on a computer.', in_pair=True))}
""")}

{step(2, 'Type your member number or phone number', """
<p>In the first box, <strong>Member Number or Phone Number</strong>, type either:</p>
<ul>
  <li>your member number, for example <span class="kbd">BND26006</span> — small letters are fine; or</li>
  <li>the phone number the SACCO holds for you, for example <span class="kbd">0772 100 006</span>.
      Spaces do not matter, and <span class="kbd">+256772100006</span> works just as well.</li>
</ul>
<p><strong>What you should see:</strong> the number you typed, in the box.</p>
""")}

{step(3, 'Type your password', """
<p>In the second box, type your password. Tap the eye symbol at the right of the box if you want to
check what you have typed before you continue.</p>
""")}

{step(4, 'Press Sign In', f"""
<p><strong>What you should see:</strong> your own dashboard, with your name at the top.</p>
{shot('member/mf-01-dashboard.png', 'The member dashboard after a successful sign-in.')}
""")}

<h2>The first time: choosing your own password</h2>
<p>If you signed in with a temporary password from the office, the system will not go to your
dashboard. It will show <strong>Choose your password</strong> instead.</p>

{shot('shared/check-after-login.png', 'The "Choose your password" screen, shown once, at first sign-in.')}

<ol>
  <li><strong>Temporary password</strong> — type the one the office gave you.</li>
  <li><strong>New password</strong> — choose your own. It must be at least eight characters long and
      contain both a letter and a number.</li>
  <li><strong>Confirm new password</strong> — type the same thing again.</li>
  <li>Press <span class="kbd">Save password and continue</span>.</li>
</ol>

{note('Choosing a password that is easy for you and hard for others',
      'Avoid your own phone number, your date of birth, or 12345678. A short phrase with a number '
      'in it — something only you would think of — is both easier to remember and much harder to guess.')}

<h2>If you cannot sign in</h2>
{table(['What the screen says', 'What it usually means', 'What to do'], [
    ['<em>Invalid login credentials</em>', 'The member number, phone number or password does not '
     'match an account. The system gives the same message either way, on purpose, so that nobody '
     'can use it to find out whether a number exists.',
     'Check for typing mistakes. If you still cannot get in, use <strong>Forgot Password?</strong> '
     'or visit the office.'],
    ['<em>Too many unsuccessful attempts&hellip;</em>', 'Sign-in has been paused for a few minutes '
     'after several wrong tries.', 'Wait the number of minutes the message gives, then try again. '
     'Nothing has been locked permanently.'],
    ['<em>Your account is currently suspended</em>', 'Your membership has been suspended.',
     'Speak to SACCO administration.'],
    ['<em>Your account is currently unavailable</em>', 'The membership is inactive or archived, or '
     'the login has been switched off.', 'Speak to SACCO administration.'],
    ['<em>Unable to sign in right now</em>', 'The system could not be reached.',
     'Check your internet connection and try again in a few minutes.'],
])}

<h2>Forgotten password</h2>
<p>Press <strong>Forgot Password?</strong> on the sign-in screen.</p>
{shot('shared/forgot-password-phone.png', 'The forgotten-password screen.')}
<p>If the SACCO holds an <strong>email address</strong> for you, a reset link is sent to it. Most
members do not have one on the SACCO's record. In that case the answer is the same as for a lost
password anywhere: <strong>go to the SACCO office with your National ID</strong>. Staff will check
who you are and issue a new temporary password, and your old password stops working immediately.</p>

<h2>Signing out</h2>
<p>Tap <strong>More</strong> at the bottom of the screen, then <strong>Log Out</strong> at the foot
of the list.</p>
{shot('member/mf-17-more.png', 'The More tab. Log Out is at the bottom.')}

{note('Always sign out on a shared phone or a computer at an internet café',
      'Closing the browser is not the same as signing out. If you do nothing for a while the system '
      'signs you out by itself, but do not rely on that.')}
''')

sec('Your dashboard', f'''
<p class="lead">The dashboard is the first screen after you sign in. It answers the questions
members ask most often, in the order they ask them.</p>

{shot('member/mf-01-dashboard.png', 'The member dashboard. The figures shown are from a test account.')}

<h2>What each part means</h2>
{table(['On the screen', 'What it is telling you'], [
    ['<strong>Welcome, &lt;name&gt;</strong> with your member number and a status badge',
     'Who the system thinks you are, and whether your membership is Active.'],
    ['<strong>Total Savings</strong> (the large blue card)',
     'Everything you have saved with the SACCO, less anything withdrawn. Shares are not counted here.'],
    ['<strong>Shares</strong>', 'The value of the shares you own, and how many shares that is.'],
    ['<strong>Loan Balance</strong>', 'What is still owed on your loan, including interest. It is '
     'shown in red because it is money you owe. If you have no loan, this shows zero.'],
    ['<strong>Next Savings</strong>', 'Your savings category, how much it expects and the date it '
     'is next due.'],
    ['<strong>Next Payment</strong>', 'The next loan installment: how much, and the date it falls due.'],
    ['<strong>Quick Actions</strong>', 'Shortcuts to the screens you use most.'],
    ['<strong>Recent activity</strong>', 'The last few payments recorded on your account.'],
])}

<h2>Moving around</h2>
<p>The five tabs along the bottom of the screen are the whole of the member portal:</p>
{table(['Tab', 'What it opens'], [
    ['<strong>Home</strong>', 'This dashboard.'],
    ['<strong>Savings</strong>', 'Your savings balance, target and history.'],
    ['<strong>Loans</strong>', 'Your loans, their balances and repayment history.'],
    ['<strong>Transactions</strong>', 'Every payment recorded against your account.'],
    ['<strong>More</strong>', 'Shares, statements, reports, guarantees, notifications, your profile and Log Out.'],
])}

{note('The bell at the top right',
      'This is your notifications. A small number on it means there are messages you have not read yet.')}
''')

sec('Your profile', f'''
<p class="lead">Your profile is the SACCO's official record of who you are. You can read all of it;
you can change only your password.</p>

{pair(shot('member/mf-16-profile.png', 'My Profile — the SACCO&rsquo;s record of you.', in_pair=True),
      shot('member/mf-17-more.png', 'Reach it from More &rarr; My Profile.', in_pair=True))}

<h2>What is on it</h2>
<ul>
  <li>Your name, member number, membership date and status.</li>
  <li>Your savings and shares totals, and your loan balance.</li>
  <li>Your share category and savings category.</li>
  <li>Your telephone number and, if the SACCO holds one, your email address.</li>
</ul>

<h2>What you can change yourself</h2>
{table(['Detail', 'Who changes it'], [
    ['Password', '<strong>You</strong>, from <em>More &rarr; Password &amp; Security</em>.'],
    ['Name', 'SACCO staff, at the office, on sight of your National ID.'],
    ['Telephone number', 'SACCO staff, at the office.'],
    ['Member number', 'Nobody. It is issued once and never changes.'],
    ['Membership date', 'SACCO staff, and only to correct an error.'],
    ['Share or savings category', 'SACCO staff, on your request.'],
    ['Membership status', 'SACCO management.'],
])}

{note('Why you cannot edit your own record',
      'Your name, number and phone number are what the SACCO uses to match money to the right '
      'person. If a member could change them, a payment could be lost or credited to the wrong '
      'person. Every change staff make is recorded with the reason for it, so there is always a '
      'trail.')}

<h2>Changing your password</h2>
<ol>
  <li>Tap <strong>More</strong>, then <strong>Password &amp; Security</strong>.</li>
  <li>Type your current password, then your new one twice.</li>
  <li>Press the save button. You stay signed in; the next time you sign in, use the new password.</li>
</ol>

{note('Change your password at once if you think somebody else knows it',
      'You do not need to ask permission and you do not need to visit the office.')}
''')

sec('Your savings', f'''
<p class="lead">The Savings tab shows what you have saved, what your category expects of you, and
every payment the SACCO has recorded.</p>

{shot('member/mf-02-savings.png', 'The Savings screen.')}

<h2>Reading the screen</h2>
{table(['On the screen', 'What it means'], [
    ['<strong>Total Savings</strong>', 'Your savings balance today.'],
    ['<strong>Savings category</strong>', 'The savings tier you were placed in — for example '
     '<em>Diamond Saver, UGX 100,000 every month</em> — and the date your next payment is due.'],
    ['<strong>Still owed</strong>', 'What is outstanding against your category so far. If this is '
     'zero, you are up to date.'],
    ['<strong>The week or month card</strong>', 'The current cycle: what was expected, what you '
     'have paid, and what is left to pay.'],
    ['<strong>Share progress</strong>', 'How far you are towards the shares your share category '
     'requires, and by when.'],
    ['<strong>Recent Cycles</strong>', 'Previous weeks or months, each marked paid, part paid, '
     'pending or missed.'],
])}

{note('If a cycle shows UGX 0 expected',
      'That simply means your category does not collect on that cycle. A monthly saver has no '
      'weekly expectation, so their weekly line will read zero.')}

<h2>How to pay</h2>
<p>Press <strong>Save Money</strong>. This screen does <strong>not</strong> take a payment. It tells
you how to pay and gives you the <strong>payment reference</strong> to quote so the cashier can
match your money to your account.</p>

{shot('member/mf-03-savings-deposit-guide.png', 'The Save Money screen: how much is outstanding, your payment reference, and how to pay.')}

{table(['Step', 'What to do'], [
    ['1', 'Note the <strong>payment reference</strong> shown on the screen (for example '
     '<span class="kbd">SAV-BND26006</span>). Tap <strong>Copy</strong> to copy it.'],
    ['2', 'Pay by whichever of the ways listed on the screen suits you — at the SACCO office, by '
     'mobile money to the SACCO merchant code, or by bank transfer.'],
    ['3', 'Keep the confirmation message or the receipt. If you paid by mobile money or bank, the '
     'reference in that message is what staff need.'],
    ['4', 'A member of staff records the payment. Your balance changes when they do.'],
])}

{note('Paying does not update your balance by itself',
      'The SACCO system is not connected to MTN, Airtel or any bank, so it cannot see your payment '
      'arrive. A member of staff checks it and records it. If you paid at the counter this is '
      'immediate; if you paid by mobile money outside office hours, it will be recorded when the '
      'office next reconciles its merchant account.', kind='warn')}

{note('If a payment is missing after a day or two',
      'Open <strong>Transactions</strong> and check it really is not there, then go to the office '
      'with the mobile-money or bank confirmation message. The reference in that message is what '
      'lets staff find the money.')}
''')

sec('Your shares', f'''
<p class="lead">Shares are your stake in the SACCO. They are kept entirely separately from your
savings.</p>

{pair(shot('member/mf-04-shares.png', 'My Shares.', in_pair=True),
      shot('member/mf-05-shares-buy-guide.png', 'Buy Shares — instructions and your reference.', in_pair=True))}

<h2>Reading the screen</h2>
{table(['On the screen', 'What it means'], [
    ['<strong>Share value</strong>', 'What the shares you hold are worth, at the SACCO&rsquo;s share price.'],
    ['<strong>Shares held</strong>', 'How many whole shares you own. Shares are bought in whole units.'],
    ['<strong>Share category</strong>', 'The tier you were placed in and the number of shares it requires.'],
    ['<strong>Progress</strong>', 'How many shares you still need, what that would cost, and the '
     'date by which your category expects them.'],
    ['<strong>Purchase history</strong>', 'Every share purchase recorded for you, with its date, '
     'number of shares and reference.'],
])}

{note('"Deadline passed"',
      'Some share categories expect the shares to be bought within a set time of joining. If that '
      'date has gone by and you have not reached the number, the screen says so. Speak to SACCO '
      'staff — what happens next is a matter for SACCO management, not something the system decides.')}

<h2>Buying shares</h2>
<p><strong>Buy Shares</strong> works exactly like <em>Save Money</em>: it shows the current share
price, what your remaining shares would cost, and the reference to quote. It does not take the
payment. You pay, and a member of staff records the purchase.</p>
''')

sec('Your loans', f'''
<p class="lead">The Loans tab shows any loan you have — what you borrowed, what is left to pay, and
every repayment recorded.</p>

{pair(shot('member/mf-06-loans.png', 'My Loans.', in_pair=True),
      shot('member/mf-07-loan-detail.png', 'One loan in detail.', in_pair=True))}

<h2>What the statuses mean</h2>
{table(['Status', 'What it means'], [
    ['<strong>Applied</strong>', 'You have applied. Nobody has looked at it yet.'],
    ['<strong>Under review</strong>', 'A loan officer is assessing it.'],
    ['<strong>Approved</strong>', 'It has been agreed but the money has not been handed over yet.'],
    ['<strong>Disbursed / Active</strong>', 'The money has been given out and repayments are due.'],
    ['<strong>Completed</strong>', 'Fully repaid. Nothing further is owed.'],
    ['<strong>Rejected</strong>', 'The application was not approved.'],
    ['<strong>Defaulted</strong>', 'Repayments are seriously behind. Speak to the SACCO.'],
])}

<h2>Reading a loan</h2>
<ul>
  <li><strong>Amount applied for</strong> — the sum you asked to borrow.</li>
  <li><strong>Outstanding balance</strong> — what is still to be paid, interest included.</li>
  <li><strong>Progress</strong> — how much of the total has been repaid so far.</li>
  <li><strong>Repayment schedule</strong> — each installment, when it is due and whether it has been paid.</li>
  <li><strong>Guarantors</strong> — the members who have agreed to stand for your loan.</li>
</ul>

<h2>Applying for a loan</h2>
<p>If the SACCO has switched this on for members, <strong>Apply Loan</strong> appears among the
quick actions on your dashboard.</p>

{shot('member/mf-09-loan-apply.png', 'Step 1 of the loan application: choosing the product. Each one shows its own terms.')}

<p>The application has six steps, and the screen tells you which one you are on:</p>
<ol>
  <li><strong>Loan type</strong> — choose the product. Each shows the smallest and largest amount,
      the interest rate, the term and how many guarantors it needs.</li>
  <li><strong>Amount and term</strong> — how much, and over how many months.</li>
  <li><strong>Purpose</strong> — what the money is for.</li>
  <li><strong>Guarantors</strong> — the members who will stand for you. You can search them by name
      or member number; you will see only their name and number.</li>
  <li><strong>Documents</strong> — what you will need to bring to the office.</li>
  <li><strong>Review and submit</strong> — check everything, then submit.</li>
</ol>
{note('You can go back at any step',
      'Nothing is submitted until the last step, so you can correct anything before you finish.')}

{note('One loan at a time',
      'The system will not accept a new application while you have a loan still running. If you '
      'try, it tells you so rather than letting you fill the whole form in first.')}

{note('Applying is not the same as being approved',
      'Submitting an application starts the process. A loan officer assesses it, and a manager '
      'approves and disburses it. You can follow the progress on this screen, and the system will '
      'notify you of the decision.')}

<p>If the Apply Loan option does not appear, loan applications are handled at the office in your
SACCO. Go to the office; a loan officer will take the application with you.</p>
''')

sec('Loan repayments', f'''
<p class="lead">Repayments are recorded by SACCO staff, exactly like savings. This screen tells you
what to pay, when, and what to quote.</p>

{shot('member/mf-08-loan-repay-guide.png', 'Repay Loan: the next installment, your payment reference and how to pay.')}

{table(['On the screen', 'What it means'], [
    ['<strong>Amount to pay</strong>', 'The next installment due, or the overdue amount if you are behind.'],
    ['<strong>Payment reference</strong>', 'What to quote so the cashier can match your money to this loan.'],
    ['<strong>Outstanding balance</strong>', 'Everything still owed on the loan.'],
    ['<strong>Next due date</strong>', 'When the next installment is expected.'],
])}

<h2>How a repayment is worked out</h2>
<p>When staff record your repayment, the system puts the money towards the <strong>interest
first</strong> and then the principal, and it updates the schedule and the balance itself. You do
not have to work anything out.</p>

<h2>Checking that a repayment was recorded</h2>
<ol>
  <li>Open <strong>Transactions</strong>.</li>
  <li>Look for an entry of type <em>Loan Repayment</em> on the date you paid.</li>
  <li>Open it and check the amount, and the reference against your own receipt.</li>
</ol>

{note('If a repayment is missing',
      'Take your evidence — the SACCO receipt, or the mobile-money confirmation message — to the '
      'office. Do not pay again. Staff will find the money by its reference and record it, and the '
      'entry will appear on your account with the date you actually paid.', kind='warn')}
''')

sec('Transactions and statements', f'''
<p class="lead">Every payment recorded against your account is here, permanently, with its own
reference number.</p>

{pair(shot('member/mf-10-transactions.png', 'The Transactions list.', in_pair=True),
      shot('member/mf-11-transaction-detail.png', 'One transaction opened: the full receipt.', in_pair=True))}

<h2>Reading the list</h2>
<p>Each line shows the type of transaction, the date and time, the reference and the amount. Money
coming in is shown in green; money going out in red.</p>

{table(['Reference begins with', 'What it is'], [
    ['<span class="kbd">SAV</span>', 'Savings'],
    ['<span class="kbd">SHR</span>', 'Share purchase'],
    ['<span class="kbd">LRP</span>', 'Loan repayment'],
    ['<span class="kbd">LDS</span>', 'Loan disbursement — money paid out to you'],
    ['<span class="kbd">RCT</span>', 'Receipt'],
    ['<span class="kbd">DEP</span> / <span class="kbd">WDL</span>', 'Deposit / withdrawal'],
    ['<span class="kbd">FEE</span>', 'A fee'],
    ['<span class="kbd">REV</span>', 'A reversal — an earlier entry being corrected'],
])}

<h2>What a status means</h2>
{table(['Status', 'What it means'], [
    ['<strong>Success</strong>', 'Recorded and counted in your balance.'],
    ['<strong>Reversed</strong>', 'The entry was cancelled by SACCO staff, with a reason. It stays '
     'on your record for good, alongside the correcting entry, so that the history is complete.'],
])}

{note('Reversed entries never disappear',
      'If a payment was recorded against the wrong member and then corrected, you will see both the '
      'original and the reversal. That is deliberate — a record that can be quietly deleted is a '
      'record nobody can trust.')}

<h2>Your statement</h2>
<p>Open <strong>More &rarr; Statements</strong>.</p>
{shot('member/mf-12-statements.png', 'The Statements screen.')}
<p>A statement covers a period you choose and shows an opening balance, every entry in between, and
a closing balance.</p>

<h3>Saving it as a PDF, or printing it</h3>
<ol>
  <li>Open the statement.</li>
  <li>Press <strong>Download PDF</strong> (or use your browser's own print option).</li>
  <li>Choose <em>Save as PDF</em> as the destination to keep a copy, or your printer to print it.</li>
</ol>
<p>The saved document carries the SACCO's crest and full name, the period, the totals, the date it
was produced and by whom — so it can be taken to a bank or kept for your records.</p>
''')

sec('Guarantees and notifications', f'''
<h2>Guarantees</h2>
<p>If you have agreed to stand as a guarantor for another member's loan, that obligation is yours,
so the system shows it to you under <strong>More &rarr; Guarantees</strong>.</p>

{pair(shot('member/mf-14-guarantees.png', 'My Guarantees: total exposure, then each loan you are backing.', in_pair=True),
      shot('member/mf-15-notifications.png', 'Notifications.', in_pair=True))}

<p>The screen shows your <strong>total exposure</strong> — everything you have agreed to back — and
then each loan: its loan number, the purpose, the amount you have guaranteed out of the total, and
where the loan has got to.</p>

{note('The borrower is shown as &ldquo;Unknown member&rdquo;',
      'At the time this guide was written, the portal cannot show you the name of the member whose '
      'loan you are guaranteeing: members are only allowed to read their own record, and the screen '
      'has nothing to fall back on. Use the <strong>loan number</strong> (for example LN260924002) '
      'and the purpose to tell one guarantee from another, and ask at the office if you need to be '
      'sure. This has been reported to SACCO management.', kind='warn')}

<p>You cannot see that member's savings, shares or any other business of theirs.</p>

{note('Standing as a guarantor is a real commitment',
      'If the borrower does not repay, the SACCO may look to the guarantors. Be sure you understand '
      'what you are agreeing to before you accept — and ask SACCO staff if you are unsure.', kind='warn')}

<h2>Notifications</h2>
<p>The bell at the top of every screen, and <strong>More &rarr; Notifications</strong>, hold messages
the system has sent you — for example, the decision on a loan application.</p>
<p>A number on the bell is the count of messages you have not opened. Tap a message to read it; it
is then marked as read.</p>

{note('Notifications are not a receipt',
      'Your record of a payment is the entry under <strong>Transactions</strong>, not a message. '
      'If you expected a notification and it has not arrived, check Transactions first, and then '
      'ask at the office.')}

<h2>Reports</h2>
<p><strong>More &rarr; Reports</strong> gathers the printable summaries of your own record in one
place.</p>
{shot('member/mf-13-reports.png', 'The member Reports screen.')}
''')

sec('Keeping your account safe', f'''
<p class="lead">The system protects your record. Only you can protect your password.</p>

{table(['Do this', 'Why'], [
    ['<strong>Keep your password to yourself.</strong>', 'Anyone who has it can see everything '
     'about your money. No member of SACCO staff will ever ask you for it — and none of them can see it.'],
    ['<strong>Never sign in for somebody else, and never let somebody sign in for you.</strong>',
     'If a payment goes wrong, the SACCO needs to know who was looking at what.'],
    ['<strong>Sign out on a borrowed phone or a café computer.</strong>',
     'Closing the browser is not signing out.'],
    ['<strong>Lock your own phone with a PIN or a fingerprint.</strong>',
     'A phone that anybody can pick up and open is a login anybody can use.'],
    ['<strong>Check your transactions from time to time.</strong>',
     'You are the person most likely to notice that one of your payments is missing.'],
    ['<strong>Report anything strange straight away.</strong>',
     'An entry you do not recognise, or a balance you cannot explain, should be raised with SACCO '
     'staff the same day.'],
    ['<strong>Change your password if you suspect anybody knows it.</strong>',
     'You can do it yourself, immediately, from More &rarr; Password &amp; Security.'],
])}

{note('What the system does on its own',
      'It pauses sign-in for a while after several failed attempts, it signs you out after a period '
      'of inactivity, and it keeps a record of every sign-in. It does not, and cannot, stop somebody '
      'who genuinely knows your password.')}

{note('Beware of anybody asking for your password',
      'If somebody telephones or messages you claiming to be from the SACCO and asks for your '
      'password or a code, it is not the SACCO. End the conversation and tell the office.', kind='warn')}
''')

sec('Common problems and what to do', f'''
{table(['Problem', 'Likely cause', 'What to do'], [
    ['I cannot sign in.', 'A typing mistake, or the wrong number.',
     'Check the member number or phone number and the password. Try <strong>Forgot Password?</strong> '
     'If that does not help, visit the office with your National ID.'],
    ['It says I have tried too many times.', 'Sign-in is paused for a few minutes after repeated '
     'failures.', 'Wait for the number of minutes shown, then try once, carefully.'],
    ['It says my account is suspended or unavailable.', 'A change to your membership status.',
     'Speak to SACCO administration. This is not something the system can undo.'],
    ['A payment I made is not on my account.', 'It has not been recorded yet, or it could not be '
     'matched to you.', 'Check <strong>Transactions</strong> first. Then take the mobile-money or '
     'bank confirmation message to the office. <strong>Do not pay again.</strong>'],
    ['My balance looks wrong.', 'A payment missing, or an entry recorded against the wrong member.',
     'Open <strong>Transactions</strong> and work through it against your own receipts, then bring '
     'the ones that do not match to the office.'],
    ['A transaction says <em>Reversed</em>.', 'Staff corrected an earlier entry.',
     'Look for the correcting entry near it. If you cannot see why, ask at the office — every '
     'reversal has a recorded reason.'],
    ['The page will not load, or is very slow.', 'The internet connection.',
     'Check your data or Wi-Fi and reload. Try again in a few minutes.'],
    ['The screen looks broken or out of date.', 'An old copy held by your browser.',
     'Close the browser tab and open the address again.'],
    ['I have forgotten my password.', '—',
     'Use <strong>Forgot Password?</strong> if the SACCO holds your email. Otherwise visit the '
     'office with your National ID.'],
    ['My name or phone number is wrong.', 'The SACCO record needs correcting.',
     'Visit the office with your National ID. Members cannot change these themselves.'],
    ['I want to change my savings or share category.', 'This is a SACCO decision.',
     'Ask at the office. Staff will change it if it is agreed.'],
])}
''')

sec('Frequently asked questions', f'''
<h3>How do I sign in?</h3>
<p>Open the SACCO web address, type your member number or phone number and your password, and press
<strong>Sign In</strong>. See Section 3.</p>

<h3>I have never signed in before. What do I do?</h3>
<p>Go to the SACCO office with your National ID and ask for a login. You will be given a temporary
password, and the system will ask you to choose your own the first time you use it.</p>

<h3>How do I check my savings?</h3>
<p>Tap the <strong>Savings</strong> tab.</p>

<h3>How do I check my loan balance?</h3>
<p>Tap the <strong>Loans</strong> tab, then the loan. The outstanding balance includes interest.</p>

<h3>Can I change my password myself?</h3>
<p>Yes — <strong>More &rarr; Password &amp; Security</strong>. You need your current password.</p>

<h3>Can I record a payment myself?</h3>
<p>No. The system cannot see money arriving, so only a member of staff can record a payment. The
<em>Save Money</em>, <em>Buy Shares</em> and <em>Repay Loan</em> screens show you how to pay and
give you the reference to quote.</p>

<h3>I paid by mobile money. Why has my balance not changed?</h3>
<p>Because the payment has not been recorded yet. A member of staff matches mobile-money payments
against the SACCO's merchant account and records them. If it has still not appeared after a day or
two, bring your confirmation message to the office.</p>

<h3>Can I see another member's account?</h3>
<p>No. You can see only your own records, plus the loans you have agreed to guarantee — and for
those, only the member's name, the amount and the loan's status.</p>

<h3>Can I get a statement for my bank?</h3>
<p>Yes — <strong>More &rarr; Statements</strong>. Choose the period and save it as a PDF or print it.
It carries the SACCO's letterhead.</p>

<h3>What does <em>Reversed</em> mean on a transaction?</h3>
<p>Staff cancelled that entry and recorded a correcting one. Both stay on your record, with the
reason.</p>

<h3>Who do I contact if something is wrong?</h3>
<p>SACCO staff at the office. Take your National ID and any receipts or confirmation messages.</p>

<h3>Does it cost anything to use?</h3>
<p>The SACCO does not charge for the portal. Your mobile operator may charge for the data you use,
which is small — the pages were built to be light.</p>
''')

sec('Support, and words you will see', f'''
<h2>Getting help</h2>
<p>For anything to do with your membership, your money or your login, the first place to go is the
<strong>SACCO office</strong>, with your National ID and any receipts. Staff there can see your full
record and correct what needs correcting.</p>

{note('Contact details',
      'The telephone numbers, email address and opening hours of the SACCO office are not printed '
      'in this guide, because they are not part of the system and could change. Ask at the office '
      'for the current details, or read them from the notice board. The SACCO may add them to this '
      'page when the guide is next issued.')}

<h2>Words you will see</h2>
{table(['Word', 'What it means here'], [
    ['<strong>Member number</strong>', 'Your permanent SACCO number, such as BND26006. It never changes.'],
    ['<strong>Reference</strong>', 'The code on a transaction, such as SAV260924133. Quote it when '
     'asking about a payment.'],
    ['<strong>Savings category</strong>', 'The tier that says how much you save and how often.'],
    ['<strong>Share category</strong>', 'The tier that says how many shares you should own, and by when.'],
    ['<strong>Schedule / cycle</strong>', 'One week or one month of expected savings.'],
    ['<strong>Outstanding</strong>', 'What is still to be paid.'],
    ['<strong>Arrears</strong>', 'Money that was due and has not been paid.'],
    ['<strong>Disbursement</strong>', 'The moment a loan is handed over to you.'],
    ['<strong>Guarantor</strong>', 'A member who agrees to stand for somebody else&rsquo;s loan.'],
    ['<strong>Reversal</strong>', 'A correcting entry that cancels an earlier one. Both stay on the record.'],
    ['<strong>Temporary password</strong>', 'A one-time password issued by the office, which you '
     'must replace at your first sign-in.'],
])}

<h2>Your main tasks, at a glance</h2>
{table(['I want to&hellip;', 'Where to go'], [
    ['See my savings balance', 'Savings tab'],
    ['See what I still owe this month', 'Savings tab &rarr; <em>Still owed</em>'],
    ['Find out how to pay', 'Savings tab &rarr; Save Money'],
    ['See my shares', 'More &rarr; My Shares'],
    ['See my loan balance', 'Loans tab'],
    ['See what my next installment is', 'Loans tab &rarr; Repay Loan'],
    ['Check a payment was recorded', 'Transactions tab'],
    ['Print a statement', 'More &rarr; Statements'],
    ['Change my password', 'More &rarr; Password &amp; Security'],
    ['Sign out', 'More &rarr; Log Out'],
])}
''')


def build():
    parts = [cover('MEMBER USER GUIDE', 'Digital SACCO Management System',
                   'Bakenye SACCO Members')]
    parts.append(f'<div class="section">{FRONT}</div>')
    parts.append('<div class="section" id="toc"><h1>Contents</h1><!--TOC--></div>')
    for i, (level, title, body) in enumerate(S, 1):
        parts.append(f'<div class="section"><h1>{i}. {title}</h1>{body}</div>')
    return document('Bakenye SACCO Member User Guide', '\n'.join(parts)), [t for _, t, _ in S]


if __name__ == '__main__':
    html_out, titles = build()
    out = sys.argv[1] if len(sys.argv) > 1 else '/var/tmp/bud-docs-stack/member.html'
    open(out, 'w').write(html_out)
    print(f'{out}: {len(titles)} sections, {n[0]} screenshots')
