FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/

RUN npm install --workspace=apps/api --workspace=packages/database

COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/database 2>/dev/null || true
RUN npm run build --workspace=apps/api

# Create uploads directory
RUN mkdir -p /app/apps/api/uploads

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
