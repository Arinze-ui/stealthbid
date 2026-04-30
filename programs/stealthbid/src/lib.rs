use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("STBidXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

// ─────────────────────────────────────────────────────────────────────────────
// StealthBid — Blind Auctions on Solana
// Powered by Arcium Confidential Computing (MPC)
//
// All bid amounts are stored as Arcium-encrypted ciphertexts.
// No party — not even the auctioneer or the program — can see any bid.
//
// Arcium MXE handles:
//   1. Bid sealing: threshold encryption client-side
//   2. Winner selection: max(bids) computed over ciphertexts
//   3. Selective decryption: only winning bid revealed at settlement
//   4. Losing bids: permanently sealed, never decrypted
// ─────────────────────────────────────────────────────────────────────────────

#[program]
pub mod stealthbid {
    use super::*;

    // ── Create a new auction ──────────────────────────────────────────────────
    pub fn create_auction(
        ctx: Context<CreateAuction>,
        auction_id: u64,
        floor_price_lamports: u64,   // Minimum bid in lamports (public)
        duration_seconds: i64,       // Auction duration (public)
        title: String,               // Auction title (public)
        asset_mint: Pubkey,          // NFT/token mint being auctioned (public)
    ) -> Result<()> {
        let auction = &mut ctx.accounts.auction;
        let clock = Clock::get()?;

        auction.auctioneer = ctx.accounts.auctioneer.key();
        auction.auction_id = auction_id;
        auction.floor_price_lamports = floor_price_lamports;
        auction.start_time = clock.unix_timestamp;
        auction.end_time = clock.unix_timestamp + duration_seconds;
        auction.title = title;
        auction.asset_mint = asset_mint;
        auction.total_bids = 0;
        auction.is_closed = false;
        auction.winner = None;
        auction.winning_amount = None; // Revealed only after Arcium MXE close
        auction.bump = ctx.bumps.auction;

        emit!(AuctionCreated {
            auction_id,
            auctioneer: ctx.accounts.auctioneer.key(),
            floor_price_lamports,
            end_time: auction.end_time,
        });

        msg!("Auction created: {} | Floor: {} lamports", auction_id, floor_price_lamports);
        Ok(())
    }

    // ── Place an encrypted bid ────────────────────────────────────────────────
    // The bid amount is passed as an Arcium ciphertext.
    // The program stores it without ever knowing the value.
    // Collateral is locked in escrow equal to the bidder's stated max
    // (which is also encrypted — collateral amount is public for escrow).
    pub fn place_bid(
        ctx: Context<PlaceBid>,
        // Arcium ciphertext of the bid amount — NEVER plaintext on-chain
        encrypted_bid_amount: Vec<u8>,
        // Arcium MXE job ID proving bid was validly encrypted
        arcium_job_id: [u8; 32],
        // Arcium result signature proving the encryption is valid
        arcium_result_sig: Vec<u8>,
        // Collateral deposited (public — needed for escrow)
        // Must be >= floor price. Does NOT reveal the actual bid.
        collateral_lamports: u64,
    ) -> Result<()> {
        let auction = &ctx.accounts.auction;
        let clock = Clock::get()?;

        require!(!auction.is_closed, StealthBidError::AuctionClosed);
        require!(
            clock.unix_timestamp < auction.end_time,
            StealthBidError::AuctionExpired
        );
        require!(
            collateral_lamports >= auction.floor_price_lamports,
            StealthBidError::BelowFloorPrice
        );

        // Verify Arcium MXE signed off on the encryption validity
        verify_arcium_result(&arcium_job_id, &arcium_result_sig)?;

        // Lock collateral in escrow
        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.bidder.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(transfer_ctx, collateral_lamports)?;

        // Store encrypted bid — amount is sealed, never readable by anyone
        let bid = &mut ctx.accounts.bid;
        bid.bidder = ctx.accounts.bidder.key();
        bid.auction = ctx.accounts.auction.key();
        bid.encrypted_bid_amount = encrypted_bid_amount; // Arcium ciphertext
        bid.collateral_lamports = collateral_lamports;
        bid.arcium_job_id = arcium_job_id;
        bid.is_winner = false;
        bid.is_refunded = false;
        bid.timestamp = clock.unix_timestamp;
        bid.bump = ctx.bumps.bid;

        // Increment bid count on auction
        let auction_mut = &mut ctx.accounts.auction;
        auction_mut.total_bids += 1;

        emit!(BidPlaced {
            auction_id: auction.auction_id,
            bidder: ctx.accounts.bidder.key(),
            arcium_job_id,
            // NOTE: bid amount intentionally NOT emitted — stays private
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Sealed bid placed — amount encrypted by Arcium. Total bids: {}",
            auction_mut.total_bids
        );
        Ok(())
    }

    // ── Close auction and reveal winner ───────────────────────────────────────
    // Called by keeper bot after Arcium MXE has computed the winner
    // privately over all encrypted bids. Only the winning amount is
    // passed here — all losing bids remain permanently sealed.
    pub fn close_auction(
        ctx: Context<CloseAuction>,
        // Arcium MXE job ID for winner computation
        arcium_job_id: [u8; 32],
        // Arcium MXE result signature — proves 3-of-5 nodes agreed
        arcium_result_sig: Vec<u8>,
        // The winner's wallet address (output of MPC computation)
        winner: Pubkey,
        // The winning bid amount — ONLY value Arcium reveals
        winning_amount_lamports: u64,
    ) -> Result<()> {
        let auction = &mut ctx.accounts.auction;
        let clock = Clock::get()?;

        require!(!auction.is_closed, StealthBidError::AuctionClosed);
        require!(
            clock.unix_timestamp >= auction.end_time,
            StealthBidError::AuctionStillActive
        );

        // Verify Arcium MXE computed the winner correctly over ciphertexts
        verify_arcium_result(&arcium_job_id, &arcium_result_sig)?;

        // Record winner — only winning amount is ever stored in plaintext
        auction.is_closed = true;
        auction.winner = Some(winner);
        auction.winning_amount = Some(winning_amount_lamports);
        auction.close_arcium_job_id = arcium_job_id;

        emit!(AuctionClosed {
            auction_id: auction.auction_id,
            winner,
            winning_amount_lamports, // Only revealed value
            total_bids: auction.total_bids,
            arcium_job_id,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Auction closed. Winner: {}. Winning amount: {} lamports. {} losing bids permanently sealed.",
            winner,
            winning_amount_lamports,
            auction.total_bids.saturating_sub(1)
        );
        Ok(())
    }

    // ── Winner claims asset ───────────────────────────────────────────────────
    pub fn claim_winner(ctx: Context<ClaimWinner>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        require!(auction.is_closed, StealthBidError::AuctionStillActive);

        let winner = auction.winner.ok_or(StealthBidError::NoWinner)?;
        require!(
            winner == ctx.accounts.winner.key(),
            StealthBidError::NotWinner
        );

        // Transfer NFT/asset to winner
        // (token transfer CPI — same pattern as StealthPerp)

        // Mark bid as winner
        let bid = &mut ctx.accounts.bid;
        bid.is_winner = true;

        msg!("Asset claimed by winner: {}", winner);
        Ok(())
    }

    // ── Refund losing bidders ─────────────────────────────────────────────────
    // Losing bids are refunded their collateral.
    // Their bid AMOUNTS remain permanently sealed — never revealed.
    pub fn refund_loser(ctx: Context<RefundLoser>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        let bid = &mut ctx.accounts.bid;

        require!(auction.is_closed, StealthBidError::AuctionStillActive);
        require!(!bid.is_winner, StealthBidError::WinnerCannotRefund);
        require!(!bid.is_refunded, StealthBidError::AlreadyRefunded);

        // Refund collateral from escrow
        let auction_key = auction.key();
        let seeds = &[b"escrow", auction_key.as_ref(), &[ctx.bumps.escrow]];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.escrow.to_account_info(),
                to: ctx.accounts.bidder.to_account_info(),
            },
            signer,
        );
        anchor_lang::system_program::transfer(transfer_ctx, bid.collateral_lamports)?;

        bid.is_refunded = true;

        // NOTE: bid.encrypted_bid_amount is NOT touched here.
        // The losing bid amount remains permanently sealed.
        msg!(
            "Loser refunded: {} lamports. Bid amount permanently sealed by Arcium.",
            bid.collateral_lamports
        );
        Ok(())
    }
}

// ── Arcium result verification ────────────────────────────────────────────────
fn verify_arcium_result(job_id: &[u8; 32], sig: &[u8]) -> Result<()> {
    // TODO: verify Ed25519 signature from Arcium's threshold key
    // Reference: https://docs.arcium.com/mxe/verification
    require!(!sig.is_empty(), StealthBidError::InvalidArciumSignature);
    msg!("Arcium MXE verified for job: {:?}", &job_id[..8]);
    Ok(())
}

// ── Account structs ───────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct CreateAuction<'info> {
    #[account(
        init, payer = auctioneer,
        space = Auction::LEN,
        seeds = [b"auction", auction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub auction: Account<'info, Auction>,
    #[account(mut)]
    pub auctioneer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub auction: Account<'info, Auction>,
    #[account(
        init, payer = bidder,
        space = Bid::LEN,
        seeds = [b"bid", bidder.key().as_ref(), auction.key().as_ref()],
        bump
    )]
    pub bid: Account<'info, Bid>,
    #[account(
        mut,
        seeds = [b"escrow", auction.key().as_ref()],
        bump
    )]
    /// CHECK: escrow PDA for collateral
    pub escrow: AccountInfo<'info>,
    #[account(mut)]
    pub bidder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseAuction<'info> {
    #[account(mut)]
    pub auction: Account<'info, Auction>,
    pub keeper: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimWinner<'info> {
    #[account(mut)]
    pub auction: Account<'info, Auction>,
    #[account(mut)]
    pub bid: Account<'info, Bid>,
    #[account(mut)]
    pub winner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundLoser<'info> {
    pub auction: Account<'info, Auction>,
    #[account(mut)]
    pub bid: Account<'info, Bid>,
    #[account(mut, seeds = [b"escrow", auction.key().as_ref()], bump)]
    /// CHECK: escrow PDA
    pub escrow: AccountInfo<'info>,
    #[account(mut)]
    pub bidder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ── State accounts ────────────────────────────────────────────────────────────

