// import 'dotenv/config';

// import { PrismaPg } from '@prisma/adapter-pg';
// import { PrismaClient } from '../generated/prisma/client';
// import bcrypt from "bcrypt"; 

// const databaseUrl = process.env.DATABASE_URL;
// if (!databaseUrl) throw new Error('DATABASE_URL is not configured');

// const prisma = new PrismaClient({
//   adapter: new PrismaPg({ connectionString: databaseUrl }),
// });


// const TEST_PASSWORD = "WhazzTest@123";

// const testUsers = [
//   {
//     email: "vendor1@whazzonline.com",
//     password: TEST_PASSWORD,
//     firstName: "Oden",
//     lastName: "Fashion",
//     registrationType: "SELLER" as const,
//     role: "VENDOR" as const,
//     city: "Yaba",
//     state: "Lagos",
//   },
//   {
//     email: "vendor2@whazzonline.com",
//     password: TEST_PASSWORD,
//     firstName: "Ayil",
//     lastName: "Electronics",
//     registrationType: "SELLER" as const,
//     role: "VENDOR" as const,
//     city: "Ikeja",
//     state: "Lagos",
//   },
//   {
//     email: "vendor3@whazzonline.com",
//     password: TEST_PASSWORD,
//     firstName: "Glow",
//     lastName: "Beauty",
//     registrationType: "SELLER" as const,
//     role: "VENDOR" as const,
//     city: "Lekki",
//     state: "Lagos",
//   },
//   {
//     email: "buyer1@whazzonline.com",
//     password: TEST_PASSWORD,
//     firstName: "Katherine",
//     lastName: "Oluseye",
//     registrationType: "BUYER" as const,
//     role: "CUSTOMER" as const,
//     city: "Ikeja",
//     state: "Lagos",
//   },
//   {
//     email: "buyer2@whazzonline.com",
//     password: TEST_PASSWORD,
//     firstName: "Daniel",
//     lastName: "Okafor",
//     registrationType: "BUYER" as const,
//     role: "CUSTOMER" as const,
//     city: "Yaba",
//     state: "Lagos",
//   },
// ];

// async function seedTestUsers() {
//   const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

//   const users = [];

//   for (const testUser of testUsers) {
//     const user = await prisma.user.upsert({
//       where: {
//         email: testUser.email,
//       },
//       update: {
//         firstName: testUser.firstName,
//         lastName: testUser.lastName,
//         passwordHash,
//         registrationType: testUser.registrationType,
//         role: testUser.role,
//         isVerified: true,
//         isActive: true,
//         emailVerified: true,
//         city: testUser.city,
//         state: testUser.state,
//       },
//       create: {
//         email: testUser.email,
//         passwordHash,
//         firstName: testUser.firstName,
//         lastName: testUser.lastName,
//         registrationType: testUser.registrationType,
//         role: testUser.role,
//         isVerified: true,
//         isActive: true,
//         emailVerified: true,
//         city: testUser.city,
//         state: testUser.state,
//       },
//     });

//     users.push(user);

//     console.log(
//       `Seeded ${testUser.role}: ${testUser.email}`,
//     );
//   }

//   return users;
// }

// const images = [
//   ['https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=85', 'Women Fashion Dress', 'Fashion', 134000],
//   ['https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85', 'Givenchi Designer Bag', 'Fashion', 134000],
//   ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85', 'Calvin Klein Wristwatch', 'Fashion', 134000],
//   ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85', 'Designer Sneakers', 'Fashion', 85000],
//   ['https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=85', 'Streetwear Collection', 'Fashion', 95000],
//   ['https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?auto=format&fit=crop&w=900&q=85', 'Classic Fashion Set', 'Fashion', 76000],
//   ['https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=900&q=85', 'Toyota Camry', 'Cars', 12000000],
//   ['https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=85', 'Lexus X350', 'Cars', 9000000],
// ] as const;

// const avatarImages = [
//   'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=85',
//   'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=85',
// ];

// const storefrontBanners = [
//   'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=85',
//   'https://images.unsplash.com/photo-1487412912498-0447578fcca8?auto=format&fit=crop&w=1200&q=85',
// ];

