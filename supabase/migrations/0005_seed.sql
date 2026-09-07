-- ===========================================================================
-- BUD-SACCO - 0005 - Reference data
--
-- Categories and loan products the SACCO actually operates with. These are
-- configuration, not demo data - the application depends on the two system
-- income categories ('Loan interest', 'Service charges') existing, because
-- disburse_loan() and record_loan_repayment() book into them by name.
-- ===========================================================================

insert into income_categories (name, is_system) values
  ('Loan interest',    true),
  ('Membership fees',  false),
  ('Registration fees', false),
  ('Penalties',        false),
  ('Service charges',  true),
  ('Other income',     false)
on conflict (name) do nothing;

insert into expense_categories (name, is_system) values
  ('Salaries',        false),
  ('Rent',            false),
  ('Electricity',     false),
  ('Internet',        false),
  ('Transport',       false),
  ('Office supplies', false),
  ('Bank charges',    false),
  ('Equipment',       false),
  ('Other',           false)
on conflict (name) do nothing;

-- Loan products mirror the three types the Stitch loan wizard offers.
insert into loan_products
  (name, code, interest_rate, interest_method, min_amount, max_amount,
   min_period_months, max_period_months, processing_fee_pct, min_guarantors, description)
values
  ('Business Loan',   'BIZ', 18.0, 'flat',  200000,  20000000, 3, 24, 1.0, 2,
   'Working capital and business expansion for trading members.'),
  ('Emergency Loan',  'EMG', 12.0, 'flat',   50000,   3000000, 1,  6, 0.5, 1,
   'Fast-track short-term credit for medical and urgent household needs.'),
  ('School Fees Loan', 'SCH', 15.0, 'flat', 100000,   5000000, 3, 12, 1.0, 2,
   'Termly school fees support repaid over the academic year.'),
  ('Agriculture Loan', 'AGR', 16.0, 'flat', 150000,  10000000, 6, 18, 1.0, 2,
   'Seasonal inputs and equipment for farming members.')
on conflict (code) do nothing;

-- Share price. The DESIGN brief works the example 10 shares x UGX 50,000.
update share_settings set unit_price = 50000, min_shares_on_join = 1 where id;
