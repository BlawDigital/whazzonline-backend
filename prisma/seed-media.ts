import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { seedConnectionString } from './seed-connection';

type Photo = {
  id: string;
  premium?: boolean;
  urls: { regular: string; small: string };
};
type SearchResponse = { results: Photo[]; total: number };
type ImageRole = 'avatar' | 'logo' | 'banner' | 'product';
type Assignment = { role: ImageRole; id: string; bucket: string; url: string };

const demoEmails = [
  'vendor1@whazzonline.com',
  'vendor2@whazzonline.com',
  'vendor3@whazzonline.com',
  'buyer1@whazzonline.com',
  'buyer2@whazzonline.com',
  'buyer3@whazzonline.com',
  'buyer31@whazzonline.com',
];
const queries: Record<string, string> = {
  avatar: 'portrait person face',
  logo: 'boutique shop storefront',
  banner: 'retail store interior',
  watch: 'wristwatch watch product',
  bag: 'leather handbag fashion product',
  sneakers: 'sneakers shoes product',
  dress: 'fashion dress clothing',
  clothing: 'fashion streetwear outfit',
  car: 'luxury car automobile',
  phone: 'smartphone mobile phone product',
  tv: 'television tv home entertainment',
  bedding: 'bedroom bedding pillows duvet',
  beauty: 'skincare beauty products',
  kids: 'children toys school shoes',
  electronics: 'electronics gadgets',
  other: 'shopping products',
};

function productBucket(name: string, category: string) {
  const text = `${name} ${category}`.toLowerCase();
  if (/watch|wrist/.test(text)) return 'watch';
  if (/bag|handbag|purse/.test(text)) return 'bag';
  if (/shoe|sneaker|jordan|converse/.test(text)) return 'sneakers';
  if (/dress|wedding/.test(text)) return 'dress';
  if (/car|lexus|toyota|camry/.test(text)) return 'car';
  if (/smartphone|phone|tablet|iphone/.test(text)) return 'phone';
  if (/television|\btv\b/.test(text)) return 'tv';
  if (/bed|bedding|duvet|pillow/.test(text)) return 'bedding';
  if (/beauty|lotion|cosmetic|skin/.test(text)) return 'beauty';
  if (/kid|toy|school/.test(text)) return 'kids';
  if (/electronic|phone|computer|gadget|tablet/.test(text)) return 'electronics';
  if (/fashion|streetwear|apparel|clothing/.test(text)) return 'clothing';
  return 'other';
}

function isDemo(email: string | null) {
  return Boolean(email && (email.endsWith('@whazzonline.test') || demoEmails.includes(email)));
}

function imageUrl(photo: Photo, role: ImageRole) {
  // Keep Unsplash's ixid and other attribution parameters supplied by the API.
  const url = new URL(role === 'avatar' || role === 'logo' ? photo.urls.small : photo.urls.regular);
  if (url.hostname !== 'images.unsplash.com') throw new Error('Unexpected Unsplash image host');
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'crop');
  url.searchParams.set('w', role === 'avatar' || role === 'logo' ? '360' : role === 'banner' ? '1400' : '900');
  url.searchParams.set('q', '80');
  return url.toString();
}

