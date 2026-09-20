FROM oven/bun:1.3-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS release
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER bun
ENTRYPOINT ["bun", "run", "src/dev.ts"]
