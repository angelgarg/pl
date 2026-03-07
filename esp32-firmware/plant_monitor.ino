/*
 * ╔══════════════════════════════════════════════════════════╗
 * ║       PlantIQ — ESP32-S3 AI Plant Monitor Firmware      ║
 * ║                                                          ║
 * ║  Hardware:                                               ║
 * ║    • ESP32-S3 with OV2640/OV5640 camera                 ║
 * ║    • Capacitive soil moisture sensor (analog)            ║
 * ║    • DS18B20 waterproof temperature sensor (1-Wire)      ║
 * ║    • Water pump relay (active-LOW)                       ║
 * ║    • Active buzzer                                       ║
 * ║                                                          ║
 * ║  Libraries (install via Arduino Library Manager):        ║
 * ║    • DallasTemperature  (Miles Burton)                  ║
 * ║    • OneWire            (Jim Studt)                     ║
 * ║    • ESP32 core ≥ 2.0.11 (Espressif)                   ║
 * ╚══════════════════════════════════════════════════════════╝
 */

// ════════════════════════════════════════════════════════════
//  ① USER CONFIG — edit these before flashing
// ════════════════════════════════════════════════════════════

#define WIFI_SSID        "Tiuu"
#define WIFI_PASSWORD    "12345678"

// Your Render backend (no trailing slash)
#define BACKEND_URL      "https://pl-kp57.onrender.com"

// Must match DEVICE_API_KEY in backend .env
#define DEVICE_KEY       "plantiq-device-key-change-me"

// ── Intervals ───────────────────────────────────────────────
#define REPORT_INTERVAL_MS   30000   // send report every 30 s
#define PHOTO_WITH_REPORT    true    // attach camera image to every report

// ── Pump thresholds (% soil moisture) ───────────────────────
#define MOISTURE_CRITICAL    20   // < 20 % → local emergency water
#define MOISTURE_DRY         30   // < 30 % → tell backend to water
#define PUMP_EMERGENCY_MS  8000   // ms to run pump in emergency (no WiFi)

// ════════════════════════════════════════════════════════════
//  ② PIN DEFINITIONS
//  ⚠  Adjust for YOUR exact board — camera I2C pins (SIOD/SIOC)
//     must NOT overlap with soil, relay, or buzzer pins.
// ════════════════════════════════════════════════════════════

// ── User peripherals ────────────────────────────────────────
#define SOIL_PIN         1   // ADC1_CH0  — capacitive soil sensor
#define DS18B20_PIN     14   // 1-Wire    — DS18B20 temp sensor
#define RELAY_PIN       21   // GPIO      — relay IN (active-LOW)
#define BUZZER_PIN      47   // GPIO      — active buzzer

// ── Camera (Freenove ESP32-S3-WROOM CAM default) ────────────
// If your board is different, update all 16 values below.
// Common alternates: XIAO ESP32S3 uses different pins — check its wiki.
#define CAM_PWDN_PIN    -1
#define CAM_RESET_PIN   -1
#define CAM_XCLK_PIN    15
#define CAM_SIOD_PIN     4   // Camera I2C SDA — do NOT share with DS18B20
#define CAM_SIOC_PIN     5   // Camera I2C SCL — do NOT share with relay
#define CAM_Y9_PIN      16
#define CAM_Y8_PIN      17
#define CAM_Y7_PIN      18
#define CAM_Y6_PIN      12
#define CAM_Y5_PIN      10
#define CAM_Y4_PIN       8
#define CAM_Y3_PIN       9
#define CAM_Y2_PIN      11
#define CAM_VSYNC_PIN    6
#define CAM_HREF_PIN     7
#define CAM_PCLK_PIN    13

// ════════════════════════════════════════════════════════════
//  ③ SOIL SENSOR CALIBRATION
//  Run Serial monitor, put sensor in dry air → record ADC value → DRY_RAW
//  Put sensor in water               → record ADC value → WET_RAW
// ════════════════════════════════════════════════════════════
#define SOIL_DRY_RAW   3200   // ADC reading in dry air
#define SOIL_WET_RAW   1100   // ADC reading fully in water

// ════════════════════════════════════════════════════════════
//  INCLUDES & GLOBALS
// ════════════════════════════════════════════════════════════
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "esp_camera.h"

OneWire      oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);

unsigned long lastReportMs = 0;
bool cameraOK = false;

// ════════════════════════════════════════════════════════════
//  BUZZER HELPERS
// ════════════════════════════════════════════════════════════

void beep(int ms, int times = 1) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(ms);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < times - 1) delay(100);
  }
}

void beepOK()      { beep(120, 3); }          // startup OK
void beepWiFiFail(){ beep(500, 2); }           // WiFi error
void beepAlert()   { beep(300, 4); }           // critical alert
void beepPump()    { beep(80,  2); delay(60); beep(200, 1); } // pump activated

// ════════════════════════════════════════════════════════════
//  PUMP
// ════════════════════════════════════════════════════════════

