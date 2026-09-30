use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use anyhow::Context;
use embedded_svc::http::client::Client as HttpClient;
use embedded_svc::http::Method;

use esp_idf_svc::eventloop::EspSystemEventLoop;
use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::http::client::{Configuration as HttpConfig, EspHttpConnection};
use esp_idf_svc::mqtt::client::{
    EspMqttClient, EventPayload, MqttClientConfiguration, QoS,
};
use esp_idf_svc::nvs::EspDefaultNvsPartition;
use esp_idf_svc::ota::EspOta;
use esp_idf_svc::wifi::{AuthMethod, BlockingWifi, ClientConfiguration, Configuration, EspWifi};

use serde_json::json;

// =========================================================================
// KONFIGURASI JARINGAN & AZURE IOT HUB
// =========================================================================
pub const WIFI_SSID: &str = "x1"; 
pub const WIFI_PASS: &str = "opoaeiso";

pub const AZURE_HOST: &str = "mqtts://iothubesp32s3.azure-devices.net:8883";
pub const DEVICE_ID: &str = "esp32s3-device-01";
pub const AZURE_USERNAME: &str = "iothubesp32s3.azure-devices.net/esp32s3-device-01/?api-version=2021-04-12";
// Catatan: Pastikan token SAS diperbarui secara berkala atau diganti token generator jika masa aktif habis
pub const AZURE_SAS_TOKEN: &str = "SharedAccessSignature sr=iothubesp32s3.azure-devices.net%2Fdevices%2Fesp32s3-device-01&sig=KSx9ZmaccQi5k4rftEi%2BwsbI5WMdO86H4fJla80v0Vs%3D&se=1852030800";
pub const FIRMWARE_VERSION: &str = "1.0.2"; 

// Struktur data telemetri yang dikirim via MPSC Channel dari Kelompok A ke C
pub struct TelemetryData {
    pub variant_name: String,
    pub confidence_score: f32,
    pub uptime_sec: u64,
}

fn main() -> anyhow::Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("==============================================");
    log::info!("ESP32-S3 IoT: E-Nose Edge Impulse & Azure OTA");
    log::info!("Firmware Version: {}", FIRMWARE_VERSION);
    log::info!("==============================================");

    // Cek status OTA saat booting
    if let Ok(mut ota) = EspOta::new() {
        if let Ok(running_slot) = ota.get_running_slot() {
            log::info!("Booting dari slot OTA: {:?}", running_slot.label);
            let _ = ota.mark_running_slot_valid();
        }
    }

    let peripherals = Peripherals::take().context("Gagal menginisialisasi periferal")?;
    let sys_loop = EspSystemEventLoop::take().context("Gagal mengambil system event loop")?;
    let nvs = EspDefaultNvsPartition::take().context("Gagal mengambil NVS partition")?;

    log::info!("Menghubungkan ke Wi-Fi...");
    let mut wifi = BlockingWifi::wrap(
        EspWifi::new(peripherals.modem, sys_loop.clone(), Some(nvs))?,
        sys_loop,
    )?;

    if connect_wifi(&mut wifi).is_ok() {
        log::info!("Menghubungkan ke Azure IoT Hub...");
        let is_connected = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mqtt_client = setup_azure_mqtt(is_connected.clone());

        match mqtt_client {
            Ok(mut client) => {
                // Tunggu sampai terhubung ke broker Azure
                while !is_connected.load(std::sync::atomic::Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(500));
                }

                let telemetry_topic = format!("devices/{}/messages/events/", DEVICE_ID);
                
                // Membuat MPSC Channel untuk komunikasi antar task/kelompok
                let (tx, rx): (Sender<TelemetryData>, Receiver<TelemetryData>) = mpsc::channel();

                // Spawn Task Simulasi / Inferensi Kelompok A (Edge Impulse)
                thread::spawn(move || {
                    let mut uptime_sec = 0u64;
                    loop {
                        thread::sleep(Duration::from_secs(5));
                        uptime_sec += 5;

                        // TODO KELOMPOK A: Ganti dengan hasil inferensi model Edge Impulse asli
                        let variant = format!("Varian_{}", (uptime_sec % 18) + 1);
                        let confidence = 85.0 + (uptime_sec % 14) as f32;

                        let data = TelemetryData {
                            variant_name: variant,
                            confidence_score: confidence,
                            uptime_sec,
                        };

                        // Kirim data ke channel, tangani jika error
                        if let Err(e) = tx.send(data) {
                            log::error!("Gagal mengirim data via MPSC channel: {:?}", e);
                            break;
                        }
                    }
                });

                // =========================================================================
                // LOOP UTAMA (KELOMPOK C): MEMBACA CHANNEL & KIRIM KE AZURE
                // =========================================================================
                loop {
                    // Menerima data dari channel secara aman tanpa memblokir inferensi ML
                    if let Ok(data) = rx.recv() {
                        if is_connected.load(std::sync::atomic::Ordering::SeqCst) {
                            let telemetry_payload = json!({
                                "variant_name": data.variant_name,
                                "confidence_score": data.confidence_score,
                                "uptime_sec": data.uptime_sec,
                                "firmware_version": FIRMWARE_VERSION,
                            });

                            let payload_str = telemetry_payload.to_string();
                            let _ = client.publish(
                                &telemetry_topic,
                                QoS::AtLeastOnce,
                                false,
                                payload_str.as_bytes(),
                            );

                            log::info!(
                                "Dikirim ke Azure -> Varian: {} | Akurasi: {:.1}%",
                                data.variant_name,
                                data.confidence_score
                            );
                        }
                    }
                }
            }
            Err(e) => log::error!("Gagal menginisialisasi MQTT Azure: {:?}", e),
        }
    }

    loop {
        thread::sleep(Duration::from_secs(1));
    }
}

