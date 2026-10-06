mod cosmos;
mod models;

use axum::{
    extract::{Query, State, WebSocketUpgrade, ws::{Message, WebSocket}},
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
        .map_err(|_| anyhow::anyhow!("Environment variable COSMOS_ENDPOINT tidak ditemukan. Silakan buat file .env di folder backend berdasarkan .env.example"))?;
    let key = env::var("COSMOS_KEY")
        .map_err(|_| anyhow::anyhow!("Environment variable COSMOS_KEY tidak ditemukan. Silakan tambahkan COSMOS_KEY ke file .env"))?;
    let database = env::var("COSMOS_DATABASE").unwrap_or_else(|_| "IoTDatabase".into());
    let container = env::var("COSMOS_CONTAINER").unwrap_or_else(|_| "TelemetryData".into());
    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = env::var("PORT").unwrap_or_else(|_| "8080".into()).parse()?;
    
    // Inisialisasi repository Cosmos DB
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
        device_id: Some(dev_id.clone()),
        timestamp: Utc::now(),
        data: SamplingPayload {
            coffee_type,
            device_id: Some(dev_id),
            sensors: input.sensors,
        },
    };

    state.repo.insert(&item).await.map_err(internal_error)?;

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
            coffee_type, count: 0,
            mq2_avg: 0.0, mq3_avg: 0.0, mq135_avg: 0.0, mq138_avg: 0.0,
            temperature_avg: 0.0, humidity_avg: 0.0,
        }));
    }

    let avg = |f: fn(&Sampling) -> f64| items.iter().map(f).sum::<f64>() / count as f64;

    Ok(Json(Statistics {
        coffee_type,
        count,
        mq2_avg: avg(|x| x.data.sensors.mq2),
        mq3_avg: avg(|x| x.data.sensors.mq3),
        mq135_avg: avg(|x| x.data.sensors.mq135),
        mq138_avg: avg(|x| x.data.sensors.mq138),
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