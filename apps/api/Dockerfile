FROM node:20-alpine
WORKDIR /app

# Copy only package manifests first for better caching
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/renderer/package.json apps/renderer/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/templates/package.json packages/templates/package.json

RUN npm install --no-audit --no-fund

# Copy source
COPY . .

WORKDIR /app/apps/api
RUN npx prisma generate

EXPOSE 3001
# v0.x uses `db push` to keep setup friction low.
# When the schema stabilizes, switch to migrations (`migrate deploy`).
CMD ["sh", "-lc", "npx prisma db push && node --loader ts-node/esm src/index.ts"]
