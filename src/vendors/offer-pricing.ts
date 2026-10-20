import { storedVariants, variantIndex } from '../common/product-options';
import { BadRequestException } from '@nestjs/common';
import type { InvoiceLine } from '../invoices/goods-invoices.service';
import type { Prisma } from 'generated/prisma/client';
export type PricingProduct = {
  id: string;
  unitPrice: number;
  promoPrice: number | null;
  promoStartsAt: Date | null;
  promoEndsAt: Date | null;
};
export type PricingOffer = {
  id: string;
  type: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  discountType: string | null;
  discountValue: number | null;
  bundlePrice: number | null;
  minimumOrderValue: number | null;
  stockLimit: number | null;
  unitsClaimed: number;
  deliveryType: string | null;
  deliveryFee: number | null;
  applicableLocations: string[];
  products: { productId: string }[];
};
export type PricedLine = InvoiceLine & { appliedOfferId?: string };
export function priceOfferProduct(price: number, type: string, value: number) {
  return type === 'PERCENTAGE'
    ? price - Math.floor((price * value) / 100)
    : type === 'FIXED_AMOUNT'
      ? price - value
      : value;
}
/** Recompute inside the invoice transaction; callers' cart prices are never authoritative. */
export function applyOfferPricing(
  lines: InvoiceLine[],
  products: PricingProduct[],
  offers: PricingOffer[],
  now = new Date(),
) {
  const byId = new Map(products.map((p) => [p.id, p]));
  let priced: PricedLine[] = lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product)
      throw new BadRequestException(
        'A selected product is no longer available.',
      );
    const promo =
      product.promoPrice &&
      product.promoStartsAt &&
      product.promoEndsAt &&
      product.promoStartsAt <= now &&
      product.promoEndsAt > now
        ? product.promoPrice
        : null;
    return {
      ...line,
      unitPrice: promo ?? product.unitPrice,
      originalPrice: promo ? product.unitPrice : null,
    };
  });
  const claimed = new Map<string, number>();
  for (const offer of offers) {
    if (
      !['ACTIVE', 'SCHEDULED'].includes(offer.status) ||
      offer.startsAt > now ||
      offer.endsAt <= now ||
      offer.type === 'DELIVERY'
    )
      continue;
    const ids = new Set(offer.products.map((p) => p.productId));
    const selected = priced.filter((l) => ids.has(l.productId));
    if (!selected.length) continue;
    const merchantId = selected[0].vendorId;
    const subtotal = priced
      .filter((l) => l.vendorId === merchantId)
      .reduce(
        (sum, l) => sum + byId.get(l.productId)!.unitPrice * l.quantity,
        0,
      );
    if (subtotal < (offer.minimumOrderValue || 0)) continue;
    if (offer.type === 'BUNDLE_DEAL') {
      if (
        !offer.bundlePrice ||
        ids.size < 2 ||
        [...ids].some((id) => !selected.some((l) => l.productId === id))
      )
        continue;
      const quantities = new Map(
        [...ids].map((id) => [
          id,
          selected
            .filter((l) => l.productId === id)
            .reduce((s, l) => s + l.quantity, 0),
        ]),
      );
      const bundles = Math.min(...quantities.values());
      const total = [...ids].reduce((s, id) => s + byId.get(id)!.unitPrice, 0);
      const effectiveTotal = [...ids].reduce(
        (sum, id) =>
          sum +
          Math.min(
            ...selected
              .filter((l) => l.productId === id)
              .map((l) => l.unitPrice),
          ),
        0,
      );
      if (offer.bundlePrice >= total || offer.bundlePrice >= effectiveTotal)
        continue;
      // Allocate a whole-naira price per component. The final component receives rounding remainder.
      const componentPrices = new Map<string, number>();
      let remainder = offer.bundlePrice;
      const sorted = [...ids].sort();
      sorted.forEach((id, i) => {
        const price =
          i === sorted.length - 1
            ? remainder
            : Math.floor(
                (offer.bundlePrice! * byId.get(id)!.unitPrice) / total,
              );
        componentPrices.set(id, price);
        remainder -= price;
      });
      const remaining = new Map([...ids].map((id) => [id, bundles]));
      const result: PricedLine[] = [];
      for (const line of priced) {
        const available = remaining.get(line.productId) || 0;
        if (!available) {
          result.push(line);
          continue;
        }
        const count = Math.min(available, line.quantity);
        remaining.set(line.productId, available - count);
        result.push({
          ...line,
          quantity: count,
          unitPrice: componentPrices.get(line.productId)!,
          originalPrice: byId.get(line.productId)!.unitPrice,
          appliedOfferId: offer.id,
        });
        if (count < line.quantity)
          result.push({ ...line, quantity: line.quantity - count });
      }
      priced = result;
    } else if (offer.discountType && offer.discountValue) {
      const units = selected.reduce((s, l) => s + l.quantity, 0);
      if (offer.stockLimit !== null && offer.unitsClaimed >= offer.stockLimit)
        continue;
      if (
        offer.stockLimit !== null &&
        offer.unitsClaimed + units > offer.stockLimit
      )
        throw new BadRequestException(
          'This offer does not have enough units remaining. Reduce the quantity or refresh your cart.',
        );
      priced = priced.map((line) => {
        if (!ids.has(line.productId)) return line;
        const original = byId.get(line.productId)!.unitPrice;
        const price = Math.min(
          line.unitPrice,
          priceOfferProduct(
            original,
            offer.discountType!,
            offer.discountValue!,
          ),
        );
        if (price <= 0 || price >= original)
          throw new BadRequestException(
            'The offer price has changed. Please refresh your cart.',
          );
        return {
          ...line,
          unitPrice: price,
          originalPrice: original,
          appliedOfferId: offer.id,
        };
      });
      if (offer.stockLimit !== null) claimed.set(offer.id, units);
    }
  }
  return { lines: priced, claimed };
}
export function deliveryOfferFee(
  fee: number,
  subtotal: number,
  productIds: string[],
  offers: PricingOffer[],
  address: string,
  now = new Date(),
) {
  let result = fee;
  for (const offer of offers) {
    if (
      offer.type !== 'DELIVERY' ||
      !['ACTIVE', 'SCHEDULED'].includes(offer.status) ||
      offer.startsAt > now ||
      offer.endsAt <= now ||
      subtotal < (offer.minimumOrderValue || 0) ||
      !productIds.every((id) => offer.products.some((p) => p.productId === id))
    )
      continue;
    const tokens = address
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    const eligible =
      offer.applicableLocations.length === 0 ||
      offer.applicableLocations.some(
        (place) =>
          place === 'NATIONAL' ||
          (place.replace(/^(LOCAL|STATE):/, '').trim().length > 0 &&
            place
              .replace(/^(LOCAL|STATE):/, '')
              .toLocaleLowerCase()
              .split(/[^\p{L}\p{N}]+/u)
              .filter(Boolean)
              .every((word) => tokens.includes(word))),
      );
    if (eligible)
      result = Math.min(
        result,
        offer.deliveryType === 'FREE' ? 0 : (offer.deliveryFee ?? fee),
      );
  }
  return result;
}
export async function releaseOfferUnits(
  tx: Prisma.TransactionClient,
  items: { appliedOfferId?: string | null; quantity: number; productId?:string; selectedVariants?:unknown; selectedColor?:string|null; selectedSize?:string|null }[],
) {
  const ids=[...new Set(items.map(i=>i.productId).filter((id):id is string=>!!id))];
  if (ids.length) {
    const products=await tx.product.findMany({where:{id:{in:ids}}});
    for (const product of products) {
      const variants=storedVariants(product.variants);
      if(!variants.length) continue;
      let changed=false;
      for(const item of items.filter(i=>i.productId === product.id)) {
        const index=variantIndex(variants,item.selectedVariants,item.selectedColor,item.selectedSize);
        if(index>=0){variants[index]={...variants[index],quantity:variants[index].quantity+item.quantity};changed=true;}
      }
      if(changed) await tx.product.update({where:{id:product.id},data:{variants:variants as Prisma.InputJsonValue}});
    }
  }
  const units = new Map<string, number>();
  for (const item of items)
    if (item.appliedOfferId)
      units.set(
        item.appliedOfferId,
        (units.get(item.appliedOfferId) || 0) + item.quantity,
      );
  for (const [id, quantity] of [...units].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    await tx.offer.updateMany({
      where: { id, stockLimit: { not: null }, unitsClaimed: { gte: quantity } },
      data: { unitsClaimed: { decrement: quantity } },
    });
}
