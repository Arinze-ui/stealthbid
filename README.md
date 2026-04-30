# 🔨 StealthBid
### Blind Auctions on Solana — powered by Arcium Confidential Computing

![Solana](https://img.shields.io/badge/Solana-9945FF?style=flat&logo=solana&logoColor=white)
![Arcium](https://img.shields.io/badge/Arcium_MPC-6B3FD4?style=flat&logoColor=white)
![Anchor](https://img.shields.io/badge/Anchor-1E7EF5?style=flat&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-B7410E?style=flat&logo=rust&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-2F7DC6?style=flat&logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-22863A?style=flat)

---

## Overview

StealthBid is a blind auction protocol on Solana that uses **Arcium's Multiparty Computation (MPC)** network to keep all bids encrypted until the auction closes. Only the winning bid amount is revealed at settlement — all losing bids remain permanently sealed.

On traditional on-chain auctions, every bid is publicly visible in real time. This creates three critical problems:

- **Bid sniping** — bidders watch others and place last-second higher bids
- **Collusion** — coordinated bidders share information to suppress prices
- **MEV extraction** — validators and bots front-run visible bid transactions

StealthBid eliminates all three by routing bid submission and winner selection through Arcium's encrypted MPC environment, where no party can observe any bid amount.

---

## Privacy Comparison

| Attack Vector | Traditional Auction | StealthBid + Arcium |
|---|---|---|
| Bid Sniping | ❌ All bids visible in real time | ✅ All bids MPC-sealed until close |
| Collusion | ❌ Participants share bid info | ✅ Cryptographically impossible |
| MEV Extraction | ❌ Bids visible to validators | ✅ Ciphertexts only — nothing to front-run |
| Auctioneer Manipulation | ❌ Auctioneer sees all bids | ✅ Even auctioneer cannot see bids |
| Losing Bid Exposure | ❌ All bids revealed at close | ✅ Only winning bid revealed |
| Fair Price Discovery | ❌ Strategic bidding distorts price | ✅ True valuation bidding enabled |

---

## How Arcium is Used

Arcium's **MXE (Multiparty Execution)** environment is integrated at two critical points:

### 1. Encrypted Bid Submission
When a bidder submits a bid, the amount is encrypted **client-side** in the browser using Arcium's threshold encryption key before the transaction is signed. The plaintext bid amount never leaves the user's device. Only a ciphertext is posted to the Solana program.

### 2. Private Winner Selection
When the auction closes, Arcium's MXE cluster receives all encrypted bids and jointly computes the maximum across **3-of-5 MPC nodes** — entirely over ciphertexts. No single node can see any individual bid. The cluster outputs only the winning bid commitment, which is then selectively decrypted for settlement.

### What This Means
- Bidders can submit their **true valuation** without strategic games
- The auctioneer **cannot manipulate** results — they never see bids
- Losing bidders' amounts are **permanently sealed** — never revealed
- MEV bots see only ciphertexts — **nothing to extract**

---

## Auction Lifecycle

| # | Actor | Action |
|---|---|---|
| 1 | Auctioneer | Creates auction on-chain via Anchor program. Sets floor price, duration, and asset to auction. |
| 2 | Bidder (Browser) | Encrypts bid amount with Arcium threshold key client-side. Submits ciphertext + collateral to Solana program. |
| 3 | Solana Program | Records encrypted bid commitment on-chain. All bids appear equal — amounts are sealed ciphertexts. |
| 4 | Arcium MXE | At auction close: 3-of-5 MPC nodes jointly compute max(all encrypted bids). No node sees individual bids. |
| 5 | Arcium MXE | Selectively decrypts only the winning bid amount. All losing bids remain permanently encrypted. |
| 6 | Solana Program | Transfers asset to winner. Settles payment from escrow. Refunds all losing bidders their collateral. |

---

## Architecture

| Component | Technology | Privacy Role |
|---|---|---|
| Smart Contract | Anchor (Rust) on Solana | Stores encrypted bid commitments, manages escrow |
| MPC Engine | Arcium MXE cluster | Computes winner over ciphertexts, selective decryption |
| Auction Keeper | TypeScript + Arcium SDK | Triggers close and winner computation |
| Frontend | HTML + Solana Wallet Adapter | Client-side encryption before any network call |
| Price Oracle | Pyth Network | Optional floor price validation |

---

## Repository Structure

```
stealthbid/
├── app/
│   └── index.html                # Auction UI (live demo)
├── programs/stealthbid/
│   └── src/
│       ├── lib.rs                # Anchor program entry point
│       ├── instructions/         # create_auction, place_bid, close_auction, claim
│       └── state/                # Auction, EncryptedBid accounts
├── sdk/
│   ├── encryption.ts             # Arcium threshold bid encryption
│   ├── arcium.ts                 # MXE job submission & winner computation
│   └── client.ts                 # StealthBid auction client
├── scripts/
│   ├── keeper.ts                 # Auction close keeper bot
│   └── deploy.sh                 # Devnet deployment
└── tests/                        # Integration tests
```

---

## What Stays Private vs Public

| 🔒 Private (MPC-sealed) | 🌐 Public |
|---|---|
| All bid amounts | Number of bidders |
| Losing bid amounts (forever) | Auction floor price |
| Bidder valuations | Auction close time |
| Bid strategies | Winning bid amount (at close only) |
| Second-highest bid | Winner's wallet address |

---

## Getting Started

### Prerequisites
- Node.js >= 18 and Yarn
- Rust toolchain (`rustup install stable`)
- Solana CLI >= 1.18
- Anchor CLI >= 0.30
- Arcium CLI + MXE cluster key

### Install
```bash
git clone https://github.com/Arinze-ui/stealthbid
cd stealthbid && yarn install
anchor build
arcium init --cluster testnet
```

### Deploy to Devnet
```bash
solana config set --url devnet
anchor deploy --provider.cluster devnet
yarn ts-node scripts/initialize.ts
```

### Run Frontend
```bash
cd app && yarn dev
# or open index.html directly in browser
```

### Run Keeper Bot
```bash
yarn ts-node scripts/keeper.ts
```

---

## Live Demo
🔗 [https://arinze-ui.github.io/stealthbid](https://arinze-ui.github.io/stealthbid)

---

## Judging Criteria

| Criterion | StealthBid's Response |
|---|---|
| **Innovation** | First blind auction protocol on Solana where even the auctioneer cannot see bids. Losing bid amounts are permanently sealed — never revealed even after close. |
| **Technical Implementation** | Anchor program with encrypted bid storage + Arcium MXE for private winner selection. TypeScript SDK with client-side threshold encryption. Keeper bot for auction close. |
| **User Experience** | Encryption is fully invisible to bidders. Standard auction UI — submit a bid amount, done. The privacy layer requires zero extra steps from the user. |
| **Impact** | Unlocks fair price discovery for NFTs, token launches, real estate, and any high-value asset auction on Solana. Removes all incentive for strategic bidding games. |
| **Clarity** | README, inline comments, and lifecycle table all explain Arcium's role at each step. Privacy guarantees are specific and cryptographically grounded. |

---

## Links
- [Arcium Documentation](https://docs.arcium.com)
- [Solana Developer Docs](https://docs.solana.com)
- [Anchor Framework](https://anchor-lang.com)
- [Live Demo](https://arinze-ui.github.io/stealthbid)

---

## License
MIT — Built for the Arcium Hackathon · Solana · 2025
