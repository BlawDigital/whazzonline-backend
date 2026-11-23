# Database changes

Everything that must exist in the database for the features built on
`feature/combined-wwp-24-25-38-39`, `feature/WWP-35-45-48-referral-codes` and
`feature/WWP-20-21-34-orders-email-referral-link`.
The SQL below is the exact output of `prisma migrate diff` between `main` and
the current `prisma/schema.prisma` (PostgreSQL).

## Summary

| # | Change | Kind | Needed by |
|---|--------|------|-----------|
| 1 | `ProductReviewReport` | New table | WWP-25 spam reports on product reviews |
| 2 | `ProductCondition` | New enum | WWP-24 condition filter |
| 3 | `Product.brand`, `Product.condition` | New columns + index `Product_brand_idx` | WWP-24 brand and condition filters |
| 4 | `ReferralStatus` | 4 new values: `QUALIFIED`, `REWARDED`, `INELIGIBLE`, `VOIDED` | WWP-49, WWP-51 |
| 5 | `Referral.qualifiedAt`, `qualifyingOrderId` (unique), `statusReason` | New columns | WWP-49, WWP-51, WWP-52 |
| 6 | `ReferralPayoutStatus` | New enum | WWP-51 |
| 7 | `ReferralPayout` | New table (`referralId` unique: one reward per referral) | WWP-51, WWP-52 |
| 8 | `ReferralProgramConfig` | New table (single row, id `default`) | WWP-51 configurable rules |
| 9 | `ReferralAuditLog` | New table | WWP-52 audit trail |
| 10 | `ReferralNotification` | New table | WWP-51 referrer notices |
| 11 | `ReferralEvent` | New table | WWP-35 journey events |
| 12 | `User.referredByCode` | New column | WWP-34 stores the code a user signed up with |
| 13 | `OrderEmailDelivery` | New table (`orderId` unique: one email per order) | WWP-21 order confirmation email |

No schema change was needed for WWP-22 (stock), WWP-20 (seller order list and CSV), or
WWP-45 to WWP-48 (referral code, link, copy) beyond the tables above: `User.referralCode` already exists and is unique.

## How to apply

**Option A, simplest (this repo has no `prisma/migrations` folder):**

```bash
npx prisma db push
```

**Option B, run the SQL by hand:** use the script in the next section. Run it
against a database that matches `main`. Back up first.

Notes for option B:
- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on PostgreSQL 11
  and earlier. On PostgreSQL 12+ it works, but the new values cannot be *used* in the
  same transaction. Run the four `ALTER TYPE "ReferralStatus"` lines on their own first
  if your tool wraps the script in a transaction.
- The script is not idempotent. Do not run it twice.

## SQL (main to current)