void pumpRun(unsigned long ms) {
  Serial.printf("[PUMP] ON for %lu ms\n", ms);
  beepPump();
  digitalWrite(RELAY_PIN, LOW);   // active-LOW
  delay(ms);
  digitalWrite(RELAY_PIN, HIGH);
  Serial.println("[PUMP] OFF");
}

// ════════════════════════════════════════════════════════════
//  SENSORS
// ════════════════════════════════════════════════════════════

int readMoisturePct() {
  // Average 5 samples to reduce noise
  long sum = 0;
  for (int i = 0; i < 5; i++) { sum += analogRead(SOIL_PIN); delay(10); }
  int raw = sum / 5;
  int pct = map(raw, SOIL_DRY_RAW, SOIL_WET_RAW, 0, 100);
  pct = constrain(pct, 0, 100);
  Serial.printf("[SOIL] raw=%d  pct=%d%%\n", raw, pct);
  return pct;
}

float readTemperatureC() {
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C) {
    Serial.println("[DS18B20] Disconnected!");
    return -999.0;
  }
  Serial.printf("[TEMP] %.2f°C\n", t);
  return t;
}

// ════════════════════════════════════════════════════════════
//  CAMERA
// ════════════════════════════════════════════════════════════

bool initCamera() {
  camera_config_t cfg;
  cfg.ledc_channel  = LEDC_CHANNEL_0;
  cfg.ledc_timer    = LEDC_TIMER_0;
  cfg.pin_d0        = CAM_Y2_PIN;
  cfg.pin_d1        = CAM_Y3_PIN;
  cfg.pin_d2        = CAM_Y4_PIN;
  cfg.pin_d3        = CAM_Y5_PIN;
  cfg.pin_d4        = CAM_Y6_PIN;
  cfg.pin_d5        = CAM_Y7_PIN;
  cfg.pin_d6        = CAM_Y8_PIN;
  cfg.pin_d7        = CAM_Y9_PIN;
  cfg.pin_xclk      = CAM_XCLK_PIN;
  cfg.pin_pclk      = CAM_PCLK_PIN;
  cfg.pin_vsync     = CAM_VSYNC_PIN;
  cfg.pin_href      = CAM_HREF_PIN;
  cfg.pin_sscb_sda  = CAM_SIOD_PIN;
  cfg.pin_sscb_scl  = CAM_SIOC_PIN;
  cfg.pin_pwdn      = CAM_PWDN_PIN;
  cfg.pin_reset     = CAM_RESET_PIN;
  cfg.xclk_freq_hz  = 20000000;
  cfg.pixel_format  = PIXFORMAT_JPEG;

  if (psramFound()) {
    cfg.frame_size   = FRAMESIZE_VGA;   // 640×480
    cfg.jpeg_quality = 10;
    cfg.fb_count     = 2;
    Serial.println("[CAM] PSRAM found — VGA mode");
  } else {
    cfg.frame_size   = FRAMESIZE_QVGA;  // 320×240
    cfg.jpeg_quality = 12;
    cfg.fb_count     = 1;
    Serial.println("[CAM] No PSRAM — QVGA mode");
  }

  esp_err_t err = esp_camera_init(&cfg);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init FAILED: 0x%x\n", err);
    return false;
  }

  // Improve image quality settings
  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 0);
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 0);
    s->set_gain_ctrl(s, 1);
    s->set_agc_gain(s, 0);
  }

  Serial.println("[CAM] Ready ✓");
  return true;
}

// ════════════════════════════════════════════════════════════
//  SEND DEVICE REPORT
//  Sends sensor data (query params) + JPEG body to backend.
//  Backend calls Azure GPT-4o, returns pump command.
// ════════════════════════════════════════════════════════════

struct ReportResult {
  bool pump;
  unsigned long duration_ms;
  bool buzzer;
  int  health_score;
  bool ok;
};

ReportResult sendDeviceReport(int moisture, float tempC) {
  ReportResult result = { false, 5000, false, -1, false };

  WiFiClientSecure client;
  client.setInsecure();  // skip cert verification (fine for hobby)
  HTTPClient http;

  String url = String(BACKEND_URL)
             + "/api/device-report?moisture=" + String(moisture)
             + "&temperature=" + String(tempC, 2);

  Serial.printf("[HTTP] POST %s\n", url.c_str());

  if (!http.begin(client, url)) {
    Serial.println("[HTTP] begin() failed");
    return result;
  }

  http.addHeader("x-device-key", DEVICE_KEY);
  http.setTimeout(20000);   // 20 s — AI call takes time

  int code;
  if (cameraOK && PHOTO_WITH_REPORT) {
    // ── With camera image ──────────────────────────────────
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb && fb->len > 0) {
      http.addHeader("Content-Type", "image/jpeg");
      Serial.printf("[CAM] Captured %u bytes\n", fb->len);
      code = http.POST(fb->buf, fb->len);
      esp_camera_fb_return(fb);
    } else {
      if (fb) esp_camera_fb_return(fb);
      Serial.println("[CAM] Capture failed — sending without image");
      http.addHeader("Content-Type", "image/jpeg");
      code = http.POST((uint8_t*)"", 0);
    }
  } else {
    // ── Sensor data only ──────────────────────────────────
    http.addHeader("Content-Type", "image/jpeg");
    code = http.POST((uint8_t*)"", 0);
  }

  Serial.printf("[HTTP] Response: %d\n", code);

  if (code == 200) {
    String body = http.getString();
    Serial.println("[HTTP] Body: " + body);

    // Simple JSON parsing (no library needed)
    result.pump         = body.indexOf("\"pump\":true")  >= 0;
    result.buzzer       = body.indexOf("\"buzzer\":true") >= 0;
    result.ok           = true;

    // Extract duration_ms
    int dIdx = body.indexOf("\"duration_ms\":");
    if (dIdx >= 0) {
      result.duration_ms = body.substring(dIdx + 14).toInt();
      if (result.duration_ms < 1000 || result.duration_ms > 60000)
        result.duration_ms = 5000;
    }

    // Extract health_score
    int hIdx = body.indexOf("\"health_score\":");
    if (hIdx >= 0) {
      result.health_score = body.substring(hIdx + 15).toInt();
    }

  } else {
    Serial.printf("[HTTP] Error: %s\n", http.getString().c_str());
  }

  http.end();
  return result;
}

