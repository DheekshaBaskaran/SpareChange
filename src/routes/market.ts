import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import { getParty, getPriceHistory, getWorkload, listOffers } from "../db/reads.js";
import { ApiError } from "../errors.js";
import { parse } from "../validation.js";

const idParams = z.object({ id: z.string().uuid() });

const offersQuery = z.object({
  gpu_model: z.string().trim().min(1).max(120).optional(),
  provider_id: z.string().uuid().optional(),
  source: z.enum(["worker", "external_reference"]).optional(),
  executable: z.enum(["true", "false"]).optional(),
  workload_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const historyQuery = z.object({
  gpu_model: z.string().trim().min(1).max(120).optional(),
  window_hours: z.coerce.number().int().min(1).max(720).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

export function registerMarketRoutes(app: FastifyInstance, db: Db): void {
  app.get("/v1/workloads/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    const workload = await getWorkload(db, id);
    if (!workload) throw new ApiError(404, "workload_not_found", "Workload not found.");
    return { workload };
  });

  app.get("/v1/parties/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    const party = await getParty(db, id);
    if (!party) throw new ApiError(404, "party_not_found", "Party not found.");
    return { party };
  });

  app.get("/v1/offers", async (request) => {
    const query = parse(offersQuery, request.query);
    const offers = await listOffers(db, {
      gpuModel: query.gpu_model ?? null,
      providerId: query.provider_id ?? null,
      source: query.source ?? null,
      executableOnly: query.executable === "true",
      workloadId: query.workload_id ?? null,
      limit: query.limit,
    });
    return {
      offers,
      executable_offers: offers.filter((offer) => offer.executable),
      public_references: offers.filter((offer) => !offer.executable),
      count: offers.length,
      filters: {
        gpu_model: query.gpu_model ?? null,
        provider_id: query.provider_id ?? null,
        source: query.source ?? null,
        executable_only: query.executable === "true",
        workload_id: query.workload_id ?? null,
      },
    };
  });

  app.get("/v1/market/history", async (request) => {
    const query = parse(historyQuery, request.query);
    return getPriceHistory(db, {
      gpuModel: query.gpu_model ?? null,
      windowHours: query.window_hours,
      limit: query.limit,
    });
  });
}