```sql
-- CreateEnum
CREATE TYPE "ReferralPayoutStatus" AS ENUM ('QUEUED', 'PROCESSING', 'PAID', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductCondition" AS ENUM ('NEW', 'USED', 'REFURBISHED');

-- AlterEnum (run these four statements on their own if your tool uses a transaction)
ALTER TYPE "ReferralStatus" ADD VALUE 'QUALIFIED';
ALTER TYPE "ReferralStatus" ADD VALUE 'REWARDED';
ALTER TYPE "ReferralStatus" ADD VALUE 'INELIGIBLE';
ALTER TYPE "ReferralStatus" ADD VALUE 'VOIDED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referredByCode" TEXT;

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN     "qualifiedAt" TIMESTAMP(3),
ADD COLUMN     "qualifyingOrderId" TEXT,
ADD COLUMN     "statusReason" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "condition" "ProductCondition";

-- CreateTable
CREATE TABLE "ReferralProgramConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minOrderValue" INTEGER NOT NULL DEFAULT 5000,
    "rewardAmount" INTEGER NOT NULL DEFAULT 500,
    "qualificationWindowDays" INTEGER NOT NULL DEFAULT 30,
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReferralProgramConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralPayout" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "referralId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "ReferralPayoutStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "transactionId" TEXT,

    CONSTRAINT "ReferralPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referrerUserId" TEXT NOT NULL,
    "referralId" TEXT,
    "type" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referralId" TEXT,
    "event" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ReferralAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralNotification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "referralId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "ReferralNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEmailDelivery" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "attemptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "OrderEmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReviewReport" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "ProductReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPayout_referralId_key" ON "ReferralPayout"("referralId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPayout_transactionId_key" ON "ReferralPayout"("transactionId");

-- CreateIndex
CREATE INDEX "ReferralPayout_status_nextAttemptAt_idx" ON "ReferralPayout"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ReferralEvent_referrerUserId_createdAt_idx" ON "ReferralEvent"("referrerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralEvent_referralId_createdAt_idx" ON "ReferralEvent"("referralId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralEvent_type_createdAt_idx" ON "ReferralEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralAuditLog_referralId_createdAt_idx" ON "ReferralAuditLog"("referralId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralAuditLog_event_createdAt_idx" ON "ReferralAuditLog"("event", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralNotification_userId_createdAt_idx" ON "ReferralNotification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderEmailDelivery_orderId_key" ON "OrderEmailDelivery"("orderId");

-- CreateIndex
CREATE INDEX "OrderEmailDelivery_status_createdAt_idx" ON "OrderEmailDelivery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductReviewReport_reviewId_idx" ON "ProductReviewReport"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReviewReport_reporterId_reviewId_key" ON "ProductReviewReport"("reporterId", "reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_qualifyingOrderId_key" ON "Referral"("qualifyingOrderId");

-- CreateIndex
CREATE INDEX "Product_brand_idx" ON "Product"("brand");

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralAuditLog" ADD CONSTRAINT "ReferralAuditLog_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralNotification" ADD CONSTRAINT "ReferralNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralNotification" ADD CONSTRAINT "ReferralNotification_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReviewReport" ADD CONSTRAINT "ProductReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReviewReport" ADD CONSTRAINT "ProductReviewReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

## Optional seed row

The app creates the referral rules row on first use with these defaults, so this
is only needed if you want it present up front:

```sql
INSERT INTO "ReferralProgramConfig" ("id", "updatedAt")
VALUES ('default', NOW())
ON CONFLICT ("id") DO NOTHING;
```

Defaults: programme enabled, minimum order ₦5,000, reward ₦500, 30-day
qualification window, first order only. Admins can change them through
`PATCH /referrals/admin/rules`.

## Table reference

### Product reviews (WWP-25)
| Table | Columns | Constraints |
|-------|---------|-------------|
| `ProductReviewReport` | `id`, `createdAt`, `reviewId`, `reporterId`, `reason?` | One report per user per review (`reporterId` + `reviewId` unique). Deleted with the review or the user. |

`ProductReview.comment` is unchanged and still `NOT NULL`. A rating with no text is
stored as an empty string.

### Search filters (WWP-24)
| Table | Columns | Notes |
|-------|---------|-------|
| `Product` | `brand?`, `condition?` (`NEW`, `USED`, `REFURBISHED`) | Existing products have both empty until sellers fill them in. Index on `brand`. |

### Referral rewards (WWP-38, WWP-39: stories WWP-49 to WWP-52)
| Table | Purpose |
|-------|---------|
| `Referral` (altered) | Adds `qualifiedAt`, `qualifyingOrderId` (unique) and `statusReason`. Status lifecycle: `PENDING` to `QUALIFIED` to `REWARDED`, or `INELIGIBLE` / `VOIDED`. `COMPLETED` is kept for merchant referrals. |
| `ReferralPayout` | The reward record. `referralId` is unique, so a referral can only ever pay once. Statuses `QUEUED`, `PROCESSING`, `PAID`, `CANCELLED`, `FAILED`, with retry fields. Links to the wallet transaction. |
| `ReferralProgramConfig` | One row of editable rules. |
| `ReferralAuditLog` | Qualification, duplicate attempts, payouts, voids, errors, for manual review. |
| `ReferralNotification` | In-app notices to the referrer. |

### Referral codes and journey (WWP-36, WWP-37, WWP-32: stories WWP-35, WWP-45 to WWP-48)
| Table | Purpose |
|-------|---------|
| `ReferralEvent` | Journey log: `LINK_OPENED`, `SIGNED_UP`, `QUALIFIED`, `REWARDED`, `INELIGIBLE`, `EXPIRED`, `VOIDED`. No foreign keys, so events survive deletions. |
| `User.referralCode` (existing) | No change. New codes are 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Old 32-character codes remain valid. |

### Order confirmation email (WWP-21)
| Table | Purpose |
|-------|---------|
| `OrderEmailDelivery` | One row per order: `destination`, `status` (`PENDING`, `SENDING`, `SENT`, `FAILED`, `SKIPPED`), `attempts`, `sentAt`, `lastError`. The unique `orderId` makes a second send impossible. Failed sends are retried every minute, up to 5 attempts within 24 hours. |

The email needs `RESEND_API_KEY` and `EMAIL_FROM` (already used for invoices) and
optionally `FRONTEND_URL` for the support link.

### Referral association (WWP-34)
| Table | Purpose |
|-------|---------|
| `User.referredByCode` | The referral code the user signed up with. Stays `NULL` when they joined without one. The `Referral` row (unique `refereeUserId`) still links referrer and referee. |

## Rollback

Drop in this order if you need to undo (data in these tables is lost):

```sql
DROP TABLE "OrderEmailDelivery", "ProductReviewReport", "ReferralNotification", "ReferralAuditLog",
           "ReferralEvent", "ReferralPayout", "ReferralProgramConfig";
ALTER TABLE "Referral" DROP COLUMN "qualifiedAt", DROP COLUMN "qualifyingOrderId", DROP COLUMN "statusReason";
ALTER TABLE "Product" DROP COLUMN "brand", DROP COLUMN "condition";
ALTER TABLE "User" DROP COLUMN "referredByCode";
DROP TYPE "ReferralPayoutStatus";
DROP TYPE "ProductCondition";
-- PostgreSQL cannot remove enum values. The four new "ReferralStatus" values stay;
-- they are harmless once no row uses them.
```
