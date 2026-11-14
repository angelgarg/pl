/*
 * ╔══════════════════════════════════════════════════════════╗
 * ║      BhoomiIQ — ESP32-CAM Exhibit Monitor v1.0          ║
 * ║      भूमि IQ — Standalone Node (WiFi + Camera + OLED)   ║
 * ╠══════════════════════════════════════════════════════════╣
 * ║  STANDALONE EXHIBIT DEVICE                               ║
 * ║   • ESP32-CAM (AI-Thinker) + OV2640 camera             ║
 * ║   • SSD1306 0.96" OLED (JMD096D-1) — live readings     ║
 * ║   • DHT11 — temperature + humidity                      ║
 * ║   • Capacitive soil moisture sensor                     ║
 * ║   • Relay-controlled pump                               ║
 * ║   • Sends AI reports to BhoomiIQ cloud every 30s       ║
 * ╠══════════════════════════════════════════════════════════╣
 * ║  PIN MAP (ESP32-CAM AI-Thinker)                         ║
 * ║   OLED SDA  → GPIO15     OLED SCL → GPIO14              ║
 * ║   DHT11     → GPIO2                                     ║
 * ║   Soil ADC  → GPIO13   ⚠ ADC2 — read before WiFi       ║
 * ║   Relay     → GPIO4    (also flash LED — expected)      ║
 * ╠══════════════════════════════════════════════════════════╣
 * ║  LIBRARIES REQUIRED (install via Arduino Library Manager)║
 * ║   • DHT sensor library  — Adafruit                      ║
 * ║   • Adafruit GFX Library                                ║
 * ║   • Adafruit SSD1306                                    ║
 * ╚══════════════════════════════════════════════════════════╝
 */

#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>
#include "esp_camera.h"
#include "esp_task_wdt.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ───────────────── STRUCTS ─────────────────
struct ReportResult {
  bool pump;
  unsigned long duration_ms;
  bool ok;
  bool animal_detected;
  char animal_type[32];
  char animal_threat[16];
};

struct DHTReading {
  float tempC;
  float humidity;
};

// ───────────────── USER CONFIG ─────────────────
WiFiMulti wifiMulti;
void setupWiFiNetworks() {
  wifiMulti.addAP("CMF",        "pearlgarg");        // exhibit
  wifiMulti.addAP("wifi",       "pass12345");        // added
  wifiMulti.addAP("CILP_Open",  "cilp@tiet#b122");   // college fallback
  wifiMulti.addAP("Angel's F07",       "12345678");          // home fallback
}

#define BACKEND_URL   "https://pl-kp57.onrender.com"
#define DEVICE_KEY    "piq-A85578-742051"

#define REPORT_INTERVAL_S          30
#define MOISTURE_CRITICAL          20
#define PUMP_EMERGENCY_MS        8000
#define PUMP_EMERGENCY_COOLDOWN_MS 120000

// true  = active LOW relay  (LOW=ON, HIGH=OFF) — most common blue relay modules
// false = active HIGH relay (HIGH=ON, LOW=OFF) — some red/black modules
#define RELAY_ACTIVE_LOW true

// ───────────────── PINS ─────────────────
// ⚠  GPIO13 is ADC2 — ESP32 blocks ADC2 while WiFi is running.
//    Soil moisture is read ONCE before WiFi starts and cached.
//    If readings are stuck at 50%, rewire sensor to GPIO33 (ADC1) and change SOIL_PIN to 33.
#define SOIL_PIN     13
#define DHT_PIN       2
#define RELAY_PIN     4   // shared with ESP32-CAM onboard flash LED — normal behavior
#define OLED_SDA     15
#define OLED_SCL     14

