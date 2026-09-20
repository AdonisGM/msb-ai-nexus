# Dựng lên máy chủ

Máy chủ chỉ cần ba tệp, không cần mã nguồn, không cần Node hay pnpm:

    docker-compose.prod.yml
    deploy.sh
    .env

## Lần đầu

    mkdir -p /srv/nexus && cd /srv/nexus
    # chép ba tệp trên lên
    cp .env.example .env        # rồi điền, xem bảng dưới
    docker login registry.marigate.org
    ./deploy.sh pull
    ./deploy.sh up
    ./deploy.sh seed            # sáu tài khoản vận hành

`.env` trên máy chủ khác `.env` ở máy phát triển:

| Biến | Máy chủ |
|---|---|
| `WEB_ORIGIN` | `https://nexus.nmtung.dev` — API chỉ nhận cookie từ đúng origin này |
| `POSTGRES_PASSWORD` | sinh mới, `openssl rand -base64 24` |
| `SEED_PASSWORD` | mật khẩu chung của sáu tài khoản demo |
| `TAG` | mã commit in ra ở cuối `./deploy.sh build`, hoặc `latest` |
| `BIND_ADDR` | để `127.0.0.1`, nginx đứng trước |

`VITE_API_BASE` và `REGISTRY` thì máy chủ không dùng tới — cái đầu đã nằm
trong ảnh web từ lúc build, cái sau chỉ cần khi kéo ảnh.

## Lên bản mới

Ở máy phát triển:

    ./deploy.sh build

Ở máy chủ:

    ./deploy.sh deploy

Migration tự chạy lúc API khởi động, không có bước riêng.

## Nginx

Xem `nginx.conf.example`. Hai máy chủ ảo, một cho web một cho API, cùng trỏ
vào 127.0.0.1.

## Sao lưu

    ./deploy.sh backup            # ra backups/nexus-<ngày giờ>.sql.gz
    ./deploy.sh restore <tệp>     # GHI ĐÈ, có hỏi lại

`seed-demo` tự sao lưu trước khi xoá.
