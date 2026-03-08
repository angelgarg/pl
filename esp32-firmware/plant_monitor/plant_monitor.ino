/*
 * ╔══════════════════════════════════════════════════════════╗
 * ║       PlantIQ — ESP32-S3 AI Plant Monitor v3.0          ║
 * ║                                                          ║
 * ║  Hardware:                                               ║
 * ║    • OV2640 camera module (built-in on board)           ║
 * ║    • Capacitive soil moisture sensor  → GPIO 1          ║
 * ║    • DS18B20 waterproof temp sensor   → GPIO 14         ║
 * ║    • Relay module (controls pump)     → GPIO 21         ║
 * ║    • Active buzzer                    → GPIO 47         ║
 * ║    • BOOT button (reset WiFi)         → GPIO 0          ║
 * ║                                                          ║
 * ║  Libraries (Arduino Library Manager):                   ║
 * ║    • DallasTemperature  by Miles Burton                 ║
 * ║    • OneWire            by Jim Studt                    ║
 * ║    • WiFiManager        by tzapu ← NEW v3.0            ║
 * ║    • Board: "ESP32S3 Dev Module" (Espressif >= 2.0.11)  ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * NEW v3.0 — WiFiManager (no more hard-coded WiFi password!)
 *   • On first boot: creates hotspot "PlantIQ-Setup" (pw: plantiq123)
 *   • Connect phone to that hotspot → captive portal opens
 *   • Enter your local farm WiFi credentials → saved to flash
 *   • Device restarts and connects automatically, forever
 *   • To reconfigure WiFi (new location): hold BOOT button 3 seconds
 *   • Device key is shown on the portal page for easy copy
 *
 * FIXES v2.3:
 *   • sensorsValid flag: sends report even when DS18B20 missing,
 *     but blocks pump — camera + moisture data still goes to dashboard
 *
 * FIXES v2.2:
 *   • REMOVED light sleep — OV2640 DVP interface freezes on wake
 *   • HTTP timeout raised to 45s (handles Render cold starts)
 *   • Watchdog raised to 120s
 *
 * FIXES v2.1:
 *   • struct ReportResult declared BEFORE any function
 *   • 8-sample ADC averaging for stable moisture reads
 *   • Camera warmup frame discarded before real capture
 *   • WiFi exponential back-off reconnect
 *   • Offline queue: stores 5 readings, flushes when WiFi returns
 */

// ════════════════════════════════════════════════════════════
//  STEP 1 — INCLUDES  (must be first)
// ════════════════════════════════════════════════════════════
#include <WiFi.h>
#include <WiFiManager.h>           // ← NEW: install via Library Manager
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>           // built-in — save device key to flash
#include <OneWire.h>
#include <DallasTemperature.h>
#include "esp_camera.h"
#include "esp_task_wdt.h"

// ════════════════════════════════════════════════════════════
//  STEP 2 — STRUCTS (must come before any function using them)
// ════════════════════════════════════════════════════════════

struct ReportResult {
  bool          pump;
  unsigned long duration_ms;
  bool          buzzer;
  int           health_score;
  bool          ok;
};

struct OfflineReading {
  int   moisture;
  float tempC;
  bool  used;
};

// ════════════════════════════════════════════════════════════
//  ① USER CONFIG — only DEVICE_KEY needs editing before flash
//
//  WiFi credentials are set via the captive portal on first
//  boot — you no longer need to hard-code them here.
// ════════════════════════════════════════════════════════════

// Paste the key from your PlantIQ dashboard here:
//   Dashboard → Fields & Devices → Add Device → copy key shown once
#define DEVICE_KEY         "piq-XXXXXX-XXXXXX"    // ← CHANGE THIS

#define BACKEND_URL        "https://pl-kp57.onrender.com"

// WiFi portal AP name & password (shown when no WiFi is configured)
#define PORTAL_AP_NAME     "PlantIQ-Setup"
#define PORTAL_AP_PASS     "plantiq123"

// Hold BOOT button this many seconds to wipe WiFi creds & re-open portal
#define RESET_BTN_PIN       0       // BOOT button on ESP32-S3
#define RESET_HOLD_MS    3000       // hold 3s to reset

// ── Timing ──────────────────────────────────────────────────
#define REPORT_INTERVAL_S   30      // send to server every N seconds