// const interests = [
//   {
//     name: "Fashion & Apparel",
//     slug: "fashion",
//   },
//   {
//     name: "Electronics",
//     slug: "electronics",
//   },
//   {
//     name: "Services",
//     slug: "services",
//   },
//   {
//     name: "Food & Groceries",
//     slug: "food",
//   },
//   {
//     name: "Home & Living",
//     slug: "home",
//   },
//   {
//     name: "Beauty & Personal Care",
//     slug: "beauty",
//   },
//   {
//     name: "Health & Wellness",
//     slug: "health",
//   },
//   {
//     name: "Agriculture & Farm Produce",
//     slug: "agriculture",
//   },
//   {
//     name: "Children & Baby",
//     slug: "children",
//   },
// ];

// async function seedWallet(
//   user: { id: string; firstName: string | null; lastName: string | null },
//   index: number,
// ) {
//   const mainBalance = 23000 + index * 500;
//   const wallet = await prisma.wallet.upsert({
//     where: { userId: user.id },
//     create: {
//       userId: user.id,
//       accountName:
//         [user.firstName, user.lastName].filter(Boolean).join(' ') ||
//         'Whazzonline User',
//       accountNumber: `019${user.id.replace(/-/g, '').slice(0, 7)}`,
//       bankName: 'Paystack - Titan',
//       mainBalance,
//       referralBonus: 2000,
//       availableBalance: mainBalance + 2000,
//     },
//     update: {
//       accountName:
//         [user.firstName, user.lastName].filter(Boolean).join(' ') ||
//         'Whazzonline User',
//       bankName: 'Paystack - Titan',
//       mainBalance,
//       referralBonus: 2000,
//       availableBalance: mainBalance + 2000,
//     },
//   });
//   if (await prisma.walletTransaction.count({ where: { walletId: wallet.id } }))
//     return;
//   const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000);
//   await prisma.walletTransaction.createMany({
//     data: [
//       {
//         walletId: wallet.id,
//         type: 'REFERRAL_BONUS',
//         status: 'COMPLETED',
//         amount: 500,
//         description: 'Referral Bonus - Rita Mma',
//         createdAt: at(0),
//       },
//       {
//         walletId: wallet.id,
//         type: 'WITHDRAWAL',
//         status: 'COMPLETED',
//         amount: -500,
//         description: 'Withdrawal to Bank',
//         createdAt: at(1),
//       },
//       {
//         walletId: wallet.id,
//         type: 'PURCHASE',
//         status: 'COMPLETED',
//         amount: -500,
//         description: 'Purchase of Watch',
//         createdAt: at(1),
//       },
//       {
//         walletId: wallet.id,
//         type: 'FUNDING',
//         status: 'COMPLETED',
//         amount: 500,
//         description: 'Funding Wallet',
//         createdAt: at(1),
//       },
//       {
//         walletId: wallet.id,
//         type: 'WITHDRAWAL',
//         status: 'PENDING',
//         amount: -500,
//         description: 'Withdrawal to Bank',
//         createdAt: at(24),
//       },
//       {
//         walletId: wallet.id,
//         type: 'PURCHASE',
//         status: 'FAILED',
//         amount: -500,
//         description: 'Purchase of Gucci bag',
//         createdAt: at(24),
//       },
//       {
//         walletId: wallet.id,
//         type: 'FUNDING',
//         status: 'COMPLETED',
//         amount: 500,
//         description: 'Funding Wallet',
//         createdAt: at(24),
//       },
//     ],
//   });
// }

// async function seedReferrals(userId: string) {
//   if (await prisma.referral.count({ where: { referrerUserId: userId } }))
//     return;
//   const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000);
//   const completed = (refereeName: string, daysAgo: number) => ({
//     referrerUserId: userId,
//     refereeName,
//     rewardAmount: 3125,
//     status: 'COMPLETED' as const,
//     createdAt: at(daysAgo),
//     completedAt: at(daysAgo),
//   });
//   const pending = (refereeName: string, daysAgo: number) => ({
//     referrerUserId: userId,
//     refereeName,
//     rewardAmount: 3125,
//     status: 'PENDING' as const,
//     createdAt: at(daysAgo),
//   });
//   await prisma.referral.createMany({
//     data: [
//       completed('Rita Mma', 0),
//       completed('Faith Vinc', 0),
//       pending('Jessica Chris', 24),
//       completed('Alhaji Musa', 1),
//       completed('Alhaji Musa', 2),
//       completed('Alhaji Musa', 3),
//       completed('Alhaji Musa', 4),
//       pending('Jessica Chris', 24),
//       completed('Mariam Bello', 5),
//       pending('John Adewale', 31),
//       completed('Kemi Adeyemi', 32),
//       pending('Chika Okafor', 34),
//     ],
//   });
// }

