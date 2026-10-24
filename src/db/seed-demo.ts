import type { Db } from "./client.js";

export const DEMO_IDS = {
  parties: {
    acme: "11111111-1111-4111-8111-111111111111",
    vertex: "22222222-2222-4222-8222-222222222222",
    northstar: "33333333-3333-4333-8333-333333333333",
    brightlane: "44444444-4444-4444-8444-444444444444",
  },
  humans: {
    maya: "ffffffff-ffff-4fff-8fff-fffffffff001",
    omar: "ffffffff-ffff-4fff-8fff-fffffffff002",
    priya: "ffffffff-ffff-4fff-8fff-fffffffff003",
    daniel: "ffffffff-ffff-4fff-8fff-fffffffff004",
  },
  authorizations: {
    vertex: "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
    northstar: "cccccccc-cccc-4ccc-8ccc-cccccccccc02",
  },
  offers: {
    vertex: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001",
    northstar: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002",
    publicH100: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003",
    publicA100: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb004",
  },
  workloads: {
    acme: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    brightlane: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
  },
  allocations: {
    acmeVertex: "abababab-abab-4bab-8bab-ababababab01",
  },
  deal: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  requests: {
    acme: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
    brightlane: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02",
    vertex: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03",
    northstar: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04",
  },
} as const;

function at(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
}

