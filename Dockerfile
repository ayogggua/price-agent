FROM public.ecr.aws/docker/library/node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
COPY client ./client
COPY designs/quote-input ./designs/quote-input
RUN npm run build && npm prune --omit=dev
FROM public.ecr.aws/docker/library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/client ./client
COPY --from=build /app/designs ./designs
RUN mkdir -p /app/.local/uploads && chown -R node:node /app/.local
USER node
EXPOSE 4312
CMD ["node","server/index.mjs"]
