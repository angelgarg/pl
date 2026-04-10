/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   BhoomiIQ — Slave Node Firmware v1.1                       ║
 * ║   भूमि IQ — Slave Zone Monitor (ESP-NOW)                    ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Hardware: Generic ESP32 WROOM-32 (no camera needed)        ║
 * ║  Communicates with BhoomiIQ Master via ESP-NOW              ║
 * ║  AUTO channel detection — no hardcoded channel needed!      ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  WIRING:                                                     ║
 * ║   Soil moisture sensor  → GPIO 34 (analog in)               ║
 * ║   DS18B20 temp sensor   → GPIO 4  (+ 4.7kΩ pull-up to 3.3V)║
 * ║   Relay (solenoid valve)→ GPIO 26 (active LOW)              ║
 * ║   Buzzer (optional)     → GPIO 27                           ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  SETUP (only 2 things to configure):                        ║
 * ║   1. Set SLAVE_ID to a unique name e.g. "ZONE_01"           ║
 * ║   2. Set MASTER_MAC to your master's MAC address            ║
 * ║      (boot master once → Serial Monitor prints MAC)         ║
 * ║   Channel is detected AUTOMATICALLY — no manual entry!      ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "esp_task_wdt.h"

// ─────────────────────────────────────────────────────────────
//  USER CONFIG — only 2 things to edit before flashing
// ─────────────────────────────────────────────────────────────
//  ┌─ SETUP CHECKLIST ────────────────────────────────────────┐
//  │  □ 1. Set SLAVE_ID — unique per node (ZONE_01, ZONE_02…) │
//  │  □ 2. Set ZONE_NAME — label shown on dashboard           │
//  │  □ 3. Set ZONE_AREA_ACRES — plot size                    │
//  │  □ 4. Boot master → Serial Monitor prints MAC            │
//  │        → paste into MASTER_MAC below                     │
//  │  ✅ NO channel needed — auto-detected at boot!           │
//  └──────────────────────────────────────────────────────────┘
#define SLAVE_ID        "COLGARDEN_01"      // ← unique per slave
#define ZONE_NAME       "College Garden A"  // ← label shown on dashboard
#define ZONE_AREA_ACRES 0.05f               // ← plot size in acres

// Master MAC — boot master once, copy from Serial Monitor
// Format: {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF}
uint8_t MASTER_MAC[] = {0x1C, 0xDB, 0xD4, 0x45, 0x84, 0xF8}; // ← REPLACE WITH REAL MASTER MAC

// ── Known WiFi SSIDs (same list as master) — slave scans these to find channel ──
// Add/remove SSIDs to match your location
const char* KNOWN_SSIDS[] = {
  "CILP_Open", "GuestHouse", "HostelQ", "Tiuu", "Manzil1102", "Manzil1102_5G"
};
const int NUM_KNOWN_SSIDS = 6;

// ─────────────────────────────────────────────────────────────
//  PINS
// ─────────────────────────────────────────────────────────────
#define SOIL_PIN        34   // Analog input (ADC1 only — ADC2 conflicts with WiFi)
#define DS18B20_PIN     4    // OneWire — needs 4.7kΩ pull-up resistor to 3.3V
#define RELAY_PIN       26   // Active LOW relay — HIGH = valve CLOSED, LOW = valve OPEN
#define BUZZER_PIN      27   // Active buzzer — optional

// ─────────────────────────────────────────────────────────────
//  SENSOR CALIBRATION
//  HOW TO CALIBRATE OUTDOORS:
//    1. Run firmware, open Serial Monitor
//    2. Hold sensor in DRY air → note "[SOIL] raw=XXXX" → set SOIL_DRY_RAW
//    3. Submerge sensor tip in water → note raw → set SOIL_WET_RAW
//    4. Re-flash — outdoor soil ADC often differs from lab values
// ─────────────────────────────────────────────────────────────
#define SOIL_DRY_RAW    3800  // Raw ADC in dry air  (re-calibrate outdoors!)
#define SOIL_WET_RAW    1200  // Raw ADC fully wet   (re-calibrate outdoors!)

// ─────────────────────────────────────────────────────────────
//  THRESHOLDS  (tuned for outdoor garden soil)
// ─────────────────────────────────────────────────────────────
#define MOISTURE_CRITICAL   25   // % — emergency local valve opens immediately below this
#define VALVE_EMERGENCY_MS  12000 // ms — 12s valve open per emergency cycle (garden plot)

