/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   BhoomiIQ — NPK Slave Node Firmware v1.0                   ║
 * ║   भूमि IQ — NPK Sensor Slave (RS485 Modbus + ESP-NOW)       ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Hardware: Generic ESP32 WROOM-32                            ║
 * ║  Sensor:   RS485 3-in-1 or 7-in-1 NPK soil sensor           ║
 * ║            (JXBS-3001 / RS-ECTHPH-N01-TR or compatible)     ║
 * ║  Comms:    ESP-NOW to BhoomiIQ Master                        ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  WIRING (MAX485 module):                                     ║
 * ║   MAX485 VCC  → 5V (some modules 3.3V — check datasheet)    ║
 * ║   MAX485 GND  → GND                                         ║
 * ║   MAX485 RO   → GPIO 16 (ESP32 RX2)                         ║
 * ║   MAX485 DI   → GPIO 17 (ESP32 TX2)                         ║
 * ║   MAX485 DE   → GPIO 4  (direction control — tied to RE)    ║
 * ║   MAX485 RE   → GPIO 4  (tie RE and DE together)            ║
 * ║   MAX485 A    → Sensor A (Yellow wire on most sensors)       ║
 * ║   MAX485 B    → Sensor B (White  wire on most sensors)       ║
 * ║   Buzzer      → GPIO 27 (optional)                          ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  SENSOR TYPES SUPPORTED (set via NPK_SENSOR_TYPE):          ║
 * ║   TYPE_3IN1: JXBS-3001 or similar — reads N, P, K only      ║
 * ║              Registers 0x0000–0x0002, addr 0x01             ║
 * ║   TYPE_7IN1: 7-in-1 sensor — N, P, K + pH, EC, moisture,   ║
 * ║              temperature  (registers 0x0000–0x0006)          ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  SETUP CHECKLIST:                                            ║
 * ║   □ 1. Set SLAVE_ID — unique (NPK_01, NPK_02…)              ║
 * ║   □ 2. Set ZONE_NAME — what this zone monitors              ║
 * ║   □ 3. Boot master FIRST → copy MAC → paste MASTER_MAC      ║
 * ║   □ 4. Copy WiFi channel → paste WIFI_CHANNEL               ║
 * ║   □ 5. Set NPK_SENSOR_TYPE (TYPE_3IN1 or TYPE_7IN1)         ║
 * ║   □ 6. Set NPK_SENSOR_ADDRESS (usually 0x01, default)       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "esp_task_wdt.h"

// ─────────────────────────────────────────────────────────────
//  USER CONFIG — EDIT BEFORE FLASHING
// ─────────────────────────────────────────────────────────────
#define SLAVE_ID        "NPK_01"            // ← unique per slave
#define ZONE_NAME       "College Garden NPK" // ← label shown on dashboard
#define ZONE_AREA_ACRES 0.05f

#define WIFI_CHANNEL    1                   // ← MUST match master's WiFi channel
uint8_t MASTER_MAC[]  = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}; // ← REPLACE WITH REAL MASTER MAC

// NPK Sensor config
#define TYPE_3IN1  1   // JXBS-3001 / 3-in-1: reads N, P, K (most common)
#define TYPE_7IN1  2   // 7-in-1: reads moisture, temp, EC, pH, N, P, K
#define NPK_SENSOR_TYPE    TYPE_3IN1
#define NPK_SENSOR_ADDRESS 0x01            // default Modbus address — check sensor label
#define NPK_BAUD_RATE      9600

// ─────────────────────────────────────────────────────────────
//  PINS
// ─────────────────────────────────────────────────────────────
#define RS485_RX_PIN   16    // MAX485 RO → ESP32 GPIO16 (Serial2 RX)
#define RS485_TX_PIN   17    // MAX485 DI → ESP32 GPIO17 (Serial2 TX)
#define RS485_DE_PIN    4    // DE + RE tied together → GPIO 4 (HIGH=transmit, LOW=receive)
#define BUZZER_PIN     27    // Active buzzer (optional)

