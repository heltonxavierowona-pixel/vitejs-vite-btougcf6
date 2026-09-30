-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('AWAITING_LINK', 'LINK_SENT', 'REFERENCE_SUBMITTED', 'VALIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentRequestKind" AS ENUM ('NEW', 'RENEWAL');

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "plan" "PlanCode" NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" "PaymentRequestKind" NOT NULL DEFAULT 'NEW',
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'AWAITING_LINK',
    "paymentLink" TEXT,
    "linkSentAt" TIMESTAMP(3),
    "transactionRef" TEXT,
    "referenceSubmittedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_transactionRef_key" ON "payment_requests"("transactionRef");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_paymentId_key" ON "payment_requests"("paymentId");

-- CreateIndex
CREATE INDEX "payment_requests_status_idx" ON "payment_requests"("status");

-- CreateIndex
CREATE INDEX "payment_requests_organizationId_status_idx" ON "payment_requests"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Une seule demande en cours par organisation (protège du double clic).
CREATE UNIQUE INDEX "payment_requests_one_open_per_org" ON "payment_requests"("organizationId")
  WHERE "status" IN ('AWAITING_LINK', 'LINK_SENT', 'REFERENCE_SUBMITTED');
