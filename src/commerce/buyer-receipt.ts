export const BUYER_RECEIPT_REASON = 'Buyer confirmed receipt';

// Only events selected for this buyer and reason are passed to this helper.
export function buyerReceiptDate(
  fulfillments: { status: string; history?: { createdAt: Date }[] }[],
) {
  const active = fulfillments.filter((row) => row.status !== 'rejected');
  if (!active.length || active.some((row) => !row.history?.length))
    return undefined;
  return new Date(
    Math.max(...active.map((row) => row.history![0].createdAt.getTime())),
  ).toISOString();
}