// ─────────────────────────────────────────────────────────────
//  TIMING
// ─────────────────────────────────────────────────────────────
#define REPORT_INTERVAL_S  120   // NPK changes slowly — 2 min is enough
#define MASTER_TIMEOUT_MS  5000  // wait for master ACK/heartbeat

// ─────────────────────────────────────────────────────────────
//  ESP-NOW PACKET STRUCTURES — MUST MATCH master + soil slave
// ─────────────────────────────────────────────────────────────
#define SLAVE_TYPE_SOIL  0
#define SLAVE_TYPE_NPK   1

typedef struct SensorPacket {
  char     slave_id[16];
  char     zone_name[32];
  uint8_t  slave_type;       // 0=SOIL, 1=NPK
  int      moisture_pct;     // NPK slave: 0 (no soil moisture sensor)
  float    temperature_c;    // from 7-in-1; 0 for 3-in-1
  bool     emergency_valve;  // always false for NPK slave (no valve)
  uint32_t uptime_s;
  float    land_area_acres;
  // NPK readings (mg/kg)
  uint16_t npk_n;            // Nitrogen
  uint16_t npk_p;            // Phosphorus
  uint16_t npk_k;            // Potassium
  float    soil_ph;          // 0.0 for 3-in-1 (no pH)
  float    soil_ec;          // 0.0 for 3-in-1 (no EC)
} SensorPacket;

typedef struct CommandPacket {
  char     slave_id[16];
  bool     valve_on;         // ignored by NPK slave (no valve)
  uint32_t valve_ms;         // ignored by NPK slave
  bool     beep;
  bool     allow_water;      // unused — no valve
} CommandPacket;

// ─────────────────────────────────────────────────────────────
//  RS485 / MODBUS
// ─────────────────────────────────────────────────────────────
HardwareSerial rs485(2);   // UART2 = Serial2

// CRC-16 Modbus calculation
uint16_t modbusCRC(const uint8_t *buf, int len) {
  uint16_t crc = 0xFFFF;
  for (int i = 0; i < len; i++) {
    crc ^= buf[i];
    for (int b = 0; b < 8; b++) {
      if (crc & 0x0001) crc = (crc >> 1) ^ 0xA001;
      else              crc >>= 1;
    }
  }
  return crc;
}

// Send RS485 Modbus read request
void rs485Send(const uint8_t *buf, int len) {
  digitalWrite(RS485_DE_PIN, HIGH);  // transmit mode
  delay(2);
  rs485.write(buf, len);
  rs485.flush();
  delay(2);
  digitalWrite(RS485_DE_PIN, LOW);   // receive mode
}

// Read Modbus holding registers — returns number of register values read
// Results stored in out[] (uint16_t values, big-endian parsed)
int modbusReadRegs(uint8_t addr, uint16_t startReg, uint8_t regCount, uint16_t *out) {
  // Build request: addr, 0x03, regHi, regLo, countHi, countLo, crcLo, crcHi
  uint8_t req[8];
  req[0] = addr;
  req[1] = 0x03;          // function: read holding registers
  req[2] = startReg >> 8;
  req[3] = startReg & 0xFF;
  req[4] = 0x00;
  req[5] = regCount;
  uint16_t crc = modbusCRC(req, 6);
  req[6] = crc & 0xFF;
  req[7] = crc >> 8;

  // Flush any stale bytes first
  while (rs485.available()) rs485.read();

  rs485Send(req, 8);

  // Expected response: addr(1) + fc(1) + bytecount(1) + data(regCount*2) + crc(2)
  int expectedLen = 3 + regCount * 2 + 2;
  uint8_t resp[32];
  int received = 0;
  uint32_t timeout = millis() + 1000;  // 1s timeout

  while (received < expectedLen && millis() < timeout) {
    if (rs485.available()) resp[received++] = rs485.read();
  }

  if (received < expectedLen) {
    Serial.printf("[RS485] Timeout — got %d/%d bytes\n", received, expectedLen);
    return 0;
  }

  // Verify CRC
  uint16_t gotCRC = resp[received-2] | (resp[received-1] << 8);
  uint16_t calcCRC = modbusCRC(resp, received - 2);
  if (gotCRC != calcCRC) {
    Serial.printf("[RS485] CRC error — got 0x%04X expected 0x%04X\n", gotCRC, calcCRC);
    return 0;
  }

  // Parse register values (big-endian, 2 bytes each)
  int dataOffset = 3;
  for (int i = 0; i < regCount; i++) {
    out[i] = ((uint16_t)resp[dataOffset + i*2] << 8) | resp[dataOffset + i*2 + 1];
  }

  return regCount;
}

