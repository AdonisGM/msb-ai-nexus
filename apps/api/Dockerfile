FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @nexus/api
COPY apps/api apps/api
RUN pnpm --filter @nexus/api build
# Bản chạy chỉ giữ dependencies, bỏ toàn bộ công cụ biên dịch
RUN pnpm --filter @nexus/api deploy --prod --legacy /out

FROM base AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
# Migration chạy lúc khởi động (src/main.ts gọi runMigrations trước khi nghe
# cổng), nên thư mục này phải đi cùng ảnh. Thiếu nó thì API lên được nhưng
# lược đồ đứng yên ở phiên bản cũ — hỏng lặng lẽ, không phải lỗi khởi động.
COPY --from=build /app/apps/api/drizzle ./drizzle
EXPOSE 3000
CMD ["node", "dist/main.js"]
