/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   BhoomiIQ — Slave Node Firmware v1.0                       ║
 * ║   भूमि IQ — Slave Zone Monitor (ESP-NOW)                    ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Hardware: Generic ESP32 WROOM-32 (no camera needed)        ║
 * ║  Communicates with BhoomiIQ Master via ESP-NOW              ║
 * ║  No WiFi router required — direct ESP32-to-ESP32            ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  WIRING:                                                     ║
 * ║   Soil moisture sensor  → GPIO 34 (analog in)               ║
 * ║   DS18B20 temp sensor   → GPIO 4  (+ 4.7kΩ pull-up to 3.3V)║
 * ║   Relay (pump)          → GPIO 26 (active LOW)              ║
 * ║   Buzzer (optional)     → GPIO 27                           ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  SETUP:                                                      ║
 * ║   1. Set SLAVE_ID to a unique name e.g. "ZONE_01"           ║
 * ║   2. Set ZONE_NAME to describe this zone e.g. "Tomatoes"    ║
 * ║   3. Set MASTER_MAC to your BhoomiIQ master's MAC address   ║
 * ║      (Print master MAC from Serial Monitor on master boot)  ║
 * ║   4. Set WIFI_CHANNEL to match your master's WiFi channel   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "esp_task_wdt.h"

// ─────────────────────────────────────────────────────────────
//  USER CONFIG — EDIT BEFORE FLASHING EACH SLAVE
// ─────────────────────────────────────────────────────────────
#define SLAVE_ID        "ZONE_01"       // ← unique per slave: ZONE_01, ZONE_02...
#define ZONE_NAME       "Tomatoes"      // ← human label shown in dashboard
#define WIFI_CHANNEL    1               // ← must match master's WiFi channel
                                        //   (check Serial Monitor on master — prints channel on boot)

// Master's MAC address — printed on master Serial Monitor at boot
// Format: {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF}
uint8_t MASTER_MAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}; // ← REPLACE WITH REAL MASTER MAC

// ─────────────────────────────────────────────────────────────
//  PINS
// ─────────────────────────────────────────────────────────────
#define SOIL_PIN        34   // Analog input (ADC1 only — ADC2 conflicts with WiFi)
#define DS18B20_PIN     4    // OneWire — needs 4.7kΩ pull-up resistor to 3.3V
#define RELAY_PIN       26   // Active LOW relay — HIGH = pump OFF, LOW = pump ON
#define BUZZER_PIN      27   // Active buzzer — optional

// ─────────────────────────────────────────────────────────────
//  SENSOR CALIBRATION
// ─────────────────────────────────────────────────────────────
#define SOIL_DRY_RAW    3800  // Raw ADC reading when sensor is dry in air
#define SOIL_WET_RAW    1200  // Raw ADC reading when sensor is fully submerged

// ─────────────────────────────────────────────────────────────
//  THRESHOLDS
// ─────────────────────────────────────────────────────────────
#define MOISTURE_CRITICAL   20   // % — auto-water immediately if below this
#define PUMP_EMERGENCY_MS   6000 // ms — emergency pump duration

// ─────────────────────────────────────────────────────────────
//  TIMING
// ─────────────────────────────────────────────────────────────
#define REPORT_INTERVAL_S   30   // seconds between sensor reads + ESP-NOW sends
#define MASTER_TIMEOUT_MS   5000 // ms to wait for master ACK/command after send

// ─────────────────────────────────────────────────────────────
//  ESP-NOW PACKET STRUCTURES
//  Must be identical on master and slave
// ─────────────────────────────────────────────────────────────

// Slave → Master: sensor data packet
typedef struct SensorPacket {
  char slave_id[16];       // e.g. "ZONE_01"
  char zone_name[32];      // e.g. "Tomatoes"
  int  moisture_pct;       // 0–100
  float temperature_c;     // e.g. 28.5
  bool emergency_pump;     // true if slave already fired emergency pump locally
  uint32_t uptime_s;       // seconds since boot
} SensorPacket;

// Master → Slave: pump command packet
typedef struct CommandPacket {
  char slave_id[16];       // target slave
  bool pump_on;            // true = run pump
  uint32_t pump_ms;        // how long to run pump (milliseconds)
  bool beep;               // true = beep confirmation
} CommandPacket;

// ─────────────────────────────────────────────────────────────
//  GLOBALS
// ─────────────────────────────────────────────────────────────
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);

volatile bool commandReceived = false;
volatile CommandPacket latestCommand;
volatile bool sendSuccess = false;

