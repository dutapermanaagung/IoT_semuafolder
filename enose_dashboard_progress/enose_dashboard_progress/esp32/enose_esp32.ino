#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";

// IP komputer yang menjalankan Rust backend.
// Contoh: http://192.168.1.10:8080/api/sampling
const char* BACKEND_URL = "http://192.168.1.10:8080/api/sampling";

const int MQ2_PIN = 1;
const int MQ3_PIN = 2;
const int MQ135_PIN = 3;
const int MQ138_PIN = 4;

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    float mq2 = analogRead(MQ2_PIN);
    float mq3 = analogRead(MQ3_PIN);
    float mq135 = analogRead(MQ135_PIN);
    float mq138 = analogRead(MQ138_PIN);

    // Ganti bagian ini dengan pembacaan DHT22/PT sensor yang benar
    float temperature = 28.5;
    float humidity = 65.0;

    sendSampling("robusta", mq2, mq3, mq135, mq138, temperature, humidity);
  }

  delay(2000);
}

void sendSampling(const char* coffeeType, float mq2, float mq3, float mq135,
                  float mq138, float temperature, float humidity) {
  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["coffee_type"] = coffeeType;
  doc["sensors"]["mq2"] = mq2;
  doc["sensors"]["mq3"] = mq3;
  doc["sensors"]["mq135"] = mq135;
  doc["sensors"]["mq138"] = mq138;
  doc["sensors"]["temperature"] = temperature;
  doc["sensors"]["humidity"] = humidity;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  Serial.printf("HTTP: %d\n", code);
  if (code > 0) Serial.println(http.getString());
  http.end();
}
