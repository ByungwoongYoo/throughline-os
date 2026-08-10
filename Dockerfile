# Throughline OS — one image, three processes.
#
# The image ships the embedded PostgreSQL rather than expecting an external one,
# because that is what the product is: a research workspace a person installs,
# not a service someone operates. `THROUGHLINE_DATABASE_URL` points it at a real
# cluster when a lab wants one.
#
# Two things are deliberate and would look like mistakes otherwise.
#
# The data root is a VOLUME. A research corpus that vanishes with the container
# is the same unrecoverable loss the ephemeral-path warning exists to prevent,
# and a default that loses data quietly is worse than one that refuses to start.
#
# It runs as a non-root user with a writable home. The analysis sandbox spawns
# subprocesses, and a container running everything as root would mean an
# analysis escape is a host escape.

FROM node:22-slim AS web
WORKDIR /build
COPY apps/web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build


FROM python:3.12-slim AS runtime

# Build tools for the scientific stack, removed in the same layer so they do not
# ship. Nothing here is needed at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash throughline
WORKDIR /app

COPY packages ./packages
COPY services ./services
COPY apps/api ./apps/api
COPY pyproject.toml* ./

RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir \
      ./packages/schemas ./packages/ingestion ./packages/model \
      ./packages/visual-spec ./packages/workflow-sdk ./packages/connector-sdk \
      ./packages/research-domain ./services/scientific-runtime \
      ./services/workers ./apps/api \
 && apt-get purge -y build-essential && apt-get autoremove -y

# Node for the web interface. Without it the API still runs and §123 makes the
# interface report itself unavailable rather than pretending.
COPY --from=web /build/.next ./apps/web/.next
COPY --from=web /build/public ./apps/web/public
COPY --from=web /build/package.json ./apps/web/package.json
COPY --from=web /build/node_modules ./apps/web/node_modules
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node

COPY scripts ./scripts
RUN chmod +x scripts/*.sh && chown -R throughline:throughline /app

USER throughline
ENV THROUGHLINE_HOME=/data \
    PYTHONUNBUFFERED=1 \
    THROUGHLINE_LOG_LEVEL=info

# Research lives here. Losing it with the container is not an acceptable default.
VOLUME ["/data"]

EXPOSE 8080 3000

# Readiness, not liveness: the endpoint returns 200 while degraded on purpose,
# because a workspace with no model still does everything deterministic and
# restarting it would lose in-flight work to fix nothing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

CMD ["./scripts/serve.sh"]
