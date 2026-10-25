import type { FastifyInstance } from "fastify";
import { requirePrincipal, requireRole } from "../auth/service.js";
import type { Db } from "../db/client.js";
import { ApiError } from "../errors.js";
import { idempotent } from "../idempotency.js";
import type { MarketSyncService } from "../market/sync.js";

/**
 * Operational surface for the Market Intelligence bridge.
 *
 * Reads are safe for everyone who can already see offers; forcing a sync is
 * admin-only because it writes shared market state.
 */
export function registerMarketBridgeRoutes(
  app: FastifyInstance,
  db: Db,
  sync: MarketSyncService | null,
): void {
  app.get("/v1/market/bridge", async (request) => {
    requirePrincipal(request.principal);
    if (!sync) {
      return {
        enabled: false,
        reason: "MARKET_API_URL is not set; Duo 1 serves only locally persisted offers.",
      };
    }
    return sync.status();
  });

  app.post("/v1/market/bridge/sync", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      requireRole(principal, ["admin"]);
      if (!sync) {
        throw new ApiError(
          503,
          "market_bridge_disabled",
          "Set MARKET_API_URL to enable the Market Intelligence bridge.",
          { retryable: false },
        );
      }
      return { statusCode: 200, body: await sync.syncNow() };
    });
  });
}
