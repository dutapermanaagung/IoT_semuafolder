# Stage 1: Build binary Rust
FROM rust:1.75-slim AS builder

WORKDIR /app
COPY . .

# Build aplikasi dalam mode release
RUN cargo build --release

# Stage 2: Runtime image yang ringan
FROM debian:bookworm-slim

WORKDIR /app

# Install dependensi dasar yang sering dibutuhkan aplikasi network/SSL
RUN apt-get update && apt-get install -y \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Salin binary hasil build dari builder stage
COPY --from=builder /app/target/release/backend /app/backend

# Port yang digunakan backend (sesuaikan dengan kode Rust kamu, misal 8080)
EXPOSE 8080

# Jalankan aplikasi
CMD ["./backend"]