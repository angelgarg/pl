/*
 * ╔══════════════════════════════════════════════════════════╗
 * ║      BhoomiIQ — ESP32-S3 AI Field Monitor v3.0          ║
 * ║      भूमि IQ — Master Node (ESP-NOW + WiFi + Camera)    ║
 * ╠══════════════════════════════════════════════════════════╣
 * ║  MASTER-SLAVE ARCHITECTURE                               ║
 * ║  This device is the MASTER:                              ║
 * ║   • Connects to WiFi + sends AI reports to cloud        ║
 * ║   • Receives sensor data from up to 10 slave nodes      ║
 * ║     via ESP-NOW (no router needed between devices)       ║
 * ║   • Relays solenoid valve commands back to each slave    ║
 * ║   • Master MAC address printed on boot (Serial Monitor) ║
 * ╠══════════════════════════════════════════════════════════╣
 * ║  SETUP INSTRUCTIONS:                                     ║
 * ║   1. Set WIFI_SSID and WIFI_PASSWORD                    ║
 * ║   2. Set DEVICE_KEY from BhoomiIQ dashboard             ║
 * ║   3. Flash this to ESP32-S3 (master)                    ║
 * ║   4. Copy MAC address from Serial Monitor               ║
 * ║   5. Paste MAC into slave firmware MASTER_MAC           ║
 * ║   6. Set WIFI_CHANNEL in slave to match this output     ║
 * ╚══════════════════════════════════════════════════════════╝
 */

#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "esp_camera.h"
#include "esp_task_wdt.h"
#include <esp_now.h>
#include <esp_wifi.h>
#include <time.h>       // NTP time — for night mode + date in reports

// ───────────────── STRUCTS ─────────────────
struct ReportResult {
  bool valve;             // true = open solenoid valve (water flow)
  unsigned long duration_ms;
  bool buzzer;
  int health_score;
  bool ok;
  bool animal_detected;
  char animal_type[32];   // "cat", "dog", "bird", "rodent", etc.
  char animal_threat[16]; // "none", "low", "medium", "high"
};

struct OfflineReading {
  int moisture;
  float tempC;
  bool used;
};

// ── ESP-NOW Packet Structures (must match slave_monitor.ino AND slave_npk.ino) ──
#define SLAVE_TYPE_SOIL  0
#define SLAVE_TYPE_NPK   1

typedef struct SensorPacket {
  char     slave_id[16];
  char     zone_name[32];
  uint8_t  slave_type;       // SLAVE_TYPE_SOIL=0, SLAVE_TYPE_NPK=1
  int      moisture_pct;     // soil moisture (SOIL slave); 0 for NPK slave
  float    temperature_c;
  bool     emergency_valve;
  uint32_t uptime_s;
  float    land_area_acres;
  // NPK fields — 0 for SOIL slave
  uint16_t npk_n;            // Nitrogen   mg/kg
  uint16_t npk_p;            // Phosphorus mg/kg
  uint16_t npk_k;            // Potassium  mg/kg
  float    soil_ph;          // soil pH    (7-in-1 NPK only)
  float    soil_ec;          // EC μS/cm   (7-in-1 NPK only)
} SensorPacket;

typedef struct CommandPacket {
  char     slave_id[16];
  bool     valve_on;
  uint32_t valve_ms;
  bool     beep;
  bool     allow_water;      // false = night mode
} CommandPacket;

// ── Slave registry (up to 10 slaves) ──
#define MAX_SLAVES 10

struct SlaveRecord {
  char     slave_id[16];
  char     zone_name[32];
  uint8_t  mac[6];
  uint8_t  slave_type;       // SLAVE_TYPE_SOIL or SLAVE_TYPE_NPK
  int      moisture_pct;
  float    temperature_c;
  bool     emergency_valve;
  float    land_area_acres;
  uint32_t last_seen;
  bool     active;
  bool     peer_registered;
  // NPK (only populated for NPK slaves)
  uint16_t npk_n;
  uint16_t npk_p;
  uint16_t npk_k;
  float    soil_ph;
  float    soil_ec;
};

SlaveRecord slaves[MAX_SLAVES];
int slaveCount = 0;
portMUX_TYPE slaveMux = portMUX_INITIALIZER_UNLOCKED;

