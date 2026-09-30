import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Product, type User, type VendorProfile } from '../generated/prisma/client';
import { seedConnectionString } from './seed-connection';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: seedConnectionString(), connectionTimeoutMillis: 15_000 }) });
const TEST_PASSWORD = 'WhazzTest@123';
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

const accounts = [
  { email: 'vendor1@whazzonline.com', firstName: 'Oden', lastName: 'Fashion', role: 'VENDOR', registrationType: 'SELLER', city: 'Yaba', state: 'Lagos', phone: '+2348030000001', dateOfBirth: '1988-04-12' },
  { email: 'vendor2@whazzonline.com', firstName: 'Ayil', lastName: 'Electronics', role: 'VENDOR', registrationType: 'SELLER', city: 'Ikeja', state: 'Lagos', phone: '+2348030000002', dateOfBirth: '1989-08-21' },
  { email: 'vendor3@whazzonline.com', firstName: 'Glow', lastName: 'Beauty', role: 'VENDOR', registrationType: 'SELLER', city: 'Lekki', state: 'Lagos', phone: '+2348030000003', dateOfBirth: '1991-11-08' },
  { email: 'buyer1@whazzonline.com', firstName: 'Katherine', lastName: 'Oluseye', role: 'CUSTOMER', registrationType: 'BUYER', city: 'Ibadan', state: 'Oyo', phone: '+2348030000004', dateOfBirth: '1983-02-12' },
  { email: 'buyer2@whazzonline.com', firstName: 'Daniel', lastName: 'Okafor', role: 'CUSTOMER', registrationType: 'BUYER', city: 'Yaba', state: 'Lagos', phone: '+2348030000005', dateOfBirth: '1993-06-19' },
  { email: 'buyer31@whazzonline.com', firstName: 'Michael', lastName: 'Adeyemi', role: 'CUSTOMER', registrationType: 'BUYER', city: 'Ikeja', state: 'Lagos', phone: '+2348030000031', dateOfBirth: '1990-10-03' },
] as const;

const storefronts = [
  { email: accounts[0].email, storeName: 'Oden Store', category: 'Fashion', subCategory: 'Clothing & Accessories', description: 'Contemporary fashion, bags, watches and everyday essentials.', city: 'Yaba', state: 'Lagos', lga: 'Lagos Mainland', address: '24 West Avenue, Yaba, Lagos' },
  { email: accounts[1].email, storeName: 'Ayil Electronics', category: 'Electronics', subCategory: 'Phones, TVs & Motors', description: 'Devices, home entertainment and select automobiles.', city: 'Ikeja', state: 'Lagos', lga: 'Ikeja', address: '12 Computer Village Road, Ikeja, Lagos' },
  { email: accounts[2].email, storeName: 'Glow Beauty & Home', category: 'Beauty & Personal Care', subCategory: 'Skincare & Home', description: 'Skincare, personal care and comfortable home essentials.', city: 'Lekki', state: 'Lagos', lga: 'Eti-Osa', address: '8 Admiralty Way, Lekki, Lagos' },
] as const;