// ── Moisture thresholds ─────────────────────────────────────
#define MOISTURE_CRITICAL   20      // < 20% → emergency local pump
#define MOISTURE_DRY        30      // < 30% → request AI to water
#define PUMP_EMERGENCY_MS 8000      // emergency run time (ms)

// ════════════════════════════════════════════════════════════
//  ② PINS
//  Camera uses GPIO 4,5,6,7,8,9,10,11,12,13,15,16,17,18
//  Safe user pins: 1, 14, 21, 47
// ════════════════════════════════════════════════════════════

#define SOIL_PIN     1
#define DS18B20_PIN 14
#define RELAY_PIN   21
#define BUZZER_PIN  47

// Camera — Freenove ESP32-S3-WROOM-CAM
#define CAM_PWDN_PIN   -1
#define CAM_RESET_PIN  -1
#define CAM_XCLK_PIN   15
#define CAM_SIOD_PIN    4
#define CAM_SIOC_PIN    5
#define CAM_Y9_PIN     16
#define CAM_Y8_PIN     17
#define CAM_Y7_PIN     18
#define CAM_Y6_PIN     12
#define CAM_Y5_PIN     10
#define CAM_Y4_PIN      8
#define CAM_Y3_PIN      9
#define CAM_Y2_PIN     11
#define CAM_VSYNC_PIN   6
#define CAM_HREF_PIN    7
#define CAM_PCLK_PIN   13

// ════════════════════════════════════════════════════════════
//  ③ BATTERY VOLTAGE MONITOR
//  Wire a voltage divider from the Battery+ pad on the Shield V8:
//
//    Battery+ ──[100kΩ]──┬──[100kΩ]── GND
//                         │
//                       GPIO2  (BATTERY_PIN)
//
//  V_ADC  = V_battery / 2  (equal resistor divider)
//  V_bat  = V_ADC * 2
//  Range  : 3.0V (empty) → 4.2V (full) per cell (both cells in parallel)
// ════════════════════════════════════════════════════════════
#define BATTERY_PIN     2       // ADC pin connected to voltage divider mid-point
#define BAT_R_RATIO  2.0f       // (R1+R2)/R2  =  (100+100)/100 = 2.0
#define BAT_ADC_REF  3.3f       // ESP32 ADC reference voltage
#define BAT_ADC_BITS 4095.0f    // 12-bit ADC
#define BAT_V_FULL   4.20f      // 100 %
#define BAT_V_EMPTY  3.00f      //   0 %

// ════════════════════════════════════════════════════════════
//  ④ SOIL CALIBRATION
//  HOW TO CALIBRATE:
//    1. Open Serial Monitor at 115200 baud
//    2. Hold sensor in dry air — note the raw= value → SOIL_DRY_RAW
//    3. Submerge sensor tip in water — note raw= value → SOIL_WET_RAW
//    4. Update defines below and reflash
// ════════════════════════════════════════════════════════════
#define SOIL_DRY_RAW  4000    // raw ADC in bone-dry air (~4095 in air)
#define SOIL_WET_RAW  1100    // raw ADC submerged in water

// ════════════════════════════════════════════════════════════
//  GLOBALS
// ════════════════════════════════════════════════════════════
OneWire           oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);
bool              cameraOK  = false;

#define OFFLINE_QUEUE_SIZE 5
OfflineReading offlineQueue[OFFLINE_QUEUE_SIZE];
int            offlineHead = 0;

// ════════════════════════════════════════════════════════════
//  BUZZER
// ════════════════════════════════════════════════════════════
void beep(int ms, int n = 1) {
  for (int i = 0; i < n; i++) {
    digitalWrite(BUZZER_PIN, HIGH); delay(ms);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < n - 1) delay(90);
  }
}
void beepBoot()  { beep(80, 3);                          }
void beepFail()  { beep(500, 2);                         }
void beepAlert() { beep(250, 4);                         }
void beepPump()  { beep(60, 2); delay(60); beep(180, 1); }
// Double-beep = portal open, single long beep = WiFi connected
void beepPortal()   { beep(300, 2);                      }
void beepConnected(){ beep(150, 1); delay(80); beep(300, 1); }

