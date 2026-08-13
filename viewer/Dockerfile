# Viewer liviano — sin Python/Chromium, arranca rápido al despertar del sleep.
FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --ignore-scripts
RUN npx prisma generate

COPY . .
RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "dist/server.js"]
