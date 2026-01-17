FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/renderer/package.json apps/renderer/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/templates/package.json packages/templates/package.json

RUN npm install --no-audit --no-fund

COPY . .

WORKDIR /app/apps/renderer
RUN npx prisma generate

EXPOSE 3002
CMD ["sh", "-lc", "node --loader ts-node/esm src/index.ts"]
