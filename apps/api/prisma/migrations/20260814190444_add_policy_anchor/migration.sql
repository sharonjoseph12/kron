-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "appCallTxId" TEXT,
ADD COLUMN     "appId" INTEGER,
ADD COLUMN     "policyHash" TEXT;
