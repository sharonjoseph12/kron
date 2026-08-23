import { prisma } from "../db.js";
import { createWalletKeys } from "../algorand/vault.js";

async function main() {
  const agents = await prisma.agent.findMany({ include: { wallet: true } });
  for (const agent of agents) {
    const keys = createWalletKeys();
    if (agent.wallet) {
      await prisma.wallet.update({
        where: { id: agent.wallet.id },
        data: {
          address: keys.address,
          encryptedKey: keys.encryptedKey,
        },
      });
      console.log(`✓ Re-keyed wallet for ${agent.name}: ${keys.address}`);
    } else {
      await prisma.wallet.create({
        data: {
          agentId: agent.id,
          address: keys.address,
          encryptedKey: keys.encryptedKey,
          network: "testnet",
        },
      });
      console.log(`✓ Created fresh wallet for ${agent.name}: ${keys.address}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
