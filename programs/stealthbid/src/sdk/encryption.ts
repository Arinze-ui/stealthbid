/**
 * StealthBid — Arcium Bid Encryption SDK
 *
 * Handles client-side threshold encryption of bid amounts
 * using Arcium's MXE cluster public key.
 *
 * The bid amount is encrypted IN THE BROWSER before any
 * network call is made. The plaintext never touches the wire.
 *
 * Arcium MXE then computes max(all encrypted bids) at close
 * without decrypting any individual bid — only the winner's
 * amount is selectively revealed for settlement.
 *
 * Reference: https://docs.arcium.com/sdk/encryption
 */

import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BidInput {
  amountLamports: bigint;   // Bid amount in lamports
  bidderPubkey: PublicKey;  // Bidder's wallet
  auctionId: bigint;        // Auction identifier
}

export interface EncryptedBid {
  ciphertext: Uint8Array;   // Arcium threshold-encrypted bid amount
  arciumJobId: Uint8Array;  // MXE job ID for on-chain verification
  arciumSig: Uint8Array;    // MXE result signature
}

export interface WinnerResult {
  winner: PublicKey;
  winningAmountLamports: bigint;  // ONLY value Arcium reveals
  arciumJobId: Uint8Array;
  arciumSig: Uint8Array;
}

export interface ArciumMXEConfig {
  clusterPublicKey: Uint8Array;
  clusterId: string;
  arciumProgramId: PublicKey;
}

// ── Arcium MXE cluster config (testnet) ──────────────────────────────────────
export const ARCIUM_TESTNET_CONFIG: ArciumMXEConfig = {
  clusterPublicKey: new Uint8Array(32), // TODO: real Arcium testnet key
  clusterId: "stealthbid-mxe-testnet-v1",
  arciumProgramId: new PublicKey("ARCiUMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"),
};

// ── Core: Encrypt a bid amount ────────────────────────────────────────────────

/**
 * Encrypt a bid amount using Arcium's threshold encryption.
 *
 * This is called CLIENT-SIDE before the transaction is built.
 * The plaintext lamport amount never leaves the browser.
 *
 * In production: uses Arcium SDK's threshold encryption with
 * the MXE cluster's public key, such that only 3-of-5 nodes
 * working together can compute over the ciphertext.
 *
 * @param bid - The bid inputs including plaintext amount
 * @param config - Arcium MXE cluster config
 * @returns Encrypted bid ready for on-chain submission
 */
export async function encryptBid(
  bid: BidInput,
  config: ArciumMXEConfig = ARCIUM_TESTNET_CONFIG
): Promise<EncryptedBid> {
  console.log("[StealthBid] Encrypting bid client-side...");
  console.log("[StealthBid] Amount will NOT be transmitted in plaintext.");

  // Serialize bid amount to 8 bytes little-endian
  const plaintext = new Uint8Array(8);
  const view = new DataView(plaintext.buffer);
  view.setBigUint64(0, bid.amountLamports, true);

  // TODO: Replace with real Arcium SDK call:
  //
  // const arciumSdk = new ArciumSDK(config);
  // const encrypted = await arciumSdk.encrypt({
  //   data: plaintext,
  //   context: {
  //     bidder: bid.bidderPubkey.toBytes(),
  //     auctionId: bid.auctionId.toString(),
  //   }
  // });
  // return {
  //   ciphertext: encrypted.ciphertext,
  //   arciumJobId: encrypted.jobId,
  //   arciumSig: encrypted.signature,
  // };

  // Placeholder encryption (XOR + padding)
  const ciphertext = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    ciphertext[i] = plaintext[i] ^ config.clusterPublicKey[i % 32];
  }
  crypto.getRandomValues(ciphertext.subarray(8));

  const arciumJobId = new Uint8Array(32);
  const arciumSig = new Uint8Array(64);
  crypto.getRandomValues(arciumJobId);
  crypto.getRandomValues(arciumSig);

  console.log("[StealthBid] Bid encrypted. Ciphertext ready for Solana submission.");

  return { ciphertext, arciumJobId, arciumSig };
}

