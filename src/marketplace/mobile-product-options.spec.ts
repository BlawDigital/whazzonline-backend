import { mobileProductOptions } from './mobile-product-options';
describe('mobile product options', () => {
  it('exposes arbitrary options and exact combination image mappings without requiring photos', () => {
    const choices = mobileProductOptions(
      [
        {
          color: 'Rose gold',
          colorHex: '#b76e79',
          size: '6.7 inches',
          type: 'With charger',
          options: { Storage: '256 GB', finish: 'Matte' },
          quantity: 2,
          imageIndexes: [1],
        },
        {
          color: 'Space black',
          size: '6.7 inches',
          options: { Storage: '512 GB' },
          quantity: 0,
          imageIndexes: [],
        },
      ],
      ['black.jpg', 'gold.jpg'],
    );
    expect(choices.variantGroups.map((group) => group.id)).toEqual([
      'Color',
      'Size',
      'Option',
      'Storage',
      'Finish',
    ]);
    expect(choices.variantGroups[0].options[0]).toMatchObject({
      swatchHex: '#b76e79',
      label: 'Rose gold',
      imageUris: ['gold.jpg'],
    });
    expect(choices.variantCombinations[0]).toMatchObject({
      values: { Color: 'Rose gold', Storage: '256 GB', Finish: 'Matte' },
      imageUris: ['gold.jpg'],
      available: true,
    });
    expect(choices.variantCombinations[1]).toMatchObject({
      imageUris: [],
      available: false,
    });
    expect(mobileProductOptions([], ['plain.jpg']).variantGroups).toEqual([]);
  });
});