// async function seedInterests() {
//   for (const interest of interests) {
//     await prisma.interest.upsert({
//       where: {
//         slug: interest.slug,
//       },
//       update: {
//         name: interest.name,
//       },
//       create: {
//         name: interest.name,
//         slug: interest.slug,
//       },
//     });
//   }

//   console.log(`Seeded ${interests.length} interests.`);
// }

// async function main() {
//   await seedInterests();
//   const testUsers = await seedTestUsers();
//   await prisma.user.upsert({
//     where: { email: 'seed-buyer@whazzonline.test' },
//     create: {
//       email: 'seed-buyer@whazzonline.test',
//       firstName: 'Katherine',
//       lastName: 'Oluseye',
//       registrationType: 'BUYER',
//       role: 'CUSTOMER',
//       isVerified: true,
//       city: 'Ikeja',
//       state: 'Lagos',
//     },
//     update: {},
//   });
//   await prisma.user.upsert({
//     where: { email: 'seed-business@whazzonline.test' },
//     create: {
//       email: 'seed-business@whazzonline.test',
//       firstName: 'Whazz Business',
//       registrationType: 'BUSINESS',
//       role: 'BUSINESS',
//       isVerified: true,
//     },
//     update: {},
//   });
//   for (const [index, storeName] of [
//     'Oden Store',
//     'Ayil Motors',
//     'Glow Beauty',
//     'Happy Kids',
//   ].entries()) {
//     await prisma.user.upsert({
//       where: { email: `seed-vendor-${index + 1}@whazzonline.test` },
//       create: {
//         email: `seed-vendor-${index + 1}@whazzonline.test`,
//         firstName: storeName,
//         registrationType: 'SELLER',
//         role: 'VENDOR',
//         isVerified: true,
//       },
//       update: {},
//     });
//   }
//   const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
//   for (const [index, user] of users.entries()) {
//     if (!user.avatarUrl) {
//       await prisma.user.update({
//         where: { id: user.id },
//         data: { avatarUrl: avatarImages[index % avatarImages.length] },
//       });
//     }
//     await seedWallet(user, index);
//     await seedReferrals(user.id);
//   }
//   const vendors = users.filter(
//     (user) => user.role === 'VENDOR' || user.role === 'BUSINESS',
//   );
//   for (const [index, user] of vendors.entries()) {
//     const profile = await prisma.vendorProfile.upsert({
//       where: { userId: user.id },
//       create: {
//         userId: user.id,
//         storeName: `${user.firstName || 'Whazz'} Store`,
//         category: 'Fashion',
//         subCategory: 'General',
//         state: 'Lagos',
//         city: 'Yaba',
//         lga: 'Lagos Mainland',
//         address: '12 Commercial Avenue, Yaba',
//         description: 'Curated products from a verified Whazzonline vendor.',
//         bannerUrl: storefrontBanners[index % storefrontBanners.length],
//         logoUrl: avatarImages[(index + 1) % avatarImages.length],
//         reviewStatus: 'APPROVED',
//         setupCompleted: true,
//       },
//       update: {
//         bannerUrl: storefrontBanners[index % storefrontBanners.length],
//         logoUrl: avatarImages[(index + 1) % avatarImages.length],
//       },
//     });
//     for (const [productIndex, [imageUrl, name, category, unitPrice]] of images
//       .slice(0, 6)
//       .entries()) {
//       const existing = await prisma.product.findFirst({
//         where: { name, vendorProfileId: profile.id },
//         select: { id: true },
//       });
//       const quantity = [25, 6, 30, 0, 2, 0][productIndex] ?? 12;
//       if (existing) {
//         await prisma.product.update({
//           where: { id: existing.id },
//           data: { imageUrls: [imageUrl], quantity },
//         });
//       } else {
//         await prisma.product.create({
//           data: {
//             vendorProfileId: profile.id,
//             category,
//             mainCategory: category,
//             description: `${name} supplied by ${profile.storeName}.`,
//             name,
//             unitPrice,
//             quantity,
//             imageUrls: [imageUrl],
//             variants: [],
//             status: 'ACTIVE',
//           },
//         });
//       }
//     }
//   }