// ─────────────────────────────────────────────────────────────
//  SENSOR READING
// ─────────────────────────────────────────────────────────────
struct NPKReading {
  uint16_t n, p, k;
  float    ph, ec, temperature;
  int      moisture;
  bool     valid;
};

NPKReading lastGood = {0, 0, 0, 7.0f, 0.0f, 25.0f, 0, false};

NPKReading readNPKSensor() {
  NPKReading r = {0, 0, 0, 7.0f, 0.0f, 25.0f, 0, false};
  uint16_t regs[7];

#if NPK_SENSOR_TYPE == TYPE_3IN1
  // 3-in-1: registers 0x0000 to 0x0002 → N, P, K
  int count = modbusReadRegs(NPK_SENSOR_ADDRESS, 0x0000, 3, regs);
  if (count < 3) {
    Serial.println("[NPK] 3-in-1 read FAILED");
    return lastGood;
  }
  r.n = regs[0];  // mg/kg
  r.p = regs[1];
  r.k = regs[2];
  Serial.printf("[NPK] N=%u P=%u K=%u mg/kg\n", r.n, r.p, r.k);

#elif NPK_SENSOR_TYPE == TYPE_7IN1
  // 7-in-1: registers 0x0000 to 0x0006
  // 0:moisture(×0.1%) 1:temp(×0.1°C) 2:EC(μS/cm) 3:pH(×0.1) 4:N 5:P 6:K
  int count = modbusReadRegs(NPK_SENSOR_ADDRESS, 0x0000, 7, regs);
  if (count < 7) {
    Serial.println("[NPK] 7-in-1 read FAILED");
    return lastGood;
  }
  r.moisture    = regs[0] / 10;          // convert 0.1% → %
  r.temperature = regs[1] / 10.0f;      // convert 0.1°C → °C
  r.ec          = regs[2];               // μS/cm
  r.ph          = regs[3] / 10.0f;      // convert 0.1 → pH
  r.n           = regs[4];              // mg/kg
  r.p           = regs[5];
  r.k           = regs[6];
  Serial.printf("[NPK] 7in1 → moisture=%d%% temp=%.1fC EC=%d pH=%.1f N=%u P=%u K=%u\n",
    r.moisture, r.temperature, (int)r.ec, r.ph, r.n, r.p, r.k);
#endif

  r.valid = true;
  lastGood = r;
  return r;
}

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
void beepBoot() { beep(60, 3); }

// ─────────────────────────────────────────────────────────────
//  ESP-NOW
// ─────────────────────────────────────────────────────────────
volatile bool sendSuccess = false;
volatile bool commandReceived = false;
volatile CommandPacket latestCommand;

void onDataSent(const uint8_t *mac, esp_now_send_status_t status) {
  sendSuccess = (status == ESP_NOW_SEND_SUCCESS);
  Serial.printf("[ESPNOW] Send %s\n", sendSuccess ? "OK" : "FAILED");
}

void onDataRecv(const uint8_t *mac, const uint8_t *data, int len) {
  if (len != sizeof(CommandPacket)) return;
  CommandPacket cmd;
  memcpy(&cmd, data, sizeof(cmd));
  if (strcmp(cmd.slave_id, SLAVE_ID) != 0 &&
      strcmp(cmd.slave_id, "ALL")    != 0) return;
  memcpy((void*)&latestCommand, &cmd, sizeof(cmd));
  commandReceived = true;
  if (cmd.beep) beep(60, 1);
}

