import type { Prisma } from '../../generated/prisma/client.js';
import {
  CHECKOUT_DRAFT_MAX_AGE_MS,
  tryHashCheckoutDraftToken,
} from './checkout-draft-token.js';

type DraftTx = Pick<Prisma.TransactionClient, 'checkoutDraft'>;

/**
 * Marks the checkout draft behind this order as CONVERTED inside the order
 * transaction. A draft that never received its first autosave is created as a
 * minimal converted tombstone, so a later save cannot resurrect an OPEN row.
 */
export async function persistConvertedDraft(
  tx: DraftTx,
  args: {
    rawToken: string | null | undefined;
    orderId: string;
    customerName: string;
    customerPhone: string;
    now?: Date;
  },
): Promise<void> {
  const now = args.now ?? new Date();
  const token = tryHashCheckoutDraftToken(args.rawToken, now);
  if (!token) return;

  const expiresAt = new Date(token.issuedAt.getTime() + CHECKOUT_DRAFT_MAX_AGE_MS);
  const contactName = args.customerName.slice(0, 120) || null;
  const contactPhone = args.customerPhone.slice(0, 24) || null;

  const update = await tx.checkoutDraft.updateMany({
    where: { tokenHash: token.hash, status: 'OPEN' },
    data: {
      status: 'CONVERTED',
      hasUserInput: true,
      orderId: args.orderId,
      contactName,
      contactPhone,
      expiresAt,
    },
  });
  if (update.count > 0) return;

  await tx.checkoutDraft.createMany({
    data: [
      {
        tokenHash: token.hash,
        tokenIssuedAt: token.issuedAt,
        status: 'CONVERTED',
        hasUserInput: true,
        clientRevision: 1,
        contactName,
        contactPhone,
        snapshot: {},
        productSnapshot: [],
        orderId: args.orderId,
        createdAt: now,
        // Keep the NOT NULL timestamp explicit rather than relying on ORM
        // timestamp injection in this order-critical createMany path.
        updatedAt: now,
        expiresAt,
      },
    ],
    skipDuplicates: true,
  });
}