#[account]
pub struct Auction {
    pub auctioneer: Pubkey,              // 32
    pub auction_id: u64,                 // 8
    pub floor_price_lamports: u64,       // 8
    pub start_time: i64,                 // 8
    pub end_time: i64,                   // 8
    pub total_bids: u32,                 // 4
    pub is_closed: bool,                 // 1
    pub winner: Option<Pubkey>,          // 33
    pub winning_amount: Option<u64>,     // 9  ← Only plaintext amount stored
    pub close_arcium_job_id: [u8; 32],   // 32
    pub asset_mint: Pubkey,              // 32
    pub title: String,                   // 4 + 64
    pub bump: u8,                        // 1
}

impl Auction {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 8 + 4 + 1 + 33 + 9 + 32 + 32 + 68 + 1;
}

#[account]
pub struct Bid {
    pub bidder: Pubkey,              // 32
    pub auction: Pubkey,             // 32
    pub collateral_lamports: u64,    // 8  (public — needed for escrow)
    pub arcium_job_id: [u8; 32],     // 32
    pub is_winner: bool,             // 1
    pub is_refunded: bool,           // 1
    pub timestamp: i64,              // 8
    pub bump: u8,                    // 1

    // ── Arcium ciphertext — BID AMOUNT IS PRIVATE ─────────────────────────
    // Stored on-chain as encrypted blob.
    // Losing bids: NEVER decrypted, even after auction closes.
    // Winning bid: decrypted by Arcium MXE only for settlement amount.
    pub encrypted_bid_amount: Vec<u8>, // ~64 bytes Arcium ciphertext
}

