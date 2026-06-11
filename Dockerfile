# Stage 1 — build the Vite bundle.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — serve the static bundle and proxy /rest/* to the router.
# Auth is injected by nginx server-side; the browser never sees the
# router credentials.
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/10-router-auth.envsh /docker-entrypoint.d/10-router-auth.envsh
COPY docker/15-runtime-config.sh /docker-entrypoint.d/15-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/10-router-auth.envsh /docker-entrypoint.d/15-runtime-config.sh
# Limit envsubst to OUR vars so nginx's own $uri / $host / $remote_addr
# in the template don't get expanded to empty strings at startup.
ENV NGINX_ENVSUBST_FILTER='^(ROUTER_URL|ROUTER_AUTH_B64)$'
EXPOSE 80
