FROM node:22-slim

WORKDIR /app

# Install native dependencies for @livekit/rtc-node
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY tsconfig.base.json ./
COPY tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY landing/package.json ./landing/

RUN npm install --workspace=apps/api --workspace=packages/database
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
