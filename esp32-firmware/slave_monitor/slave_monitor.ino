/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   BhoomiIQ — Slave Node Firmware v2.0                       ║
 * ║   भूमि IQ — Slave Zone Monitor (ESP-NOW, Soil Only)         ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Hardware: Generic ESP32 WROOM-32                           ║
 * ║  Sensors : Soil moisture (GPIO 34)                          ║
 * ║  NO pump / relay connected on this node                     ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  SETUP — only 2 things to change:                           ║
 * ║   1. SLAVE_ID  — unique per node e.g. "ZONE_01"             ║
 * ║   2. ZONE_NAME — label e.g. "Front Garden"                  ║
 * ║                                                             ║
 * ║  NO master MAC needed — uses broadcast automatically        ║
 * ║  NO channel needed    — auto-detected at boot               ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "esp_task_wdt.h"

// ─────────────────────────────────────────────────────────────
//  USER CONFIG — only edit these two lines
// ─────────────────────────────────────────────────────────────
#define SLAVE_ID        "ZONE_01"         // ← unique per node
#define ZONE_NAME       "College Garden"  // ← label on dashboard
#define ZONE_AREA_ACRES 0.05f             // ← plot size in acres

// ─────────────────────────────────────────────────────────────
//  KNOWN WiFi SSIDs — slave scans these to find the right channel
//  (master must be connected to one of these)
// ─────────────────────────────────────────────────────────────
const char* KNOWN_SSIDS[] = {
  "CILP_Open", "GuestHouse", "HostelQ", "Tiuu", "Manzil1102", "Manzil1102_5G"
};
const int NUM_KNOWN_SSIDS = 6;

// ─────────────────────────────────────────────────────────────
//  PINS — soil moisture only (no relay, no buzzer)
// ─────────────────────────────────────────────────────────────
#define SOIL_PIN   34   // Analog in — ADC1 only (ADC2 conflicts with WiFi)

// ─────────────────────────────────────────────────────────────
//  SENSOR CALIBRATION
//  1. Open Serial Monitor
//  2. Hold sensor in dry air  → note "[SOIL] raw=XXXX" → set DRY
//  3. Dip sensor in water     → note raw               → set WET
// ─────────────────────────────────────────────────────────────
#define SOIL_DRY_RAW  3800   // raw ADC in dry air
#define SOIL_WET_RAW  1200   // raw ADC fully wet

// ─────────────────────────────────────────────────────────────
//  TIMING
// ─────────────────────────────────────────────────────────────
#define REPORT_INTERVAL_S  60   // send data to master every 60 seconds

// ─────────────────────────────────────────────────────────────
//  ESP-NOW PACKET STRUCTURES
//  Must be IDENTICAL on master, soil slave, and NPK slave
// ─────────────────────────────────────────────────────────────
#define SLAVE_TYPE_SOIL  0
#define SLAVE_TYPE_NPK   1

typedef struct SensorPacket {
  char     slave_id[16];
  char     zone_name[32];
  uint8_t  slave_type;
  int      moisture_pct;
  float    temperature_c;
  bool     emergency_valve;   // always false — no valve on this node
  uint32_t uptime_s;
  float    land_area_acres;
  uint16_t npk_n;             // 0 — soil slave only
  uint16_t npk_p;
  uint16_t npk_k;
  float    soil_ph;
  float    soil_ec;
} SensorPacket;

typedef struct CommandPacket {
  char     slave_id[16];
  bool     valve_on;
  uint32_t valve_ms;
  bool     beep;
  bool     allow_water;
} CommandPacket;

// ─────────────────────────────────────────────────────────────
//  GLOBALS
// ─────────────────────────────────────────────────────────────
// Broadcast MAC — sends to ALL ESP-NOW devices on same channel
// Master auto-registers this slave when first packet arrives
uint8_t BROADCAST_MAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

volatile bool sendDone    = false;
volatile bool sendSuccess = false;

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

// ─────────────────────────────────────────────────────────────
//  ESP-NOW CALLBACKS
// ─────────────────────────────────────────────────────────────
void onDataSent(const uint8_t *mac, esp_now_send_status_t status) {
  sendSuccess = (status == ESP_NOW_SEND_SUCCESS);
  sendDone    = true;
  Serial.printf("[ESPNOW] Send %s\n", sendSuccess ? "OK ✓" : "FAILED ✗");
}