// ───────────────── USER CONFIG (EDIT THESE BEFORE FLASHING) ─────────────────
//  ┌─ FIELD SETUP CHECKLIST ─────────────────────────────────────────────────┐
//  │  □ 1. Verify WiFi networks below (college + mobile hotspot fallback)    │
//  │  □ 2. BACKEND_URL and DEVICE_KEY already set — no changes needed        │
//  │  □ 3. Flash master FIRST — note from Serial Monitor:                    │
//  │        "Master MAC: XX:XX:XX:XX:XX:XX" → paste into slave MASTER_MAC   │
//  │        "[ESPNOW] WiFi Channel: X"       → paste into slave WIFI_CHANNEL │
//  │  □ 4. Then flash slave(s) with correct MASTER_MAC + WIFI_CHANNEL        │
//  │  □ 5. Power both — slave beeps 2× on success                           │
//  │  □ 6. Watch Serial Monitor: master should print slave zone data         │
//  └─────────────────────────────────────────────────────────────────────────┘
// Add / remove networks below — device auto-picks strongest available
WiFiMulti wifiMulti;
void setupWiFiNetworks() {
  wifiMulti.addAP("CILP_Open",  "cilp@tiet#b122");   // college garden WiFi
  wifiMulti.addAP("GuestHouse", "ghouse@tugh");       // guest house
  wifiMulti.addAP("HostelQ",    "hostelnet");          // hostel
  wifiMulti.addAP("Tiuu",       "12345678");
  wifiMulti.addAP("Manzil1102",       "Hemabh@23");
  wifiMulti.addAP("Manzil1102_5G",  "Hemabh@23");          // backup: home
  // wifiMulti.addAP("MyHotspot", "password");        // ← add mobile hotspot as field fallback
}

#define BACKEND_URL  "https://pl-kp57.onrender.com"  // ← BhoomiIQ backend
//#define DEVICE_KEY   "piq-FA20E3-2D352D"             // ← from BhoomiIQ dashboard garden
#define DEVICE_KEY   "piq-839072-2248CA"
#define SENSOR_INTERVAL_S        60      // read sensors + check emergency every 60s (day & night)
#define CLOUD_REPORT_INTERVAL_H  3       // send AI report every 3 hours (daytime only)

#define MOISTURE_CRITICAL 25             // % — emergency valve fires immediately (outdoor garden soil)
#define MOISTURE_DRY      40             // % — "dry" warning level for AI report
#define VALVE_EMERGENCY_MS       180000  // ms — 3 min valve open per emergency (matches cloud dose)
#define VALVE_EMERGENCY_COOLDOWN_MS 300000 // 5 min cooldown — prevents over-watering outdoor garden

// ── Night / Day schedule (IST) ──
#define DAY_START_HOUR   6   // 6 AM — watering + cloud reports resume
#define NIGHT_START_HOUR 21  // 9 PM — no watering, no cloud reports

// ── RELAY TYPE — change if valve behaviour is inverted ──
// true  = active LOW relay  (LOW=ON, HIGH=OFF) — most common blue relay modules
// false = active HIGH relay (HIGH=ON, LOW=OFF) — some red/black modules
#define RELAY_ACTIVE_LOW true
// ───────────────── PINS ─────────────────
#define SOIL_PIN 1
#define DS18B20_PIN 14
#define RELAY_PIN 38   // solenoid valve relay — GPIO 38
#define BUZZER_PIN 21  // buzzer soldered to GPIO 21

// Camera pins
#define CAM_PWDN_PIN -1
#define CAM_RESET_PIN -1
#define CAM_XCLK_PIN 15
#define CAM_SIOD_PIN 4
#define CAM_SIOC_PIN 5
#define CAM_Y9_PIN 16
#define CAM_Y8_PIN 17
#define CAM_Y7_PIN 18
#define CAM_Y6_PIN 12
#define CAM_Y5_PIN 10
#define CAM_Y4_PIN 8
#define CAM_Y3_PIN 9
#define CAM_Y2_PIN 11
#define CAM_VSYNC_PIN 6
#define CAM_HREF_PIN 7
#define CAM_PCLK_PIN 13

// Soil calibration — re-calibrate outdoors if readings look wrong:
//   Open Serial Monitor → "[SOIL] raw=XXXX" →
//   Hold sensor in dry air → set SOIL_DRY_RAW to that value
//   Dip sensor in water   → set SOIL_WET_RAW to that value
#define SOIL_DRY_RAW 4000   // ADC reading in dry air
#define SOIL_WET_RAW 1100   // ADC reading fully wet

// ───────────────── GLOBALS ─────────────────
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);
bool cameraOK = false;
unsigned long lastEmergencyValveMs = 0; // cooldown tracker for local emergency valve open

// Loop timing — millis() based, replaces blocking delay
unsigned long lastSensorMs     = 0;  // last sensor read
unsigned long lastCloudMs      = 0;  // last cloud AI report
unsigned long lastCmdPollMs    = 0;  // last manual-command poll
bool          firstCloudDone   = false; // send first report on boot (before 3h timer)
#define SENSOR_INTERVAL_MS       (SENSOR_INTERVAL_S * 1000UL)
#define CLOUD_REPORT_INTERVAL_MS (CLOUD_REPORT_INTERVAL_H * 3600UL * 1000UL)
#define CMD_POLL_INTERVAL_MS     30000UL  // poll for instant manual commands every 30 s

#define OFFLINE_QUEUE_SIZE 5
OfflineReading offlineQueue[OFFLINE_QUEUE_SIZE];
int offlineHead = 0;

// ───────────────── BUZZER ─────────────────
void beep(int ms, int n = 1) {
  for (int i = 0; i < n; i++) {
    digitalWrite(BUZZER_PIN, HIGH); delay(ms);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < n - 1) delay(90);
  }
}

