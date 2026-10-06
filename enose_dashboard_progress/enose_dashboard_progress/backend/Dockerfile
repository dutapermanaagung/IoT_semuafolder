# ======================
# Stage 1: Builder
# ======================
FROM rust:1.80-slim AS builder

# Install dependency yang dibutuhkan untuk compile (sangat penting!)
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Cargo.toml & Cargo.lock dulu supaya dependency di-cache
COPY Cargo.toml Cargo.lock ./

# Buat dummy source supaya cargo bisa resolve dependency
RUN mkdir src && echo "fn main() {}" > src/main.rs

# Build dependency dulu (layer ini akan di-cache)
RUN cargo build --release

# Hapus dummy dan copy source code asli
RUN rm -rf src
COPY src ./src

# Build ulang dengan source asli
RUN touch src/main.rs && cargo build --release

# ======================
# Stage 2: Runtime
# ======================
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Gunakan nama binary yang benar sesuai Cargo.toml
COPY --from=builder /app/target/release/enose-cosmos-backend /app/backend

EXPOSE 8080

CMD ["./backend"]