void onDataRecv(const uint8_t *mac, const uint8_t *data, int len) {
  // Acknowledge any command from master (informational only — no valve)
  if (len == sizeof(CommandPacket)) {
    CommandPacket cmd;
    memcpy(&cmd, data, sizeof(cmd));
    if (strcmp(cmd.slave_id, SLAVE_ID) == 0 || strcmp(cmd.slave_id, "ALL") == 0) {
      Serial.printf("[CMD] Master heartbeat received (water=%s)\n",
        cmd.allow_water ? "allowed" : "night");
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  AUTO CHANNEL DETECTION
// ─────────────────────────────────────────────────────────────
int8_t scanForChannel() {
  Serial.println("[SCAN] Auto-detecting WiFi channel...");
  WiFi.mode(WIFI_STA);
  int n = WiFi.scanNetworks(false, true);
  Serial.printf("[SCAN] %d networks found\n", n);

  int8_t bestCh   = -1;
  int    bestRSSI = -999;

  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    for (int j = 0; j < NUM_KNOWN_SSIDS; j++) {
      if (ssid == KNOWN_SSIDS[j]) {
        int   rssi = WiFi.RSSI(i);
        int8_t ch  = (int8_t)WiFi.channel(i);
        Serial.printf("[SCAN]  '%s' ch=%d RSSI=%d\n", KNOWN_SSIDS[j], ch, rssi);
        if (rssi > bestRSSI) { bestRSSI = rssi; bestCh = ch; }
      }
    }
  }
  WiFi.scanDelete();

  if (bestCh == -1) {
    Serial.println("[SCAN] No known SSID found — defaulting ch=1");
    bestCh = 1;
  } else {
    Serial.printf("[SCAN] ✓ Using channel %d\n", bestCh);
  }
  return bestCh;
}

// ─────────────────────────────────────────────────────────────
//  ESP-NOW INIT
// ─────────────────────────────────────────────────────────────
bool initESPNOW() {
  int8_t channel = scanForChannel();

  WiFi.disconnect();
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  Serial.printf("[ESPNOW] Slave MAC : %s\n", WiFi.macAddress().c_str());
  Serial.printf("[ESPNOW] Channel   : %d (auto)\n", channel);
  Serial.printf("[ESPNOW] Sending   : broadcast (no master MAC needed)\n");

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESPNOW] Init FAILED");
    return false;
  }

  esp_now_register_send_cb(onDataSent);
  esp_now_register_recv_cb(onDataRecv);

  // Add broadcast peer — works without knowing master MAC
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_MAC, 6);
  peer.channel = channel;
  peer.encrypt = false;

  if (esp_now_add_peer(&peer) != ESP_OK) {
    Serial.println("[ESPNOW] Add broadcast peer FAILED");
    return false;
  }

  Serial.println("[ESPNOW] Ready ✓");
  return true;
}

// ─────────────────────────────────────────────────────────────
//  SEND TO MASTER
// ─────────────────────────────────────────────────────────────
bool sendToMaster(int moisture) {
  SensorPacket pkt;
  memset(&pkt, 0, sizeof(pkt));
  strncpy(pkt.slave_id,  SLAVE_ID,  sizeof(pkt.slave_id)  - 1);
  strncpy(pkt.zone_name, ZONE_NAME, sizeof(pkt.zone_name) - 1);
  pkt.slave_type      = SLAVE_TYPE_SOIL;
  pkt.moisture_pct    = moisture;
  pkt.temperature_c   = 0;     // no temp sensor on this node
  pkt.emergency_valve = false; // no valve on this node
  pkt.uptime_s        = millis() / 1000;
  pkt.land_area_acres = ZONE_AREA_ACRES;

  sendDone    = false;
  sendSuccess = false;
  esp_err_t err = esp_now_send(BROADCAST_MAC, (uint8_t*)&pkt, sizeof(pkt));

  if (err != ESP_OK) {
    Serial.printf("[ESPNOW] Send error: %s\n", esp_err_to_name(err));
    return false;
  }

  // Wait for send callback (up to 1 s)
  uint32_t t = millis();
  while (!sendDone && millis() - t < 1000) delay(10);
  return sendSuccess;
}

// ─────────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("╔══════════════════════════════════╗");
  Serial.printf( "║  BhoomiIQ Slave: %-16s║\n", SLAVE_ID);
  Serial.printf( "║  Zone: %-26s║\n", ZONE_NAME);
  Serial.println("║  No pump — soil sensor only      ║");
  Serial.println("╚══════════════════════════════════╝");

  // Watchdog — 3 minutes (covers WiFi scan)
  esp_task_wdt_init(180, true);
  esp_task_wdt_add(NULL);

  bool ok = initESPNOW();
  if (!ok) Serial.println("[ERROR] ESP-NOW failed — check wiring/power");

  Serial.printf("[SETUP] Done — reporting every %ds\n", REPORT_INTERVAL_S);
}

// ─────────────────────────────────────────────────────────────
//  LOOP
// ─────────────────────────────────────────────────────────────
void loop() {
  esp_task_wdt_reset();

  int moisture = readMoisturePct();
  Serial.printf("[SLAVE] %s | moisture=%d%%\n", SLAVE_ID, moisture);

  bool sent = sendToMaster(moisture);
  Serial.printf("[SLAVE] Send: %s\n", sent ? "OK" : "FAILED (master may not be on yet)");

  // Wait for next report
  Serial.printf("[WAIT] %ds until next reading...\n", REPORT_INTERVAL_S);
  for (int i = 0; i < REPORT_INTERVAL_S; i++) {
    delay(1000);
    esp_task_wdt_reset();
  }
}
