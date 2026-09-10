-- ===========================================================================
-- BUD-SACCO - 0026 - Vocabulary for Cash at Merchant, Cash at Bank and Cash at Hand
--
-- New enum values have to be committed before anything may compare against
-- them, so, as with 0010, this migration does nothing else. 0027 builds the
-- accounts, the account ledger and every function that moves money between
-- them.
-- ===========================================================================

-- Two more kinds of ledger row.
--   transfer - money moving between two of the SACCO's own accounts
--              (merchant -> bank, cash -> bank, bank -> cash, bank -> bank).
--              Neither income nor expense; total funds do not change.
--   payment  - money paid out that is not an operating expense: a refund to a
--              member, a dividend, an asset purchase.
alter type txn_type add value if not exists 'transfer';
alter type txn_type add value if not exists 'payment';

-- A settings section of its own, "Cash & Bank", for the approval rules and the
-- dashboard alert thresholds.
alter type setting_category add value if not exists 'treasury';

do $$ begin
  create type finance_account_type as enum ('merchant', 'bank', 'cash');
exception when duplicate_object then null; end $$;

do $$ begin
  create type finance_account_status as enum ('active', 'inactive', 'closed');
exception when duplicate_object then null; end $$;

-- The life of a transfer or a payment document. Money moves only on the step
-- into 'completed'; every state before that is a request, every state after it
-- is history.
do $$ begin
  create type finance_doc_status as enum (
    'draft', 'submitted', 'approved', 'completed', 'rejected', 'cancelled', 'reversed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type transfer_kind as enum (
    'merchant_to_bank', 'cash_to_bank', 'bank_to_cash', 'bank_to_bank'
  );
exception when duplicate_object then null; end $$;
