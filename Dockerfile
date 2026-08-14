# Throughline in one container: database, worker, API and interface.
#
# The whole product is local-first — the database, the embeddings and the
# analysis sandbox all run beside the code rather than as managed services — so
# the image is deliberately self-contained rather than a service that expects a
# Postgres URL handed to it. Somebody should be able to run this on a laptop or
# a lab box and have a working workspace, which is the same promise the desktop
# install makes.
#
# Two things about that are load-bearing and easy to get wrong.
#
# **The data directory must be a volume.** PostgreSQL runs inside the container
# and writes to /data. Without a volume the entire corpus — sources, analyses,
# findings, the notebook — is destroyed by `docker run` a second time, and the
# failure looks like "the app forgot everything" rather than like a missing
# mount. VOLUME below makes the container refuse to pretend otherwise.
#
# **The model is not in here.** Ollama is a separate process, reached over the
# network by address. Baking a multi-gigabyte model into the image would make
# it unshippable, and the system is built to run without one: every
# deterministic verdict, correction and export works with no model at all, and
# says so rather than failing.

# --- the interface --------------------------------------------------------
#
# Built first and separately: the web build needs node and nothing else, and
# keeping it in its own stage means none of node lands in the final image.
FROM node:22-slim AS web

WORKDIR /build/apps/web

# Dependencies before sources, so a change to a component does not re-resolve
# the dependency tree.
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY apps/web/ ./
# The interface is statically built against a same-origin /api, which is what
# the session cookie requires: it is SameSite=strict, so a cross-origin fetch
# drops it silently and every call answers 401.
RUN npm run build


# --- the workspace --------------------------------------------------------
FROM python:3.12-slim AS runtime

# `libgomp1` is needed by the scientific stack; the rest of the build tooling is
# installed and removed in the same layer so it does not ship.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

# Runs as a non-root user. The analysis sandbox already refuses network and
# database access from inside an analysis, but a container that runs everything
# as root undoes that at the layer below.
RUN useradd --create-home --uid 10001 throughline

WORKDIR /app

# Package metadata before sources, so editing a module does not reinstall the
# dependency tree. There is no root pyproject.toml — this is a workspace of
# nine independent packages, and a COPY glob matching nothing fails the build.
COPY packages/schemas/pyproject.toml            packages/schemas/
COPY packages/model/pyproject.toml              packages/model/
COPY packages/research-domain/pyproject.toml    packages/research-domain/
COPY packages/connector-sdk/pyproject.toml      packages/connector-sdk/
COPY packages/ingestion/pyproject.toml          packages/ingestion/
COPY packages/visual-spec/pyproject.toml        packages/visual-spec/
COPY services/scientific-runtime/pyproject.toml services/scientific-runtime/
COPY services/workers/pyproject.toml            services/workers/
COPY apps/api/pyproject.toml                    apps/api/

COPY packages/ packages/
COPY services/ services/
COPY apps/api/ apps/api/
COPY scripts/ scripts/

# Every workspace package, in dependency order — the same list bootstrap.sh
# installs. Four of the nine were missing there once, and the result was an
# install whose API could not import half of itself.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir \
      ./packages/schemas \
      ./packages/model \
      ./packages/research-domain \
      ./packages/connector-sdk \
      ./packages/ingestion \
      ./packages/visual-spec \
      ./services/scientific-runtime \
      ./services/workers \
      ./apps/api

COPY --from=web /build/apps/web/.next/       apps/web/.next/
COPY --from=web /build/apps/web/public/      apps/web/public/
COPY --from=web /build/apps/web/package.json apps/web/
COPY --from=web /build/apps/web/node_modules/ apps/web/node_modules/
COPY --from=web /usr/local/bin/node /usr/local/bin/node

# Everything the workspace keeps lives here, and nothing else does.
ENV THROUGHLINE_HOME=/data \
    PORT=8080 \
    WEB_PORT=3000 \
    PYTHONUNBUFFERED=1
RUN mkdir -p /data && chown -R throughline:throughline /data /app
VOLUME ["/data"]

USER throughline
EXPOSE 3000 8080

# Health is per dependency and 200 while degraded on purpose: a workspace with
# no model still does every deterministic thing, and restarting it would fix
# nothing while losing in-flight work. Only an unreachable database answers 503,
# which is the only state where taking the container out of rotation helps.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

CMD ["bash", "scripts/serve.sh"]
