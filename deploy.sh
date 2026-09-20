#!/usr/bin/env bash
#
# Bảng điều khiển cho bản chạy thật.
#
# Ở máy phát triển dùng để dựng ảnh và đẩy lên registry; ở máy chủ dùng để kéo
# ảnh về, bật tắt, xem log và sao lưu. Máy chủ chỉ cần ba tệp: script này,
# docker-compose.prod.yml và .env.
#
#   ./deploy.sh help
#
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE=docker-compose.prod.yml
ENV_FILE=.env
BACKUP_DIR=backups
DB=${NEXUS_DB:-nexus}

# ── Nói cho người đọc biết chuyện gì đang xảy ra ────────────────────────────
if [ -t 1 ]; then B=$'\033[1m'; D=$'\033[2m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; N=$'\033[0m'
else B=''; D=''; R=''; G=''; Y=''; N=''; fi
say()  { printf '%s\n' "$B==>$N $*"; }
note() { printf '%s\n' "$D    $*$N"; }
warn() { printf '%s\n' "$Y!!  $*$N" >&2; }
die()  { printf '%s\n' "${R}✗   $*$N" >&2; exit 1; }
ok()   { printf '%s\n' "${G}✓   $*$N"; }

# ── .env là bắt buộc ────────────────────────────────────────────────────────
# Thiếu nó thì compose lặng lẽ dùng chuỗi rỗng cho mọi biến, và cái hỏng đầu
# tiên sẽ là cookie đăng nhập chứ không phải một thông báo lỗi.
need_env() {
  [ -f "$ENV_FILE" ] || die "chưa có $ENV_FILE. Chép từ .env.example rồi điền:  cp .env.example .env"
  set -a; . "./$ENV_FILE"; set +a
  local missing=()
  for v in REGISTRY IMAGE_NS WEB_ORIGIN VITE_API_BASE POSTGRES_PASSWORD; do
    [ -n "${!v:-}" ] || missing+=("$v")
  done
  [ ${#missing[@]} -eq 0 ] || die "$ENV_FILE thiếu giá trị: ${missing[*]}"
}

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

SERVICES=(api web)
img() { printf '%s/%s/%s' "$REGISTRY" "$IMAGE_NS" "$1"; }

pick() {  # pick <đối số còn lại...> → danh sách service hợp lệ
  if [ $# -eq 0 ]; then printf '%s\n' "${SERVICES[@]}"; return; fi
  for s in "$@"; do
    case " ${SERVICES[*]} " in *" $s "*) printf '%s\n' "$s" ;;
      *) die "không có service tên '$s'. Chọn trong: ${SERVICES[*]}" ;; esac
  done
}

# ── build: dựng cho arm64 rồi đẩy thẳng lên registry ────────────────────────
#
# Chỉ dựng linux/arm64: máy chủ chạy ARM, và máy phát triển cũng là Apple
# Silicon nên đây là bản dựng chạy thẳng trên máy, không qua giả lập. Máy chủ
# x86 thì thêm linux/amd64 vào --platform, nhưng bản ấy dựng bằng giả lập nên
# chậm hơn nhiều.
cmd_build() {
  need_env
  command -v git >/dev/null || die "cần git để lấy mã bản dựng"
  local tag; tag=$(git rev-parse --short HEAD)
  if [ -n "$(git status --porcelain)" ]; then
    warn "cây làm việc còn thay đổi chưa commit, ảnh sẽ mang nhãn $tag nhưng không khớp commit đó"
  fi

  # Số phiên bản in ở chân cột menu. git describe cho "v0.4.0" khi HEAD đúng là
  # một tag, và "v0.4.0-3-gabc1234" khi đã đi thêm ba commit — cái đuôi ấy cũng
  # là thông tin: nó nói ngay rằng bản đang chạy không phải bản đã phát hành.
  local ver; ver=$(git describe --tags --always 2>/dev/null || echo "$tag")

  docker buildx inspect nexus >/dev/null 2>&1 || {
    say "tạo builder"; docker buildx create --name nexus --use >/dev/null
  }
  docker buildx use nexus

  for s in $(pick "$@"); do
    say "dựng $s  ($ver)"
    local args=(--platform linux/arm64 -f "apps/$s/Dockerfile"
                --build-arg "APP_VERSION=$ver"
                -t "$(img "$s"):$tag" -t "$(img "$s"):latest" --push .)
    # Ảnh web phải biết gốc API và số phiên bản lúc dựng, vì cả hai bị nướng
    # vào bundle chứ không đọc lúc chạy.
    [ "$s" = web ] && args=(--build-arg "VITE_API_BASE=$VITE_API_BASE"
                            --build-arg "VITE_APP_VERSION=$ver" "${args[@]}")
    docker buildx build "${args[@]}"
    ok "$(img "$s"):$tag"
  done
  note "đặt TAG=$tag trong .env của máy chủ để ghim đúng bản này"
}

cmd_pull()    { need_env; say "kéo ảnh"; dc pull; }
cmd_up()      { need_env; say "bật"; dc up -d --remove-orphans "$@"; dc ps; }
cmd_down()    { need_env; say "tắt (dữ liệu trong volume vẫn còn)"; dc down "$@"; }
cmd_restart() { need_env; dc restart "$@"; }
cmd_ps()      { need_env; dc ps; }
cmd_logs()    { need_env; dc logs -f --tail=100 "$@"; }
cmd_psql()    { need_env; dc exec db psql -U nexus -d "$DB" "$@"; }

# Kéo bản mới rồi thay tại chỗ. Migration tự chạy lúc API khởi động.
cmd_deploy() {
  need_env
  cmd_pull
  say "thay container bằng bản mới"
  dc up -d --remove-orphans
  dc ps
  ok "xong"
}

# Sáu tài khoản vận hành. Không đụng tới khách hàng hay cơ hội.
cmd_seed() {
  need_env
  [ -n "${SEED_PASSWORD:-}" ] || die "$ENV_FILE thiếu SEED_PASSWORD"
  say "ghi tài khoản"
  dc exec api node dist/seed.js
}

# Dữ liệu mẫu. XOÁ toàn bộ khách hàng, cơ hội và chỉ tiêu đang có.
cmd_seed_demo() {
  need_env
  [ -n "${SEED_PASSWORD:-}" ] || die "$ENV_FILE thiếu SEED_PASSWORD"
  warn "lệnh này xoá sạch khách hàng, cơ hội và chỉ tiêu rồi dựng lại dữ liệu mẫu"
  read -rp "    gõ 'demo' để tiếp tục: " answer
  [ "$answer" = demo ] || die "dừng"
  cmd_backup
  dc exec api node dist/seed.js --demo
}

# Sao lưu trước mọi thứ có thể hỏng. Nén ngay, và giữ tên theo giờ máy chủ.
cmd_backup() {
  need_env
  mkdir -p "$BACKUP_DIR"
  local file="$BACKUP_DIR/nexus-$(date +%Y%m%d-%H%M%S).sql.gz"
  say "sao lưu $DB"
  dc exec -T db pg_dump -U nexus -d "$DB" | gzip > "$file"
  ok "$file  ($(du -h "$file" | cut -f1))"
}

cmd_restore() {
  need_env
  local file=${1:?dùng: ./deploy.sh restore <tệp.sql.gz>}
  [ -f "$file" ] || die "không thấy $file"
  warn "lệnh này GHI ĐÈ toàn bộ cơ sở dữ liệu $DB bằng nội dung $file"
  read -rp "    gõ 'restore' để tiếp tục: " answer
  [ "$answer" = restore ] || die "dừng"
  gunzip -c "$file" | dc exec -T db psql -U nexus -d "$DB"
  ok "đã phục hồi"
}

cmd_help() {
  cat <<'TXT'
Dùng: ./deploy.sh <lệnh> [tham số]

Ở máy phát triển
  build [api|web]   dựng ảnh cho linux/arm64 rồi đẩy lên registry

Ở máy chủ
  pull              kéo ảnh theo TAG trong .env
  up / down         bật, tắt (volume dữ liệu vẫn còn)
  deploy            pull rồi thay container, migration tự chạy
  restart [dv]      khởi động lại một service
  ps / logs [dv]    trạng thái, nhật ký
  psql [...]        mở psql trong container db
  seed              ghi sáu tài khoản vận hành
  seed-demo         XOÁ rồi dựng lại dữ liệu mẫu (tự sao lưu trước)
  backup            kết xuất cơ sở dữ liệu ra backups/
  restore <tệp>     GHI ĐÈ cơ sở dữ liệu bằng một bản sao lưu
TXT
}

case "${1:-help}" in
  build)     shift; cmd_build "$@" ;;
  pull)      shift; cmd_pull "$@" ;;
  up)        shift; cmd_up "$@" ;;
  down)      shift; cmd_down "$@" ;;
  deploy)    shift; cmd_deploy "$@" ;;
  restart)   shift; cmd_restart "$@" ;;
  ps)        shift; cmd_ps "$@" ;;
  logs)      shift; cmd_logs "$@" ;;
  psql)      shift; cmd_psql "$@" ;;
  seed)      shift; cmd_seed "$@" ;;
  seed-demo) shift; cmd_seed_demo "$@" ;;
  backup)    shift; cmd_backup "$@" ;;
  restore)   shift; cmd_restore "$@" ;;
  help|-h|--help) cmd_help ;;
  *) die "không có lệnh '$1'. Xem ./deploy.sh help" ;;
esac
