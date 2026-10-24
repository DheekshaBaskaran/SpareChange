import type { FastifyInstance } from "fastify";
import { CONTRACT_VERSION } from "../contract.js";
import { getHealth } from "../db/reads.js";
import type { Db } from "../db/client.js";
import { ApiError, isDatabaseUnavailable } from "../errors.js";

export function registerHealth(app: FastifyInstance, db: Db): void {
  app.get("/v1/health", async () => {
    try {
      const health = await getHealth(db);
      return {
        status: "ok",
        contract: CONTRACT_VERSION,
        database: health.database,
        time: health.now,
      };
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        throw new ApiError(503, "database_unavailable", "The database is not reachable.", {
          retryable: true,
        });
      }
      throw error;
    }
  });
}
