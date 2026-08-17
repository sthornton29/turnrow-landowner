// Allocation proposals for the rent upload: given a check total and the
// lease's OPEN expected payments, propose how the money lands. Pure and
// unit-tested; the user adjusts every allocation freely before saving.

export interface OpenExpectedPayment {
  id: string;
  label: string;
  due_date: string; // YYYY-MM-DD
  expected_amount: number;
  received_total: number; // already recorded against it
}

export interface AllocationLine {
  expectedId: string;
  amount: number;
}

export interface AllocationProposal {
  lines: AllocationLine[];
  leftover: number; // dollars with no open expected payment to land on
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function outstanding(e: OpenExpectedPayment): number {
  return round2(Math.max(e.expected_amount - e.received_total, 0));
}

// Rules, in order:
// 1. One open payment whose outstanding matches the check (within a
//    penny) takes it all, preferring the one due nearest the check date.
// 2. Otherwise fill open payments in due-date order (nearest the check
//    date first), splitting one check across several and leaving the
//    last one partial.
// 3. Money beyond all outstanding comes back as leftover (recorded as
//    an unscheduled payment unless the user reassigns it).
export function proposeAllocation(
  totalAmount: number,
  checkDate: string | null,
  open: OpenExpectedPayment[]
): AllocationProposal {
  const total = round2(totalAmount);
  const candidates = open
    .map((e) => ({ e, out: outstanding(e) }))
    .filter((c) => c.out > 0.005);
  if (total <= 0 || candidates.length === 0) {
    return { lines: [], leftover: Math.max(total, 0) };
  }

  const refTime = checkDate ? new Date(checkDate + "T00:00:00").getTime() : null;
  const proximity = (due: string) =>
    refTime === null
      ? new Date(due + "T00:00:00").getTime()
      : Math.abs(new Date(due + "T00:00:00").getTime() - refTime);
  const ordered = [...candidates].sort(
    (a, b) => proximity(a.e.due_date) - proximity(b.e.due_date)
  );

  // Exact single match wins.
  const exact = ordered.find((c) => Math.abs(c.out - total) <= 0.01);
  if (exact) {
    return { lines: [{ expectedId: exact.e.id, amount: total }], leftover: 0 };
  }

  const lines: AllocationLine[] = [];
  let remaining = total;
  for (const c of ordered) {
    if (remaining <= 0.005) break;
    const amount = round2(Math.min(c.out, remaining));
    lines.push({ expectedId: c.e.id, amount });
    remaining = round2(remaining - amount);
  }
  return { lines, leftover: Math.max(remaining, 0) };
}