const products = [
  { seller: 0, name: 'Leather Tote Bag', category: 'Fashion', price: 220000 },
  { seller: 0, name: 'Classic Wristwatch', category: 'Fashion', price: 134000 },
  { seller: 0, name: 'Everyday Sneakers', category: 'Fashion', price: 85000 },
  { seller: 0, name: 'Women Fashion Dress', category: 'Fashion', price: 95000 },
  { seller: 0, name: 'Canvas Shoulder Bag', category: 'Fashion', price: 68000 },
  { seller: 0, name: 'Gold-Tone Wristwatch', category: 'Fashion', price: 155000 },
  { seller: 0, name: 'Running Sneakers', category: 'Fashion', price: 72000 },
  { seller: 0, name: 'Evening Dress', category: 'Fashion', price: 112000 },
  { seller: 1, name: 'Premium Smartphone 256GB', category: 'Electronics', price: 480000 },
  { seller: 1, name: 'Compact Smartphone 128GB', category: 'Electronics', price: 290000 },
  { seller: 1, name: 'Camera Smartphone 512GB', category: 'Electronics', price: 620000 },
  { seller: 1, name: 'Everyday Smartphone 128GB', category: 'Electronics', price: 215000 },
  { seller: 1, name: 'Large 55-Inch TV', category: 'Electronics', price: 590000 },
  { seller: 1, name: 'Smart 65-Inch TV', category: 'Electronics', price: 780000 },
  { seller: 1, name: 'Luxury Sedan Car', category: 'Cars', price: 9_000_000 },
  { seller: 1, name: 'Sport Coupe Car', category: 'Cars', price: 13_500_000 },
  { seller: 2, name: 'Daily Skincare Set', category: 'Beauty', price: 46000 },
  { seller: 2, name: 'Hydrating Body Lotion', category: 'Beauty', price: 18000 },
  { seller: 2, name: 'Face Serum Collection', category: 'Beauty', price: 38000 },
  { seller: 2, name: 'Beauty Care Gift Set', category: 'Beauty', price: 53000 },
  { seller: 2, name: 'Soft Cotton Bedding Set', category: 'Home', price: 79000 },
  { seller: 2, name: 'Luxury Duvet and Pillow Set', category: 'Home', price: 110000 },
  { seller: 2, name: 'Classic Bedroom Bedding', category: 'Home', price: 95000 },
  { seller: 2, name: 'Cloud-Soft Duvet', category: 'Home', price: 68000 },
] as const;

const interests = [
  ['Fashion & Apparel', 'fashion'], ['Electronics', 'electronics'], ['Services', 'services'],
  ['Food & Groceries', 'food'], ['Home & Living', 'home'], ['Beauty & Personal Care', 'beauty'],
  ['Health & Wellness', 'health'], ['Agriculture & Farm Produce', 'agriculture'], ['Children & Baby', 'children'],
] as const;

async function seedUsers() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const result: User[] = [];
  for (const account of accounts) {
    const address = account.role === 'CUSTOMER'
      ? `4 Zone F Calling Estate, ${account.city}, ${account.state}`
      : `24 Market Road, ${account.city}, ${account.state}`;
    result.push(await prisma.user.upsert({
      where: { email: account.email },
      create: { ...account, passwordHash, authProvider: 'EMAIL', address, countryCode: '+234', emailVerified: true, isVerified: true, isActive: true },
      update: { ...account, passwordHash, authProvider: 'EMAIL', address, countryCode: '+234', emailVerified: true, isVerified: true, isActive: true },
    }));
  }
  for (const [name, slug] of interests) {
    await prisma.interest.upsert({ where: { slug }, create: { name, slug }, update: { name } });
  }
  return result;
}

async function seedStorefronts(users: Awaited<ReturnType<typeof seedUsers>>) {
  const result: VendorProfile[] = [];
  for (const [index, store] of storefronts.entries()) {
    const owner = users.find((user) => user.email === store.email);
    if (!owner) throw new Error(`Missing seeded seller ${store.email}`);
    const profile = await prisma.vendorProfile.upsert({
      where: { userId: owner.id },
      create: {
        userId: owner.id, storeName: store.storeName, category: store.category, subCategory: store.subCategory,
        description: store.description, city: store.city, state: store.state, lga: store.lga,
        address: store.address, sellerType: 'DEMO', reviewStatus: 'APPROVED', setupCompleted: true,
        bankName: 'Demo Bank', bankCode: '000', bankAccountNumber: `000000000${index + 1}`,
        bankAccountName: store.storeName, submittedAt: at(30), termsAcceptedAt: at(30),
      },
      update: {
        storeName: store.storeName, category: store.category, subCategory: store.subCategory,
        description: store.description, city: store.city, state: store.state, lga: store.lga,
        address: store.address, reviewStatus: 'APPROVED', setupCompleted: true,
      },
    });
    result.push(profile);
    await prisma.vendorCategory.upsert({
      where: { vendorProfileId_name: { vendorProfileId: profile.id, name: store.category } },
      create: { vendorProfileId: profile.id, name: store.category },
      update: {},
    });
  }
  return result;
}

