// Store categories come exclusively from the taxonomy selected on products.
export function storeCategories<
  T extends {
    category: string;
    mainCategory?: string | null;
    status: string;
    quantity: number;
    createdAt: Date;
    imageUrls?: string[];
  },
>(products: T[], vendorProfileId: string) {
  const groups = new Map<string, T[]>();
  for (const product of products) {
    if (product.status !== 'ACTIVE') continue;
    const name = (product.mainCategory || product.category || '').trim();
    if (name) groups.set(name, [...(groups.get(name) ?? []), product]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => ({
      id: `preset:${name}`,
      name,
      vendorProfileId,
      imageUrl: items[0].imageUrls?.[0] ?? null,
      createdAt: items[0].createdAt,
      productCount: items.length,
      outOfStock: items.every((item) => item.quantity < 1),
    }));
}
