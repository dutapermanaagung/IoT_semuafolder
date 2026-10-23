mod cosmos;
mod models;

use axum::{
    extract::{Multipart, Query, State, WebSocketUpgrade, ws::{Message, WebSocket}},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use cosmos::CosmosRepo;
use models::{CreateSampling, Sampling, SamplingPayload, Statistics};
use serde::Deserialize;
use std::{env, net::SocketAddr, sync::Arc};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    repo: CosmosRepo,
    tx: broadcast::Sender<String>,
}

#[derive(Debug, Deserialize)]
struct SamplingQuery {
    coffee_type: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    let endpoint = env::var("COSMOS_ENDPOINT")
        .map_err(|_| anyhow::anyhow!("Environment variable COSMOS_ENDPOINT tidak ditemukan."))?;
    let key = env::var("COSMOS_KEY")
        .map_err(|_| anyhow::anyhow!("Environment variable COSMOS_KEY tidak ditemukan."))?;
    let database = env::var("COSMOS_DATABASE").unwrap_or_else(|_| "IoTDatabase".into());
    let container = env::var("COSMOS_CONTAINER").unwrap_or_else(|_| "TelemetryData".into());
    let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port: u16 = env::var("PORT").unwrap_or_else(|_| "8081".into()).parse()?;
    
    let repo_result = CosmosRepo::new(endpoint, key, database, container).await;
    match &repo_result {
        Ok(_) => println!("[INFO] Database status: Connected (Azure Cosmos DB OK)"),
        Err(e) => eprintln!("[ERROR] Database status: Disconnected / Error -> {}", e),
    }
    let repo = repo_result?;
    let (tx, _) = broadcast::channel(100);
    let state = Arc::new(AppState { repo, tx });

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/sampling", post(create_sampling).get(get_sampling))
        .route("/api/statistics", get(statistics))
        .route("/api/firmware", post(upload_firmware))
        .route("/ws", get(websocket))
        .with_state(state)
        .layer(CorsLayer::very_permissive());

    let addr: SocketAddr = format!("{host}:{port}").parse()?;
    println!("Backend running at http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok", 
        "database": "Azure Cosmos DB (IoTDatabase)",
        "container": "TelemetryData",
        "db": "Connected"
    }))
}

async fn upload_firmware(
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut file_name = String::new();
    let mut file_bytes = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("firmware") || field.name() == Some("file") {
            if let Some(name) = field.file_name() {
                file_name = name.to_string();
            }
            if let Ok(data) = field.bytes().await {
                file_bytes = data.to_vec();
            }
        }
    }

    if file_name.is_empty() || file_bytes.is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "status": "error",
                "message": "File .bin tidak ditemukan dalam request"
            })),
        ));
    }

    if !file_name.ends_with(".bin") {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "status": "error",
                "message": "File harus berekstensi .bin"
            })),
        ));
    }

    let storage_account = env::var("STORAGE_ACCOUNT_NAME").unwrap_or_else(|_| "storageesp32ota".into());
    let _storage_key = env::var("STORAGE_ACCOUNT_KEY").map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "status": "error",
                "message": "STORAGE_ACCOUNT_KEY belum dikonfigurasi di Environment Variables"
            })),
        )
    })?;

    let blob_url = format!(
        "https://{}.blob.core.windows.net/firmware/{}",
        storage_account, file_name
    );

    let client = reqwest::Client::new();
    let now = Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string();

    let res = client
        .put(&blob_url)
        .header("x-ms-blob-type", "BlockBlob")
        .header("x-ms-date", &now)
        .header("x-ms-version", "2020-10-02")
        .body(file_bytes)
        .send()
        .await
        .map_err(|e| (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "status": "error",
                "message": format!("Gagal terhubung ke Azure Blob: {}", e)
            })),
        ))?;

    if res.status().is_success() {
        Ok(Json(serde_json::json!({
            "status": "success",
            "message": "Firmware berhasil diunggah ke Azure Storage. Pemicu OTA diaktifkan.",
            "file_name": file_name,
            "url": blob_url
        })))
    } else {
        let err_text = res.text().await.unwrap_or_default();
        Err((
            axum::http::StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "status": "error",
                "message": format!("Gagal unggah ke Azure Blob: {}", err_text)
            })),
        ))
    }
}

