import type { FastifyInstance } from "fastify";
import { requirePrincipal } from "../auth/service.js";

/** Authenticated identity for the console BFF. Never returns a credential. */
export function registerSessionRoutes(app: FastifyInstance): void {
  app.get("/v1/session", async (request, reply) => {
    const principal = requirePrincipal(request.principal);
    reply.header("Cache-Control", "no-store");
    return { principal: { id: principal.id, name: principal.name, role: principal.role,
      partyId: principal.partyId, humanUserId: principal.humanUserId } };
  });
}
