import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { upsertApiKey } from "../src/auth/keys.js";
import type { MarketBridgeConfig } from "../src/config.js";
import { createTestContext } from "./helpers/app.js";

const ADMIN_KEY = "test-admin-market-bridge-1234567890";
const OBSERVED_AT = "2026-10-24T21:00:00.000Z";
const EXPIRES_AT = "2026-10-24T21:15:00.000Z";

function offer(overrides: Record<string, unknown> = {}) {
  return {
    id: "7f2a4b6c-0000-4000-8000-000000000001",
    provider: "vastai",
    provider_offer_id: "vast-123",
    gpu_model: "NVIDIA H100 SXM5 80GB",
    gpu_model_normalized: "H100",
    gpu_count: 8,
    vram_gb: 80,
    cpu_cores: 64,
    ram_gb: 512,
    disk_gb: 2048,
    region: "us-east",
    country: "US",
    price_per_hour_minor: 1032,
    price_per_hour_micros: 10_320_000,
    price_per_gpu_hour_minor: 129,
    price_per_gpu_hour_micros: 1_290_000,
    currency: "USD",
    billing_scope: "per_gpu",
    availability_scope: "live_inventory",
    executable: false,
    price_available: true,
    pricing_model: "fixed",
    available_gpu_count: 8,
    capacity_scope: "offer",
    source: "vastai",
    source_url: "https://example.test/vast-123",
    source_record_id: "vast-123",
    trust_tier: "primary",
    freshness: "fresh",
    observed_at: OBSERVED_AT,
    expires_at: EXPIRES_AT,
    ingested_at: OBSERVED_AT,
    reliability: 0.99,
    raw_hash: "hash-1",
    metadata: {},
    ...overrides,
  };
}

async function fixtureServer(offers: () => Array<Record<string, unknown>>): Promise<{
  server: Server;
  url: string;
}> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");
    if (url.pathname === "/v1/market/providers") {
      response.end(
        JSON.stringify([
          { provider: "vastai", display_name: "Vast.ai", enabled: true, status: "ok" },
          { provider: "runpod", display_name: "RunPod", enabled: true, status: "ok" },
        ]),
      );
      return;
    }
    if (url.pathname === "/v1/market/offers") {
      response.end(
        JSON.stringify({
          items: offers(),
          next_cursor: null,
          generated_at: OBSERVED_AT,
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

function bridgeConfig(apiUrl: string): MarketBridgeConfig {
  return {
    apiUrl,
    token: null,
    offerTtlSeconds: 900,
    advertisedOfferTtlSeconds: 21_600,
    // 0 keeps the background loop (and its boot sync) out of the test.
    syncIntervalMs: 0,
    maxOffers: 1_000,
  };
}

test("market bridge mirrors fresh public offers as non-executable references", async (t) => {
  const current = [
    offer(),
    offer({
      id: "7f2a4b6c-0000-4000-8000-000000000002",
      provider: "runpod",
      provider_offer_id: "runpod-456",
      gpu_model: "H100 80GB HBM3",
      gpu_model_normalized: "H100",
      gpu_count: 1,
      price_per_hour_minor: 289,
      price_per_gpu_hour_minor: 289,
      availability_scope: "advertised",
      observed_at: OBSERVED_AT,
    }),
    // Unpriced capacity must never become a quotable offer.
    offer({
      id: "7f2a4b6c-0000-4000-8000-000000000003",
      provider_offer_id: "vast-unpriced",
      price_available: false,
      price_per_hour_minor: 0,
      price_per_gpu_hour_minor: 0,
    }),
  ];
  const { server, url } = await fixtureServer(() => current);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const ctx = await createTestContext({ market: bridgeConfig(url) });
  t.after(async () => ctx.app.close());
  await upsertApiKey(ctx.db, { name: "test-admin", key: ADMIN_KEY, role: "admin" });

  const first = await ctx.app.inject({
    method: "POST",
    url: "/v1/market/bridge/sync",
    headers: ctx.headers(ADMIN_KEY, { idempotencyKey: "bridge-sync-1" }),
  });
  assert.equal(first.statusCode, 200, first.body);
  const result = first.json() as {
    fetched: number;
    upserted: number;
    skipped: number;
    providers: number;
    expired: number;
  };
  assert.equal(result.fetched, 3);
  assert.equal(result.upserted, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.providers, 2);

  const listed = await ctx.app.inject({
    method: "GET",
    url: "/v1/offers?source=external_reference",
    headers: ctx.headers(),
  });
  assert.equal(listed.statusCode, 200, listed.body);
  const body = listed.json() as {
    count: number;
    offers: Array<{
      gpu_model: string;
      rate_minor_per_gpu_hour: number;
      executable: boolean;
      provider: { name: string };
      metadata: Record<string, unknown>;
    }>;
  };
  // The demo seed also ships two hand-written public references.
  const mirrored = body.offers.filter((item) => item.metadata.bridge === "market-intelligence-v1");
  assert.equal(mirrored.length, 2);
  for (const listedOffer of mirrored) {
    // A public listing is a reference, never authorized inventory.
    assert.equal(listedOffer.executable, false);
  }
  const vast = mirrored.find((item) => item.provider.name === "Vast.ai");
  assert.ok(vast, "provider party is created with its market display name");
  assert.equal(vast.gpu_model, "H100", "canonical model keeps workload matching exact");
  assert.equal(vast.rate_minor_per_gpu_hour, 129);

  // A second pass at a new price updates the same row instead of duplicating it.
  current[0] = offer({ price_per_hour_minor: 1192, price_per_gpu_hour_minor: 149 });
  const second = await ctx.app.inject({
    method: "POST",
    url: "/v1/market/bridge/sync",
    headers: ctx.headers(ADMIN_KEY, { idempotencyKey: "bridge-sync-2" }),
  });
  assert.equal(second.statusCode, 200, second.body);
  const rows = await ctx.db.query<{ count: string; rate: string }>(
    `SELECT count(*)::text AS count,
            max(rate_minor_per_gpu_hour) FILTER (WHERE external_ref = 'vastai:vast-123')::text AS rate
       FROM market_offers
      WHERE source = 'external_reference'
        AND metadata->>'bridge' = 'market-intelligence-v1'`,
  );
  assert.equal(rows.rows[0]?.count, "2");
  assert.equal(rows.rows[0]?.rate, "149");

  const bridged = await ctx.app.inject({
    method: "GET",
    url: "/v1/market/bridge",
    headers: ctx.headers(),
  });
  assert.equal(bridged.statusCode, 200, bridged.body);
  const status = bridged.json() as { enabled: boolean; last_result: { upserted: number } | null };
  assert.equal(status.enabled, true);
  assert.equal(status.last_result?.upserted, 2);
});

test("market bridge reports disabled when MARKET_API_URL is unset", async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.app.close());

  const response = await ctx.app.inject({
    method: "GET",
    url: "/v1/market/bridge",
    headers: ctx.headers(),
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal((response.json() as { enabled: boolean }).enabled, false);
});