async function seedProducts(profiles: Awaited<ReturnType<typeof seedStorefronts>>) {
  const result: Product[] = [];
  for (const item of products) {
    const vendorProfileId = profiles[item.seller].id;
    const existing = await prisma.product.findFirst({ where: { vendorProfileId, name: item.name } });
    const offer = products.indexOf(item) % 5 === 0;
    const data = {
      category: item.category, mainCategory: item.category, name: item.name,
      description: `Demo listing for ${item.name}. Photos are illustrative; confirm product details with the seller.`,
      unitPrice: item.price, quantity: item.category === 'Cars' ? 3 : 40,
      status: 'ACTIVE' as const, variants: [],
      promoPrice: offer ? Math.round(item.price * 0.9) : null,
      promoStartsAt: offer ? at(1) : null, promoEndsAt: offer ? at(-14) : null,
    };
    result.push(existing
      ? await prisma.product.update({ where: { id: existing.id }, data })
      : await prisma.product.create({ data: { ...data, vendorProfileId, imageUrls: [] } }));
  }
  for (const profile of profiles) {
    const first = result.find((product) => product.vendorProfileId === profile.id);
    if (!first) continue;
    const existing = await prisma.offer.findFirst({ where: { vendorProfileId: profile.id, name: 'Welcome offer' } });
    if (!existing) await prisma.offer.create({
      data: {
        vendorProfileId: profile.id, name: 'Welcome offer', type: 'PRICE_DISCOUNT',
        discountType: 'PERCENTAGE', discountValue: 10, status: 'ACTIVE',
        startsAt: at(1), endsAt: at(-14), products: { create: { productId: first.id } },
      },
    });
  }
  return result;
}

async function seedWalletsAndReferrals(users: Awaited<ReturnType<typeof seedUsers>>) {
  for (const [index, user] of users.entries()) {
    const funding = 250_000 + index * 50_000;
    const purchase = 45_000 + index * 5_000;
    const bonus = 5_000;

    let wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) {
      try {
        wallet = await prisma.wallet.create({
          data: {
            userId: user.id, accountName: `${user.firstName} ${user.lastName}`,
            accountNumber: `01900000${String(index + 1).padStart(3, '0')}`, bankName: 'Demo Bank',
            mainBalance: funding - purchase, referralBonus: bonus, availableBalance: funding - purchase + bonus,
          },
        });
      } catch (error) {
        const uniqueConstraintError = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
        if (!uniqueConstraintError) throw error;
        wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      }
    }

    if (!wallet) {
      throw new Error(`Unable to create or recover wallet for user ${user.id}`);
    }

    if (!(await prisma.walletTransaction.count({ where: { walletId: wallet.id } }))) {
      await prisma.walletTransaction.createMany({ data: [
        { walletId: wallet.id, type: 'FUNDING', amount: funding, description: 'Demo wallet funding', status: 'COMPLETED', createdAt: at(18) },
        { walletId: wallet.id, type: 'PURCHASE', amount: -purchase, description: 'Marketplace purchase', status: 'COMPLETED', createdAt: at(10) },
        { walletId: wallet.id, type: 'REFERRAL_BONUS', amount: bonus, description: 'Referral reward', status: 'COMPLETED', createdAt: at(4) },
        { walletId: wallet.id, type: 'WITHDRAWAL', amount: -20_000, description: 'Withdrawal request', status: 'PENDING', createdAt: at(1) },
      ] });
    }
    if (!(await prisma.referral.count({ where: { referrerUserId: user.id } }))) {
      await prisma.referral.createMany({ data: [
        { referrerUserId: user.id, refereeName: 'Rita Mma Store', rewardAmount: bonus, status: 'COMPLETED', createdAt: at(12), completedAt: at(4) },
        { referrerUserId: user.id, refereeName: 'Faith Supermarket', rewardAmount: 0, status: 'PENDING', createdAt: at(2) },
      ] });
    }
  }
}

