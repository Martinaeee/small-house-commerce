import { randomUUID } from 'node:crypto';

/** Client-supplied tracing ids must be sane before we echo or store them. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function resolveRequestId(raw: string | string[] | undefined): string {
  return typeof raw === 'string' && REQUEST_ID_PATTERN.test(raw) ? raw : randomUUID();
}
