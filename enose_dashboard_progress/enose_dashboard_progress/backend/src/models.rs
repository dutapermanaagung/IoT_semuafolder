use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensorValues {
    #[serde(default)]
    pub mq3: f64,
    #[serde(default)]
    pub mq6: f64,
    #[serde(default)]
    pub mq7: f64,
    #[serde(default)]
    pub mq135: f64,
    #[serde(default)]
    pub tgs2600: f64,
    #[serde(default)]
    pub tgs2602: f64,
    #[serde(default)]
    pub tgs2611: f64,
    #[serde(default)]
    pub tgs2620: f64,
    #[serde(default)]
    pub temperature: f64,
    #[serde(default)]
    pub humidity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingPayload {
    pub coffee_type: String,
    #[serde(default)]
    pub status_coffee: Option<String>,
    #[serde(default)]
    pub batch: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub firmware_version: Option<String>,
    #[serde(default)]
    pub connected_wifi: Option<String>, // Menangkap info SSID Wi-Fi aktif
    #[serde(default)]
    pub confidence_score: Option<f64>,
    pub sensors: SensorValues,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sampling {
    pub id: String,
    #[serde(default)]
    pub device_id: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub data: SamplingPayload,
}

#[derive(Debug, Deserialize)]
pub struct CreateSampling {
    pub coffee_type: String,
    #[serde(default)]
    pub status_coffee: Option<String>,
    #[serde(default)]
    pub batch: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub firmware_version: Option<String>,
    #[serde(default)]
    pub connected_wifi: Option<String>, // Menangkap info SSID Wi-Fi dari request
    #[serde(default)]
    pub confidence_score: Option<f64>,
    pub sensors: SensorValues,
}

#[derive(Debug, Serialize)]
pub struct Statistics {
    pub coffee_type: String,
    pub count: usize,
    pub mq3_avg: f64,
    pub mq6_avg: f64,
    pub mq7_avg: f64,
    pub mq135_avg: f64,
    pub tgs2600_avg: f64,
    pub tgs2602_avg: f64,
    pub tgs2611_avg: f64,
    pub tgs2620_avg: f64,
    pub temperature_avg: f64,
    pub humidity_avg: f64,
}