// Shared date math for recurring transactions, used by both the controller
// (when a template is first created) and the daily job (when advancing a
// template after it fires).

// The next date on/after `fromDate` that lands on `dayOfMonth`.
export const computeNextRunDate = (dayOfMonth, fromDate = new Date()) => {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const today = fromDate.getDate();

  const candidate =
    today > dayOfMonth ? new Date(year, month + 1, dayOfMonth) : new Date(year, month, dayOfMonth);
  candidate.setHours(0, 0, 0, 0);
  return candidate;
};

// Advances one calendar month from `fromDate` (a previous run date), landing
// on the same dayOfMonth — always relative to the last scheduled date, not
// "today", so a late-running job doesn't cause drift.
export const advanceOneMonth = (fromDate, dayOfMonth) => {
  const next = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, dayOfMonth);
  next.setHours(0, 0, 0, 0);
  return next;
};