// ════════════════════════════════════════════════════════════
//  PUMP
// ════════════════════════════════════════════════════════════
void pumpRun(unsigned long ms) {
  Serial.printf("[PUMP] ON  %lu ms\n", ms);
  beepPump();
  digitalWrite(RELAY_PIN, LOW);   // active-LOW relay = ON
  esp_task_wdt_reset();
  delay(ms);
  digitalWrite(RELAY_PIN, HIGH);  // relay OFF
  Serial.println("[PUMP] OFF");
  esp_task_wdt_reset();
}

// ════════════════════════════════════════════════════════════
//  SOIL MOISTURE  (8-sample average)
// ════════════════════════════════════════════════════════════
int readMoisturePct() {
  long sum = 0;
  for (int i = 0; i < 8; i++) { sum += analogRead(SOIL_PIN); delay(5); }
  int raw = (int)(sum / 8);
  int pct = map(raw, SOIL_DRY_RAW, SOIL_WET_RAW, 0, 100);
  pct = constrain(pct, 0, 100);
  Serial.printf("[SOIL] raw=%d  moisture=%d%%\n", raw, pct);
  return pct;
}

// ════════════════════════════════════════════════════════════
//  BATTERY VOLTAGE  (8-sample average)
// ════════════════════════════════════════════════════════════
int readBatteryPct() {
  // Configure ADC attenuation so 0-3.9V maps to 0-4095
  analogSetAttenuation(ADC_11db);
  long sum = 0;
  for (int i = 0; i < 8; i++) { sum += analogRead(BATTERY_PIN); delay(5); }
  float raw = (float)(sum / 8);

  // Convert ADC reading → voltage at pin → battery voltage
  float v_pin = (raw / BAT_ADC_BITS) * BAT_ADC_REF;
  float v_bat = v_pin * BAT_R_RATIO;

  // Clamp and map to 0-100 %
  v_bat = constrain(v_bat, BAT_V_EMPTY, BAT_V_FULL);
  int pct = (int)(((v_bat - BAT_V_EMPTY) / (BAT_V_FULL - BAT_V_EMPTY)) * 100.0f);

  Serial.printf("[BAT] raw=%d  v_pin=%.3fV  v_bat=%.3fV  bat=%d%%\n",
                (int)raw, v_pin, v_bat, pct);
  return pct;
}

// ════════════════════════════════════════════════════════════
//  DS18B20 TEMPERATURE
// ════════════════════════════════════════════════════════════
float readTemperatureC() {
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C) {
    Serial.println("[TEMP] Sensor disconnected! (check 4.7k pull-up resistor)");
    return -999.0f;
  }
  Serial.printf("[TEMP] %.2f C\n", t);
  return t;
}

// ════════════════════════════════════════════════════════════
//  CAMERA INIT
// ════════════════════════════════════════════════════════════
bool initCamera() {
  camera_config_t cfg;
  cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.ledc_timer   = LEDC_TIMER_0;
  cfg.pin_d0 = CAM_Y2_PIN;  cfg.pin_d1 = CAM_Y3_PIN;
  cfg.pin_d2 = CAM_Y4_PIN;  cfg.pin_d3 = CAM_Y5_PIN;
  cfg.pin_d4 = CAM_Y6_PIN;  cfg.pin_d5 = CAM_Y7_PIN;
  cfg.pin_d6 = CAM_Y8_PIN;  cfg.pin_d7 = CAM_Y9_PIN;
  cfg.pin_xclk     = CAM_XCLK_PIN;
  cfg.pin_pclk     = CAM_PCLK_PIN;
  cfg.pin_vsync    = CAM_VSYNC_PIN;
  cfg.pin_href     = CAM_HREF_PIN;
  cfg.pin_sscb_sda = CAM_SIOD_PIN;
  cfg.pin_sscb_scl = CAM_SIOC_PIN;
  cfg.pin_pwdn     = CAM_PWDN_PIN;
  cfg.pin_reset    = CAM_RESET_PIN;
  cfg.xclk_freq_hz = 20000000;
  cfg.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    cfg.frame_size = FRAMESIZE_VGA; cfg.jpeg_quality = 10; cfg.fb_count = 2;
    Serial.println("[CAM] PSRAM found — VGA 640x480");
  } else {
    cfg.frame_size = FRAMESIZE_QVGA; cfg.jpeg_quality = 12; cfg.fb_count = 1;
    Serial.println("[CAM] No PSRAM — QVGA 320x240");
  }

  if (esp_camera_init(&cfg) != ESP_OK) {
    Serial.println("[CAM] Init FAILED — check your board pinout!");
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_exposure_ctrl(s, 1);
    s->set_gain_ctrl(s, 1);
  }

  // Discard first frame (AE/AWB still stabilising)
  camera_fb_t *w = esp_camera_fb_get();
  if (w) esp_camera_fb_return(w);
  delay(200);

  Serial.println("[CAM] Ready");
  return true;
}