void beepBoot()  { beep(80,3); }
void beepFail()  { beep(500,2); }
void beepValve() { beep(60,2); delay(60); beep(180,1); } // two short + one long = valve open
// Animal detected — aggressive pattern: 3× (short-short-long) to scare animal away
void beepAnimal(int cycles=3) {
  for(int c=0; c<cycles; c++){
    beep(80,2); delay(60); beep(400,1);
    if(c < cycles-1) delay(200);
  }
}

// ───────────────── NTP TIME (IST = UTC+5:30) ─────────────────

void syncNTP() {
  // India Standard Time = UTC + 5h30m = 19800 seconds offset
  configTime(19800, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
  Serial.print("[NTP] Syncing");
  time_t now = time(nullptr);
  int tries = 0;
  while (now < 1000000000UL && tries++ < 20) {
    delay(500); esp_task_wdt_reset();
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println();
  if (now > 1000000000UL) {
    struct tm *t = localtime(&now);
    char buf[40];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S IST", t);
    Serial.printf("[NTP] Synced — %s\n", buf);
  } else {
    Serial.println("[NTP] Sync failed — watering allowed until NTP syncs (safe default)");
  }
}

bool isTimeReady() {
  return time(nullptr) > 1000000000UL;
}

// Returns true during night hours (9 PM – 6 AM IST)
// If NTP not yet synced, returns false (treat as day — safe default)
bool isNightTime() {
  if (!isTimeReady()) return false;
  time_t now = time(nullptr);
  struct tm *t = localtime(&now);
  int h = t->tm_hour;
  return (h >= NIGHT_START_HOUR || h < DAY_START_HOUR);
}

// Returns formatted date+time string for Serial logs and HTTP reports
String getDateTimeStr() {
  if (!isTimeReady()) return "time-not-synced";
  time_t now = time(nullptr);
  struct tm *t = localtime(&now);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", t);
  return String(buf);
}

// ───────────────── SOLENOID VALVE ─────────────────
#define RELAY_ON  (RELAY_ACTIVE_LOW ? LOW  : HIGH)
#define RELAY_OFF (RELAY_ACTIVE_LOW ? HIGH : LOW)

// NOTE: Solenoid valve — NO soft-start needed.
// Unlike a pump, a solenoid valve has no motor to spin up.
// It is a simple electromagnetic coil that opens/closes instantly.
// Soft-start would cause partial-open states — valve opens fully on first RELAY_ON.
void valveRun(unsigned long ms){
  Serial.printf("[VALVE] OPEN %lu ms (active-%s)\n", ms,
    RELAY_ACTIVE_LOW ? "LOW" : "HIGH");
  beepValve();
  digitalWrite(RELAY_PIN, RELAY_ON);   // valve opens immediately
  esp_task_wdt_reset();
  unsigned long endMs = millis() + ms;
  while(millis() < endMs){ esp_task_wdt_reset(); delay(100); }
  digitalWrite(RELAY_PIN, RELAY_OFF);  // valve closes
  Serial.println("[VALVE] CLOSED");
}

// ───────────────── MOISTURE ─────────────────
int readMoisturePct(){
  long sum=0;
  for(int i=0;i<8;i++){sum+=analogRead(SOIL_PIN);delay(5);}
  int raw=sum/8;
  int pct=map(raw,SOIL_DRY_RAW,SOIL_WET_RAW,0,100);
  pct=constrain(pct,0,100);
  Serial.printf("[SOIL] raw=%d moisture=%d%%\n",raw,pct);
  return pct;
}

// ───────────────── TEMPERATURE ─────────────────
float lastGoodTemp = 25.0; // fallback if sensor fails

float readTemperatureC(){
  tempSensor.requestTemperatures();
  float t=tempSensor.getTempCByIndex(0);
  if(t==DEVICE_DISCONNECTED_C || t < -100 || t > 100){
    Serial.println("[TEMP] Sensor disconnected — using last known value");
    return lastGoodTemp; // use last valid reading instead of -999
  }
  lastGoodTemp = t; // save good reading
  Serial.printf("[TEMP] %.2f C\n",t);
  return t;
}

// ───────────────── CAMERA ─────────────────
bool initCamera(){

camera_config_t cfg;

cfg.ledc_channel=LEDC_CHANNEL_0;
cfg.ledc_timer=LEDC_TIMER_0;

cfg.pin_d0=CAM_Y2_PIN;
cfg.pin_d1=CAM_Y3_PIN;
cfg.pin_d2=CAM_Y4_PIN;
cfg.pin_d3=CAM_Y5_PIN;
cfg.pin_d4=CAM_Y6_PIN;
cfg.pin_d5=CAM_Y7_PIN;
cfg.pin_d6=CAM_Y8_PIN;
cfg.pin_d7=CAM_Y9_PIN;

cfg.pin_xclk=CAM_XCLK_PIN;
cfg.pin_pclk=CAM_PCLK_PIN;
cfg.pin_vsync=CAM_VSYNC_PIN;
cfg.pin_href=CAM_HREF_PIN;

cfg.pin_sscb_sda=CAM_SIOD_PIN;
cfg.pin_sscb_scl=CAM_SIOC_PIN;

cfg.pin_pwdn=CAM_PWDN_PIN;
cfg.pin_reset=CAM_RESET_PIN;

cfg.xclk_freq_hz=20000000;
cfg.pixel_format=PIXFORMAT_JPEG;

// PSRAM boards: VGA (640×480) — timeout is now 60s so it handles the larger payload
// No-PSRAM boards: QVGA (320×240) — limited heap, keep it safe
if(psramFound()){
  cfg.frame_size  = FRAMESIZE_VGA;   // 640×480 — 4× sharper than QVGA
  cfg.jpeg_quality= 10;              // 0=best 63=worst; 10 gives ~35-55 KB at VGA
  cfg.fb_count    = 2;
}
else{
  cfg.frame_size  = FRAMESIZE_QVGA;
  cfg.jpeg_quality= 12;              // slightly better quality than before
  cfg.fb_count    = 1;
}

if(esp_camera_init(&cfg)!=ESP_OK){
  Serial.println("[CAM] Init FAILED");
  return false;
}

// ── OV2640 sensor fine-tuning ──────────────────────────────────
// These settings dramatically improve colour accuracy and sharpness
// compared to the OV2640 defaults
sensor_t *s = esp_camera_sensor_get();
if(s){
  s->set_brightness(s, 1);      // -2..2   — slight boost for indoor/shade
  s->set_contrast(s, 1);        // -2..2   — punchier greens
  s->set_saturation(s, 1);      // -2..2   — richer plant colours
  s->set_sharpness(s, 2);       // -2..2   — crisper leaf edges
  s->set_denoise(s, 1);         // 0|1     — reduce sensor noise
  s->set_whitebal(s, 1);        // AWB on  — natural colour temp
  s->set_awb_gain(s, 1);        // AWB gain on
  s->set_wb_mode(s, 0);         // 0=auto, 1=sunny, 2=cloudy, 3=office, 4=home
  s->set_exposure_ctrl(s, 1);   // AEC on  — auto exposure
  s->set_aec2(s, 1);            // AEC DSP on for better low-light
  s->set_ae_level(s, 0);        // AEC bias 0 (neutral)
  s->set_gain_ctrl(s, 1);       // AGC on
  s->set_agc_gain(s, 0);        // let AGC pick
  s->set_gainceiling(s, (gainceiling_t)2); // max 2× gain — keeps noise low
  s->set_bpc(s, 1);             // bad pixel correction
  s->set_wpc(s, 1);             // white pixel correction
  s->set_raw_gma(s, 1);         // raw gamma on — better dynamic range
  s->set_lenc(s, 1);            // lens correction — even brightness across frame
  s->set_hmirror(s, 0);         // set 1 if image appears mirrored
  s->set_vflip(s, 0);           // set 1 if image appears upside-down
  Serial.println("[CAM] Sensor tuning applied");
}

// Discard first 3 frames — OV2640 needs a few frames to settle
// AGC and AWB after a cold start
for(int w=0;w<3;w++){
  camera_fb_t *wb = esp_camera_fb_get();
  if(wb) esp_camera_fb_return(wb);
  delay(100);
}

Serial.println("[CAM] Ready");
return true;
}

// ───────────────── ESP-NOW ─────────────────

// Find or create a slave record by MAC address
int findOrCreateSlave(const uint8_t* mac) {
  portENTER_CRITICAL(&slaveMux);
  for (int i = 0; i < slaveCount; i++) {
    if (memcmp(slaves[i].mac, mac, 6) == 0) {
      portEXIT_CRITICAL(&slaveMux);
      return i;
    }
  }
  if (slaveCount < MAX_SLAVES) {
    int idx = slaveCount++;
    memcpy(slaves[idx].mac, mac, 6);
    slaves[idx].active = true;
    slaves[idx].peer_registered = false;
    portEXIT_CRITICAL(&slaveMux);
    return idx;
  }
  portEXIT_CRITICAL(&slaveMux);
  return -1; // full
}

// Called when a slave sends us sensor data
void onSlaveData(const uint8_t *mac, const uint8_t *data, int len) {
  if (len != sizeof(SensorPacket)) return;

  SensorPacket pkt;
  memcpy(&pkt, data, sizeof(pkt));

  int idx = findOrCreateSlave(mac);
  if (idx < 0) return;

  portENTER_CRITICAL(&slaveMux);
  strncpy(slaves[idx].slave_id,  pkt.slave_id,  15);
  strncpy(slaves[idx].zone_name, pkt.zone_name, 31);
  slaves[idx].slave_type      = pkt.slave_type;
  slaves[idx].moisture_pct    = pkt.moisture_pct;
  slaves[idx].temperature_c   = pkt.temperature_c;
  slaves[idx].emergency_valve = pkt.emergency_valve;
  slaves[idx].land_area_acres = pkt.land_area_acres;
  slaves[idx].npk_n           = pkt.npk_n;
  slaves[idx].npk_p           = pkt.npk_p;
  slaves[idx].npk_k           = pkt.npk_k;
  slaves[idx].soil_ph         = pkt.soil_ph;
  slaves[idx].soil_ec         = pkt.soil_ec;
  slaves[idx].last_seen       = millis();
  slaves[idx].active          = true;
  portEXIT_CRITICAL(&slaveMux);

  if (pkt.slave_type == SLAVE_TYPE_NPK) {
    Serial.printf("[ESPNOW] ← %s [NPK] | N=%u P=%u K=%u mg/kg | pH=%.1f EC=%.0f\n",
      pkt.slave_id, pkt.npk_n, pkt.npk_p, pkt.npk_k, pkt.soil_ph, pkt.soil_ec);
  } else {
    Serial.printf("[ESPNOW] ← %s [SOIL] | moisture=%d%% temp=%.1fC\n",
      pkt.slave_id, pkt.moisture_pct, pkt.temperature_c);
  }

  // Register slave as peer if not yet done (so we can send commands back)
  if (!slaves[idx].peer_registered) {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, mac, 6);
    uint8_t ch = 0;
    wifi_second_chan_t sec;
    esp_wifi_get_channel(&ch, &sec);
    peer.channel = ch;
    peer.encrypt = false;
    if (esp_now_add_peer(&peer) == ESP_OK) {
      slaves[idx].peer_registered = true;
      Serial.printf("[ESPNOW] Registered peer: %s\n", pkt.slave_id);
    }
  }
}

// Send valve command to a specific slave by index
// allow_water=false tells slave to suppress its own local emergency valve (night mode)
void sendValveCommand(int idx, bool valveOn, uint32_t valveMs, bool allowWater = true) {
  if (idx < 0 || idx >= slaveCount) return;
  if (!slaves[idx].peer_registered) return;

  CommandPacket cmd;
  memset(&cmd, 0, sizeof(cmd));
  strncpy(cmd.slave_id, slaves[idx].slave_id, 15);
  cmd.valve_on    = valveOn;
  cmd.valve_ms    = valveMs;
  cmd.beep        = valveOn;
  cmd.allow_water = allowWater;

  esp_err_t res = esp_now_send(slaves[idx].mac, (uint8_t*)&cmd, sizeof(cmd));
  Serial.printf("[ESPNOW] → %s valve=%s allow_water=%s (%s)\n",
    cmd.slave_id, valveOn ? "OPEN" : "CLOSED",
    allowWater ? "yes" : "NIGHT",
    res == ESP_OK ? "sent" : "error");
}

// Every sensor cycle — send slaves the current day/night flag + open valve if needed
void processSlaveCommands() {
  bool dayMode = !isNightTime();
  for (int i = 0; i < slaveCount; i++) {
    if (!slaves[i].active) continue;
    if (!dayMode) {
      // Night: send heartbeat with allow_water=false so slave suppresses local emergency
      sendValveCommand(i, false, 0, false);
      Serial.printf("[NIGHT] → %s: no-water heartbeat sent\n", slaves[i].slave_id);
    } else if (slaves[i].moisture_pct < MOISTURE_CRITICAL && !slaves[i].emergency_valve) {
      // Day + critical moisture — open valve
      sendValveCommand(i, true, VALVE_EMERGENCY_MS, true);
    } else {
      // Day + moisture OK — heartbeat with allow_water=true
      sendValveCommand(i, false, 0, true);
    }
  }
}

// Build slaves JSON array for HTTP report (includes NPK fields for NPK slaves)
String buildSlavesJson() {
  String json = "[";
  bool first = true;
  for (int i = 0; i < slaveCount; i++) {
    if (!slaves[i].active) continue;
    if (!first) json += ",";
    first = false;
    bool online = (millis() - slaves[i].last_seen) < 120000; // 2 min timeout
    json += "{";
    json += "\"slave_id\":\"" + String(slaves[i].slave_id) + "\",";
    json += "\"zone_name\":\"" + String(slaves[i].zone_name) + "\",";
    json += "\"slave_type\":" + String(slaves[i].slave_type) + ",";
    json += "\"moisture_pct\":" + String(slaves[i].moisture_pct) + ",";
    json += "\"temperature_c\":" + String(slaves[i].temperature_c, 1) + ",";
    json += "\"land_area_acres\":" + String(slaves[i].land_area_acres, 2) + ",";
    json += "\"online\":" + String(online ? "true" : "false") + ",";
    json += "\"last_seen_s\":" + String((millis() - slaves[i].last_seen) / 1000);
    // Include NPK fields (0 for SOIL slaves — backend ignores zeros)
    json += ",\"npk_n\":" + String(slaves[i].npk_n);
    json += ",\"npk_p\":" + String(slaves[i].npk_p);
    json += ",\"npk_k\":" + String(slaves[i].npk_k);
    json += ",\"soil_ph\":" + String(slaves[i].soil_ph, 1);
    json += ",\"soil_ec\":" + String(slaves[i].soil_ec, 0);
    json += "}";
  }
  json += "]";
  return json;
}

bool initESPNOW() {
  // ESP-NOW is initialized AFTER WiFi connects (must share same channel)
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESPNOW] Init FAILED");
    return false;
  }
  esp_now_register_recv_cb(onSlaveData);
  Serial.printf("[ESPNOW] Ready — Master MAC: %s\n", WiFi.macAddress().c_str());

  // Print WiFi channel so slaves can be configured to match
  uint8_t ch = 0;
  wifi_second_chan_t sec;
  esp_wifi_get_channel(&ch, &sec);
  Serial.printf("[ESPNOW] WiFi Channel: %d  ← copy this to slave WIFI_CHANNEL\n", ch);
  return true;
}

