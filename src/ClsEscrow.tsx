import { useEffect, useState } from "react";
import { clsOverdue, escrowSummary, formatPercent, formatPesos, manilaToday, type EscrowRecord } from "./conditionalLicense";

export function useManilaDate() {
  const [today, setToday] = useState(() => manilaToday());
  useEffect(() => {
    const timer = window.setInterval(() => setToday(manilaToday()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return today;
}

export function ConditionalEscrowSummary({ record }: { record: EscrowRecord }) {
  const today = useManilaDate();
  const summary = escrowSummary(record.escrow_total_centavos, record.escrow_paid_centavos);
  const totalOnly = escrowSummary(record.escrow_total_centavos, 0);
  return <section className="escrow-summary wide" aria-label="CLS escrow breakdown" aria-live="polite">
    <h3>Escrow breakdown</h3>
    {summary ? <>
      <dl>
        <div><dt>Total escrow (100%)</dt><dd>{formatPesos(summary.total)}</dd></div>
        <div><dt>Minimum payment (25%)</dt><dd>{formatPesos(summary.minimum)}</dd></div>
        <div><dt>Actual paid ({formatPercent(summary.paidPercent)})</dt><dd>{formatPesos(summary.paid)}</dd></div>
        <div><dt>Remaining balance ({formatPercent(summary.balancePercent)})</dt><dd>{formatPesos(summary.balance)}</dd></div>
      </dl>
      {summary.paid < summary.minimum && <p className="cls-warning">Payment is below the required 25% minimum.</p>}
      {summary.balance === 0 && <p className="cls-paid">Escrow fully paid.</p>}
      {clsOverdue(record, today) && <p className="cls-warning" role="status">CLS expired with an unpaid balance of {formatPesos(summary.balance)}. Review this record.</p>}
    </> : <>
      {totalOnly && <dl><div><dt>Total escrow (100%)</dt><dd>{formatPesos(totalOnly.total)}</dd></div><div><dt>Minimum payment (25%)</dt><dd>{formatPesos(totalOnly.minimum)}</dd></div></dl>}
      <p>Enter valid escrow and payment amounts to see the full breakdown. Payment must be at least 25% and no more than the total.</p>
    </>}
    <small>Amounts are in Philippine pesos. The 25% minimum is rounded up to the next centavo when needed.</small>
  </section>;
}
