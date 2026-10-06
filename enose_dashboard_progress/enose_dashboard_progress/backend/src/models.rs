use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensorValues {
    #[serde(default)]
    pub mq2: f64,
    #[serde(default)]
    pub mq3: f64,
    #[serde(default)]
    pub mq135: f64,
    #[serde(default)]
    pub mq138: f64,
    #[serde(default)]
    pub temperature: f64,
    #[serde(default)]
    pub humidity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingPayload {
    pub coffee_type: String,
    #[serde(default)]
    pub device_id: Option<String>,
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
    pub device_id: Option<String>,
    pub sensors: SensorValues,
}

#[derive(Debug, Serialize)]
pub struct Statistics {
    pub coffee_type: String,
    pub count: usize,
    pub mq2_avg: f64,
    pub mq3_avg: f64,
    pub mq135_avg: f64,
    pub mq138_avg: f64,
    pub temperature_avg: f64,
    pub humidity_avg: f64,
}