FROM node:26-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ pkgconfig
COPY package.json package-lock.json ./
COPY scripts/check-install-script-policy.mjs scripts/dependency-installation.mjs scripts/npm-install-policy.mjs scripts/node-gyp-local-headers.cjs ./scripts/
COPY vendor/brace-expansion-compat ./vendor/brace-expansion-compat
ENV NODE_OPTIONS=--require=/app/scripts/node-gyp-local-headers.cjs
RUN npm run install-scripts:check && npm run npm-install-policy:check && npm ci --strict-allow-scripts && npm run dependencies:check
ENV NODE_OPTIONS=

FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_IMAGE_STORAGE_MODE=fs
ENV NEXT_PUBLIC_IMAGE_STORAGE_MODE=${NEXT_PUBLIC_IMAGE_STORAGE_MODE}
COPY . .
RUN npm run build

FROM node:26-alpine AS runner
WORKDIR /app
ARG NEXT_PUBLIC_IMAGE_STORAGE_MODE=fs
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_IMAGE_STORAGE_MODE=${NEXT_PUBLIC_IMAGE_STORAGE_MODE}
ENV PORT=4783
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/node_modules/next/dist/compiled/next-server ./node_modules/next/dist/compiled/next-server

RUN mkdir -p /app/generated-images && chown node:node /app/generated-images
USER node

EXPOSE 4783
CMD ["node", "server.js"]