// ── ESP32-CAM AI-Thinker camera pinout ──
#define CAM_PWDN_PIN  32
#define CAM_RESET_PIN -1
#define CAM_XCLK_PIN   0
#define CAM_SIOD_PIN  26
#define CAM_SIOC_PIN  27
#define CAM_Y9_PIN    35
#define CAM_Y8_PIN    34
#define CAM_Y7_PIN    39
#define CAM_Y6_PIN    36
#define CAM_Y5_PIN    21
#define CAM_Y4_PIN    19
#define CAM_Y3_PIN    18
#define CAM_Y2_PIN     5
#define CAM_VSYNC_PIN 25
#define CAM_HREF_PIN  23
#define CAM_PCLK_PIN  22

#define SOIL_DRY_RAW 4000
#define SOIL_WET_RAW 1100

#define OLED_WIDTH   128
#define OLED_HEIGHT   64
#define OLED_ADDR   0x3C   // try 0x3D if display stays blank

// ── Pump modes — shown on OLED and Serial ──
// AUTO   : triggered locally when moisture < MOISTURE_CRITICAL
// CLOUD  : triggered by AI report from dashboard (manual or AI decision)
#define PUMP_MODE_AUTO   "AUTO"
#define PUMP_MODE_CLOUD  "CLOUD"

// ───────────────── GLOBALS ─────────────────
DHT dht(DHT_PIN, DHT11);
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
bool cameraOK = false;
bool oledOK   = false;
int  cachedMoisturePct = 50;           // pre-WiFi soil reading — reused in loop
unsigned long lastEmergencyPumpMs = 0;
bool pumpRunThisCycle = false;         // prevents double-pump (auto + cloud) in same loop pass

// ───────────────── OLED ─────────────────
void oledShow(const char* l1, const char* l2 = "", const char* l3 = "", const char* l4 = "") {
  if (!oledOK) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0,  0); display.println(l1);
  display.setCursor(0, 16); display.println(l2);
  display.setCursor(0, 32); display.println(l3);
  display.setCursor(0, 48); display.println(l4);
  display.display();
}

// ───────────────── PUMP ─────────────────
#define RELAY_ON  (RELAY_ACTIVE_LOW ? LOW  : HIGH)
#define RELAY_OFF (RELAY_ACTIVE_LOW ? HIGH : LOW)

void pumpSoftStart() {
  digitalWrite(RELAY_PIN, RELAY_ON);  delay(80);
  digitalWrite(RELAY_PIN, RELAY_OFF); delay(60);
  esp_task_wdt_reset();
  digitalWrite(RELAY_PIN, RELAY_ON);  delay(150);
  digitalWrite(RELAY_PIN, RELAY_OFF); delay(60);
  esp_task_wdt_reset();
  digitalWrite(RELAY_PIN, RELAY_ON);  delay(300);
  digitalWrite(RELAY_PIN, RELAY_OFF); delay(60);
  esp_task_wdt_reset();
  digitalWrite(RELAY_PIN, RELAY_ON);
  Serial.printf("[PUMP] Soft-start complete (active-%s)\n", RELAY_ACTIVE_LOW ? "LOW" : "HIGH");
}

void pumpRun(unsigned long ms, const char* mode = PUMP_MODE_CLOUD) {
  Serial.printf("[PUMP] ON %lu ms  mode=%s\n", ms, mode);
  char pumpLine[22];
  snprintf(pumpLine, sizeof(pumpLine), "PUMP ON [%s]", mode);
  oledShow("BhoomiIQ Exhibit", "", "", pumpLine);
  pumpSoftStart();
  esp_task_wdt_reset();
  unsigned long runMs = (ms > 810) ? ms - 810 : 0;
  if (runMs > 0) delay(runMs);
  digitalWrite(RELAY_PIN, RELAY_OFF);
  Serial.printf("[PUMP] OFF  mode=%s\n", mode);
}

