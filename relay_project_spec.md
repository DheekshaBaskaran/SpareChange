# Relay | Dynamic AI Compute Marketplace

## Overview
Relay is a financial clearinghouse for AI compute. Buyers and providers can discover, negotiate, and exchange compute commitments, including deals that depend on several participants agreeing at once. Relay searches for arrangements that create value, coordinates approvals and provisional reservations, and connects financial settlement to actual workload execution.

The broader vision is a marketplace for available GPU/CPU resources and transferable compute commitments. The key differentiator to test is **conditional multi-party clearing across participating providers**, not ordinary GPU rental, spot bidding, or resale.

## Finalized architecture: two duos, strict boundaries

Relay is delivered by two parallel duos. The split is an integration boundary, not a suggestion: each side owns its datastore and writes, and the other side consumes a published contract.

**Duo 1 — Marketplace & Financial Intelligence**
- **Person A:** Apify GPU Market Intelligence Actor, real provider adapters, normalization, deduplication, historical pricing analytics, Tiger Data schema and market APIs.
- **Person B:** market-clearing optimization, Hyphenate-aligned autonomous finance, CREAO agent coordination, and the Elastic Agent Builder financial investigation agent.

**Duo 2 — Compute Execution, Payments & Frontend**
- Vultr + Docker compute execution, Solana settlement, Coinbase x402 machine purchases, Figma design, and the marketplace frontend.

### Integration boundaries
- **Tiger Data is the canonical system of record** for market observations, offers, workloads, commitments, executions, and settlement references. Elasticsearch indexes selected records for retrieval; it never becomes the source of truth and never writes back into Tiger Data.
- **Duo 1 owns the market-intelligence tables and the `/v1/market/*` API.** Duo 2 and other consumers call that API read-only. They do not insert, update, or migrate market tables.
- **Duo 2 owns execution, x402 purchasing, Solana settlement, and the frontend.** Duo 1 does not modify those services, ledger entries, or payment state.
- **Person B owns the financial optimization, CREAO orchestration, Hyphenate policy/ledger workflow, and Elastic agent.** Duo 1 publishes normalized market offers and historical analytics; Person B consumes them through the stable contract and never scrapes provider pages directly.
- **Financial state and market state are separate.** A public listing is a reference price, not executable inventory. Only an authorized worker or provider reservation can create executable capacity, and only the backend can finalize a reservation or authorize funds.
- **Evidence crosses boundaries by identifier.** Elastic documents and CREAO workflows reference canonical IDs (offer, workload, deal, execution, settlement) rather than copying mutable financial state.
- **Credentials are environment variables.** No provider key, database URL, or payment secret is committed. Each side supplies its own credentials at runtime.

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

| Tool / track | Owner | What it does in Relay | Meaningful proof |
|---|---|---|---|
| **Apify** | Duo 1 / Person A | Runs a scheduled/custom GPU Market Intelligence Actor that gathers permitted public GPU rental listings, advertised price, hardware, location, and timestamp. The actor normalizes records and can POST them to the ingestion API. | Live sourced records with provenance and freshness; they inform comparisons, not falsely represented as executable offers. |
| **Tiger Data (TimescaleDB)** | Duo 1 / Person A | **Canonical relational and time-series database.** Stores market observations, normalized offers, provider health, ingestion runs, time-series worker telemetry, job events, reservations, and settlement audit references. Hypertables, continuous aggregates, and retention policies support pricing trends and reliability views. | Price history and measured worker status affecting a decision, with queryable event history. |
| **Elastic Agent Builder on Elasticsearch Serverless** | Duo 1 / Person B | Specialized **financial investigation agent** that retrieves evidence from indexed agreements, invoices, usage records, and payment events. Elastic receives a read-only projection of selected Tiger Data records plus document evidence; it answers “why is this charge here?” with citations, and never mutates financial state. | An investigator agent answers a reconciliation question by citing indexed agreement, usage, and payment-event evidence, with IDs traced back to Tiger Data. |
| **CREAO** | Duo 1 / Person B | Autonomous negotiation, multi-party agreement coordination, financial workflow orchestration, and approval escalation. CREAO moves a deal through explicit states, asks for missing terms, negotiates within approved bounds, and escalates exceptions to a human; the deterministic solver remains the authority on feasibility and allocation. | CREAO executes a multi-party workflow through APIs with recorded approvals and escalation, not merely a chat summary. |
| **Hyphenate (prize track)** | Duo 1 / Person B | Autonomous finance workflow aligned to the Hyphenate track: real double-entry accounting, invoice reconciliation, approval policies, separation of duties, and immutable audit trails around procurement and settlement. Hyphenate is a **prize track, not necessarily a required API integration**; the workflow must stand on its own with correct accounting semantics. | Balanced double-entry ledger, reconciled invoice, policy-gated approval, and a complete audit trail for a Relay purchase. |
| **Solana (devnet)** | Duo 2 | Authorized marketplace settlement for capacity exchanges or verified work. Store hashes/identifiers and payment transactions on-chain; scheduling and private details stay off-chain. | A linked on-chain test transaction corresponding to a verified delivery record. |
| **Coinbase x402** | Duo 2 | Autonomous machine-to-machine purchases for a defined compute service. x402 defines the payment handshake; the purchase is initiated by an agent under an approved budget. | Real x402 request and test payment authorization, not a decorative wallet balance. |
| **Vultr + Docker** | Duo 2 | Real compute execution and verifiable workload usage. Dockerized workloads run on Vultr instances; the worker reports measured start/stop, resource use, and a completion proof. | A workload actually executed on Vultr, with provider-side instance evidence and measured usage. |
| **Figma** | Duo 2 | Design marketplace, buyer intent flow, active commitments, deal explanation, execution monitor, and settlement history. Apply in the implemented web frontend. | Strong user comprehension and cohesive polished UI; check any Figma-specific award requirements. |
| **Visa Reimagining Shopping** | Duo 2 (narrative) | Present compute procurement as a new commerce flow: compare compatible offers, negotiate terms, and complete an approved purchase. This is a prize alignment, not a claimed Visa API integration. | End-to-end purchasing flow with clear price, rights, and fulfillment conditions. |
| **GoDaddy Registry** | Duo 2 | Register a distinctive eligible domain and host the public-facing experience. Verify applicable TLD and contest terms. | Working registered domain that fits the product identity. |