// ════════════════════════════════════════════════════════════
//  WiFiManager SETUP  ← NEW v3.0
//
//  Tries saved credentials first.
//  If none / wrong → opens AP "PlantIQ-Setup" + captive portal.
//  Portal times out after 3 minutes → device reboots and tries again.
// ════════════════════════════════════════════════════════════
void setupWiFi() {
  WiFiManager wm;

  // Portal timeout: if nobody configures it within 3 min, reboot
  wm.setConfigPortalTimeout(180);

  // Show device key on the portal page so farmer can note it down
  String keyHtml = "<p style='background:#f0f9ff;padding:10px;border-radius:6px;"
                   "font-family:monospace;font-size:13px;border:1px solid #bfdbfe'>"
                   "📡 <b>Device Key:</b><br>"
                   "<span style='color:#1d4ed8;font-size:15px'>" + String(DEVICE_KEY) + "</span><br>"
                   "<small style='color:#64748b'>Copy this — enter it in PlantIQ dashboard under Fields &amp; Devices</small></p>";
  WiFiManagerParameter keyDisplay(keyHtml.c_str());
  wm.addParameter(&keyDisplay);

  // Set custom title
  wm.setTitle("PlantIQ Setup");

  Serial.println("[WiFi] Starting WiFiManager...");
  Serial.println("[WiFi] If no saved WiFi — connecting to AP: " PORTAL_AP_NAME);

  // autoConnect: tries saved creds first, otherwise opens portal
  bool connected = wm.autoConnect(PORTAL_AP_NAME, PORTAL_AP_PASS);

  if (!connected) {
    Serial.println("[WiFi] Portal timed out — restarting in 3s");
    beepFail();
    delay(3000);
    ESP.restart();
  }

  Serial.printf("[WiFi] ✓ Connected to: %s\n", WiFi.SSID().c_str());
  Serial.printf("[WiFi]   IP: %s   RSSI: %d dBm\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
  beepConnected();
}

// ════════════════════════════════════════════════════════════
//  RESET BUTTON CHECK  ← NEW v3.0
//  Hold BOOT (GPIO 0) for 3 seconds → wipes WiFi creds → portal
//  Call at start of every loop() iteration.
// ════════════════════════════════════════════════════════════
void checkResetButton() {
  if (digitalRead(RESET_BTN_PIN) == LOW) {
    unsigned long held = millis();
    Serial.println("[RESET] BOOT held — release within 3s to cancel");
    while (digitalRead(RESET_BTN_PIN) == LOW) {
      if (millis() - held >= RESET_HOLD_MS) {
        Serial.println("[RESET] Clearing WiFi credentials and restarting...");
        beepAlert();
        WiFiManager wm;
        wm.resetSettings();       // wipe SSID + password from flash
        delay(500);
        ESP.restart();
      }
      delay(50);
    }
    Serial.println("[RESET] Cancelled (released before 3s)");
  }
}

// ════════════════════════════════════════════════════════════
//  WiFi reconnect (called if connection drops mid-session)
// ════════════════════════════════════════════════════════════
bool reconnectWiFi(int maxRetries = 3) {
  for (int a = 1; a <= maxRetries; a++) {
    Serial.printf("[WiFi] Reconnect attempt %d...\n", a);
    WiFi.reconnect();
    int t = 0;
    while (WiFi.status() != WL_CONNECTED && t++ < 20) {
      delay(500); esp_task_wdt_reset();
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("[WiFi] Reconnected ✓");
      return true;
    }
    delay(1000 * a);
  }
  return false;
}

// ════════════════════════════════════════════════════════════
//  SEND DEVICE REPORT  — returns ReportResult (AI decision)
// ════════════════════════════════════════════════════════════
ReportResult sendDeviceReport(int moisture, float tempC, int batteryPct) {
  ReportResult res = { false, 5000, false, -1, false };

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(50);          // TCP socket timeout (seconds)

  HTTPClient http;
  String url = String(BACKEND_URL)
             + "/api/device-report?moisture=" + String(moisture)
             + "&temperature=" + String(tempC, 2)
             + "&battery=" + String(batteryPct);

  Serial.printf("[HTTP] POST %s\n", url.c_str());
  if (!http.begin(client, url)) {
    Serial.println("[HTTP] begin failed");
    return res;
  }

  http.addHeader("x-device-key", DEVICE_KEY);
  http.setReuse(true);
  http.setTimeout(45000);         // 45s for Render cold starts

  int code;
  if (cameraOK) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb && fb->len > 500) {
      http.addHeader("Content-Type", "image/jpeg");
      Serial.printf("[CAM] %u bytes\n", fb->len);
      code = http.POST(fb->buf, fb->len);
      esp_camera_fb_return(fb);
    } else {
      if (fb) esp_camera_fb_return(fb);
      Serial.println("[CAM] Empty frame — sending no image");
      http.addHeader("Content-Type", "image/jpeg");
      code = http.POST((uint8_t *)"", 0);
    }
  } else {
    http.addHeader("Content-Type", "image/jpeg");
    code = http.POST((uint8_t *)"", 0);
  }

  esp_task_wdt_reset();           // reset WDT after long HTTP wait

  Serial.printf("[HTTP] %d\n", code);
  if (code == 200) {
    String body = http.getString();
    Serial.println(body);
    res.ok     = true;
    res.pump   = body.indexOf("\"pump\":true")  != -1;
    res.buzzer = body.indexOf("\"buzzer\":true") != -1;
    int di = body.indexOf("\"duration_ms\":");
    if (di != -1) {
      unsigned long d = (unsigned long)body.substring(di + 14).toInt();
      res.duration_ms = (d >= 1000 && d <= 60000) ? d : 5000;
    }
    int hi = body.indexOf("\"health_score\":");
    if (hi != -1) res.health_score = body.substring(hi + 15).toInt();
  } else {
    Serial.printf("[HTTP] Error: %s\n", http.getString().c_str());
  }
  http.end();
  return res;
}