// ───────────────── WIFI (STATIC IP) ─────────────────
bool connectWiFi(int maxRetries=3){

WiFi.mode(WIFI_STA);
setupWiFiNetworks();

Serial.println("[WiFi] Scanning for known networks...");

for(int a=1; a<=maxRetries; a++){

  Serial.printf("[WiFi] Attempt %d\n", a);

  int t = 0;
  while(wifiMulti.run() != WL_CONNECTED && t++ < 20){
    delay(500);
    Serial.print(".");
    esp_task_wdt_reset();
  }

  Serial.println();

  if(WiFi.status() == WL_CONNECTED){

    Serial.printf("[WiFi] Connected to: %s\n", WiFi.SSID().c_str());
    Serial.printf("[WiFi] IP:%s  RSSI:%d\n",
      WiFi.localIP().toString().c_str(),
      WiFi.RSSI());

    // Apply static IP only on college network (needs fixed IP for Render reach)
    if(WiFi.SSID() == "CILP_Open"){
      WiFi.disconnect(false);
      IPAddress local_IP(172, 31, 29, 200);
      IPAddress gateway(172, 31, 29, 1);
      IPAddress subnet(255, 255, 255, 0);
      IPAddress dns(8, 8, 8, 8);
      if(WiFi.config(local_IP, gateway, subnet, dns)){
        WiFi.begin("CILP_Open", "cilp@tiet#b122");
        int st=0;
        while(WiFi.status()!=WL_CONNECTED && st++<20){ delay(500); }
        Serial.printf("[WiFi] Static IP applied: %s\n",
          WiFi.localIP().toString().c_str());
      }
    }

    return true;
  }

  WiFi.disconnect(true);
  delay(1000 * a);
}

Serial.println("[WiFi] FAILED — no known network in range");
return false;
}

