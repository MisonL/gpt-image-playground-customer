FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ pkgconfig
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache python3 make g++ pkgconfig
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
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