// Fungsi Koneksi Wi-Fi dengan mekanisme Auto-Reconnect sederhana
fn connect_wifi(wifi: &mut BlockingWifi<EspWifi<'static>>) -> anyhow::Result<()> {
    let wifi_configuration: Configuration = Configuration::Client(ClientConfiguration {
        ssid: WIFI_SSID.try_into().unwrap_or_default(),
        bssid: None,
        auth_method: AuthMethod::WPA2Personal,
        password: WIFI_PASS.try_into().unwrap_or_default(),
        channel: None,
        ..Default::default()
    });

    wifi.set_configuration(&wifi_configuration)?;
    wifi.start()?;
    wifi.connect()?;
    wifi.wait_netif_up()?;
    Ok(())
}

// Fungsi Setup MQTT & Listener OTA
fn setup_azure_mqtt(
    is_connected: Arc<std::sync::atomic::AtomicBool>,
) -> anyhow::Result<EspMqttClient<'static>> {
    let conf = MqttClientConfiguration {
        client_id: Some(DEVICE_ID),
        username: Some(AZURE_USERNAME),
        password: Some(AZURE_SAS_TOKEN),
        keep_alive_interval: Some(Duration::from_secs(30)),
        use_global_ca_store: true,
        crt_bundle_attach: Some(esp_idf_svc::sys::esp_crt_bundle_attach),
        ..Default::default()
    };

    let is_conn_clone = is_connected.clone();

    let mut client = EspMqttClient::new_cb(AZURE_HOST, &conf, move |event| {
        match event.payload() {
            EventPayload::Connected(_) => {
                is_conn_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                log::info!("BERHASIL TERHUBUNG KE AZURE IOT HUB!");
            }
            EventPayload::Disconnected => {
                is_conn_clone.store(false, std::sync::atomic::Ordering::SeqCst);
                log::warn!("Terputus dari Azure, mencoba koneksi ulang...");
            }
            EventPayload::Received { topic, data, .. } => {
                if let Some(topic_str) = topic {
                    let payload_str = String::from_utf8_lossy(data);
                    if topic_str.starts_with("$iothub/twin/PATCH/properties/desired/") {
                        handle_azure_twin(&payload_str);
                    }
                }
            }
            _ => {}
        }
    })?;

    client.subscribe("$iothub/twin/PATCH/properties/desired/#", QoS::AtLeastOnce)?;
    Ok(client)
}

// Parser URL OTA dengan Custom Thread Builder (Stack Size 8KB untuk mencegah Stack Overflow)
fn handle_azure_twin(payload: &str) {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(payload) {
        if let Some(fw_url) = json.get("fw_url").and_then(|u| u.as_str()) {
            let url = fw_url.to_string();
            
            // Menggunakan Thread Builder dengan alokasi stack aman untuk HTTPS/TLS
            let _ = std::thread::Builder::new()
                .stack_size(8192)
                .spawn(move || {
                    if let Err(e) = execute_ota_update(&url) {
                        log::error!("Proses OTA gagal: {:?}", e);
                    }
                });
        }
    }
}

// Eksekutor Update OTA dengan Laporan Device Twin Reported ke Azure
pub fn execute_ota_update(url: &str) -> anyhow::Result<()> {
    log::info!("MEMULAI OVER-THE-AIR (OTA) UPDATE... URL: {}", url);

    let mut ota = EspOta::new().context("Gagal menginisialisasi EspOta")?;
    let mut update = ota.initiate_update().context("Gagal memulai update partisi OTA")?;

    let http_config = HttpConfig {
        use_global_ca_store: true,
        crt_bundle_attach: Some(esp_idf_svc::sys::esp_crt_bundle_attach),
        timeout: Some(Duration::from_secs(30)),
        ..Default::default()
    };

    let connection = EspHttpConnection::new(&http_config).context("Gagal membuat HTTP")?;
    let mut client = HttpClient::wrap(connection);

    let request = client.request(Method::Get, url, &[]).context("Gagal membuat HTTP request")?;
    let mut response = request.submit().context("Gagal mengirim HTTP request")?;

    if response.status() != 200 {
        update.abort().ok();
        anyhow::bail!("Server menolak pengunduhan. Status: {}", response.status());
    }

    let mut buffer = [0u8; 2048];
    loop {
        let n = response.read(&mut buffer).context("Error saat mengunduh byte")?;
        if n == 0 { break; }
        update.write(&buffer[..n]).context("Gagal menulis binary ke flash OTA")?;
    }

    update.complete().context("Gagal menyelesaikan OTA")?;
    log::info!("OTA UPDATE BERHASIL!");

    // Catatan: Di sini idealnya mengirimkan laporan reported properties ke Azure sebelum restart
    log::info!("Merestart perangkat ke versi baru...");
    thread::sleep(Duration::from_secs(2));
    esp_idf_svc::hal::reset::restart();
}