/**
 * Advertising numbers shown on orders and campaign links.
 *
 * FB posts have no identifier of their own that survives how we publish them,
 * so every post link gets a generated number: FB-<optimizer AID>-<YYMMDD>-<nn>.
 * The date is the post's Manila calendar date (or the creation date when the
 * post date is unknown), and the sequence counts that optimizer's numbered
 * links of the same kind on that day. Meta ads keep their real ad ID when one
 * was recorded; only missing ones fall back to the same generated shape.
 */

export type AdidKind = 'FB' | 'AD';

/** YYMMDD for an instant, read on the Manila wall clock. */
export function manilaDayKey(instant: Date): string {
  const shifted = new Date(instant.getTime() + 8 * 3600_000);
  return shifted.toISOString().slice(2, 10).replaceAll('-', '');
}

/** YYMMDD for a stored post date (UTC midnight of the calendar day). */
export function calendarDayKey(postDate: Date): string {
  return postDate.toISOString().slice(2, 10).replaceAll('-', '');
}

export function adidFor(kind: AdidKind, aid: string, dayKey: string, sequence: number): string {
  return `${kind}-${aid}-${dayKey}-${String(sequence).padStart(2, '0')}`;
}
