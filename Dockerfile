FROM node:22 AS build
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm run build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install --frozen-lockfile --prod && \
    apt-get purge -y python3 make g++ && apt-get autoremove -y
RUN mkdir -p /app/data
EXPOSE 8766
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD curl -f http://localhost:8766/health || exit 1
CMD ["node", "dist/index.js", "serve", "--port", "8766"]
