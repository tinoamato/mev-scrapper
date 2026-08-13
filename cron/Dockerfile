# Imagen para el Railway Cron Job de MEV.
# Recorte del Dockerfile de legal-saas/server: mismo Node+Python+Selenium+Chromium
# para el scraper, sin Playwright/PJN (no aplica a este monitor).
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pip \
    chromium \
    chromium-driver \
    tini \
    && rm -rf /var/lib/apt/lists/*

RUN if [ -f /usr/bin/chromium-driver ]; then ln -s /usr/bin/chromium-driver /usr/bin/chromedriver; fi
RUN python3 --version && chromium --version && chromedriver --version

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --ignore-scripts
RUN npx prisma generate

COPY scripts/requirements-mev.txt ./scripts/
RUN python3 -m pip install --break-system-packages --no-cache-dir -r scripts/requirements-mev.txt

COPY . .
RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV MEV_HEADLESS=1
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver

# tini como PID 1: recolecta los procesos huérfanos de chromium/chromedriver
# que Selenium deja al matar el driver (mismo fix ya aplicado en legal-saas).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/run-mev-check.js"]