// ───────────────── WAKE RENDER (cold-start ping) ─────────────────
// Render free tier sleeps after inactivity — ping /health first
// and wait up to 40 seconds for it to wake before sending image
bool wakeBackend(){
  // Render free tier can take up to 60s on cold start
  // Try up to 6 times — each attempt has its own fresh SSL client
  for(int attempt=1; attempt<=6; attempt++){
    WiFiClientSecure wc;
    wc.setInsecure();
    wc.setTimeout(30);        // 30s SSL socket timeout (overrides 5s default)
    HTTPClient hh;
    String pingUrl = String(BACKEND_URL) + "/health";
    if(!hh.begin(wc, pingUrl)){ hh.end(); continue; }
    hh.setTimeout(30000);     // 30s HTTP timeout
    hh.setConnectTimeout(30000);
    Serial.printf("[WAKE] Pinging backend (attempt %d/6)...\n", attempt);
    int c = hh.GET();
    hh.end();
    if(c > 0){
      Serial.printf("[WAKE] Backend ready (attempt %d, HTTP %d)\n", attempt, c);
      // Wait 5s — let Render fully settle before heavy SSL POST
      for(int g=0;g<5;g++){ delay(1000); esp_task_wdt_reset(); }
      return true;
    }
    Serial.printf("[WAKE] Attempt %d failed (err %d) — waiting 10s\n", attempt, c);
    for(int w=0;w<10;w++){ delay(1000); esp_task_wdt_reset(); }
  }
  Serial.println("[WAKE] Backend unreachable after 6 attempts");
  return false;
}

