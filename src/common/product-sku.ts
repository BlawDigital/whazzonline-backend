export function productSku(productId: string) {
  const compact = productId.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `WHZ-${compact.slice(0, 6).padEnd(6, '0')}`;
}
