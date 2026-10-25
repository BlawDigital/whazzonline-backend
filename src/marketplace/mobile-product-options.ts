import {
  normalizeOptionName,
  storedVariants,
  variantValues,
} from '../common/product-options';

export function mobileProductOptions(value: unknown, images: string[]) {
  const variants = storedVariants(value);
  const values = variants.map((variant) =>
    Object.fromEntries(
      Object.entries(variantValues(variant)).map(([name, entry]) => [
        normalizeOptionName(name),
        entry.trim(),
      ]),
    ),
  );
  const groups = new Map<string, string[]>();
  values.forEach((choices) =>
    Object.entries(choices).forEach(([key, entry]) => {
      const list = groups.get(key) ?? [];
      if (!list.some((item) => item.toLowerCase() === entry.toLowerCase()))
        list.push(entry);
      groups.set(key, list);
    }),
  );
  const imageUris = (indexes?: number[]) =>
    (indexes ?? []).map((index) => images[index]).filter(Boolean);
  return {
    variantCombinations: variants.map((variant, index) => ({
      available: variant.quantity > 0,
      quantity: variant.quantity,
      values: values[index],
      imageUris: imageUris(variant.imageIndexes),
    })),
    variantGroups: [...groups].map(([key, choices]) => ({
      id: key,
      label: key,
      displayType: key === 'Color' ? ('swatch' as const) : ('pill' as const),
      options: choices.map((choice) => {
        const matching = variants.filter(
          (_, index) =>
            values[index][key]?.toLowerCase() === choice.toLowerCase(),
        );
        const custom = matching.find(
          (variant) => typeof variant.colorHex === 'string',
        )?.colorHex;
        return {
          id: choice,
          label: choice,
          value: choice,
          available: matching.some((variant) => variant.quantity > 0),
          imageUris: imageUris([
            ...new Set(
              matching.flatMap((variant) => variant.imageIndexes ?? []),
            ),
          ]),
          ...(typeof custom === 'string' && /^#[\da-f]{6}$/i.test(custom)
            ? { swatchHex: custom }
            : {}),
        };
      }),
    })),
  };
}