float lastGoodTemp = 25.0;

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
void beepPump()    { beep(60, 2); delay(60); beep(120, 1); }
void beepCommand() { beep(80, 1); }  // short beep on receiving master command

// ─────────────────────────────────────────────────────────────
//  PUMP (same soft-start as master to protect battery shield)
// ─────────────────────────────────────────────────────────────
void pumpSoftStart() {
  digitalWrite(RELAY_PIN, LOW);  delay(80);
  digitalWrite(RELAY_PIN, HIGH); delay(60);
  esp_task_wdt_reset();
  digitalWrite(RELAY_PIN, LOW);  delay(150);
  digitalWrite(RELAY_PIN, HIGH); delay(60);
  esp_task_wdt_reset();
  digitalWrite(RELAY_PIN, LOW);  delay(300);
  digitalWrite(RELAY_PIN, HIGH); delay(60);
  esp_task_wdt_reset();
  digitalWrite(RELAY_PIN, LOW);
  Serial.println("[PUMP] Soft-start done");
}

void pumpRun(unsigned long ms) {
  Serial.printf("[PUMP] ON %lu ms\n", ms);
  beepPump();
  pumpSoftStart();
  unsigned long runMs = (ms > 810) ? ms - 810 : 0;
  if (runMs > 0) {
    unsigned long end = millis() + runMs;
    while (millis() < end) {
      esp_task_wdt_reset();
      delay(100);
    }
  }
  digitalWrite(RELAY_PIN, HIGH); // OFF
  Serial.println("[PUMP] OFF");
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
  Serial.printf("[CMD] Received — pump=%s ms=%lu\n",
    cmd.pump_on ? "ON" : "OFF", cmd.pump_ms);
}

// ─────────────────────────────────────────────────────────────
//  ESP-NOW INIT
// ─────────────────────────────────────────────────────────────
bool initESPNOW() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  // Set channel to match master — critical for ESP-NOW to work
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  Serial.printf("[ESPNOW] MAC: %s  Channel: %d\n",
    WiFi.macAddress().c_str(), WIFI_CHANNEL);

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESPNOW] Init FAILED");
    return false;
  }

  esp_now_register_send_cb(onDataSent);
  esp_now_register_recv_cb(onDataRecv);

  // Register master as peer
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, MASTER_MAC, 6);
  peerInfo.channel = WIFI_CHANNEL;
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
  strncpy(pkt.slave_id,   SLAVE_ID,   sizeof(pkt.slave_id) - 1);
  strncpy(pkt.zone_name,  ZONE_NAME,  sizeof(pkt.zone_name) - 1);
  pkt.moisture_pct   = moisture;
  pkt.temperature_c  = tempC;
  pkt.emergency_pump = emergencyPump;
  pkt.uptime_s       = millis() / 1000;

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

  // Relay OFF before pinMode (active LOW — HIGH = OFF)
  digitalWrite(RELAY_PIN, HIGH);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);

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

  Serial.printf("[READ] %s | moisture=%d%% temp=%.1fC\n",
    SLAVE_ID, moisture, tempC);

  // ── Emergency local pump (no need to wait for master) ──
  if (moisture < MOISTURE_CRITICAL) {
    Serial.println("[SLAVE] CRITICAL moisture — local emergency pump");
    beepAlert();
    pumpRun(PUMP_EMERGENCY_MS);
    emergencyRan = true;
  }

  // ── Send data to master ──
  commandReceived = false;
  bool sent = sendToMaster(moisture, tempC, emergencyRan);
  Serial.printf("[SLAVE] Send to master: %s\n", sent ? "OK" : "FAILED");

  if (sent) {
    // Wait for pump command from master (up to MASTER_TIMEOUT_MS)
    uint32_t waitStart = millis();
    while (!commandReceived && millis() - waitStart < MASTER_TIMEOUT_MS) {
      esp_task_wdt_reset();
      delay(50);
    }

    if (commandReceived) {
      beepCommand();
      if (latestCommand.pump_on && !emergencyRan) {
        pumpRun(latestCommand.pump_ms);
      } else if (latestCommand.pump_on && emergencyRan) {
        Serial.println("[SLAVE] Master pump cmd skipped — emergency already ran");
      }
    } else {
      Serial.println("[SLAVE] No command from master (timeout — normal if master decided no pump)");
    }
  }

  // ── Wait for next interval ──
  Serial.printf("[WAIT] %ds until next reading\n", REPORT_INTERVAL_S);
  for (int i = 0; i < REPORT_INTERVAL_S; i++) {
    delay(1000);
    esp_task_wdt_reset();
  }
}