// ════════════════════════════════════════════════════════════
//  OFFLINE QUEUE
// ════════════════════════════════════════════════════════════
void queueOffline(int m, float t) {
  int idx = offlineHead % OFFLINE_QUEUE_SIZE;
  offlineQueue[idx] = { m, t, false };
  offlineHead++;
  Serial.printf("[QUEUE] Stored #%d  m=%d t=%.1f\n", offlineHead, m, t);
}

void flushOfflineQueue() {
  for (int i = 0; i < OFFLINE_QUEUE_SIZE; i++) {
    if (!offlineQueue[i].used && offlineQueue[i].moisture > 0) {
      Serial.printf("[QUEUE] Flushing entry %d  m=%d t=%.1f\n",
                    i, offlineQueue[i].moisture, offlineQueue[i].tempC);
      sendDeviceReport(offlineQueue[i].moisture, offlineQueue[i].tempC);
      offlineQueue[i].used = true;
      delay(500);
      esp_task_wdt_reset();
    }
  }
}

// ════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n╔══════════════════════════╗");
  Serial.println("║  PlantIQ ESP32-S3 v3.0  ║");
  Serial.println("╚══════════════════════════╝");
  Serial.println("  WiFiManager enabled — no hard-coded WiFi");
  Serial.println("  BOOT button (GPIO 0) held 3s = reset WiFi creds");
  Serial.printf ("  Device key: %s\n\n", DEVICE_KEY);

  // Relay OFF (active-LOW — HIGH = off) and buzzer OFF
  pinMode(RELAY_PIN,  OUTPUT); digitalWrite(RELAY_PIN,  HIGH);
  pinMode(BUZZER_PIN, OUTPUT); digitalWrite(BUZZER_PIN, LOW);
  pinMode(RESET_BTN_PIN, INPUT_PULLUP);   // BOOT button

  // Watchdog 120s (covers HTTP wait + portal open time)
  esp_task_wdt_init(120, true);
  esp_task_wdt_add(NULL);

  // DS18B20
  tempSensor.begin();
  int found = tempSensor.getDeviceCount();
  Serial.printf("[DS18B20] Found: %d sensor(s)", found);
  if (found == 0) Serial.print("  ← add 4.7k pull-up resistor between DATA and 3.3V!");
  Serial.println();

  // Camera (init before WiFi so portal page can show camera status)
  cameraOK = initCamera();

  // Soil sensor boot reading (useful for calibration)
  int bootRaw = analogRead(SOIL_PIN);
  Serial.printf("[SOIL] Boot ADC: %d  (dry=%d wet=%d)\n",
                bootRaw, SOIL_DRY_RAW, SOIL_WET_RAW);

  // WiFiManager — handles first-time setup + reconnect on boot
  // This call may block for up to 3 minutes if portal is opened
  esp_task_wdt_reset();
  setupWiFi();
  esp_task_wdt_reset();

  // Flush any offline readings that were queued before WiFi came up
  flushOfflineQueue();

  Serial.println("[SETUP] Done — entering main loop");
}