// ───────────────── HTTP REPORT ─────────────────
ReportResult sendDeviceReport(int moisture,float tempC){

ReportResult res={false,5000,false,-1,false,false,"none","none"}; // valve=false by default

// Wake Render first — avoids SSL timeout on cold start
if(!wakeBackend()) return res;

// Build URL with master sensor data + slaves JSON + datetime
String slavesJson = buildSlavesJson();
String dtStr = getDateTimeStr();
String url=String(BACKEND_URL)+"/api/device-report?moisture="+String(moisture)
           +"&temperature="+String(tempC,2)
           +"&slave_count="+String(slaveCount)
           +"&datetime="+dtStr;
Serial.printf("[HTTP] POST report at %s\n", dtStr.c_str());

// Retry up to 3 times on send failure (-3 chunk error)
for(int attempt=1; attempt<=3; attempt++){

  if(attempt > 1){
    Serial.printf("[HTTP] Retry %d/3 — waiting 3s\n", attempt);
    for(int w=0;w<3;w++){ delay(1000); esp_task_wdt_reset(); }
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(60); 
  HTTPClient http;
  http.setReuse(false); // fresh connection each attempt — prevents stale SSL issues

  if(!http.begin(client,url)){
    Serial.println("[HTTP] begin failed");
    continue;
  }

  http.addHeader("x-device-key", DEVICE_KEY);
  http.addHeader("Connection", "close");
  http.addHeader("x-slaves-json", slavesJson); // slave zone data piggybacked in header
  http.setTimeout(60000);

  camera_fb_t *fb = esp_camera_fb_get();
  int code;

  if(fb){
    Serial.printf("[CAM] %u bytes (attempt %d)\n", fb->len, attempt);
    http.addHeader("Content-Type", "image/jpeg");
    http.addHeader("Content-Length", String(fb->len)); // explicit size — prevents chunked encoding
    code = http.POST(fb->buf, fb->len);
    esp_camera_fb_return(fb);
  } else {
    code = http.POST((uint8_t*)"", 0);
  }

  Serial.printf("[HTTP] %d\n", code);

  if(code == 200){
    String body = http.getString();
    res.ok             = true;
    res.valve          = body.indexOf("\"pump\":true")           != -1;
    res.buzzer         = body.indexOf("\"buzzer\":true")         != -1;
    res.animal_detected= body.indexOf("\"animal_detected\":true")!= -1;

    // Log device mode and AI intent (informational — actual valve is already decided by backend)
    bool semiMode    = body.indexOf("\"mode\":\"semi\"")         != -1;
    bool aiWanted    = body.indexOf("\"ai_pump_wanted\":true")  != -1;
    bool dailyForced = body.indexOf("\"daily_forced\":true")    != -1;
    if (semiMode && aiWanted && !res.valve)
      Serial.println("[MODE] Semi-Auto: AI wanted to water but valve suppressed — use dashboard button");
    else if (semiMode)
      Serial.println("[MODE] Semi-Auto: valve only opens on manual dashboard command");
    else if (dailyForced && res.valve)
      Serial.printf("[PUMP] Compulsory daily watering — valve ON for %lums\n", res.duration_ms);
    else
      Serial.println("[MODE] Auto: AI is in control");

    // Extract animal_type string from JSON
    int atIdx = body.indexOf("\"animal_type\":\"");
    if(atIdx != -1){
      int start = atIdx + 15;
      int end   = body.indexOf("\"", start);
      if(end != -1) body.substring(start, end).toCharArray(res.animal_type, 32);
    }
    // Extract animal_threat string from JSON
    int thIdx = body.indexOf("\"animal_threat\":\"");
    if(thIdx != -1){
      int start = thIdx + 17;
      int end   = body.indexOf("\"", start);
      if(end != -1) body.substring(start, end).toCharArray(res.animal_threat, 16);
    }

    if(res.animal_detected)
      Serial.printf("[AI] Animal detected: %s (threat: %s)\n",
        res.animal_type, res.animal_threat);

    http.end();
    return res; // success — exit retry loop
  }

  http.end();

  if(code == -1 || code == -3 || code == -11){
    // -1  = connection refused (Render not ready yet)
    // -3  = send failed / chunk error
    // -11 = timeout
    Serial.printf("[HTTP] Retriable error (%d) — will retry\n", code);
    continue;
  }

  break; // non-retryable error — stop trying
}

Serial.println("[HTTP] All attempts failed");
return res;
}

// ───────────────── INSTANT PUMP POLL ─────────────────
// Called every 30 s — checks backend for a queued manual "Paani Do" command.
// Fires the valve immediately without waiting for the 3-hour AI report.
void checkPendingCommand() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String(BACKEND_URL) + "/api/device/pending-command";
  http.begin(url);
  http.addHeader("x-device-key", DEVICE_KEY);
  http.setTimeout(8000);
  esp_task_wdt_reset();
  int code = http.GET();
  if (code == 200) {
    String body = http.getString();
    if (body.indexOf("\"pump\":true") != -1) {
      unsigned long dur = 180000UL; // fallback 3 min
      int dIdx = body.indexOf("\"duration_ms\":");
      if (dIdx != -1) {
        String numStr = body.substring(dIdx + 14);
        long parsed = numStr.toInt();
        if (parsed > 0) dur = (unsigned long)parsed;
      }
      Serial.printf("[CMD] 💧 Instant manual pump — valve ON for %lus\n", dur / 1000UL);
      beepValve();
      valveRun(dur); // manual always bypasses night-mode suppression
    }
  }
  http.end();
  esp_task_wdt_reset();
}

