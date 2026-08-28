# syntax=docker/dockerfile:1

# Reality Check, as one process: it serves the built client and answers /api on
# the same origin. Two stages, because the build needs Vite, React and the
# TypeScript compiler and the thing that runs needs none of them.

# ---------- build the client ----------
FROM node:22-alpine AS client
WORKDIR /app/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
# The build typechecks across into the scoring engine, so it has to be here
# before `tsc -b` runs, at the ../spike the imports name.
COPY spike/ /app/spike/

# Vite inlines this into the bundle, so it is a build argument rather than a
# runtime secret like the rest. That is correct: a Mapbox *public* token is
# meant to reach the browser. Restrict it by URL in the Mapbox dashboard --
# that, not secrecy, is what stops someone else spending it.
ARG VITE_MAPBOX_TOKEN=""
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
RUN npm run build

# ---------- run ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# No node_modules: every import in the server is a Node builtin -- node:http,
# node:sqlite, node:crypto, fetch -- so the runtime image is the sources and
# the built client and nothing else.
COPY spike/src ./spike/src
# The safety indexes -- one per city, about 18MB in total. Gitignored, so they
# come from the working copy rather than the repo: build them before deploying
# (`npm run build-index` for San Jose, `build-sf`, and `build-city -- <id>` for
# the rest) or those cities score nothing.
COPY spike/data/blocks*.json ./spike/data/
COPY web/server.ts web/auth.ts web/store.ts ./web/
COPY --from=client /app/web/dist ./web/dist

EXPOSE 8080
CMD ["node", "--experimental-strip-types", "--no-warnings", "web/server.ts"]
