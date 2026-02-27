FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
RUN NODE_OPTIONS=--max-old-space-size=512 npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src/agents/ghostwriter/knowledge ./dist/agents/ghostwriter/knowledge
COPY public ./public
COPY package.json ./
RUN mkdir -p /app/storage/SecondBrain
EXPOSE 8080
CMD ["node", "dist/index.js"]
