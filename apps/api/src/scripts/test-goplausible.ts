async function main() {
  try {
    const res = await fetch("https://facilitator.goplausible.xyz/supported");
    const data = await res.json();
    console.log("SUPPORTED:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error fetching /supported:", err);
  }
}
main();