// ════════════════════════════════════════════════════════════
//  WiFi CONNECT
// ════════════════════════════════════════════════════════════

bool connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {
    delay(500);
    Serial.print(".");
    tries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s  RSSI: %d dBm\n",
      WiFi.localIP().toString().c_str(), WiFi.RSSI());
    return true;
  }

  Serial.println("\n[WiFi] FAILED — running offline");
  return false;
}

// ════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("╔══════════════════════════════╗");
  Serial.println("║   PlantIQ ESP32-S3 v2.0      ║");
  Serial.println("╚══════════════════════════════╝");

  // Output pins
  pinMode(RELAY_PIN,  OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(RELAY_PIN,  HIGH);  // relay OFF (active-LOW)
  digitalWrite(BUZZER_PIN, LOW);

  // DS18B20
  tempSensor.begin();
  int sensors = tempSensor.getDeviceCount();
  Serial.printf("[DS18B20] Found %d device(s)\n", sensors);

  // Camera
  cameraOK = initCamera();

  // WiFi
  bool wifiOK = connectWiFi();

  // Startup feedback
  if (wifiOK) {
    beepOK();
  } else {
    beepWiFiFail();
  }

  // Print calibration guide
  Serial.println("\n[SOIL] Calibration values:");
  Serial.printf("       DRY_RAW=%d  WET_RAW=%d\n", SOIL_DRY_RAW, SOIL_WET_RAW);
  Serial.printf("       Current ADC reading: %d\n", analogRead(SOIL_PIN));

  // Trigger first report immediately
  lastReportMs = millis() - REPORT_INTERVAL_MS;
}

// ════════════════════════════════════════════════════════════
//  LOOP
// ════════════════════════════════════════════════════════════

void loop() {
  unsigned long now = millis();

  if (now - lastReportMs >= (unsigned long)REPORT_INTERVAL_MS) {
    lastReportMs = now;

    // 1. Read sensors
    int   moisture = readMoisturePct();
    float tempC    = readTemperatureC();

    Serial.printf("\n── Report: moisture=%d%%  temp=%.1f°C ──\n", moisture, tempC);

    // 2. Local emergency: water immediately if critically dry (even offline)
    if (moisture < MOISTURE_CRITICAL) {
      Serial.println("[ALERT] CRITICALLY DRY — emergency local pump!");
      beepAlert();
      pumpRun(PUMP_EMERGENCY_MS);
      // Don't return — still send report to backend
    }

    // 3. Send to backend (AI analysis + remote pump decision)
    if (WiFi.status() == WL_CONNECTED) {
      ReportResult r = sendDeviceReport(moisture, tempC);

      if (r.ok) {
        Serial.printf("[AI] Health: %d  Pump: %s\n",
          r.health_score, r.pump ? "YES" : "NO");

        // Run pump if AI/backend says so (and we didn't already in emergency)
        if (r.pump && moisture >= MOISTURE_CRITICAL) {
          pumpRun(r.duration_ms);
        }

        // Buzzer alert for high/critical conditions
        if (r.buzzer) {
          beepAlert();
        }

        // Health score LED feedback via Serial
        if (r.health_score >= 0) {
          Serial.printf("[STATUS] Plant health: %d/100 %s\n",
            r.health_score,
            r.health_score >= 75 ? "✅ Good" :
            r.health_score >= 50 ? "⚠ Needs attention" : "🔴 Critical");
        }
      } else {
        // Server unreachable — apply local rule
        Serial.println("[OFFLINE] Server unreachable — local rule");
        if (moisture < MOISTURE_DRY) {
          Serial.println("[LOCAL] Dry → running pump locally");
          pumpRun(6000);
        }
      }

    } else {
      Serial.println("[WiFi] Offline — local rule only");
      WiFi.reconnect();

      // Local rule: water if dry
      if (moisture < MOISTURE_DRY && moisture >= MOISTURE_CRITICAL) {
        Serial.println("[LOCAL] Dry + offline → watering locally");
        pumpRun(6000);
      }
    }
  }

  delay(50);
}