// ───────────────── SETUP ─────────────────
void setup(){

Serial.begin(115200);

// Set relay OFF *before* pinMode — prevents solenoid valve from auto-opening at boot
digitalWrite(RELAY_PIN, RELAY_OFF); // ensure valve CLOSED (respects RELAY_ACTIVE_LOW flag)
pinMode(RELAY_PIN, OUTPUT);
digitalWrite(RELAY_PIN, RELAY_OFF); // double-set after pinMode — solenoid valve stays closed

// Set buzzer OFF *before* pinMode — prevents continuous sound at boot
// Active buzzer: HIGH = ON, LOW = OFF
digitalWrite(BUZZER_PIN, LOW); // silence first
pinMode(BUZZER_PIN, OUTPUT);
digitalWrite(BUZZER_PIN, LOW); // double-set after pinMode

esp_task_wdt_init(300,true); // 5 min — covers 6x wake attempts (30s+10s each) + main request
esp_task_wdt_add(NULL);

tempSensor.begin();

cameraOK=initCamera();

bool wifiOK=connectWiFi();

// Init ESP-NOW AFTER WiFi connects — they must share the same channel
if(wifiOK){
  initESPNOW();
  Serial.println("[SETUP] ESP-NOW ready — waiting for slave nodes...");
  Serial.println("[SETUP] ↑ Copy the MAC + Channel above into each slave's config");
  syncNTP(); // sync IST time — enables night mode + datetime in reports
}

wifiOK?beepBoot():beepFail();

Serial.printf("[SETUP] Done — %s | Day:%02dh–%02dh | Report every %dh\n",
  getDateTimeStr().c_str(), DAY_START_HOUR, NIGHT_START_HOUR, CLOUD_REPORT_INTERVAL_H);
}

