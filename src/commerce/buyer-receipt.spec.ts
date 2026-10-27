import { buyerReceiptDate } from './buyer-receipt';
describe('buyer receipt history', () => {
  const event = { createdAt: new Date('2026-10-26T11:00:00Z') };
  it('does not treat merchant delivery as buyer confirmation', () => {
    expect(
      buyerReceiptDate([{ status: 'delivered', history: [] }]),
    ).toBeUndefined();
    expect(buyerReceiptDate([])).toBeUndefined();
  });
  it('waits for confirmation of every active merchant, ignoring rejected fulfillments', () => {
    expect(
      buyerReceiptDate([
        { status: 'delivered', history: [event] },
        { status: 'delivered', history: [] },
      ]),
    ).toBeUndefined();
    expect(
      buyerReceiptDate([
        { status: 'delivered', history: [event] },
        { status: 'rejected', history: [] },
      ]),
    ).toBe('2026-10-26T11:00:00.000Z');
  });
});