// ─────────────────────────────────────────────────────────────
//  TIMING
// ─────────────────────────────────────────────────────────────
#define REPORT_INTERVAL_S   60   // seconds between sensor reads + ESP-NOW sends (60s = stable on college WiFi)
#define MASTER_TIMEOUT_MS   5000 // ms to wait for master ACK/command after send

// ─────────────────────────────────────────────────────────────
//  ESP-NOW PACKET STRUCTURES
//  Must be IDENTICAL on master, soil slave, and NPK slave
// ─────────────────────────────────────────────────────────────
#define SLAVE_TYPE_SOIL  0
#define SLAVE_TYPE_NPK   1

// Slave → Master: sensor data packet
typedef struct SensorPacket {
  char     slave_id[16];      // e.g. "COLGARDEN_01"
  char     zone_name[32];     // e.g. "College Garden A"
  uint8_t  slave_type;        // SLAVE_TYPE_SOIL=0, SLAVE_TYPE_NPK=1
  int      moisture_pct;      // 0–100 (soil slave only; 0 for NPK slave)
  float    temperature_c;     // DS18B20 reading
  bool     emergency_valve;   // true if slave already opened emergency valve locally
  uint32_t uptime_s;          // seconds since boot
  float    land_area_acres;   // zone land area in acres
  // NPK fields — soil slave always sends 0 for these
  uint16_t npk_n;             // Nitrogen   mg/kg (NPK slave only)
  uint16_t npk_p;             // Phosphorus mg/kg (NPK slave only)
  uint16_t npk_k;             // Potassium  mg/kg (NPK slave only)
  float    soil_ph;           // soil pH    (NPK 7-in-1 only; 0 otherwise)
  float    soil_ec;           // EC μS/cm   (NPK 7-in-1 only; 0 otherwise)
} SensorPacket;

// Master → Slave: solenoid valve command packet
typedef struct CommandPacket {
  char     slave_id[16];      // target slave (or "ALL")
  bool     valve_on;          // true = open solenoid valve
  uint32_t valve_ms;          // how long to keep valve open (milliseconds)
  bool     beep;              // true = beep confirmation
  bool     allow_water;       // false = night mode — suppress local emergency valve
} CommandPacket;

// ─────────────────────────────────────────────────────────────
//  GLOBALS
// ─────────────────────────────────────────────────────────────
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);

volatile bool commandReceived = false;
volatile CommandPacket latestCommand;
volatile bool sendSuccess = false;

float lastGoodTemp  = 25.0;
bool  allowWater    = true;  // updated each cycle from master — false = night mode, no valve

// ─────────────────────────────────────────────────────────────
//  BUZZER
// ─────────────────────────────────────────────────────────────
void beep(int ms, int n = 1) {
  for (int i = 0; i < n; i++) {
    digitalWrite(BUZZER_PIN, HIGH); delay(ms);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < n - 1) delay(80);
  }
}
void beepBoot()    { beep(60, 2); }
void beepAlert()   { beep(200, 3); }
void beepValve()   { beep(60, 2); delay(60); beep(120, 1); } // two short + one long = valve open
void beepCommand() { beep(80, 1); }  // short beep on receiving master command

// ─────────────────────────────────────────────────────────────
//  SOLENOID VALVE
//  NOTE: NO soft-start needed — solenoid valve is an electromagnetic
//  coil, not a motor. It opens instantly on RELAY_ON.
//  Soft-start would cause partial-open states and is wrong for valves.
// ─────────────────────────────────────────────────────────────
void valveRun(unsigned long ms) {
  Serial.printf("[VALVE] OPEN %lu ms\n", ms);
  beepValve();
  digitalWrite(RELAY_PIN, LOW);   // valve opens immediately (active LOW)
  unsigned long endMs = millis() + ms;
  while (millis() < endMs) {
    esp_task_wdt_reset();
    delay(100);
  }
  digitalWrite(RELAY_PIN, HIGH);  // valve closes
  Serial.println("[VALVE] CLOSED");
}

// ─────────────────────────────────────────────────────────────
//  SENSORS
// ─────────────────────────────────────────────────────────────
int readMoisturePct() {
  long sum = 0;
  for (int i = 0; i < 8; i++) { sum += analogRead(SOIL_PIN); delay(5); }
  int raw = sum / 8;
  int pct = map(raw, SOIL_DRY_RAW, SOIL_WET_RAW, 0, 100);
  pct = constrain(pct, 0, 100);
  Serial.printf("[SOIL] raw=%d  moisture=%d%%\n", raw, pct);
  return pct;
}