// ───────────────── LOOP ─────────────────
void loop(){

esp_task_wdt_reset();

unsigned long now = millis();
bool night = isNightTime();

// ── INSTANT COMMAND POLL (every 30s — catches manual "Paani Do" button presses) ─────
if(now - lastCmdPollMs >= CMD_POLL_INTERVAL_MS){
  lastCmdPollMs = now;
  checkPendingCommand();
}

// ── SENSOR CHECK (every 60s — runs day AND night) ─────────────────────────
if(now - lastSensorMs >= SENSOR_INTERVAL_MS){
  lastSensorMs = now;

  int moisture = readMoisturePct();
  float tempC  = readTemperatureC();
  bool sensorsValid = (tempC > -100);

  Serial.printf("[READ] %s | moisture=%d%% temp=%.1fC | %s\n",
    getDateTimeStr().c_str(), moisture, tempC, night ? "NIGHT-no watering" : "DAY");

  // ── Emergency local valve — DAY ONLY ──
  if(!night && sensorsValid && moisture < MOISTURE_CRITICAL){
    if(now - lastEmergencyValveMs > VALVE_EMERGENCY_COOLDOWN_MS){
      Serial.printf("[VALVE] Critical (%d%%) — emergency valve OPEN\n", moisture);
      valveRun(VALVE_EMERGENCY_MS);
      lastEmergencyValveMs = now;
    } else {
      Serial.printf("[VALVE] Critical (%d%%) — cooldown active, skipping\n", moisture);
    }
  } else if(night && sensorsValid && moisture < MOISTURE_CRITICAL){
    Serial.printf("[NIGHT] Moisture critical (%d%%) — watering suppressed until %02dh\n",
      moisture, DAY_START_HOUR);
  }

  // ── Slave heartbeat (day/night flag + emergency valve if needed) ──
  if(slaveCount > 0){
    Serial.printf("[SLAVES] %d zone(s) — %s\n", slaveCount, night ? "sending night flag" : "checking moisture");
    processSlaveCommands();
  }

  // ── WiFi reconnect if dropped ──
  if(WiFi.status() != WL_CONNECTED){
    Serial.println("[WiFi] Reconnecting...");
    WiFi.reconnect();
    // Re-sync NTP after reconnect if time was lost
    delay(3000); esp_task_wdt_reset();
    if(WiFi.status() == WL_CONNECTED && !isTimeReady()) syncNTP();
  }
}

// ── CLOUD AI REPORT (every 3h — DAY ONLY) ────────────────────────────────
bool cloudDue = (!firstCloudDone) || (now - lastCloudMs >= CLOUD_REPORT_INTERVAL_MS);
if(!night && cloudDue && WiFi.status() == WL_CONNECTED){
  lastCloudMs   = now;
  firstCloudDone = true;

  int moisture = readMoisturePct();
  float tempC  = readTemperatureC();
  bool sensorsValid = (tempC > -100);

  Serial.printf("[REPORT] AI report — %s\n", getDateTimeStr().c_str());
  ReportResult r = sendDeviceReport(moisture, tempC);

  // Valve command from AI — DAY only (double-check night didn't start during upload)
  if(r.ok && r.valve && sensorsValid && !isNightTime()){
    valveRun(r.duration_ms);
  }

  // Animal alert — day or night (camera+buzzer still works at night)
  if(r.ok && r.animal_detected){
    Serial.printf("[ANIMAL] %s detected (threat:%s)\n", r.animal_type, r.animal_threat);
    int cycles = (strcmp(r.animal_threat,"high")==0) ? 5 :
                 (strcmp(r.animal_threat,"low") ==0) ? 2 : 3;
    beepAnimal(cycles);
  }

  Serial.printf("[NEXT] Next AI report in %dh\n", CLOUD_REPORT_INTERVAL_H);
}

delay(500);
esp_task_wdt_reset();

}