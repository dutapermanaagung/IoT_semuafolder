# E-Nose Coffee — Azure Cosmos DB

Versi ini mengganti SQLite dengan Azure Cosmos DB for NoSQL.

## Arsitektur
ESP32-S3 -> Rust/Axum -> Azure Cosmos DB
                       -> WebSocket -> React

## 1. Azure Cosmos DB
Buat Cosmos DB for NoSQL, lalu buat:
- Database: `enose_coffee`
- Container: `sampling`
- Partition key: `/coffee_type`

Ambil endpoint dan key dari Azure Portal.

## 2. Backend
Salin `.env.example` menjadi `.env`, lalu isi credential Cosmos DB.

Jalankan:
```powershell
cd backend
cargo run
```

Backend berjalan di `http://127.0.0.1:8080`.

## 3. Frontend
```powershell
cd frontend
npm install
npm run dev
```

## 4. ESP32-S3
Buka `esp32/enose_esp32.ino` di Arduino IDE.
Ganti:
- WIFI_SSID
- WIFI_PASSWORD
- BACKEND_URL

Sesuaikan pin sensor dengan rangkaian yang digunakan.

## Endpoint
POST `/api/sampling`
GET `/api/sampling?coffee_type=robusta`
GET `/api/statistics?coffee_type=robusta`
GET `/api/health`
WebSocket `/ws`

Catatan:
- Jangan memasukkan COSMOS_KEY ke frontend atau ESP32.
- Untuk deployment publik, gunakan HTTPS/WSS dan simpan secret di environment/secret manager.