//   const buyers = users.filter((user) => user.role === 'CUSTOMER');
//   const vendorProfiles = await prisma.vendorProfile.findMany({
//     include: { products: { where: { status: 'ACTIVE' }, take: 1 } },
//     orderBy: { createdAt: 'asc' },
//   });
//   for (const buyer of buyers) {
//     for (const profile of vendorProfiles.slice(0, 3)) {
//       const conversation = await prisma.conversation.upsert({
//         where: {
//           buyerUserId_vendorProfileId: {
//             buyerUserId: buyer.id,
//             vendorProfileId: profile.id,
//           },
//         },
//         create: {
//           buyerUserId: buyer.id,
//           vendorProfileId: profile.id,
//           favorite: true,
//         },
//         update: {},
//       });
//       if (
//         !(await prisma.chatMessage.count({
//           where: { conversationId: conversation.id },
//         }))
//       ) {
//         await prisma.chatMessage.create({
//           data: {
//             conversationId: conversation.id,
//             senderUserId: buyer.id,
//             kind: 'TEXT',
//             text: `Hello ${profile.storeName}, is this product available?`,
//           },
//         });
//       }
//     }

//     const profile = vendorProfiles[0];
//     const product = profile?.products[0];
//     if (!profile || !product) continue;
//     let order = await prisma.commerceOrder.findFirst({
//       where: {
//         userId: buyer.id,
//         deliveryAddress: 'Seeded completed order',
//       },
//       include: { items: true },
//     });
//     if (!order) {
//       order = await prisma.commerceOrder.create({
//         data: {
//           userId: buyer.id,
//           deliveryAddress: 'Seeded completed order',
//           latitude: 6.5244,
//           longitude: 3.3792,
//           paymentMethod: 'simulated',
//           status: 'delivered',
//           completedAt: new Date(),
//           subtotal: product.unitPrice,
//           serviceFee: 600,
//           deliveryFee: 1500,
//           total: product.unitPrice + 2100,
//           items: {
//             create: {
//               productId: product.id,
//               vendorId: profile.userId,
//               vendorName: profile.storeName,
//               name: product.name,
//               subtitle: profile.category,
//               imageUri: product.imageUrls[0] ?? '',
//               sku: product.id.slice(0, 8).toUpperCase(),
//               unitPrice: product.unitPrice,
//               quantity: 1,
//               deliveryAddress: 'Seeded completed order',
//             },
//           },
//         },
//         include: { items: true },
//       });
//     }
//     await prisma.vendorTrustReview.upsert({
//       where: {
//         reviewerUserId_vendorProfileId_orderId: {
//           reviewerUserId: buyer.id,
//           vendorProfileId: profile.id,
//           orderId: order.id,
//         },
//       },
//       create: {
//         reviewerUserId: buyer.id,
//         vendorProfileId: profile.id,
//         orderId: order.id,
//         reason:
//           'The seller communicated clearly and delivered exactly what I ordered.',
//       },
//       update: {},
//     });
//   }
//   console.log(
//     `Seeded ${users.length} users, ${vendors.length} storefronts, real products, commerce history, trust reviews, wallets, referrals, and conversations.`,
//   );
// }

// main()
//   .catch((error) => {
//     console.error(error);
//     process.exitCode = 1;
//   })
//   .finally(() => prisma.$disconnect());


import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, User } from "../generated/prisma/client";
import bcrypt from "bcrypt";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl,
  }),
});

/**
 * ============================================================
 * TEST USERS
 * ============================================================
 */

const TEST_PASSWORD = "WhazzTest@123";

