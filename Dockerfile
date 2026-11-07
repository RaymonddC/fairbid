# syntax=docker/dockerfile:1

# Node major must match the one that wrote package-lock.json: npm 10 and npm 11
# resolve differently, and `npm ci` then fails on a lock that installs locally.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Baked into the browser bundle, so this is a build arg.
ARG NEXT_PUBLIC_PAYPAL_CLIENT_ID=""
ENV NEXT_PUBLIC_PAYPAL_CLIENT_ID=$NEXT_PUBLIC_PAYPAL_CLIENT_ID
RUN npx prisma generate
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
# Cloud Run sets PORT; the standalone server honours it.
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
