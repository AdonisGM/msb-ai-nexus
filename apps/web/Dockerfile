FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @nexus/web
COPY apps/web apps/web
# Hai giá trị này nướng thẳng vào bundle, nên ảnh web chỉ chạy đúng với tên
# miền đã dựng cho nó. Đổi tên miền API là phải dựng và đẩy lại ảnh web.
ARG VITE_API_BASE
ARG VITE_APP_VERSION=dev
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_APP_VERSION=$VITE_APP_VERSION
RUN pnpm --filter @nexus/web build

FROM nginx:1.29-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
