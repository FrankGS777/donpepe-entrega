FROM node:24-alpine AS map-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./frontend
COPY v2/frontend ./v2/frontend
COPY utils/scanCode.js ./utils/scanCode.js
RUN npm run build

FROM node:24-alpine
ENV TZ=America/Lima
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
COPY --from=map-builder /app/public/js/warehouse-map.js ./public/js/warehouse-map.js
COPY --from=map-builder /app/public/js/scanner.js ./public/js/scanner.js
COPY --from=map-builder /app/public/js/logistics-network.js ./public/js/logistics-network.js
COPY --from=map-builder /app/v2/public/app.js ./v2/public/app.js
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm", "run", "start:legacy"]
