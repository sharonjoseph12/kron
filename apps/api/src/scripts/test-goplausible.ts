import dotenv from "dotenv";
import { resolve } from "node:path";
import algosdk from "algosdk";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

async function main() {
  const facilitatorUrl = "https://facilitator.goplausible.xyz";
  const caip2Network = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";

  console.log("Testing GoPlausible Facilitator endpoints...");

  // 1. Check /supported
  const suppRes = await fetch(`${facilitatorUrl}/supported`);
  console.log("GET /supported status:", suppRes.status);
  const suppData = (await suppRes.json()) as any;
  console.log("Supported kinds:", JSON.stringify(suppData.kinds, null, 2));

  // 2. Generate a dummy testnet transaction to see how /verify and /settle respond
  const algodClient = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");
  const sp = await algodClient.getTransactionParams().do();
  const acc = algosdk.generateAccount();
  const receiverAcc = algosdk.generateAccount();
  const receiver = receiverAcc.addr.toString();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: acc.addr,
    receiver: receiver,
    amount: 10000n,
    suggestedParams: sp,
  });
  const signed = algosdk.signTransaction(txn, acc.sk);
  const signedTxnB64 = Buffer.from(signed.blob).toString("base64");

  const paymentPayload = {
    x402Version: 2,
    scheme: "exact",
    network: caip2Network,
    payload: {
      paymentGroup: [signedTxnB64],
      paymentIndex: 0,
    },
  };

  const paymentRequirements = {
    scheme: "exact",
    network: caip2Network,
    payTo: receiver,
    amount: "10000",
    maxAmountRequired: "10000",
    price: "0.01",
    asset: "0",
    resource: {
      url: "http://localhost:9100/pay/premium-market-sentiment",
      method: "GET",
      description: "KRON x402 payment — USDC",
    },
    description: "KRON autonomous agent payment",
  };

  console.log("\nTesting POST /verify...");
  try {
    const verifyRes = await fetch(`${facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
    console.log("POST /verify status:", verifyRes.status);
    const verifyText = await verifyRes.text();
    console.log("POST /verify response:", verifyText);
  } catch (e) {
    console.error("POST /verify error:", e);
  }

  console.log("\nTesting POST /settle...");
  try {
    const settleRes = await fetch(`${facilitatorUrl}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
    console.log("POST /settle status:", settleRes.status);
    const settleText = await settleRes.text();
    console.log("POST /settle response:", settleText);
  } catch (e) {
    console.error("POST /settle error:", e);
  }
}

main();