**Other natural award targets:** Microsoft Built for the Real World, Most Technically Advanced, Most Creative, and possibly Microsoft Customer Impact. Do not add unrelated technology solely to collect tracks.

## Architecture

### Services
- **Market Intelligence service (Duo 1 / Person A):** Python/FastAPI service owning the market schema, Apify actor orchestration, provider adapters, normalization, deduplication, freshness, and historical analytics. It is the only writer to market tables and publishes the `/v1/market/*` contract.
- **GPU Market Intelligence Actor (Duo 1 / Person A):** deployable Apify Actor. Collects permitted public listings from Vast.ai, RunPod, Lambda, and TensorDock where public data or credentials permit; emits normalized records with source URL, observed timestamp, and raw payload hash.
- **Financial intelligence and agent services (Duo 1 / Person B):** deterministic clearing/optimization, CREAO workflow orchestration, Hyphenate-aligned double-entry finance, and the Elastic Agent Builder investigator. These read normalized offers from the market API and write only their own tables/services.
- **Web:** Next.js/TypeScript; buyer/provider marketplace, deal review, execution and settlement views.
- **API (Duo 2):** identity, offers/workflows, reservations, jobs, and audit logs for execution and settlement.
- **Economic engine (Duo 1 / Person B):** deterministic allocation solver (e.g., OR-Tools). Evaluate feasible deal bundles with objective of net economic surplus after migration, retry, and coordination costs. Disallow allocations violating budgets, compatibility, deadlines, or authorization.
- **Workers (Duo 2):** Dockerized Python workload runner for approved templates, leases/heartbeats, task-level checkpoints, verification, and event reporting on Vultr.

