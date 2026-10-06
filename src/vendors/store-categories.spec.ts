import { storeCategories } from './store-categories';
describe('Product-derived store categories', () => {
  it('groups selected main categories and excludes archived, deleted and draft products', () => {
    const product = {
      category: 'Shoes',
      mainCategory: 'Men Fashion',
      status: 'ACTIVE',
      quantity: 2,
      createdAt: new Date(),
      imageUrls: ['https://example.com/shoe.png'],
    };
    expect(
      storeCategories(
        [
          product,
          { ...product, quantity: 0 },
          { ...product, mainCategory: 'Women Fashion', status: 'ARCHIVED' },
          { ...product, mainCategory: 'Phones', status: 'DELETED' },
        ],
        'store-id',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'Men Fashion',
        productCount: 2,
        outOfStock: false,
        imageUrl: product.imageUrls[0],
      }),
    ]);
    expect(
      storeCategories(
        [{ ...product, mainCategory: null, quantity: 0 }],
        'store-id',
      ),
    ).toEqual([expect.objectContaining({ name: 'Shoes', outOfStock: true })]);
  });
});