async function searchPhotos(query: string, page: number, accessKey: string) {
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '30');
  url.searchParams.set('content_filter', 'high');
  const response = await fetch(url, { headers: { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' } });
  if (!response.ok) {
    throw new Error(response.status === 429 ? 'Unsplash rate limit reached; try again after the API window resets.' : `Unsplash search failed (${response.status}). Check the access key and try again.`);
  }
  return (await response.json()) as SearchResponse;
}

async function assignPhotos(targets: Array<{ role: ImageRole; id: string; bucket: string }>, accessKey: string) {
  const usedPhotoIds = new Set<string>();
  const assignments: Assignment[] = [];
  const buckets = [...new Set(targets.map((target) => target.bucket))];
  for (const bucket of buckets) {
    const requested = targets.filter((target) => target.bucket === bucket);
    const available: Photo[] = [];
    for (let page = 1; available.length < requested.length && page <= 5; page++) {
      const result = await searchPhotos(queries[bucket], page, accessKey);
      for (const photo of result.results) {
        if (!photo.premium && !usedPhotoIds.has(photo.id)) available.push(photo);
      }
      if (result.results.length < 30) break;
    }
    if (available.length < requested.length) {
      throw new Error(`Unsplash returned only ${available.length} distinct ${bucket} photos for ${requested.length} records. No database changes were made.`);
    }
    requested.forEach((target, index) => {
      const photo = available[index];
      usedPhotoIds.add(photo.id);
      assignments.push({ ...target, url: imageUrl(photo, target.role) });
    });
  }
  return assignments;
}

async function main() {
  const scope = process.argv.find((arg) => arg.startsWith('--scope='))?.split('=')[1] ?? 'demo';
  if (scope !== 'demo' && scope !== 'all') throw new Error('Use --scope=demo or --scope=all.');
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: seedConnectionString(), connectionTimeoutMillis: 15_000 }) });
  try {
    const [allUsers, allVendors, allProducts] = await Promise.all([
      prisma.user.findMany({ select: { id: true, email: true } }),
      prisma.vendorProfile.findMany({ select: { id: true, userId: true } }),
      prisma.product.findMany({ select: { id: true, vendorProfileId: true, name: true, category: true } }),
    ]);
    const users = scope === 'all' ? allUsers : allUsers.filter((user) => isDemo(user.email));
    const userIds = new Set(users.map((user) => user.id));
    const vendors = scope === 'all' ? allVendors : allVendors.filter((vendor) => userIds.has(vendor.userId));
    const vendorIds = new Set(vendors.map((vendor) => vendor.id));
    const products = scope === 'all' ? allProducts : allProducts.filter((product) => vendorIds.has(product.vendorProfileId));
    const targets: Array<{ role: ImageRole; id: string; bucket: string }> = [
      ...users.map((user) => ({ role: 'avatar' as const, id: user.id, bucket: 'avatar' })),
      ...vendors.flatMap((vendor) => [
        { role: 'logo' as const, id: vendor.id, bucket: 'logo' },
        { role: 'banner' as const, id: vendor.id, bucket: 'banner' },
      ]),
      ...products.map((product) => ({ role: 'product' as const, id: product.id, bucket: productBucket(product.name, product.category) })),
    ];
    console.log(`Media plan (${scope}): ${users.length} avatars, ${vendors.length} logos, ${vendors.length} banners, ${products.length} products.`);
    if (!apply) {
      console.log('Dry run only. No database records were changed. Run with --apply after reviewing the scope.');
      return;
    }
    if (scope === 'all' && process.env.CONFIRM_ALL_MEDIA_REPLACEMENT !== 'yes') {
      throw new Error('All-account replacement requires CONFIRM_ALL_MEDIA_REPLACEMENT=yes. No changes were made.');
    }
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) throw new Error('UNSPLASH_ACCESS_KEY is required for unique, relevant image search. No changes were made.');
    const assignments = await assignPhotos(targets, accessKey);
    await prisma.$transaction(async (tx) => {
      for (const item of assignments) {
        if (item.role === 'avatar') await tx.user.update({ where: { id: item.id }, data: { avatarUrl: item.url } });
        if (item.role === 'logo') await tx.vendorProfile.update({ where: { id: item.id }, data: { logoUrl: item.url } });
        if (item.role === 'banner') await tx.vendorProfile.update({ where: { id: item.id }, data: { bannerUrl: item.url } });
        if (item.role === 'product') {
          await tx.product.update({ where: { id: item.id }, data: { imageUrls: [item.url] } });
          await tx.commerceCartItem.updateMany({ where: { productId: item.id }, data: { imageUri: item.url } });
          await tx.commerceOrderItem.updateMany({ where: { productId: item.id }, data: { imageUri: item.url } });
        }
      }
    }, { timeout: 120_000 });
    console.log(`Updated ${assignments.length} media fields with distinct Unsplash photos, including cart and order image snapshots.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Media seed failed.');
  process.exitCode = 1;
});