async fn create_sampling(
    State(state): State<Arc<AppState>>,
    Json(input): Json<CreateSampling>,
) -> Result<Json<Sampling>, (axum::http::StatusCode, String)> {
    let coffee_type = input.coffee_type.trim().to_lowercase();
    if coffee_type.is_empty() {
        return Err((axum::http::StatusCode::BAD_REQUEST, "coffee_type tidak boleh kosong".into()));
    }

    let dev_id = input.device_id.clone().unwrap_or_else(|| "esp32s3-device-01".into());
    let item = Sampling {
        id: Uuid::new_v4().to_string(),
        device_id: Some(dev_id),
        timestamp: Utc::now(),
        data: SamplingPayload {
            coffee_type,
            status_coffee: input.status_coffee,
            batch: input.batch,
            firmware_version: input.firmware_version,
            connected_wifi: input.connected_wifi,
            confidence_score: input.confidence_score,
            sensors: input.sensors,
        },
    };

    let msg = serde_json::to_string(&item).map_err(internal_error)?;
    let _ = state.tx.send(msg);

    Ok(Json(item))
}

async fn get_sampling(
    State(state): State<Arc<AppState>>,
    Query(params): Query<SamplingQuery>,
) -> Result<Json<Vec<Sampling>>, (axum::http::StatusCode, String)> {
    let coffee_type = params.coffee_type.unwrap_or_else(|| "robusta".into()).to_lowercase();
    let items = state.repo.list_by_type(&coffee_type).await.map_err(internal_error)?;
    Ok(Json(items))
}

async fn statistics(
    State(state): State<Arc<AppState>>,
    Query(params): Query<SamplingQuery>,
) -> Result<Json<Statistics>, (axum::http::StatusCode, String)> {
    let coffee_type = params.coffee_type.unwrap_or_else(|| "robusta".into()).to_lowercase();
    let items = state.repo.list_by_type(&coffee_type).await.map_err(internal_error)?;
    let count = items.len();

    if count == 0 {
        return Ok(Json(Statistics {
            coffee_type,
            count: 0,
            mq3_avg: 0.0,
            mq6_avg: 0.0,
            mq7_avg: 0.0,
            mq135_avg: 0.0,
            tgs2600_avg: 0.0,
            tgs2602_avg: 0.0,
            tgs2611_avg: 0.0,
            tgs2620_avg: 0.0,
            temperature_avg: 0.0,
            humidity_avg: 0.0,
        }));
    }

    let avg = |f: fn(&Sampling) -> f64| items.iter().map(f).sum::<f64>() / count as f64;

    Ok(Json(Statistics {
        coffee_type,
        count,
        mq3_avg: avg(|x| x.data.sensors.mq3),
        mq6_avg: avg(|x| x.data.sensors.mq6),
        mq7_avg: avg(|x| x.data.sensors.mq7),
        mq135_avg: avg(|x| x.data.sensors.mq135),
        tgs2600_avg: avg(|x| x.data.sensors.tgs2600),
        tgs2602_avg: avg(|x| x.data.sensors.tgs2602),
        tgs2611_avg: avg(|x| x.data.sensors.tgs2611),
        tgs2620_avg: avg(|x| x.data.sensors.tgs2620),
        temperature_avg: avg(|x| x.data.sensors.temperature),
        humidity_avg: avg(|x| x.data.sensors.humidity),
    }))
}

async fn websocket(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| websocket_task(socket, state.tx.subscribe()))
}

async fn websocket_task(mut socket: WebSocket, mut rx: broadcast::Receiver<String>) {
    while let Ok(message) = rx.recv().await {
        if socket.send(Message::Text(message.into())).await.is_err() {
            break;
        }
    }
}

fn internal_error<E: std::fmt::Display>(err: E) -> (axum::http::StatusCode, String) {
    (axum::http::StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
}