import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not configured');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const images = [
  ['car-camry', 'Toyota Camry', 'Cars', 12000000],
  ['car-lexus-x350', 'Lexus X350', 'Cars', 9000000],
  ['fashion-wedding', 'Wedding Dress', 'Fashion', 250000],
  ['fashion-converse', 'Converse Sneakers', 'Fashion', 85000],
  ['beauty-set', 'Beauty Care Set', 'Beauty', 35000],
  ['beauty-bottle', 'Glow Body Lotion', 'Beauty', 18000],
  ['kids-toys', 'Learning Toy Set', 'Kids', 22000],
  ['kids-shoes', 'Kids School Shoes', 'Kids', 30000],
] as const;

async function seedWallet(
  user: { id: string; firstName: string | null; lastName: string | null },
  index: number,
) {
  const mainBalance = 23000 + index * 500;
  const wallet = await prisma.wallet.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      accountName:
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        'Whazzonline User',
      accountNumber: `019${user.id.replace(/-/g, '').slice(0, 7)}`,
      bankName: 'Paystack - Titan',
      mainBalance,
      referralBonus: 2000,
      availableBalance: mainBalance + 2000,
    },
    update: {},
  });
  if (await prisma.walletTransaction.count({ where: { walletId: wallet.id } }))
    return;
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000);
  await prisma.walletTransaction.createMany({
    data: [
      {
        walletId: wallet.id,
        type: 'REFERRAL_BONUS',
        status: 'COMPLETED',
        amount: 500,
        description: 'Referral Bonus - Rita Mma',
        createdAt: at(0),
      },
      {
        walletId: wallet.id,
        type: 'WITHDRAWAL',
        status: 'COMPLETED',
        amount: -500,
        description: 'Withdrawal to Bank',
        createdAt: at(1),
      },
      {
        walletId: wallet.id,
        type: 'PURCHASE',
        status: 'COMPLETED',
        amount: -500,
        description: 'Purchase of Watch',
        createdAt: at(1),
      },
      {
        walletId: wallet.id,
        type: 'FUNDING',
        status: 'COMPLETED',
        amount: 500,
        description: 'Funding Wallet',
        createdAt: at(1),
      },
      {
        walletId: wallet.id,
        type: 'WITHDRAWAL',
        status: 'PENDING',
        amount: -500,
        description: 'Withdrawal to Bank',
        createdAt: at(24),
      },
      {
        walletId: wallet.id,
        type: 'PURCHASE',
        status: 'FAILED',
        amount: -500,
        description: 'Purchase of Gucci bag',
        createdAt: at(24),
      },
      {
        walletId: wallet.id,
        type: 'FUNDING',
        status: 'COMPLETED',
        amount: 500,
        description: 'Funding Wallet',
        createdAt: at(24),
      },
    ],
  });
}

async function seedReferrals(userId: string) {
  if (await prisma.referral.count({ where: { referrerUserId: userId } })) return;
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000);
  const completed = (refereeName: string, daysAgo: number) => ({
    referrerUserId: userId,
    refereeName,
    rewardAmount: 3125,
    status: 'COMPLETED' as const,
    createdAt: at(daysAgo),
    completedAt: at(daysAgo),
  });
  const pending = (refereeName: string, daysAgo: number) => ({
    referrerUserId: userId,
    refereeName,
    rewardAmount: 3125,
    status: 'PENDING' as const,
    createdAt: at(daysAgo),
  });
  await prisma.referral.createMany({
    data: [
      completed('Rita Mma', 0),
      completed('Faith Vinc', 0),
      pending('Jessica Chris', 24),
      completed('Alhaji Musa', 1),
      completed('Alhaji Musa', 2),
      completed('Alhaji Musa', 3),
      completed('Alhaji Musa', 4),
      pending('Jessica Chris', 24),
      completed('Mariam Bello', 5),
      pending('John Adewale', 31),
      completed('Kemi Adeyemi', 32),
      pending('Chika Okafor', 34),
    ],
  });
}

async function main() {
  for (const [index, storeName] of [
    'Oden Store',
    'Ayil Motors',
    'Glow Beauty',
    'Happy Kids',
  ].entries()) {
    await prisma.user.upsert({
      where: { email: `seed-vendor-${index + 1}@whazzonline.test` },
      create: {
        email: `seed-vendor-${index + 1}@whazzonline.test`,
        firstName: storeName,
        registrationType: 'SELLER',
        role: 'VENDOR',
        isVerified: true,
      },
      update: {},
    });
  }
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  for (const [index, user] of users.entries()) {
    await seedWallet(user, index);
    await seedReferrals(user.id);
  }
  const vendors = users.filter(
    (user) => user.role === 'VENDOR' || user.role === 'BUSINESS',
  );
  for (const [index, user] of vendors.entries()) {
    const profile = await prisma.vendorProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        storeName: `${user.firstName || 'Whazz'} Store`,
        category: 'Fashion',
        subCategory: 'General',
        state: 'Lagos',
        city: 'Yaba',
        lga: 'Lagos Mainland',
        address: '12 Commercial Avenue, Yaba',
        description: 'Curated products from a verified Whazzonline vendor.',
        reviewStatus: 'APPROVED',
        setupCompleted: true,
      },
      update: {},
    });
    if (await prisma.product.count({ where: { vendorProfileId: profile.id } }))
      continue;
    const productImages = [
      images[(index * 2) % images.length],
      images[(index * 2 + 1) % images.length],
    ];
    await prisma.product.createMany({
      data: productImages.map(([imageKey, name, category, unitPrice]) => ({
        vendorProfileId: profile.id,
        category,
        name,
        unitPrice,
        quantity: 12,
        imageUrls: [imageKey],
        variants: [],
        status: 'ACTIVE',
      })),
    });
  }
  console.log(
    `Seeded wallets and referrals for ${users.length} users and marketplace products for ${vendors.length} vendors.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