bool initESPNOW() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
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

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, MASTER_MAC, 6);
  peer.channel = WIFI_CHANNEL;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) {
    Serial.println("[ESPNOW] Add master peer FAILED — check MASTER_MAC");
    return false;
  }
  Serial.println("[ESPNOW] Ready");
  return true;
}

bool sendToMaster(const NPKReading &npk) {
  SensorPacket pkt;
  memset(&pkt, 0, sizeof(pkt));

  strncpy(pkt.slave_id,  SLAVE_ID,  sizeof(pkt.slave_id) - 1);
  strncpy(pkt.zone_name, ZONE_NAME, sizeof(pkt.zone_name) - 1);
  pkt.slave_type      = SLAVE_TYPE_NPK;
  pkt.moisture_pct    = npk.moisture;        // 0 for 3-in-1, real value for 7-in-1
  pkt.temperature_c   = npk.temperature;     // 0 for 3-in-1, real value for 7-in-1
  pkt.emergency_valve = false;               // NPK slave has no valve
  pkt.uptime_s        = millis() / 1000;
  pkt.land_area_acres = ZONE_AREA_ACRES;
  pkt.npk_n           = npk.n;
  pkt.npk_p           = npk.p;
  pkt.npk_k           = npk.k;
  pkt.soil_ph         = npk.ph;
  pkt.soil_ec         = npk.ec;

  sendSuccess = false;
  esp_err_t res = esp_now_send(MASTER_MAC, (uint8_t*)&pkt, sizeof(pkt));
  if (res != ESP_OK) {
    Serial.printf("[ESPNOW] Send error: %s\n", esp_err_to_name(res));
    return false;
  }
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

  Serial.printf("\n╔════════════════════════════════╗\n");
  Serial.printf("║  BhoomiIQ NPK Slave — %s  ║\n", SLAVE_ID);
  Serial.printf("║  Zone: %-24s║\n", ZONE_NAME);
#if NPK_SENSOR_TYPE == TYPE_3IN1
  Serial.printf("║  Sensor: RS485 3-in-1 NPK      ║\n");
#else
  Serial.printf("║  Sensor: RS485 7-in-1 NPK+      ║\n");
#endif
  Serial.printf("╚════════════════════════════════╝\n\n");

  // Buzzer
  digitalWrite(BUZZER_PIN, LOW);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // RS485 direction pin
  pinMode(RS485_DE_PIN, OUTPUT);
  digitalWrite(RS485_DE_PIN, LOW); // start in receive mode

  // RS485 UART
  rs485.begin(NPK_BAUD_RATE, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
  delay(100);

  // Watchdog: 3 minutes
  esp_task_wdt_init(180, true);
  esp_task_wdt_add(NULL);

  bool espnowOK = initESPNOW();
  espnowOK ? beepBoot() : beep(500, 3);

  Serial.printf("[SETUP] Done — reading NPK every %ds\n", REPORT_INTERVAL_S);
}

// ─────────────────────────────────────────────────────────────
//  LOOP
// ─────────────────────────────────────────────────────────────
void loop() {
  esp_task_wdt_reset();

  // Read NPK sensor
  NPKReading npk = readNPKSensor();

  Serial.printf("[SEND] %s | N=%u P=%u K=%u mg/kg | ph=%.1f ec=%.0f\n",
    SLAVE_ID, npk.n, npk.p, npk.k, npk.ph, npk.ec);

  // Send to master
  commandReceived = false;
  bool sent = sendToMaster(npk);
  Serial.printf("[SLAVE] Send to master: %s\n", sent ? "OK" : "FAILED");

  if (sent) {
    // Wait for master ACK/heartbeat
    uint32_t waitStart = millis();
    while (!commandReceived && millis() - waitStart < MASTER_TIMEOUT_MS) {
      esp_task_wdt_reset();
      delay(50);
    }
    if (commandReceived) {
      Serial.println("[SLAVE] Master ACK received");
    }
  }

  // Wait for next interval
  Serial.printf("[WAIT] %ds until next reading\n", REPORT_INTERVAL_S);
  for (int i = 0; i < REPORT_INTERVAL_S; i++) {
    delay(1000);
    esp_task_wdt_reset();
  }
}