float readTemperatureC() {
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C || t < -100 || t > 100) {
    Serial.println("[TEMP] Disconnected — using last known");
    return lastGoodTemp;
  }
  lastGoodTemp = t;
  Serial.printf("[TEMP] %.2f C\n", t);
  return t;
}

// ─────────────────────────────────────────────────────────────
//  ESP-NOW CALLBACKS
// ─────────────────────────────────────────────────────────────

// Called when we finish sending to master
void onDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  sendSuccess = (status == ESP_NOW_SEND_SUCCESS);
  Serial.printf("[ESPNOW] Send %s\n", sendSuccess ? "OK" : "FAILED");
}

// Called when master sends a command back to us
void onDataRecv(const uint8_t *mac, const uint8_t *data, int len) {
  if (len != sizeof(CommandPacket)) return;
  CommandPacket cmd;
  memcpy(&cmd, data, sizeof(cmd));

  // Only accept commands addressed to this slave
  if (strcmp(cmd.slave_id, SLAVE_ID) != 0 &&
      strcmp(cmd.slave_id, "ALL") != 0) return;

  memcpy((void*)&latestCommand, &cmd, sizeof(cmd));
  commandReceived = true;
  Serial.printf("[CMD] Received — valve=%s ms=%lu\n",
    cmd.valve_on ? "OPEN" : "CLOSED", cmd.valve_ms);
}

// ─────────────────────────────────────────────────────────────
//  AUTO CHANNEL DETECTION
//  Scans WiFi, finds a known SSID, reads its channel.
//  Master connects to the same SSID → same channel → ESP-NOW works.
// ─────────────────────────────────────────────────────────────
int8_t scanForChannel() {
  Serial.println("[SCAN] Scanning for WiFi channel (auto-detect)...");
  WiFi.mode(WIFI_STA);
  int n = WiFi.scanNetworks(false, true); // blocking, include hidden
  Serial.printf("[SCAN] %d networks found\n", n);

  int8_t bestCh    = -1;
  int    bestRSSI  = -999;

  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    for (int j = 0; j < NUM_KNOWN_SSIDS; j++) {
      if (ssid == KNOWN_SSIDS[j]) {
        int rssi = WiFi.RSSI(i);
        int8_t ch = (int8_t)WiFi.channel(i);
        Serial.printf("[SCAN]  '%s' ch=%d RSSI=%d\n", KNOWN_SSIDS[j], ch, rssi);
        if (rssi > bestRSSI) {   // pick strongest signal
          bestRSSI = rssi;
          bestCh   = ch;
        }
      }
    }
  }
  WiFi.scanDelete();

  if (bestCh == -1) {
    Serial.println("[SCAN] No known SSID found — defaulting to ch 1");
    bestCh = 1;
  } else {
    Serial.printf("[SCAN] Using channel %d (RSSI %d)\n", bestCh, bestRSSI);
  }
  return bestCh;
}

// ─────────────────────────────────────────────────────────────
//  ESP-NOW INIT
// ─────────────────────────────────────────────────────────────
bool initESPNOW() {
  // Auto-detect channel by scanning for known SSIDs
  int8_t channel = scanForChannel();

  WiFi.disconnect();

  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  Serial.printf("[ESPNOW] MAC: %s  Channel: %d (auto)\n",
    WiFi.macAddress().c_str(), channel);

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESPNOW] Init FAILED");
    return false;
  }

  esp_now_register_send_cb(onDataSent);
  esp_now_register_recv_cb(onDataRecv);

  // Register master as peer using auto-detected channel
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, MASTER_MAC, 6);
  peerInfo.channel = channel;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("[ESPNOW] Add master peer FAILED — check MASTER_MAC");
    return false;
  }

  Serial.println("[ESPNOW] Ready");
  return true;
}

