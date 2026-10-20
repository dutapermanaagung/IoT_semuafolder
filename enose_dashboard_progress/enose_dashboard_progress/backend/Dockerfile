# Stage 1: Builder
FROM rust:bookworm AS builder

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifest & seluruh source code asli
COPY Cargo.toml Cargo.lock ./
COPY src ./src

# Build biner release secara bersih dari source asli
RUN cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy biner executable hasil build
COPY --from=builder /app/target/release/enose-cosmos-backend /app/backend

ENV PORT=8080
ENV HOST=0.0.0.0

EXPOSE 8080

CMD ["./backend"]