### Data and trust boundaries
- **Tiger Data:** canonical relational and time-series store. Market observations are append-only hypertable rows; normalized current offers are a deduplicated view; continuous aggregates serve price history. The ledger uses Tiger Data (or the finance service's PostgreSQL) with double-entry invariants.
- **Elasticsearch Serverless:** derived retrieval index for agreements, invoices, usage records, payment events, and selected market/deal documents. Populated one-way from canonical records; agent answers cite canonical IDs and evidence excerpts.
- **Apify:** external observation channel. Actor output lands in an Apify dataset and is ingested through a validated, idempotent pipeline. No consumer reads raw actor output directly.
- **Execution evidence:** Vultr/Docker worker events and provider instance metadata are recorded as measured execution data, separate from advertised prices.

### Market data truth model
- Every observation carries `source`, `source_url`, `observed_at`, `ingested_at`, `source_record_id`, `raw_hash`, and `trust_tier`.
- Public listings are `reference` observations with `executable=false`. Only authorized inventory can be `executable=true`; the market service never infers executable capacity from a public listing.
- Deduplication key is `(provider, provider_offer_id, observation_bucket)`, plus a normalized-content hash to detect unchanged republished rows. The current-offer view chooses the newest observation per identity with source priority as a tie-break.
- Freshness is explicit: `fresh`, `stale`, or `expired`, derived from the source TTL and observation age. Stale records remain queryable with their timestamp but are excluded from “current executable” comparisons.
- Failures are isolated per provider: one broken adapter creates a failed ingestion run with diagnostics and does not discard other providers' records.

### Agent and payments
- **CREAO** coordinates negotiation and approval steps over Relay's APIs, with explicit state transitions and escalation.
- **Hyphenate-aligned finance** records procurement as balanced double-entry journal entries, reconciles invoices against usage, enforces approval policies and separation of duties, and emits audit events.
- **Elastic Agent Builder** investigates financial evidence; it retrieves and cites but cannot approve, pay, or mutate canonical records.
- **x402** handles machine-initiated compute purchases; **Solana devnet** stores settlement confirmations; **Vultr** provides real execution capacity.

## Shared interfaces (define before parallel work)
All teams use stable UUID strings, ISO 8601 timestamps in UTC, currency amounts as integer minor units, and explicit status enums. Suggested common objects:

- `Provider`: id, hardware, location, allowed_workloads, availability, price_model, permissions.
- `MarketOffer`: id, provider_id, source (`worker` or `external_reference`), GPU/CPU specs, rate, observed_at, expires_at, executable.
  - Market-intelligence extension: `provider`, `provider_offer_id`, `gpu_model`, `gpu_count`, `vram_gb`, `cpu_cores`, `ram_gb`, `disk_gb`, `region`, `country`, `price_per_hour_minor`, `currency`, `billing_scope`, `availability_scope`, `source`, `source_url`, `source_record_id`, `trust_tier`, `freshness`, `raw_hash`, `ingested_at`.
  - Public reference offers always have `executable=false`. Only an authorized worker/reservation may produce an executable offer.
- `Workload`: id, buyer_id, type, resource_constraints, budget_minor, deadline, flexibility, state.
- `Commitment`: id, workload_id, offer_id, time_window, rights, reservation_status.
- `DealProposal`: id, parties, required_commitments, proposed_transfers, compensation, projected_surplus, approval_status.
- `ExecutionEvent`: id, workload_id, worker_id, event_type, measured_at, proof_reference.
- `Settlement`: id, deal_id, delivery_verification_id, amount_minor, chain, tx_id, status.

Minimal API endpoints (mock implementations permitted before integration):
`GET /market/offers`, `POST /workloads`, `POST /deals/search`, `POST /deals/{id}/approve`, `POST /deals/{id}/commit`, `GET /deals/{id}`, `GET /workloads/{id}/events`, `POST /workers/heartbeat`, `POST /workers/events`, `POST /settlements`, `GET /market/history`.

Market Intelligence's stable implementation (owned by Person A, consumed read-only by Person B and Duo 2):
`GET /v1/market/offers`, `GET /v1/market/offers/{id}`, `GET /v1/market/providers`, `GET /v1/market/history`, `GET /v1/market/summary`, `GET /v1/market/freshness`, `POST /v1/admin/ingestion/runs`, `GET /v1/admin/ingestion/runs/{id}`, `GET /healthz`, `GET /readyz`. The full contract is in `docs/MARKET_INTELLIGENCE_INTERFACE.md`.

Money is integer minor units in the API and `NUMERIC(20,6)` in the database for per-hour prices; the canonical API field is `price_per_hour_minor` plus `currency`. Timestamps are ISO 8601 UTC with `Z`. IDs are UUID strings. Lists are keyset-paginated with an opaque `next_cursor`. Errors use a stable envelope (`code`, `message`, `details`, `request_id`).

Publish OpenAPI schemas and fixtures in a shared `/contracts` folder. Define idempotency keys for commit and settlement actions. Only backend services can finalize a reservation or authorize funds. Market ingestion accepts an idempotency key per run and deduplicates at the observation level.

## Milestones and integration checks

**M0 | Contracts and skeleton:** Agree on states, schemas, endpoint owners, and one test scenario. Frontend and other services can consume fixture data immediately.

**M1 | Single-provider execution:** One authorized worker registers, receives a predefined job, runs it, and reports real completion telemetry. Display results in the web UI and Tiger Data.

**M2 | Price discovery and deal calculation:** Apify ingests sourced offers into Tiger Data. The solver compares baseline individual transactions against a coordinated proposal and displays economic assumptions, switching costs, and constraints. Person A delivers live Vast.ai offers plus credential-aware RunPod/Lambda/TensorDock adapters, historical price analytics, and freshness/dedupe guarantees; Person B consumes the market API without touching market tables.

**M3 | Coordinated exchange:** Two or more parties approve a conditional arrangement. The platform reserves capacity, executes the supported handoff or task-level restart, and confirms delivery or follows a defined fallback.

**M4 | Financial and agent flow:** CREAO coordinates approval steps and escalation. Hyphenate-aligned double-entry finance reconciles the purchase with policy and audit evidence; the Elastic Agent Builder investigator answers evidence questions with citations. A verified event triggers Solana devnet settlement; use x402 for a separate valid machine-initiated compute-service purchase if it fits.

**M5 | Demo hardening:** Run the end-to-end scenario repeatedly, test one failed reservation and one worker dropout, capture a fallback video, and report net value against direct purchase/resale baselines.

## Non-goals and truthful claims
Not a production exchange, real-money derivatives market, arbitrary-code execution platform, or universally portable GPU checkpoint system. A multi-provider deal is staged and recoverable, not perfectly atomic across infrastructure. Public listing prices are not confirmed inventory, synthetic bids are not live market trades, and test settlements are not real revenue. Our novelty is a **hypothesis**: conditional multi-party clearing plus verifiable execution may unlock useful deals that simpler rentals and brokers cannot.

## Success criteria
One working end-to-end exchange on real workers; correct approvals and conditional commitments; reproducible execution evidence; verifiable test settlement; and a transparent economic comparison against independent purchasing or resale that includes migration and recovery costs. If the coordinated deal does not beat those baselines, show that result honestly and explain when the mechanism is useful.
