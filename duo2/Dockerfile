# Duo 2 — SpareChange execution console, job manager and payment rail.
#
# Next.js standalone output, non-root, no secrets baked in. Compute runs as a
# real local worker process inside the container (Docker-in-Docker is not
# available there), which is the honest fallback the UI already reports.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3402 \
    HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# The workload that actually runs the demo compute.
COPY --from=build /app/worker ./worker

# Job history lives here; mount a volume to keep it across restarts.
RUN mkdir -p /app/.data && chown -R node:node /app/.data

USER node
EXPOSE 3402

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3402)+'/api/system').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