// ─────────────────────────────────────────────────────────────
//  SEND SENSOR DATA TO MASTER
// ─────────────────────────────────────────────────────────────
bool sendToMaster(int moisture, float tempC, bool emergencyPump) {
  SensorPacket pkt;
  memset(&pkt, 0, sizeof(pkt));   // zero all fields including NPK (important!)
  strncpy(pkt.slave_id,   SLAVE_ID,   sizeof(pkt.slave_id) - 1);
  strncpy(pkt.zone_name,  ZONE_NAME,  sizeof(pkt.zone_name) - 1);
  pkt.slave_type      = SLAVE_TYPE_SOIL;
  pkt.moisture_pct    = moisture;
  pkt.temperature_c   = tempC;
  pkt.emergency_valve = emergencyPump;
  pkt.uptime_s        = millis() / 1000;
  pkt.land_area_acres = ZONE_AREA_ACRES;
  // NPK fields already zeroed by memset

  sendSuccess = false;
  esp_err_t result = esp_now_send(MASTER_MAC, (uint8_t*)&pkt, sizeof(pkt));

  if (result != ESP_OK) {
    Serial.printf("[ESPNOW] Send error: %s\n", esp_err_to_name(result));
    return false;
  }

  // Wait for send callback (up to 1s)
  uint32_t start = millis();
  while (!sendSuccess && millis() - start < 1000) delay(10);

  return sendSuccess;
}

// ─────────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.printf("\n╔══════════════════════════════╗\n");
  Serial.printf("║  BhoomiIQ Slave — %s  ║\n", SLAVE_ID);
  Serial.printf("║  Zone: %-22s║\n", ZONE_NAME);
  Serial.printf("╚══════════════════════════════╝\n\n");

  // Relay OFF before pinMode — solenoid valve stays CLOSED at boot (active LOW — HIGH = CLOSED)
  digitalWrite(RELAY_PIN, HIGH);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // double-set — valve must not open on boot

  // Buzzer OFF before pinMode
  digitalWrite(BUZZER_PIN, LOW);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // Watchdog: 3 minutes
  esp_task_wdt_init(180, true);
  esp_task_wdt_add(NULL);

  tempSensor.begin();

  bool espnowOK = initESPNOW();
  espnowOK ? beepBoot() : beep(500, 3);

  Serial.printf("[SETUP] Done — reporting every %ds\n", REPORT_INTERVAL_S);
}

// ─────────────────────────────────────────────────────────────
//  LOOP
// ─────────────────────────────────────────────────────────────
void loop() {
  esp_task_wdt_reset();

  int   moisture     = readMoisturePct();
  float tempC        = readTemperatureC();
  bool  emergencyRan = false;

  Serial.printf("[READ] %s | moisture=%d%% temp=%.1fC | water=%s\n",
    SLAVE_ID, moisture, tempC, allowWater ? "allowed" : "NIGHT");

  // ── Emergency local valve — only if master allows (day mode) ──
  if (moisture < MOISTURE_CRITICAL) {
    if (allowWater) {
      Serial.println("[SLAVE] CRITICAL moisture — local emergency valve OPEN");
      beepAlert();
      valveRun(VALVE_EMERGENCY_MS);
      emergencyRan = true;
    } else {
      Serial.printf("[SLAVE] CRITICAL moisture (%d%%) — NIGHT MODE, valve suppressed\n", moisture);
    }
  }

  // ── Send data to master ──
  commandReceived = false;
  bool sent = sendToMaster(moisture, tempC, emergencyRan);
  Serial.printf("[SLAVE] Send to master: %s\n", sent ? "OK" : "FAILED");

  if (sent) {
    // Wait for command/heartbeat from master (up to MASTER_TIMEOUT_MS)
    uint32_t waitStart = millis();
    while (!commandReceived && millis() - waitStart < MASTER_TIMEOUT_MS) {
      esp_task_wdt_reset();
      delay(50);
    }

    if (commandReceived) {
      // Update night/day mode from master's heartbeat
      allowWater = latestCommand.allow_water;
      Serial.printf("[SLAVE] Master says: water=%s\n", allowWater ? "allowed" : "NIGHT");
      beepCommand();
      if (latestCommand.valve_on && !emergencyRan && allowWater) {
        valveRun(latestCommand.valve_ms);
      } else if (latestCommand.valve_on && emergencyRan) {
        Serial.println("[SLAVE] Master valve cmd skipped — emergency already ran");
      } else if (latestCommand.valve_on && !allowWater) {
        Serial.println("[SLAVE] Master valve cmd skipped — night mode");
      }
    } else {
      Serial.println("[SLAVE] No command from master (timeout — keeping last water mode)");
    }
  }

  // ── Wait for next interval ──
  Serial.printf("[WAIT] %ds until next reading\n", REPORT_INTERVAL_S);
  for (int i = 0; i < REPORT_INTERVAL_S; i++) {
    delay(1000);
    esp_task_wdt_reset();
  }
}
