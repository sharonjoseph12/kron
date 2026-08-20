/*
  Warnings:

  - Added the required column `hardCeilingMicro` to the `PolicyVersion` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PolicyVersion" ADD COLUMN     "hardCeilingMicro" BIGINT NOT NULL;
