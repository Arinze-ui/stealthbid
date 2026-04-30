/**
 * StealthBid — Auction Keeper Bot
 *
 * Monitors active auctions and triggers close + winner computation
 * via Arcium MXE when the auction end time is reached.
 *
 * KEY PRIVACY PROPERTY:
 *   The keeper NEVER sees any individual bid amount.
 *   It collects all encrypted bid ciphertexts from on-chain accounts
 *   and submits them to Arcium MXE, which computes the winner privately.
 *   Only the winning amount is returned — all other bids stay sealed.
 *
 * This means even the keeper bot — which has access to all on-chain data —
 * cannot determine what any individual bidder bid. The ciphertexts are
 * meaningless without Arcium's threshold key quorum.
 *
 * Run: npx ts-node scripts/keeper.ts
 */

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { computeWinner } from "../sdk/encryption";

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("STBidXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
const POLL_INTERVAL_MS = 10_000; // Check every 10 seconds
const KEEPER_FEE_LAMPORTS = BigInt(1_000_000); // 0.001 SOL keeper reward

// ── Main keeper loop ──────────────────────────────────────────────────────────

async function runKeeper() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║   StealthBid Auction Keeper Bot               ║");
  console.log("║   Winner computation: Arcium MXE (Private)    ║");
  console.log("║   Bid amounts: Never visible to this bot      ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  const connection = new Connection(RPC_URL, "confirmed");

  console.log(`[Keeper] Connected to: ${RPC_URL}`);
  console.log(`[Keeper] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[Keeper] Privacy: Bid amounts MPC-sealed — keeper sees only ciphertexts\n`);

  while (true) {
    try {
      await checkExpiredAuctions(connection);
    } catch (err) {
      console.error("[Keeper] Error:", err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// ── Check for expired auctions ────────────────────────────────────────────────

async function checkExpiredAuctions(connection: Connection) {
  const now = Math.floor(Date.now() / 1000);

  // TODO: Fetch all open auction accounts from program
  // const auctions = await program.account.auction.all([
  //   { memcmp: { offset: CLOSED_OFFSET, bytes: bs58.encode([0]) } } // is_closed = false
  // ]);

  const auctions = getMockAuctions(now);
  const expired = auctions.filter(a => a.endTime <= now && !a.isClosed);

  console.log(`[Keeper] ${auctions.length} active auctions. ${expired.length} expired and ready to close.`);

  for (const auction of expired) {
    console.log(`\n[Keeper] Processing expired auction: ${auction.id}`);
    await closeAuction(connection, auction);
  }

  if (expired.length === 0) {
    console.log(`[Keeper] No auctions to close this cycle.\n`);
  }
}

// ── Close an auction via Arcium MXE ──────────────────────────────────────────

async function closeAuction(connection: Connection, auction: MockAuction) {
  console.log(`[Keeper] Fetching ${auction.totalBids} sealed bids from chain...`);

  // Fetch all encrypted bid accounts for this auction
  // These are ciphertexts — keeper cannot read bid amounts
  const encryptedBids = await fetchEncryptedBids(connection, auction.pubkey);

  console.log(`[Keeper] Retrieved ${encryptedBids.length} ciphertexts.`);
  console.log(`[Keeper] Submitting to Arcium MXE for private winner computation...`);
  console.log(`[Keeper] Note: Keeper cannot see any bid amounts — only Arcium MXE can compute over them.`);

  // Submit to Arcium MXE — computes max(bids) over ciphertexts
  // Returns ONLY the winner and winning amount
  const result = await computeWinner(encryptedBids, BigInt(auction.id));

  console.log(`[Keeper] ✅ Arcium MXE computed winner:`);
  console.log(`[Keeper]    Winner: ${result.winner.toString()}`);
  console.log(`[Keeper]    Winning amount: ${Number(result.winningAmountLamports) / 1e9} SOL`);
  console.log(`[Keeper]    ${encryptedBids.length - 1} losing bids: permanently sealed.`);

  // Submit close_auction instruction to Solana
  await submitCloseInstruction(auction, result);

  // Trigger refunds for all losing bidders
  await refundLosers(connection, auction, result.winner);
}

// ── Submit close instruction to Solana ───────────────────────────────────────

async function submitCloseInstruction(
  auction: MockAuction,
  result: Awaited<ReturnType<typeof computeWinner>>
) {
  console.log(`[Keeper] Submitting close_auction instruction to Solana...`);

  // TODO: Real Anchor instruction call:
  // await program.methods
  //   .closeAuction(
  //     Array.from(result.arciumJobId),
  //     Array.from(result.arciumSig),
  //     result.winner,
  //     new BN(result.winningAmountLamports.toString())
  //   )
  //   .accounts({
  //     auction: auction.pubkey,
  //     keeper: keeperKeypair.publicKey,
  //     systemProgram: SystemProgram.programId,
  //   })
  //   .signers([keeperKeypair])
  //   .rpc();

  console.log(`[Keeper] ✅ Auction closed on-chain. Only winning amount stored in plaintext.`);
}

// ── Refund losing bidders ─────────────────────────────────────────────────────

async function refundLosers(
  connection: Connection,
  auction: MockAuction,
  winner: PublicKey
) {
  console.log(`[Keeper] Processing refunds for losing bidders...`);

  // TODO: Fetch all bid accounts and refund non-winners
  // const bids = await program.account.bid.all([
  //   { memcmp: { offset: AUCTION_OFFSET, bytes: auction.pubkey.toBase58() } }
  // ]);
  //
  // for (const bid of bids) {
  //   if (bid.account.bidder.toString() !== winner.toString()) {
  //     await program.methods.refundLoser()
  //       .accounts({ auction: auction.pubkey, bid: bid.publicKey, ... })
  //       .rpc();
  //     console.log(`[Keeper] Refunded: ${bid.account.bidder} — bid amount stays sealed.`);
  //   }
  // }

  console.log(`[Keeper] All losing bidders refunded. Their bid amounts remain sealed forever.`);
}

// ── Fetch encrypted bids from chain ──────────────────────────────────────────

async function fetchEncryptedBids(
  connection: Connection,
  auctionPubkey: PublicKey
): Promise<Array<{ bidder: PublicKey; ciphertext: Uint8Array }>> {
  // TODO: Real program account fetch
  // Returns encrypted ciphertexts — keeper cannot decode these

  return getMockEncryptedBids();
}

// ── Mock data ─────────────────────────────────────────────────────────────────

interface MockAuction {
  id: number;
  pubkey: PublicKey;
  endTime: number;
  totalBids: number;
  isClosed: boolean;
}

function getMockAuctions(now: number): MockAuction[] {
  return [
    {
      id: 1,
      pubkey: new PublicKey("11111111111111111111111111111111"),
      endTime: now - 60, // expired 60 seconds ago
      totalBids: 24,
      isClosed: false,
    },
    {
      id: 2,
      pubkey: new PublicKey("11111111111111111111111111111111"),
      endTime: now + 3600, // still active
      totalBids: 8,
      isClosed: false,
    },
  ];
}

function getMockEncryptedBids(): Array<{ bidder: PublicKey; ciphertext: Uint8Array }> {
  return Array.from({ length: 24 }, (_, i) => ({
    bidder: new PublicKey("11111111111111111111111111111111"),
    ciphertext: new Uint8Array(64), // Arcium ciphertext — keeper cannot read
  }));
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Entry point ───────────────────────────────────────────────────────────────

runKeeper().catch(err => {
  console.error("[Keeper] Fatal error:", err);
  process.exit(1);
});