const testUsers = [
  {
    email: "vendor1@whazzonline.com",
    password: TEST_PASSWORD,
    firstName: "Oden",
    lastName: "Fashion",
    registrationType: "SELLER" as const,
    role: "VENDOR" as const,
    city: "Yaba",
    state: "Lagos",
  },
  {
    email: "vendor2@whazzonline.com",
    password: TEST_PASSWORD,
    firstName: "Ayil",
    lastName: "Electronics",
    registrationType: "SELLER" as const,
    role: "VENDOR" as const,
    city: "Ikeja",
    state: "Lagos",
  },
  {
    email: "vendor3@whazzonline.com",
    password: TEST_PASSWORD,
    firstName: "Glow",
    lastName: "Beauty",
    registrationType: "SELLER" as const,
    role: "VENDOR" as const,
    city: "Lekki",
    state: "Lagos",
  },
  {
    email: "buyer1@whazzonline.com",
    password: TEST_PASSWORD,
    firstName: "Katherine",
    lastName: "Oluseye",
    registrationType: "BUYER" as const,
    role: "CUSTOMER" as const,
    city: "Ikeja",
    state: "Lagos",
  },
  {
    email: "buyer2@whazzonline.com",
    password: TEST_PASSWORD,
    firstName: "Daniel",
    lastName: "Okafor",
    registrationType: "BUYER" as const,
    role: "CUSTOMER" as const,
    city: "Yaba",
    state: "Lagos",
  },
];

async function seedTestUsers() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  const users: User[] = [];

  for (const testUser of testUsers) {
    const user = await prisma.user.upsert({
      where: {
        email: testUser.email,
      },

      update: {
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        passwordHash,
        registrationType: testUser.registrationType,
        role: testUser.role,
        isVerified: true,
        isActive: true,
        emailVerified: true,
        city: testUser.city,
        state: testUser.state,
      },

      create: {
        email: testUser.email,
        passwordHash,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        registrationType: testUser.registrationType,
        role: testUser.role,
        isVerified: true,
        isActive: true,
        emailVerified: true,
        city: testUser.city,
        state: testUser.state,
      },
    });

    users.push(user);

    console.log(
      `Seeded ${testUser.role}: ${testUser.email}`,
    );
  }

  return users;
}

/**
 * ============================================================
 * INTERESTS
 * ============================================================
 */

const interests = [
  {
    name: "Fashion & Apparel",
    slug: "fashion",
  },
  {
    name: "Electronics",
    slug: "electronics",
  },
  {
    name: "Services",
    slug: "services",
  },
  {
    name: "Food & Groceries",
    slug: "food",
  },
  {
    name: "Home & Living",
    slug: "home",
  },
  {
    name: "Beauty & Personal Care",
    slug: "beauty",
  },
  {
    name: "Health & Wellness",
    slug: "health",
  },
  {
    name: "Agriculture & Farm Produce",
    slug: "agriculture",
  },
  {
    name: "Children & Baby",
    slug: "children",
  },
];

async function seedInterests() {
  for (const interest of interests) {
    await prisma.interest.upsert({
      where: {
        slug: interest.slug,
      },

      update: {
        name: interest.name,
      },

      create: {
        name: interest.name,
        slug: interest.slug,
      },
    });
  }

  console.log(`Seeded ${interests.length} interests.`);
}

/**
 * ============================================================
 * MAIN
 * ============================================================
 */

async function main() {
  console.log("Starting production seed...");

  await seedInterests();

  const users = await seedTestUsers();

  console.log(
    `Seed complete: ${users.length} test users and ${interests.length} interests.`,
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * ============================================================
 * DISABLED SEED DATA
 * ============================================================
 *
 * The following seed functions are intentionally disabled while
 * setting up the new live database.
 *
 * We can enable them later when we are ready to populate:
 *
 * - Wallets
 * - Wallet transactions
 * - Referrals
 * - Vendor profiles
 * - Products
 * - Conversations
 * - Chat messages
 * - Orders
 * - Trust reviews
 * - Storefront images
 *
 * DO NOT put the old `findMany()` user loop back into `main()`
 * until we intentionally want to seed data for all users.
 *
 * ============================================================
 */