// ───────────────── MOISTURE ─────────────────
int readMoisturePct() {
  long sum = 0;
  for (int i = 0; i < 8; i++) { sum += analogRead(SOIL_PIN); delay(5); }
  int raw = sum / 8;
  int pct = map(raw, SOIL_DRY_RAW, SOIL_WET_RAW, 0, 100);
  pct = constrain(pct, 0, 100);
  // ADC2 returns ~0 when WiFi is on; ignore those readings and use last cached value
  if (raw > 200) cachedMoisturePct = pct;
  Serial.printf("[SOIL] raw=%d moisture=%d%% (cached=%d%%)\n", raw, pct, cachedMoisturePct);
  return cachedMoisturePct;
}

// ───────────────── DHT11 ─────────────────
float lastGoodTemp = 25.0;
float lastGoodHum  = 50.0;

DHTReading readDHT() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (!isnan(t) && t > -10 && t < 85) lastGoodTemp = t;
  if (!isnan(h) && h >= 0 && h <= 100) lastGoodHum  = h;
  Serial.printf("[DHT11] %.1fC  %.1f%%RH\n", lastGoodTemp, lastGoodHum);
  return { lastGoodTemp, lastGoodHum };
}

// ───────────────── CAMERA ─────────────────
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
    cfg.frame_size   = FRAMESIZE_QVGA;
    cfg.jpeg_quality = 15;
    cfg.fb_count     = 2;
  } else {
    cfg.frame_size   = FRAMESIZE_QVGA;
    cfg.jpeg_quality = 18;
    cfg.fb_count     = 1;
  }
  if (esp_camera_init(&cfg) != ESP_OK) {
    Serial.println("[CAM] Init FAILED");
    return false;
  }
  camera_fb_t *fb = esp_camera_fb_get();
  if (fb) esp_camera_fb_return(fb);
  Serial.println("[CAM] Ready");
  return true;
}

// ───────────────── WIFI ─────────────────
bool connectWiFi(int maxRetries = 3) {
  WiFi.mode(WIFI_STA);
  setupWiFiNetworks();
  Serial.println("[WiFi] Scanning...");
  for (int a = 1; a <= maxRetries; a++) {
    Serial.printf("[WiFi] Attempt %d\n", a);
    int t = 0;
    while (wifiMulti.run() != WL_CONNECTED && t++ < 20) {
      delay(500); Serial.print("."); esp_task_wdt_reset();
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[WiFi] Connected: %s  IP:%s  RSSI:%d\n",
        WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.RSSI());
      return true;
    }
    WiFi.disconnect(true);
    delay(1000 * a);
  }
  Serial.println("[WiFi] FAILED — no known network in range");
  return false;
}

// ───────────────── WAKE RENDER (cold-start ping) ─────────────────
bool wakeBackend() {
  for (int attempt = 1; attempt <= 4; attempt++) {
    WiFiClientSecure wc;
    wc.setInsecure();
    wc.setTimeout(60);     // 60s SSL socket timeout — Render cold start can take 30-60s
    HTTPClient hh;
    if (!hh.begin(wc, String(BACKEND_URL) + "/health")) { hh.end(); continue; }
    hh.setTimeout(60000);
    Serial.printf("[WAKE] Attempt %d/4...\n", attempt);
    int c = hh.GET();
    hh.end();
    if (c > 0) {
      Serial.printf("[WAKE] Backend ready (HTTP %d)\n", c);
      for (int g = 0; g < 5; g++) { delay(1000); esp_task_wdt_reset(); }
      return true;
    }
    Serial.printf("[WAKE] Failed (%d) — waiting 8s\n", c);
    for (int w = 0; w < 8; w++) { delay(1000); esp_task_wdt_reset(); }
  }
  Serial.println("[WAKE] Backend unreachable");
  return false;
}

