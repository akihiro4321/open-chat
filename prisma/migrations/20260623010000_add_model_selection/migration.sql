-- AlterTable
ALTER TABLE "Thread" ADD COLUMN "model" TEXT;

-- AlterTable
ALTER TABLE "ModelRun" ADD COLUMN "requestedModel" TEXT;
ALTER TABLE "ModelRun" ADD COLUMN "fallbackUsed" BOOLEAN NOT NULL DEFAULT false;
