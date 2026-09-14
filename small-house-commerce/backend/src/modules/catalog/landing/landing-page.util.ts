import type { LandingPageStatus } from '../../../generated/prisma/client.js';

export type LandingEffectiveStatus = 'LIVE' | 'SCHEDULED' | 'ENDED' | 'DISABLED';

export interface EffectiveStatusInput {
  status: LandingPageStatus;
  startAt: Date | string | null;
  endAt: Date | string | null;
}

// ACTIVE + inside (or without) a schedule window is LIVE; boundaries inclusive.
export function effectiveStatus(lp: EffectiveStatusInput, now: Date = new Date()): LandingEffectiveStatus {
  if (lp.status === 'DISABLED') return 'DISABLED';
  const instant = now.getTime();
  if (lp.startAt && new Date(lp.startAt).getTime() > instant) return 'SCHEDULED';
  if (lp.endAt && new Date(lp.endAt).getTime() < instant) return 'ENDED';
  return 'LIVE';
}
