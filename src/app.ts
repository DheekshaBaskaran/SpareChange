import Fastify, { type FastifyServerOptions } from "fastify";
import { ZodError } from "zod";
import { authenticate } from "./auth/service.js";
import type { AppConfig } from "./config.js";
import { CONTRACT_HEADER, CONTRACT_VERSION, SUPPORTED_CONTRACTS } from "./contract.js";
import type { Db } from "./db/client.js";
import { ApiError, isDatabaseUnavailable, validationError } from "./errors.js";
import { headerValue } from "./http.js";
import { ElasticHttpClient } from "./elastic/client.js";
import { ElasticFinanceIntegration } from "./elastic/investigations.js";
import { ElasticSyncService } from "./elastic/sync.js";
import type { ElasticInvestigationService } from "./elastic/types.js";
import { MarketSyncService } from "./market/sync.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerCreaoRoutes } from "./routes/creao.js";
import { registerDealRoutes } from "./routes/deals.js";
import { registerDuo2Routes } from "./routes/duo2.js";
import { registerElasticRoutes } from "./routes/elastic.js";
import { registerFinanceRoutes } from "./routes/finance.js";
import { registerHealth } from "./routes/health.js";
import { registerMarketBridgeRoutes } from "./routes/market-bridge.js";
import { registerMarketRoutes } from "./routes/market.js";
import { registerSessionRoutes } from "./routes/session.js";

export interface BuildAppOptions {
  db: Db;
  config: AppConfig;
  logger?: FastifyServerOptions["logger"];
  elastic?: ElasticInvestigationService | null;
}

export function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger:
      options.logger ??
      {
        level: options.config.logLevel,
        redact: ["req.headers.authorization", "req.headers['idempotency-key']"],
      },
    bodyLimit: 1_048_576,
    requestTimeout: 20_000,
  });

  app.decorateRequest("principal", null);
  registerSessionRoutes(app);

  let elastic = options.elastic;
  if (elastic === undefined) {
    if (options.config.elastic?.enabled) {
      const client = new ElasticHttpClient(options.config.elastic);
      const sync = new ElasticSyncService(
        options.db,
        options.config.elastic,
        client,
        (error) => app.log.error({ err: error }, "elastic index sync failed"),
      );
      elastic = new ElasticFinanceIntegration({
        db: options.db,
        config: options.config.elastic,
        search: client,
        agent: client,
        sync,
        onError: (error) => app.log.error({ err: error }, "elastic integration error"),
      });
    } else {
      elastic = null;
    }
  }
  if (elastic && options.config.elastic?.enabled) elastic.start?.();

  let marketSync: MarketSyncService | null = null;
  if (options.config.market) {
    marketSync = new MarketSyncService(
      options.db,
      options.config.market,
      (error) => app.log.error({ err: error }, "market intelligence sync failed"),
    );
    // Boot-time failures are logged, never fatal: finance must keep serving.
    marketSync.start();
  }

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Relay-Contract", CONTRACT_VERSION);
    reply.header("X-Content-Type-Options", "nosniff");

    // Liveness must work even when the caller cannot present a credential.
    if (request.url.split("?")[0] === "/v1/health") return;

    const contract = headerValue(request, CONTRACT_HEADER);
    if (!contract) {
      throw new ApiError(
        400,
        "contract_header_required",
        `Every request must include the ${CONTRACT_HEADER} header.`,
        { retryable: false },
      );
    }
    if (!SUPPORTED_CONTRACTS.has(contract)) {
      throw new ApiError(
        400,
        "unsupported_contract",
        `Unsupported contract version '${contract}'. Supported: ${[...SUPPORTED_CONTRACTS].join(", ")}.`,
        { retryable: false },
      );
    }

    try {
      const principal = await authenticate(options.db, options.config, request.headers.authorization);
      if (!principal) {
        throw new ApiError(401, "authentication_required", "A valid Bearer API key is required.", {
          retryable: false,
        });
      }
      request.principal = principal;
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        throw new ApiError(503, "database_unavailable", "The database is not reachable.", {
          retryable: true,
        });
      }
      throw error;
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Relay-Contract", CONTRACT_VERSION);
    reply.header("X-Request-Id", request.id);
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.statusCode).send(error.toBody());
      return;
    }
    if (error instanceof ZodError) {
      const apiError = validationError(error);
      void reply.status(apiError.statusCode).send(apiError.toBody());
      return;
    }
    if (isDatabaseUnavailable(error)) {
      void reply.status(503).send({
        code: "database_unavailable",
        detail: "The database is not reachable.",
        retryable: true,
        violations: [],
      });
      return;
    }
    request.log.error({ err: error }, "unhandled request error");
    if (process.env.RELAY_DEBUG_ERRORS === "1") console.error(error);
    void reply.status(500).send({
      code: "internal_error",
      detail: "An internal error occurred.",
      retryable: false,
      violations: [],
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({
      code: "not_found",
      detail: "Route not found.",
      retryable: false,
      violations: [],
    });
  });

  registerHealth(app, options.db);
  registerMarketRoutes(app, options.db);
  registerMarketBridgeRoutes(app, options.db, marketSync);
  registerDealRoutes(app, options.db);
  registerApprovalRoutes(app, options.db, options.config);
  registerFinanceRoutes(app, options.db);
  registerCreaoRoutes(app, options.db);
  registerElasticRoutes(app, options.db, elastic);
  registerDuo2Routes(app, options.db);
  registerAuditRoutes(app, options.db);

  app.addHook("onClose", async () => {
    elastic?.stop?.();
    marketSync?.stop();
    await options.db.close();
  });

  return app;
}
