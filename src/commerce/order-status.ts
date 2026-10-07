/** One fulfillment vocabulary for legacy mobile records and current clients. */
export function normalizeOrderStatus(status: string): string {
  switch (status.toLowerCase().replaceAll('-', '_')) {
    case 'confirmed':
    case 'new':
      return 'pending';
    case 'accepted':
      return 'processing';
    case 'ready_for_pickup':
      return 'ready';
    case 'picked_up':
    case 'in_transit':
      return 'out_for_delivery';
    case 'cancelled':
    case 'canceled':
      return 'rejected';
    default:
      return status.toLowerCase().replaceAll('-', '_');
  }
}
