import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG ? ["query", "error", "warn"] : ["error", "warn"],
});