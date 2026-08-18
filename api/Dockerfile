# Node.js API with OTel instrumentation loaded via --require
FROM node:22-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# --require loads instrumentation.js BEFORE index.js so the OTel SDK
# patches all libraries before they are imported by application code.
CMD ["node", "--require", "./src/instrumentation.js", "src/index.js"]