export async function seedDemo(db: Db): Promise<void> {
  const now = new Date();
  const observed5m = new Date(now.getTime() - 5 * 60_000).toISOString();
  const observed3m = new Date(now.getTime() - 3 * 60_000).toISOString();
  const observed10m = new Date(now.getTime() - 10 * 60_000).toISOString();
  const observed2h = new Date(now.getTime() - 2 * 60 * 60_000).toISOString();
  const windowStart = at(2);
  const windowEnd = at(12);

  const proposal = {
    proposal_id: DEMO_IDS.deal,
    deal_id: DEMO_IDS.deal,
    terms_version: 1,
    status: "awaiting_human_approval",
    title: "Move Acme to Northstar and reassign Vertex capacity to Brightlane",
    parties: [
      {
        id: DEMO_IDS.parties.acme,
        role: "buyer",
        name: "Acme Compute",
        obligation: "Release the 8x H100 Vertex window and restart the batch job on Northstar",
        amount_minor: 14300,
        currency: "USD",
        floor_surplus_minor: 1000,
      },
      {
        id: DEMO_IDS.parties.brightlane,
        role: "buyer",
        name: "Brightlane AI",
        obligation: "Take the reassigned 8x H100 Vertex window and pay $180.00",
        amount_minor: 18000,
        currency: "USD",
        floor_surplus_minor: 1000,
      },
      {
        id: DEMO_IDS.parties.vertex,
        role: "provider",
        name: "Vertex Labs",
        obligation: "Reassign the 8x H100 window to Brightlane after Acme's checkpoint",
        amount_minor: 0,
        currency: "USD",
        floor_surplus_minor: 0,
      },
      {
        id: DEMO_IDS.parties.northstar,
        role: "provider",
        name: "Northstar GPU",
        obligation: "Reserve 8x H100 for Acme for the ten-hour window",
        amount_minor: 0,
        currency: "USD",
        floor_surplus_minor: 0,
      },
    ],
    required_commitments: [
      {
        offer_id: DEMO_IDS.offers.vertex,
        provider_id: DEMO_IDS.parties.vertex,
        gpu_count: 8,
        window_start: windowStart,
        window_end: windowEnd,
        reservation_status: "planned",
      },
      {
        offer_id: DEMO_IDS.offers.northstar,
        provider_id: DEMO_IDS.parties.northstar,
        gpu_count: 8,
        window_start: windowStart,
        window_end: windowEnd,
        reservation_status: "planned",
      },
    ],
    proposed_transfers: [
      {
        from_party_id: DEMO_IDS.parties.acme,
        to_party_id: DEMO_IDS.parties.brightlane,
        offer_id: DEMO_IDS.offers.vertex,
        gpu_count: 8,
        window_start: windowStart,
        window_end: windowEnd,
      },
      {
        from_party_id: DEMO_IDS.parties.northstar,
        to_party_id: DEMO_IDS.parties.acme,
        offer_id: DEMO_IDS.offers.northstar,
        gpu_count: 8,
        window_start: windowStart,
        window_end: windowEnd,
      },
    ],
    compensation: [
      {
        from_party_id: DEMO_IDS.parties.acme,
        to_party_id: DEMO_IDS.parties.northstar,
        amount_minor: 12800,
        reason: "replacement capacity",
      },
      {
        from_party_id: DEMO_IDS.parties.brightlane,
        to_party_id: DEMO_IDS.parties.vertex,
        amount_minor: 18000,
        reason: "reassigned capacity",
      },
    ],
    participant_costs: [
      {
        party_id: DEMO_IDS.parties.acme,
        gross_minor: 12800,
        switching_minor: 1500,
        net_minor: 14300,
        baseline_minor: 16800,
        savings_minor: 2500,
      },
      {
        party_id: DEMO_IDS.parties.brightlane,
        gross_minor: 18000,
        switching_minor: 0,
        net_minor: 18000,
        baseline_minor: 22400,
        savings_minor: 4400,
      },
      {
        party_id: DEMO_IDS.parties.vertex,
        gross_minor: 0,
        switching_minor: 0,
        net_minor: 0,
        baseline_minor: 0,
        revenue_minor: 18000,
      },
      {
        party_id: DEMO_IDS.parties.northstar,
        gross_minor: 0,
        switching_minor: 0,
        net_minor: 0,
        baseline_minor: 0,
        revenue_minor: 12800,
      },
    ],
    total_cost_minor: 30800,
    baseline_cost_minor: 39200,
    switching_cost_minor: 1500,
    coordination_fee_minor: 1000,
    projected_surplus_minor: 7100,
    projected_surplus_per_hour_minor: 710,
    approval_status: "pending",
    reservation_status: "planned",
    settlement_authorized: false,
    engine: {
      name: "seed-fixture",
      version: "0.0.0",
      deterministic: true,
      solver_status: "fixture_not_solver",
      note: "P0 contract fixture for UI and agent integration. Replace with a persisted solver proposal in P1.",
    },
    fallback: {
      action: "cancel_and_keep_existing_allocations",
      description: "If either party rejects or an offer expires, no transfer or payment is authorized.",
    },
  };

  await db.transaction(async (tx) => {
    const parties = [
      [DEMO_IDS.parties.acme, "buyer", "Acme Compute"],
      [DEMO_IDS.parties.vertex, "provider", "Vertex Labs"],
      [DEMO_IDS.parties.northstar, "provider", "Northstar GPU"],
      [DEMO_IDS.parties.brightlane, "buyer", "Brightlane AI"],
    ] as const;
    for (const [id, kind, name] of parties) {
      await tx.query(
        `INSERT INTO parties (id, kind, name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'active'`,
        [id, kind, name],
      );
    }

    const humans = [
      [DEMO_IDS.humans.maya, "Maya Chen", "maya@acme.example"],
      [DEMO_IDS.humans.omar, "Omar Haddad", "omar@vertex.example"],
      [DEMO_IDS.humans.priya, "Priya Nair", "priya@northstar.example"],
      [DEMO_IDS.humans.daniel, "Daniel Park", "daniel@brightlane.example"],
    ] as const;
    for (const [id, name, email] of humans) {
      await tx.query(
        `INSERT INTO human_users (id, display_name, email) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email`,
        [id, name, email],
      );
    }

    await tx.query(
      `INSERT INTO provider_profiles
         (party_id, hardware, allowed_workloads, regions, price_model,
          authorized_at, authorization_expires_at)
       VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (party_id) DO UPDATE SET
         hardware = EXCLUDED.hardware,
         allowed_workloads = EXCLUDED.allowed_workloads,
         regions = EXCLUDED.regions,
         price_model = EXCLUDED.price_model,
         authorized_at = EXCLUDED.authorized_at,
         authorization_expires_at = EXCLUDED.authorization_expires_at,
         updated_at = now()`,
      [
        DEMO_IDS.parties.vertex,
        JSON.stringify([{ gpu_model: "H100", count: 8, memory_gb: 80 }]),
        ["batch-inference", "fine-tuning"],
        ["us-east"],
        JSON.stringify({ currency: "USD", rate_minor_per_gpu_hour: 210 }),
        at(-24 * 30),
        at(24 * 90),
      ],
    );
    await tx.query(
      `INSERT INTO provider_profiles
         (party_id, hardware, allowed_workloads, regions, price_model,
          authorized_at, authorization_expires_at)
       VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (party_id) DO UPDATE SET
         hardware = EXCLUDED.hardware,
         allowed_workloads = EXCLUDED.allowed_workloads,
         regions = EXCLUDED.regions,
         price_model = EXCLUDED.price_model,
         authorized_at = EXCLUDED.authorized_at,
         authorization_expires_at = EXCLUDED.authorization_expires_at,
         updated_at = now()`,
      [
        DEMO_IDS.parties.northstar,
        JSON.stringify([{ gpu_model: "H100", count: 16, memory_gb: 80 }]),
        ["batch-inference"],
        ["us-west"],
        JSON.stringify({ currency: "USD", rate_minor_per_gpu_hour: 160 }),
        at(-24 * 14),
        at(24 * 90),
      ],
    );

    const authorizations = [
      [DEMO_IDS.authorizations.vertex, DEMO_IDS.parties.vertex, "vertex-worker-001"],
      [DEMO_IDS.authorizations.northstar, DEMO_IDS.parties.northstar, "northstar-worker-001"],
    ] as const;
    for (const [id, providerId, evidence] of authorizations) {
      await tx.query(
        `INSERT INTO provider_authorizations
           (id, provider_id, scope, authorized_at, expires_at, evidence_ref)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           scope = EXCLUDED.scope, expires_at = EXCLUDED.expires_at, evidence_ref = EXCLUDED.evidence_ref`,
        [
          id,
          providerId,
          JSON.stringify({ gpu_model: "H100", max_gpu_count: 16, transferable: true }),
          at(-24 * 7),
          at(24 * 90),
          evidence,
        ],
      );
    }

    const offers = [
      [
        DEMO_IDS.offers.vertex,
        DEMO_IDS.parties.vertex,
        "worker",
        null,
        "H100",
        8,
        64,
        640,
        210,
        "us-east",
        at(1),
        windowEnd,
        observed5m,
        at(24),
        true,
        DEMO_IDS.authorizations.vertex,
      ],
      [
        DEMO_IDS.offers.northstar,
        DEMO_IDS.parties.northstar,
        "worker",
        null,
        "H100",
        8,
        64,
        640,
        160,
        "us-west",
        at(1),
        windowEnd,
        observed3m,
        at(24),
        true,
        DEMO_IDS.authorizations.northstar,
      ],
      [
        DEMO_IDS.offers.publicH100,
        DEMO_IDS.parties.vertex,
        "external_reference",
        "apify:public-h100-us-east",
        "H100",
        8,
        64,
        640,
        280,
        "us-east",
        at(1),
        at(24),
        observed10m,
        at(6),
        false,
        null,
      ],
      [
        DEMO_IDS.offers.publicA100,
        DEMO_IDS.parties.northstar,
        "external_reference",
        "apify:public-a100-us-west",
        "A100",
        8,
        48,
        320,
        120,
        "us-west",
        at(1),
        at(24),
        observed2h,
        at(6),
        false,
        null,
      ],
    ] as const;

    for (const offer of offers) {
      await tx.query(
        `INSERT INTO market_offers
           (id, provider_id, source, external_ref, gpu_model, gpu_count, cpu_cores,
            memory_gb, rate_minor_per_gpu_hour, currency, location, available_from,
            available_until, observed_at, expires_at, executable, authorization_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'USD', $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           source = EXCLUDED.source, external_ref = EXCLUDED.external_ref,
           gpu_model = EXCLUDED.gpu_model, gpu_count = EXCLUDED.gpu_count,
           cpu_cores = EXCLUDED.cpu_cores, memory_gb = EXCLUDED.memory_gb,
           rate_minor_per_gpu_hour = EXCLUDED.rate_minor_per_gpu_hour,
           location = EXCLUDED.location, available_from = EXCLUDED.available_from,
           available_until = EXCLUDED.available_until, observed_at = EXCLUDED.observed_at,
           expires_at = EXCLUDED.expires_at, executable = EXCLUDED.executable,
           authorization_id = EXCLUDED.authorization_id, metadata = EXCLUDED.metadata`,
        [
          offer[0],
          offer[1],
          offer[2],
          offer[3],
          offer[4],
          offer[5],
          offer[6],
          offer[7],
          offer[8],
          offer[9],
          offer[10],
          offer[11],
          offer[12],
          offer[13],
          offer[14],
          offer[15],
          JSON.stringify({
            seed: "relay-demo",
            contract: "P1",
            ...(offer[0] === DEMO_IDS.offers.vertex
              ? { transfer_rate_minor_per_gpu_hour: 225 }
              : {}),
          }),
        ],
      );
    }

    await tx.query(
      `INSERT INTO workloads
         (id, buyer_id, type, gpu_model, gpu_count, cpu_cores, memory_gb, budget_minor,
          deadline, earliest_start, flexibility, state)
       VALUES ($1, $2, 'batch-inference', 'H100', 8, 64, 640, 20000, $3, $4, $5::jsonb, 'open')
       ON CONFLICT (id) DO UPDATE SET budget_minor = EXCLUDED.budget_minor, state = 'open'`,
      [
        DEMO_IDS.workloads.acme,
        DEMO_IDS.parties.acme,
        at(30),
        at(1),
        JSON.stringify({
          restartable: true,
          max_restart_minutes: 20,
          duration_hours: 10,
          switch_cost_minor: 1500,
        }),
      ],
    );
    await tx.query(
      `INSERT INTO workloads
         (id, buyer_id, type, gpu_model, gpu_count, cpu_cores, memory_gb, budget_minor,
          deadline, earliest_start, flexibility, state)
       VALUES ($1, $2, 'fine-tuning', 'H100', 8, 64, 640, 20000, $3, $4, $5::jsonb, 'open')
       ON CONFLICT (id) DO UPDATE SET budget_minor = EXCLUDED.budget_minor, state = 'open'`,
      [
        DEMO_IDS.workloads.brightlane,
        DEMO_IDS.parties.brightlane,
        at(30),
        at(2),
        JSON.stringify({ restartable: false, max_restart_minutes: 0, duration_hours: 10 }),
      ],
    );

    // Acme currently holds the Vertex window. This is the status quo the solver
    // must improve; it is not a pre-computed answer.
    await tx.query(
      `INSERT INTO capacity_allocations
         (id, offer_id, buyer_id, workload_id, gpu_count, window_start, window_end,
          status, transferable, switch_cost_minor, metadata)
       VALUES ($1, $2, $3, $4, 8, $5, $6, 'active', true, 1500, $7::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end,
         status = 'active', switch_cost_minor = EXCLUDED.switch_cost_minor`,
      [
        DEMO_IDS.allocations.acmeVertex,
        DEMO_IDS.offers.vertex,
        DEMO_IDS.parties.acme,
        DEMO_IDS.workloads.acme,
        windowStart,
        windowEnd,
        JSON.stringify({ seed: "relay-demo", note: "Acme's current held Vertex window" }),
      ],
    );

    await tx.query(
      `INSERT INTO deals (id, workload_id, title, status, current_version)
       VALUES ($1, $2, $3, 'awaiting_human_approval', 1)
       ON CONFLICT (id) DO NOTHING`,
      [DEMO_IDS.deal, DEMO_IDS.workloads.acme, proposal.title],
    );
    await tx.query(
      `INSERT INTO deal_versions (deal_id, version, status, proposal, engine, created_by)
       VALUES ($1, 1, 'awaiting_human_approval', $2::jsonb, $3::jsonb, 'seed-fixture')
       ON CONFLICT (deal_id, version) DO NOTHING`,
      [
        DEMO_IDS.deal,
        JSON.stringify(proposal),
        JSON.stringify({ name: "seed-fixture", version: "0.0.0", deterministic: true }),
      ],
    );

    const requests = [
      [DEMO_IDS.requests.acme, DEMO_IDS.parties.acme, proposal.parties[0].obligation, 14300],
      [DEMO_IDS.requests.brightlane, DEMO_IDS.parties.brightlane, proposal.parties[1].obligation, 18000],
      [DEMO_IDS.requests.vertex, DEMO_IDS.parties.vertex, proposal.parties[2].obligation, 0],
      [DEMO_IDS.requests.northstar, DEMO_IDS.parties.northstar, proposal.parties[3].obligation, 0],
    ] as const;
    for (const [id, participantId, obligation, amountMinor] of requests) {
      await tx.query(
        `INSERT INTO deal_approval_requests
           (id, deal_id, version, participant_id, obligation, amount_minor, currency,
            channel, status, expires_at)
         VALUES ($1, $2, 1, $3, $4, $5, 'USD', 'api', 'pending', $6)
         ON CONFLICT (deal_id, version, participant_id) DO NOTHING`,
        [id, DEMO_IDS.deal, participantId, obligation, amountMinor, at(24)],
      );
    }

    await tx.query(`DELETE FROM market_observations WHERE metadata->>'seed' = 'relay-demo'`);
    const observations = [
      [at(-6), "H100", 205, "apify"],
      [at(-5), "H100", 210, "worker"],
      [at(-4), "H100", 200, "apify"],
      [at(-3), "H100", 160, "worker"],
      [at(-2), "H100", 215, "apify"],
      [at(-1), "H100", 208, "apify"],
      [at(-4), "A100", 120, "apify"],
      [at(-2), "A100", 118, "apify"],
      [at(-1), "A100", 125, "apify"],
    ] as const;
    for (const [observedAt, gpuModel, rate, source] of observations) {
      await tx.query(
        `INSERT INTO market_observations
           (observed_at, offer_id, provider_id, gpu_model, rate_minor_per_gpu_hour, source, metadata)
         VALUES ($1, NULL, NULL, $2, $3, $4, $5::jsonb)`,
        [observedAt, gpuModel, rate, source, JSON.stringify({ seed: "relay-demo" })],
      );
    }
  });
}
