// Your business details, printed on quotes and invoices.
// Change them here once and every document picks them up.
export const BUSINESS = {
  name: '[YOUR BUSINESS NAME]',
  contact: '[YOUR EMAIL · PHONE]',
  vatNumber: '', // leave empty if you're not VAT-registered
  bankDetails: '[BANK NAME · ACCOUNT NAME · ACCOUNT NUMBER · BRANCH CODE]',
}

// Leave allowance per year, used for the balances on HR & people.
// Set these to match your own leave policy.
export const LEAVE_POLICY = {
  annualDaysPerYear: 15,
}
