<div align="center">

# ZK Resistor

**Trustless ZK Privacy Protocol on TON Blockchain**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TON](https://img.shields.io/badge/TON-Blockchain-0098EA)](https://ton.org)
[![Groth16](https://img.shields.io/badge/ZK-Groth16-green)](https://eprint.iacr.org/2016/260)
[![BLS12-381](https://img.shields.io/badge/Curve-BLS12--381-purple)](https://electriccoin.co/blog/new-snark-curve/)

Deposit and withdraw REDO tokens with complete privacy using Zero-Knowledge Proofs.

[Live App](https://pool.resistance.dog) | [Contract](https://tonviewer.com/EQBUH-7pbBjvVKXe7FjPnCSIJ2vvUedfJmjoWdKfLYMC_1KF) | [Community](https://t.me/zkproof)

</div>

---

## About

ZK Resistor is a privacy mixer for REDO tokens on TON. Deposit 100 REDO, receive a secret. Later, use that secret to withdraw to any wallet. Zero-knowledge proofs ensure no one can link your deposit to your withdrawal.

- **Trustless** - Groth16 proofs verified on-chain via native TVM BLS12-381 opcodes
- **Non-custodial** - Only you can withdraw your funds (requires your secret)
- **Private** - Cryptographic unlinkability between deposits and withdrawals

**Goal:** Evolve into a complete privacy infrastructure for TON. Permissionless pool deployment for any Jetton. Gasless withdrawals via decentralized relayer network. Private cross-pool swaps executed off-chain through TON Payment Network channels - trustless, untraceable, cryptographically secured.

## Table of Contents

- [Mainnet Deployment](#mainnet-deployment-v11)
- [Tech Stack](#tech-stack)
- [How It Works](#how-it-works)
- [Smart Contract Operations](#smart-contract-operations)
- [Transaction Costs](#transaction-costs)
- [Privacy Best Practices](#privacy-best-practices)
- [Trust Model](#trust-model)
- [Roadmap](#roadmap)
- [Vision](#vision-privacy-infrastructure-for-ton)
- [Why $REDO?](#why-redo)
- [Links](#links)

---

## Mainnet Deployment v1.1

| Component | Address |
|-----------|---------|
| Mixer Contract | `EQBUH-7pbBjvVKXe7FjPnCSIJ2vvUedfJmjoWdKfLYMC_1KF` |
| Mixer Jetton Wallet | `EQDau73gHBXP1jeZ1RsRrUEI90zYn1UPrLLg_suLDylWFy1F` |
| REDO Jetton Master | `EQBZ_cafPyDr5KUTs0aNxh0ZTDhkpEZONmLJA2SNGlLm4Cko` |
| Code Hash | `89a11636da7040a870b5bf727d952fd9cc096fd30c7ee42bf0f9ef7a980cf7a4` |
| Deposit Amount | 100 REDO |
| Protocol Fee | 0.1 TON |
| Pool Capacity | 1024 deposits (depth 10) |

## Tech Stack

| Component | Technology |
|-----------|------------|
| ZK Proofs | Groth16 on BLS12-381 (TON native) |
| Hash | Poseidon BLS12-381 |
| Smart Contracts | FunC + TVM BLS opcodes |
| Frontend | Telegram Mini App + TonConnect |
| Backend | Node.js + Express |

## How It Works

1. **Deposit** - Generate a secret, compute `commitment = Poseidon(secret, nullifier)`, send 100 REDO + 0.1 TON fee
2. **Withdraw** - Generate a ZK proof that you know a secret in the Merkle tree, without revealing which one
3. **Privacy** - The link between deposit and withdrawal is cryptographically hidden

## Smart Contract Operations

| Operation | Op Code | Description |
|-----------|---------|-------------|
| `deposit` | `0x1` | Called via jetton `transfer_notification`, stores commitment |
| `withdraw` | `0x2` | Verifies Groth16 proof, sends REDO to recipient |
| `update_root` | `0x3` | Admin syncs Merkle root from backend |
| `set_jetton_wallet` | `0x4` | One-time admin setup |
| `event::deposit` | `0xde9051` | External message log for indexers |
| `event::withdraw` | `0x717d3a` | External message log for indexers |

## Transaction Costs

| Operation | Gas | Fees |
|-----------|-----|------|
| Deposit | ~6,000 | ~0.01 TON + 0.1 TON protocol fee |
| Withdraw | ~135,000 | ~0.05 TON |
| Root sync | ~5,000 | ~0.002 TON |

## Privacy Best Practices

| Practice | Why |
|----------|-----|
| Use a fresh wallet for withdrawal | Avoids linking deposit and withdrawal addresses |
| Wait before withdrawing | More deposits in between = larger anonymity set |
| Don't withdraw immediately after deposit | Timing analysis can reduce privacy |
| Use different IP/network for withdraw | Prevents IP correlation |

## Trust Model

### V1.1 Beta (Current) - Proof of Concept

This release validates the core ZK privacy architecture on TON. Backend handles Merkle tree computation while Poseidon BLS12-381 FunC implementation is finalized.

| Component | Trust Level | Details |
|-----------|-------------|---------|
| **Deposits** | Trustless | Commitments stored on-chain. Funds held by contract. |
| **Withdrawals** | Trustless | Groth16 proof verified on-chain via BLS12-381 pairing. |
| **Merkle root** | Semi-trusted | Backend computes Poseidon hash, admin syncs to contract. |
| **Funds** | Trustless | Admin cannot access funds. Requires your secret + nullifier. |

**Current limitation:** Admin can delay root sync (temporary withdrawal delay).

**Funds are NEVER at risk.** Commitments are stored on-chain at deposit. Even if backend goes offline, the Merkle tree can be reconstructed from on-chain data.

### V1.2 Beta (Next) - Fully Trustless

Poseidon BLS12-381 hash is already implemented in our Circom circuits. V1.2 ports this to FunC for on-chain Merkle tree computation.

- Contract computes Merkle root on deposit (no backend dependency)
- Eliminates admin role for root updates
- Fully trustless, fully on-chain

## Roadmap

### V1 - ZK Resistor Protocol (Current)

Core ZK privacy infrastructure on TON.

- [x] **Groth16 ZK-SNARK verifier** - On-chain proof verification via native TVM BLS12-381 opcodes
- [x] **Poseidon BLS12-381 hash** - Circuit-friendly hash for commitments and Merkle tree
- [x] **Circom circuits** - withdraw_poseidon.circom with 5 public inputs, 13 private inputs
- [x] **FunC smart contract** - Mixer with embedded verifier, nullifier tracking, root history
- [x] **100 REDO pool** - Depth 10, 1024 deposits max
- [x] **Blockchain indexer** - Auto-sync deposits from on-chain events
- [x] **Event logs** - External message logs for third-party indexers
- [ ] **On-chain Poseidon Merkle tree** - Fully trustless, no backend dependency
- [ ] **1,000 / 10,000 REDO pools** - Depth 20, 1M deposits max

### V2 - Resistor Network

Decentralized relayer network built on TON infrastructure.

- [ ] **Relayer nodes** - Operators run nodes on TON network
- [ ] **Gasless withdrawals** - Users submit ZK proofs, relayers broadcast TX
- [ ] **Garlic routing** - Multi-hop relay for metadata privacy
- [ ] **ADNL/RLDP integration** - Native TON P2P for node discovery

### V3 - Resistor Factory

Permissionless privacy pool deployment for any Jetton.

- [ ] **Factory contract** - Deploy mixer for any token
- [ ] **Configurable pools** - Amount, depth, fees
- [ ] **Pool registry** - Discovery and verification

### V4 - Private Swaps

Trustless cross-pool swaps via Resistor Network.

- [ ] **Atomic cross-pool swaps** - Swap between any Jetton privacy pools
- [ ] **Off-chain execution** - Swaps via TON Payment Network channels with on-chain settlement
- [ ] **Decentralized** - No central server, nodes coordinate via ADNL P2P
- [ ] **Untraceable** - No on-chain link between input and output token
- [ ] **Trustless** - HTLC guarantees, disputes resolved on-chain
- [ ] **Relayer liquidity** - Nodes provide cross-pool liquidity

Deposit Token A, withdraw Token B. Swap happens off-chain through decentralized payment channels - fast, private, cryptographically secured by TON.

## Vision: Privacy Infrastructure for TON

ZK Resistor evolves from a single mixer to a complete **privacy infrastructure layer** for the TON ecosystem.

**On-chain (TON Blockchain)**
- Smart contracts hold funds and verify ZK proofs
- Groth16 verification via native BLS12-381 TVM opcodes
- Commitments and nullifiers stored immutably
- Permissionless: anyone can deploy a privacy pool for any Jetton
- Trustless: no admin can access funds or link transactions

**Off-chain (TON Network)**
- Resistor Network nodes communicate via ADNL protocol
- Payment channels enable instant, private cross-pool swaps
- Garlic routing obscures transaction metadata
- Cryptographically secured: HTLC guarantees atomicity, disputes settle on-chain
- Decentralized: no central coordinator, nodes discover peers via DHT

### Security Model

| Layer | Security Guarantee |
|-------|-------------------|
| **Funds** | Secured by smart contracts. Withdrawal requires valid ZK proof (only owner has secret). |
| **Privacy** | Zero-knowledge proofs hide deposit-withdrawal link. Off-chain swaps leave no on-chain trace. |
| **Off-chain** | TON Payment Network channels with on-chain settlement. Funds cannot be stolen - only delayed. |
| **Network** | Decentralized P2P. No single point of failure. Censorship resistant. |

### End State

Any Jetton can have privacy. Users deposit any token into its privacy pool, swap privately between pools through the Resistor Network, and withdraw any token to any wallet. On-chain observers see only isolated, unlinkable transactions. Off-chain activity is invisible and untraceable.

## Why $REDO?

Resistance Dog ($REDO) is more than a memecoin - it's a symbol of digital resistance.

In 2018, when the Russian government attempted to block Telegram, Pavel Durov hand-drew the iconic hooded dog as a symbol of defiance against censorship. $REDO was created on TON in January 2024 as a community-driven tribute to these principles of freedom and privacy.

**ZK Resistor uses $REDO because privacy is resistance.**

## Acknowledgments

- [Tornado Cash](https://github.com/tornadocash) - Original mixer design
- [Tonnel Network](https://tonnel.network) - ZK privacy pioneer on TON
- [iden3](https://github.com/iden3) - Circom & snarkjs
- [TON Foundation](https://ton.org) - BLS12-381 TVM opcodes
- [Resistance Dog](https://resistance.dog) - $REDO token

## Links

- [Live App](https://pool.resistance.dog)
- [Telegram Bot](https://t.me/ZkResistorBot)
- [Community](https://t.me/zkproof)
- [Contract on Tonviewer](https://tonviewer.com/EQBUH-7pbBjvVKXe7FjPnCSIJ2vvUedfJmjoWdKfLYMC_1KF)

## Disclaimer

This is experimental software in public beta. Not audited. Use at your own risk.

## License

[MIT](LICENSE)