// ───────────────── HTTP REPORT ─────────────────
ReportResult sendDeviceReport(int moisture, float tempC, float humidity) {
  ReportResult res = {false, 5000, false, false, "none", "none"};
  if (!wakeBackend()) return res;

  String url = String(BACKEND_URL) + "/api/device-report"
    + "?moisture="    + String(moisture)
    + "&temperature=" + String(tempC, 2)
    + "&humidity="    + String(humidity, 1);

  Serial.printf("[HTTP] POST %s\n", url.c_str());

  for (int attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      Serial.printf("[HTTP] Retry %d/3 — waiting 3s\n", attempt);
      for (int w = 0; w < 3; w++) { delay(1000); esp_task_wdt_reset(); }
    }

    WiFiClientSecure client;
    client.setInsecure();
    client.setTimeout(60);    // 60s SSL socket timeout — prevents MBEDTLS_ERR_SSL_CONN_EOF
    HTTPClient http;
    http.setReuse(false);     // fresh SSL connection each attempt

    if (!http.begin(client, url)) { Serial.println("[HTTP] begin failed"); continue; }

    http.addHeader("x-device-key", DEVICE_KEY);
    http.addHeader("Connection", "close");
    http.setTimeout(60000);

    camera_fb_t *fb = esp_camera_fb_get();
    int code;
    if (fb) {
      Serial.printf("[CAM] %u bytes (attempt %d)\n", fb->len, attempt);
      http.addHeader("Content-Type", "image/jpeg");
      http.addHeader("Content-Length", String(fb->len));
      code = http.POST(fb->buf, fb->len);
      esp_camera_fb_return(fb);
    } else {
      code = http.POST((uint8_t*)"", 0);
    }

    Serial.printf("[HTTP] %d\n", code);

    if (code == 200) {
      String body = http.getString();
      res.ok              = true;
      res.pump            = body.indexOf("\"pump\":true")            != -1;
      res.animal_detected = body.indexOf("\"animal_detected\":true") != -1;

      int atIdx = body.indexOf("\"animal_type\":\"");
      if (atIdx != -1) {
        int s = atIdx + 15, e = body.indexOf("\"", s);
        if (e != -1) body.substring(s, e).toCharArray(res.animal_type, 32);
      }
      int thIdx = body.indexOf("\"animal_threat\":\"");
      if (thIdx != -1) {
        int s = thIdx + 17, e = body.indexOf("\"", s);
        if (e != -1) body.substring(s, e).toCharArray(res.animal_threat, 16);
      }

      if (res.animal_detected)
        Serial.printf("[AI] Animal: %s (threat: %s)\n", res.animal_type, res.animal_threat);

      http.end();
      return res;
    }

    http.end();
    if (code == -1 || code == -3 || code == -11) continue; // retriable
    break;
  }

  Serial.println("[HTTP] All attempts failed");
  return res;
}

// ───────────────── SETUP ─────────────────
void setup() {
  Serial.begin(115200);

  // Relay OFF before pinMode — prevents trigger at boot
  digitalWrite(RELAY_PIN, RELAY_OFF);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);

  esp_task_wdt_init(180, true); // 3 min WDT
  esp_task_wdt_add(NULL);

  // OLED — custom I2C pins (not default 21/22 on ESP32-CAM)
  Wire.begin(OLED_SDA, OLED_SCL);
  oledOK = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (oledOK) {
    display.clearDisplay();
    display.display();
    oledShow("BhoomiIQ", "Exhibit Monitor", "v1.0  Starting...", "");
    Serial.println("[OLED] Ready");
  } else {
    Serial.println("[OLED] Not found — check SDA/SCL wiring or try OLED_ADDR 0x3D");
  }

  dht.begin();

  // Read soil BEFORE WiFi starts — GPIO13 (ADC2) is blocked by WiFi radio
  delay(500); // let DHT settle
  cachedMoisturePct = readMoisturePct();
  Serial.printf("[SOIL] Pre-WiFi reading cached: %d%%\n", cachedMoisturePct);

  cameraOK = initCamera();

  oledShow("BhoomiIQ", "Connecting...", "WiFi: CMF", "");
  bool wifiOK = connectWiFi();

  if (wifiOK) {
    char ipLine[22];
    snprintf(ipLine, sizeof(ipLine), "%s", WiFi.localIP().toString().c_str());
    oledShow("BhoomiIQ", "WiFi Connected!", ipLine, "");
  } else {
    oledShow("BhoomiIQ", "WiFi FAILED", "Offline mode", "Check password");
  }

  Serial.println("[SETUP] Done — Exhibit node online");
  delay(1500);
}

