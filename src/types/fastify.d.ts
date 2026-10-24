import type { Principal } from "../contract.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}
