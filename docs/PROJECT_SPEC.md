# Relay | Dynamic AI Compute Marketplace

## Overview
Relay is a financial clearinghouse for AI compute. Buyers and providers can discover, negotiate, and exchange compute commitments, including deals that depend on several participants agreeing at once. Relay searches for arrangements that create value, coordinates approvals and provisional reservations, and connects financial settlement to actual workload execution.

The broader vision is a marketplace for available GPU/CPU resources and transferable compute commitments. The key differentiator to test is **conditional multi-party clearing across participating providers**, not ordinary GPU rental, spot bidding, or resale.

## Problem and target users
GPU buyers may hold capacity that no longer matches their workload, while others need capacity urgently. Simple resales or independent purchases may fail when each participant needs another part of the deal guaranteed before committing. Relay targets AI teams with variable compute demand and compute operators that authorize capacity reassignment.

**Important limitation:** A rented instance is not automatically transferable. All transfers require resource control or provider authorization. Relay's MVP represents agreements and payments using test funds and makes no production guarantee of atomic GPU migration.

## Core product flow
1. **Supply and demand:** Providers connect an authorized worker or publish an eligible offer. Buyers specify workload requirements, timing, budget, and flexibility.
2. **Discovery:** Apify collects public market reference prices; the platform separately tracks executable inventory from connected workers and participating providers.
3. **Deal search:** The economic engine considers independent purchases, direct resale, and conditional multi-party exchanges. It checks hardware compatibility, price, deadlines, provider permissions, and switching overhead.
4. **Negotiation:** CREAO agents investigate possibilities, convey proposed terms, request approvals, and surface exceptions. The deterministic engine, not an LLM, calculates feasibility and allocations.
5. **Commit:** Relay records agreed terms and secures provisional capacity reservations and authorized payment commitments before altering allocations.
6. **Execute:** Workers run supported jobs, release or reassign capacity when feasible, and report progress and proof of delivery.
7. **Settle:** Verified delivery events determine test payments or compensation and a transaction audit trail.

### Example scenario
Buyer A occupies capacity but can shift a restartable batch job. Buyer B needs A's capacity urgently. Provider C has compatible, lower-priced capacity. Relay checks whether the move is worthwhile, obtains approval from all affected parties, reserves C, moves or restarts A's eligible work, assigns B, and settles compensation only according to agreed verification rules. If requirements cannot be met, it falls back or cancels safely.

## MVP demonstration
Demonstrate **one real conditional exchange** and compare it with a direct-rental or simple-resale baseline. Connect two or more real worker processes (separate computers if available), use a predefined restartable workload, and show market intelligence, negotiation, reservations, execution changes, verified results, and test settlement.

Show explicitly which values are real measured execution data, publicly advertised prices, participant-entered bids, or test payments. No arbitrary untrusted code on personal machines and no unsupported promise of general-purpose GPU live migration.

## Integrations and responsibilities

| Tool / track | What it does in Relay | Meaningful proof |
|---|---|---|
| **Apify** | Runs a scheduled/custom Actor to gather permitted public GPU rental listings, advertised price, hardware, location, and timestamp. Normalizes results and passes them to the market data ingestion API. | Live sourced records with provenance and freshness; they inform comparisons, not falsely represented as executable offers. |
| **Tiger Data (TimescaleDB)** | System of record for market observations, time-series worker telemetry, job events, offers, reservations, and settlement audit references. Continuous aggregates support pricing trends and reliability/utilization views. | Price history and measured worker status affecting a decision, with queryable event history. |
| **Hyphenate prize concept** | Relay's autonomous financial workflows: budget-limited procurement, comparison of feasible deals, conditional commitments, and auditable decisions. Hyphenate is a prize track; verify whether specific products are required. | A financially beneficial deal calculated and fulfilled under policy limits. |
| **CREAO** | Agent-based deal investigation and coordination: ask for missing terms, summarize feasible offers, negotiate within approved boundaries, and request human approvals or exception resolution. | An agent carries a multi-party workflow forward using APIs, rather than merely generating a chat summary. |
| **Solana (devnet)** | Auditable test settlement for capacity exchanges or verified work. Store hashes/identifiers and payment transactions on-chain; scheduling and private details stay off-chain. | A linked on-chain test transaction corresponding to a verified delivery record. |
| **Coinbase x402** | Optional API payment flow for an autonomous buyer purchasing a defined compute service. x402 defines the payment handshake; Solana can serve as a supported settlement network if the chosen implementation supports it. | Real payment-protocol request and test payment authorization, not a decorative wallet balance. |
| **Figma** | Design marketplace, buyer intent flow, active commitments, deal explanation, execution monitor, and settlement history. Apply in the implemented web frontend. | Strong user comprehension and cohesive polished UI; check any Figma-specific award requirements. |
| **Visa Reimagining Shopping** | Present compute procurement as a new commerce flow: compare compatible offers, negotiate terms, and complete an approved purchase. This is a prize alignment, not a claimed Visa API integration. | End-to-end purchasing flow with clear price, rights, and fulfillment conditions. |
| **GoDaddy Registry** | Register a distinctive eligible domain and host the public-facing experience. Verify applicable TLD and contest terms. | Working registered domain that fits the product identity. |