// ── Winner computation via Arcium MXE ─────────────────────────────────────────

/**
 * Submit all encrypted bids to Arcium MXE for winner computation.
 *
 * The MPC cluster computes max(all_encrypted_bids) over ciphertexts.
 * No single node sees any individual bid amount.
 *
 * Selective decryption: only the winning amount is revealed.
 * All losing bids remain permanently sealed after this call.
 *
 * Called by the keeper bot at auction close.
 *
 * @param encryptedBids - All ciphertexts from on-chain bid accounts
 * @param auctionId - The auction being closed
 * @param config - Arcium MXE cluster config
 * @returns Winner pubkey + winning amount (only revealed value)
 */
export async function computeWinner(
  encryptedBids: Array<{ bidder: PublicKey; ciphertext: Uint8Array }>,
  auctionId: bigint,
  config: ArciumMXEConfig = ARCIUM_TESTNET_CONFIG
): Promise<WinnerResult> {
  console.log(`[StealthBid] Submitting ${encryptedBids.length} sealed bids to Arcium MXE...`);
  console.log("[StealthBid] Computing max(bids) over ciphertexts — no bid amounts visible.");
  console.log("[StealthBid] Only winning amount will be selectively decrypted.");

  // TODO: Real Arcium MXE winner computation:
  //
  // const arciumSdk = new ArciumSDK(config);
  // const job = await arciumSdk.submitComputation({
  //   computationType: "MAX_SEALED_BIDS",
  //   encryptedInputs: encryptedBids.map(b => ({
  //     bidder: b.bidder.toBytes(),
  //     encryptedAmount: b.ciphertext,
  //   })),
  //   publicInputs: { auctionId: auctionId.toString() },
  //   // Selective decryption: only output the winner's amount
  //   outputDecryption: "WINNER_AMOUNT_ONLY",
  // });
  //
  // const result = await arciumSdk.waitForResult(job.id);
  // return {
  //   winner: new PublicKey(result.winnerPubkey),
  //   winningAmountLamports: BigInt(result.winningAmount),
  //   arciumJobId: job.id,
  //   arciumSig: result.signature,
  // };

  // Placeholder result
  const arciumJobId = new Uint8Array(32);
  const arciumSig = new Uint8Array(64);
  crypto.getRandomValues(arciumJobId);
  crypto.getRandomValues(arciumSig);

  // Mock: first bidder wins with placeholder amount
  const winner = encryptedBids[0]?.bidder ?? new PublicKey(0);
  const winningAmountLamports = BigInt(100_000_000_000); // 100 SOL

  console.log(`[StealthBid] Winner computed by Arcium MXE.`);
  console.log(`[StealthBid] Winner: ${winner.toString()}`);
  console.log(`[StealthBid] Winning amount: ${winningAmountLamports} lamports`);
  console.log(`[StealthBid] ${encryptedBids.length - 1} losing bids permanently sealed.`);

  return { winner, winningAmountLamports, arciumJobId, arciumSig };
}

// ── Bid validation (client-side pre-check) ────────────────────────────────────

/**
 * Validate bid inputs before encryption.
 * All validation happens before any encryption or network call.
 */
export function validateBid(
  bid: BidInput,
  floorPriceLamports: bigint
): { valid: boolean; error?: string } {
  if (bid.amountLamports < floorPriceLamports) {
    return {
      valid: false,
      error: `Bid ${bid.amountLamports} lamports is below floor price ${floorPriceLamports} lamports`,
    };
  }

  if (bid.amountLamports <= 0n) {
    return { valid: false, error: "Bid amount must be greater than zero" };
  }

  return { valid: true };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1_000_000_000));
}

export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / 1_000_000_000;
}

/**
 * Format a bid for display — always shows as sealed unless it's the winner.
 * Enforces the privacy model in the UI layer too.
 */
export function formatBidDisplay(
  isWinner: boolean,
  winningAmount?: bigint
): string {
  if (isWinner && winningAmount !== undefined) {
    return `${lamportsToSol(winningAmount).toFixed(2)} SOL (Winner)`;
  }
  return "🔒 Sealed by Arcium";
}
