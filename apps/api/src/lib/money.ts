/**
 * Money + JSON helpers. All money is stored in the DB as exact microAlgo
 * integers (Prisma BigInt) and converted to/from ALGO only at DTO boundaries.
 * BigInt is never JSON-serialized directly (it throws).
 */

export const ALGO_DECIMALS = 6;

export function algoToMicro(algo: number): bigint {
  return BigInt(Math.round(algo * 1_000_000));
}

export function microToAlgo(micro: bigint | number): number {
  return Number(micro) / 1_000_000;
}

/** Prisma BigInt -> ALGO number for DTOs. */
export function toAlgo(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

/** PRD §12/§13 formatting: "0.018 ALGO" */
export function fmtAlgo(micro: bigint | number): string {
  const v = typeof micro === "bigint" ? toAlgo(micro) : micro;
  return `${v.toFixed(v >= 100 ? 2 : 4).replace(/\.?0+$/, "")} ALGO`;
}

/** JSON-safe copy that converts BigInt to string. */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}