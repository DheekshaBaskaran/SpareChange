# SpareChange compute worker image.
# Build:  docker build -t sparechange-worker:latest worker/
# Run:    docker run --rm -e JOB_ID=test sparechange-worker:latest
FROM node:22-alpine

WORKDIR /app
COPY workload.mjs ./

# Run as the unprivileged "node" user that ships with the image.
USER node

CMD ["node", "workload.mjs"]