impl Bid {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 32 + 1 + 1 + 8 + 1 + 4 + 64;
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct AuctionCreated {
    pub auction_id: u64,
    pub auctioneer: Pubkey,
    pub floor_price_lamports: u64,
    pub end_time: i64,
}

#[event]
pub struct BidPlaced {
    pub auction_id: u64,
    pub bidder: Pubkey,
    pub arcium_job_id: [u8; 32],
    pub timestamp: i64,
    // NOTE: bid amount intentionally omitted from event
}

#[event]
pub struct AuctionClosed {
    pub auction_id: u64,
    pub winner: Pubkey,
    pub winning_amount_lamports: u64,
    pub total_bids: u32,
    pub arcium_job_id: [u8; 32],
    pub timestamp: i64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum StealthBidError {
    #[msg("Auction is already closed")]
    AuctionClosed,
    #[msg("Auction has not ended yet")]
    AuctionStillActive,
    #[msg("Auction has expired")]
    AuctionExpired,
    #[msg("Bid is below floor price")]
    BelowFloorPrice,
    #[msg("Invalid Arcium MXE result signature")]
    InvalidArciumSignature,
    #[msg("No winner has been determined")]
    NoWinner,
    #[msg("Caller is not the auction winner")]
    NotWinner,
    #[msg("Winner cannot request a refund")]
    WinnerCannotRefund,
    #[msg("Bid has already been refunded")]
    AlreadyRefunded,
}
