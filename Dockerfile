FROM node:22-alpine AS development
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run db:generate
EXPOSE 3000
CMD ["npm", "run", "dev"]