async function seedCommerce(
  users: Awaited<ReturnType<typeof seedUsers>>,
  profiles: Awaited<ReturnType<typeof seedStorefronts>>,
  catalog: Awaited<ReturnType<typeof seedProducts>>,
) {
  const buyers = users.filter((user) => user.role === 'CUSTOMER');
  for (const [sellerIndex, profile] of profiles.entries()) {
    const sellerProducts = catalog.filter((product) => product.vendorProfileId === profile.id);
    const featured = sellerProducts[0];
    if (!featured) continue;
    for (const [stateIndex, state] of ['pending', 'accepted', 'ready_for_pickup', 'delivered'].entries()) {
      const buyer = buyers[(sellerIndex + stateIndex) % buyers.length];
      const sku = `SEED-${sellerIndex + 1}-${state.toUpperCase()}`;
      const exists = await prisma.commerceOrderItem.findFirst({ where: { sku } });
      if (exists) continue;
      const item = sellerProducts[stateIndex % sellerProducts.length];
      const completed = state === 'delivered';
      const order = await prisma.commerceOrder.create({
        data: {
          userId: buyer.id, deliveryAddress: buyer.address || 'Demo delivery address',
          latitude: 6.6018, longitude: 3.3515, paymentMethod: 'bank_transfer',
          status: completed ? 'delivered' : 'confirmed', completedAt: completed ? at(1) : null,
          subtotal: item.unitPrice, deliveryFee: 5_000, serviceFee: 0, total: item.unitPrice + 5_000,
          items: { create: {
            productId: item.id, vendorId: profile.userId, vendorName: profile.storeName,
            name: item.name, subtitle: item.category, imageUri: item.imageUrls[0] ?? '',
            sku, unitPrice: item.unitPrice, quantity: 1, deliveryAddress: buyer.address || 'Demo delivery address',
          } },
          fulfillments: { create: {
            vendorId: profile.userId, status: state,
            history: { create: { status: state, actorUserId: profile.userId, createdAt: at(4 - stateIndex) } },
          } },
        },
      });
      if (completed) await prisma.vendorTrustReview.create({
        data: { orderId: order.id, vendorProfileId: profile.id, reviewerUserId: buyer.id, reason: 'Clear communication and reliable delivery.' },
      });
    }
    for (const buyer of buyers) {
      let conversation = await prisma.conversation.findFirst({ where: { buyerUserId: buyer.id, vendorProfileId: profile.id } });
      if (!conversation) conversation = await prisma.conversation.create({
        data: { buyerUserId: buyer.id, vendorProfileId: profile.id, subject: `Question about ${featured.name}`, favorite: sellerIndex === 0 },
      });
      if (!(await prisma.chatMessage.count({ where: { conversationId: conversation.id } }))) {
        await prisma.chatMessage.createMany({ data: [
          { conversationId: conversation.id, senderUserId: buyer.id, kind: 'TEXT', text: `Hi, is ${featured.name} available?`, createdAt: at(2) },
          { conversationId: conversation.id, senderUserId: profile.userId, kind: 'TEXT', text: 'Yes, it is available. Let me know if you have any questions.', createdAt: at(1) },
        ] });
      }
    }
  }
  for (const [index, buyer] of buyers.entries()) {
    const product = catalog[index];
    if (!product) continue;
    await prisma.productLike.upsert({
      where: { userId_productId: { userId: buyer.id, productId: product.id } },
      create: { userId: buyer.id, productId: product.id }, update: {},
    });
  }
  const buyerWithCart = buyers.find((buyer) => buyer.email === 'buyer2@whazzonline.com');
  const cartProduct = catalog[1];
  if (buyerWithCart && cartProduct && !(await prisma.commerceCartItem.count({ where: { userId: buyerWithCart.id } }))) {
    const profile = profiles.find((item) => item.id === cartProduct.vendorProfileId);
    if (profile) await prisma.commerceCartItem.create({
      data: {
        userId: buyerWithCart.id, productId: cartProduct.id, vendorId: profile.userId,
        vendorName: profile.storeName, name: cartProduct.name, subtitle: cartProduct.category,
        imageUri: cartProduct.imageUrls[0] ?? '', sku: `SEED-CART-${cartProduct.id.slice(0, 8)}`,
        unitPrice: cartProduct.unitPrice, quantity: 1, deliveryAddress: buyerWithCart.address || '',
      },
    });
  }
}

async function main() {
  const users = await seedUsers();
  const profiles = await seedStorefronts(users);
  const catalog = await seedProducts(profiles);
  await seedWalletsAndReferrals(users);
  await seedCommerce(users, profiles, catalog);
  console.log(`Seeded ${users.length} demo users, ${profiles.length} storefronts, ${catalog.length} products, wallets, transactions, referrals, chats and orders.`);
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