// ───────────────── LOOP ─────────────────
void loop() {
  esp_task_wdt_reset();

  int moisture = readMoisturePct();
  DHTReading dhtR = readDHT();

  Serial.printf("[READ] moisture=%d%% temp=%.1fC hum=%.1f%%\n",
    moisture, dhtR.tempC, dhtR.humidity);

  // Reset per-cycle pump guard
  pumpRunThisCycle = false;

  // Build OLED status lines
  char l2[22], l3[22], l4[22];
  snprintf(l2, sizeof(l2), "Moisture: %d%%", moisture);
  snprintf(l3, sizeof(l3), "T:%.1fC  H:%.0f%%", dhtR.tempC, dhtR.humidity);
  snprintf(l4, sizeof(l4), WiFi.status() == WL_CONNECTED ? "WiFi: OK" : "WiFi: OFF");
  oledShow("BhoomiIQ Exhibit", l2, l3, l4);

  // ── AUTO MODE — emergency pump, local decision, no cloud needed ──
  // Fires when moisture < MOISTURE_CRITICAL regardless of WiFi state
  if (moisture < MOISTURE_CRITICAL) {
    unsigned long now = millis();
    if (now - lastEmergencyPumpMs > PUMP_EMERGENCY_COOLDOWN_MS) {
      Serial.printf("[AUTO] Critical moisture (%d%%) — emergency pump ON\n", moisture);
      pumpRun(PUMP_EMERGENCY_MS, PUMP_MODE_AUTO);
      lastEmergencyPumpMs = now;
      pumpRunThisCycle = true;
    } else {
      Serial.printf("[AUTO] Critical moisture (%d%%) — cooldown active, skipping\n", moisture);
    }
  }

  // ── CLOUD MODE — AI report from dashboard (manual ON from dashboard = pump:true) ──
  // Manual pump from dashboard: press the pump button in BhoomiIQ dashboard
  // → cloud returns "pump":true on the next 30s report cycle → pump fires here.
  if (WiFi.status() == WL_CONNECTED) {
    oledShow("BhoomiIQ Exhibit", l2, l3, "Sending report...");
    ReportResult r = sendDeviceReport(moisture, dhtR.tempC, dhtR.humidity);

    if (r.ok && r.pump && !pumpRunThisCycle) {
      // Dashboard/AI commanded pump — only run if auto mode didn't already pump this cycle
      Serial.printf("[CLOUD] Dashboard/AI pump command received\n");
      pumpRun(r.duration_ms, PUMP_MODE_CLOUD);
      pumpRunThisCycle = true;
    } else if (r.ok && r.pump && pumpRunThisCycle) {
      Serial.println("[CLOUD] Pump command received but AUTO already ran this cycle — skipped");
    }

    if (r.ok && r.animal_detected) {
      Serial.printf("[ANIMAL] %s detected (threat: %s)\n", r.animal_type, r.animal_threat);
      char al[22];
      snprintf(al, sizeof(al), "ANIMAL: %s!", r.animal_type);
      oledShow("BhoomiIQ Exhibit", l2, l3, al);
      delay(3000);
    }

    // Final OLED status
    snprintf(l4, sizeof(l4), r.ok ? "Synced OK" : "Sync failed");
    oledShow("BhoomiIQ Exhibit", l2, l3, l4);

  } else {
    Serial.println("[OFFLINE] WiFi lost — reconnecting");
    WiFi.reconnect();
  }

  Serial.printf("[WAIT] %ds\n", REPORT_INTERVAL_S);
  for (int i = 0; i < REPORT_INTERVAL_S; i++) {
    delay(1000);
    esp_task_wdt_reset();
  }
}