**Other natural award targets:** Microsoft Built for the Real World, Most Technically Advanced, Most Creative, and possibly Microsoft Customer Impact. Do not add unrelated technology solely to collect tracks.

## Architecture
- **Web:** Next.js/TypeScript; buyer/provider marketplace, deal review, execution and settlement views.
- **API:** FastAPI or Node backend managing identity, offers, workflows, reservations, jobs, and audit logs.
- **Economic engine:** Deterministic allocation solver (e.g., OR-Tools). Evaluate feasible deal bundles with objective of net economic surplus after migration, retry, and coordination costs. Disallow allocations violating budgets, compatibility, deadlines, or authorization.
- **Workers:** Lightweight Python client for approved workload templates, leases/heartbeats, task-level checkpoints, verification, and event reporting.
- **Data:** Tiger Data for relational transactions and time series; Apify collectors feed normalized external observations.
- **Agent and payments:** CREAO coordinates approved steps; x402 handles suitable automated service purchases; Solana devnet stores settlement confirmations.

## Shared interfaces (define before parallel work)
All teams use stable UUID strings, ISO 8601 timestamps in UTC, currency amounts as integer minor units, and explicit status enums. Suggested common objects:

- `Provider`: id, hardware, location, allowed_workloads, availability, price_model, permissions.
- `MarketOffer`: id, provider_id, source (`worker` or `external_reference`), GPU/CPU specs, rate, observed_at, expires_at, executable.
- `Workload`: id, buyer_id, type, resource_constraints, budget_minor, deadline, flexibility, state.
- `Commitment`: id, workload_id, offer_id, time_window, rights, reservation_status.
- `DealProposal`: id, parties, required_commitments, proposed_transfers, compensation, projected_surplus, approval_status.
- `ExecutionEvent`: id, workload_id, worker_id, event_type, measured_at, proof_reference.
- `Settlement`: id, deal_id, delivery_verification_id, amount_minor, chain, tx_id, status.

Minimal API endpoints (mock implementations permitted before integration):
`GET /market/offers`, `POST /workloads`, `POST /deals/search`, `POST /deals/{id}/approve`, `POST /deals/{id}/commit`, `GET /deals/{id}`, `GET /workloads/{id}/events`, `POST /workers/heartbeat`, `POST /workers/events`, `POST /settlements`, `GET /market/history`.

Publish OpenAPI schemas and fixtures in a shared `/contracts` folder. Define idempotency keys for commit and settlement actions. Only backend services can finalize a reservation or authorize funds.

## Milestones and integration checks

**M0 | Contracts and skeleton:** Agree on states, schemas, endpoint owners, and one test scenario. Frontend and other services can consume fixture data immediately.

**M1 | Single-provider execution:** One authorized worker registers, receives a predefined job, runs it, and reports real completion telemetry. Display results in the web UI and Tiger Data.

**M2 | Price discovery and deal calculation:** Apify ingests sourced offers. The solver compares baseline individual transactions against a coordinated proposal and displays economic assumptions, switching costs, and constraints.

**M3 | Coordinated exchange:** Two or more parties approve a conditional arrangement. The platform reserves capacity, executes the supported handoff or task-level restart, and confirms delivery or follows a defined fallback.

**M4 | Financial and agent flow:** CREAO coordinates approval steps. A verified event triggers Solana devnet settlement; use x402 for a separate valid machine-initiated compute-service purchase if it fits.

**M5 | Demo hardening:** Run the end-to-end scenario repeatedly, test one failed reservation and one worker dropout, capture a fallback video, and report net value against direct purchase/resale baselines.

## Non-goals and truthful claims
Not a production exchange, real-money derivatives market, arbitrary-code execution platform, or universally portable GPU checkpoint system. A multi-provider deal is staged and recoverable, not perfectly atomic across infrastructure. Public listing prices are not confirmed inventory, synthetic bids are not live market trades, and test settlements are not real revenue. Our novelty is a **hypothesis**: conditional multi-party clearing plus verifiable execution may unlock useful deals that simpler rentals and brokers cannot.

## Success criteria
One working end-to-end exchange on real workers; correct approvals and conditional commitments; reproducible execution evidence; verifiable test settlement; and a transparent economic comparison against independent purchasing or resale that includes migration and recovery costs. If the coordinated deal does not beat those baselines, show that result honestly and explain when the mechanism is useful.
