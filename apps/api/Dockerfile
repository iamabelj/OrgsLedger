FROM node:22-alpine

WORKDIR /app

# Install native dependencies for @livekit/rtc-node
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package.json ./
COPY tsconfig.base.json ./
COPY tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY landing/package.json ./landing/

RUN npm install --workspace=apps/api --workspace=packages/database
# Install the musl-specific livekit native binary
RUN npm install @livekit/rtc-node-linux-x64-musl --workspace=apps/api || true
RUN cd landing && npm install --omit=dev

COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY landing/ ./landing/

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/database 2>/dev/null || true
RUN npm run build --workspace=apps/api

# Create uploads directory
RUN mkdir -p /app/apps/api/uploads

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