// ════════════════════════════════════════════════════════════
//  LOOP
// ════════════════════════════════════════════════════════════
void loop() {
  esp_task_wdt_reset();

  // ── Check BOOT button for WiFi reset ─────────────────────
  checkResetButton();

  // ── Read sensors ──────────────────────────────────────────
  int   moisture   = readMoisturePct();
  float tempC      = readTemperatureC();
  int   batteryPct = readBatteryPct();
  Serial.printf("\n[READ] moisture=%d%%  temp=%.1fC  battery=%d%%\n",
                moisture, tempC, batteryPct);

  // ── Sensor validity flag ──────────────────────────────────
  // If DS18B20 is missing (-999), still send report so dashboard
  // gets camera + moisture, but ALL pump actions are blocked.
  bool sensorsValid = (tempC > -100.0f);
  if (!sensorsValid) {
    Serial.println("[WARN] DS18B20 missing — report will send but pump is DISABLED");
    Serial.println("[WARN] Fix: 4.7k resistor between GPIO14 and 3.3V");
  }

  // ── Emergency local pump (only when sensors are valid) ────
  if (sensorsValid && moisture < MOISTURE_CRITICAL) {
    Serial.println("[ALERT] Critically dry — emergency pump!");
    beepAlert();
    pumpRun(PUMP_EMERGENCY_MS);
  }

  // ── Send to backend / queue offline ───────────────────────
  if (WiFi.status() == WL_CONNECTED) {
    flushOfflineQueue();
    ReportResult r = sendDeviceReport(moisture, tempC, batteryPct);
    if (r.ok) {
      Serial.printf("[AI] health=%d  pump=%s\n",
                    r.health_score, r.pump ? "YES" : "NO");
      if (r.pump && sensorsValid && moisture >= MOISTURE_CRITICAL) {
        pumpRun(r.duration_ms);
      } else if (r.pump && !sensorsValid) {
        Serial.println("[PUMP] Blocked — connect DS18B20 sensor first");
      }
      if (r.buzzer && sensorsValid) beepAlert();
    } else {
      // Backend unreachable — local rule fallback
      if (sensorsValid && moisture < MOISTURE_DRY && moisture >= MOISTURE_CRITICAL) {
        Serial.println("[LOCAL] No AI response — watering by local rule");
        pumpRun(6000);
      }
    }
  } else {
    Serial.println("[OFFLINE] WiFi lost — queuing reading");
    queueOffline(moisture, tempC);   // battery not queued (not critical for offline)
    if (sensorsValid && moisture < MOISTURE_DRY && moisture >= MOISTURE_CRITICAL) pumpRun(6000);
    reconnectWiFi();
  }

  // ── Wait until next report ────────────────────────────────
  esp_task_wdt_reset();
  Serial.printf("[WAIT] %ds until next report\n", REPORT_INTERVAL_S);
  for (int i = 0; i < REPORT_INTERVAL_S; i++) {
    delay(1000);
    esp_task_wdt_reset();
    checkResetButton();   // also check reset during wait period
  }
}
