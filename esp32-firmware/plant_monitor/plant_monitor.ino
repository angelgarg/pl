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
 * ║   • Relays pump commands back to each slave              ║
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
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "esp_camera.h"
#include "esp_task_wdt.h"
#include <esp_now.h>
#include <esp_wifi.h>

// ───────────────── STRUCTS ─────────────────
struct ReportResult {
  bool pump;
  unsigned long duration_ms;
  bool buzzer;
  int health_score;
  bool ok;
};

struct OfflineReading {
  int moisture;
  float tempC;
  bool used;
};

// ── ESP-NOW Packet Structures (must match slave_monitor.ino) ──

typedef struct SensorPacket {
  char slave_id[16];
  char zone_name[32];
  int  moisture_pct;
  float temperature_c;
  bool emergency_pump;
  uint32_t uptime_s;
} SensorPacket;

typedef struct CommandPacket {
  char slave_id[16];
  bool pump_on;
  uint32_t pump_ms;
  bool beep;
} CommandPacket;

// ── Slave registry (up to 10 slaves) ──
#define MAX_SLAVES 10

struct SlaveRecord {
  char slave_id[16];
  char zone_name[32];
  uint8_t mac[6];
  int moisture_pct;
  float temperature_c;
  bool emergency_pump;
  uint32_t last_seen;     // millis() of last ESP-NOW packet
  bool active;
  bool peer_registered;
};

SlaveRecord slaves[MAX_SLAVES];
int slaveCount = 0;
portMUX_TYPE slaveMux = portMUX_INITIALIZER_UNLOCKED;

// ───────────────── USER CONFIG (EDIT THESE BEFORE FLASHING) ─────────────────
#define WIFI_SSID       "CILP_Open"       // ← your WiFi name
#define WIFI_PASSWORD   "cilp@tiet#b122"  // ← your WiFi password
#define BACKEND_URL     "https://pl-kp57.onrender.com"  // ← BhoomiIQ backend
#define DEVICE_KEY      "piq-1D7ADC-E53119"    // ← from BhoomiIQ dashboard

#define REPORT_INTERVAL_S 30

#define MOISTURE_CRITICAL 20
#define MOISTURE_DRY 30
#define PUMP_EMERGENCY_MS 8000

// ───────────────── PINS ─────────────────
#define SOIL_PIN 1
#define DS18B20_PIN 14
#define RELAY_PIN 47   // pump relay soldered to GPIO 47
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

#define SOIL_DRY_RAW 4000
#define SOIL_WET_RAW 1100

// ───────────────── GLOBALS ─────────────────
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);
bool cameraOK = false;

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

void beepBoot(){beep(80,3);}
void beepFail(){beep(500,2);}
void beepAlert(){beep(250,4);}
void beepPump(){beep(60,2);delay(60);beep(180,1);}

// ───────────────── PUMP ─────────────────
// Soft-start: gradually ramp up pump in 3 pulses before full ON
// This reduces inrush current spike that can trip battery shield overcurrent protection
void pumpSoftStart(){
  // Pulse relay ON briefly to let motor spin up, then full ON
  // Each pulse charges the motor windings gradually
  digitalWrite(RELAY_PIN, LOW);  delay(80);   // pulse 1 — short burst
  digitalWrite(RELAY_PIN, HIGH); delay(60);   // brief OFF — capacitor recharges
  esp_task_wdt_reset();
  digitalWrite(RELAY_PIN, LOW);  delay(150);  // pulse 2 — longer burst
  digitalWrite(RELAY_PIN, HIGH); delay(60);   // brief OFF
  esp_task_wdt_reset();
  digitalWrite(RELAY_PIN, LOW);  delay(300);  // pulse 3 — motor nearly at speed
  digitalWrite(RELAY_PIN, HIGH); delay(60);   // brief OFF
  esp_task_wdt_reset();
  // Now motor is spinning — full ON is safe, inrush is minimal
  digitalWrite(RELAY_PIN, LOW);
  Serial.println("[PUMP] Soft-start complete — full ON");
}

void pumpRun(unsigned long ms){
  Serial.printf("[PUMP] ON %lu ms (with soft-start)\n", ms);
  beepPump();
  pumpSoftStart();                // ramp up first — avoids battery shield trip
  esp_task_wdt_reset();
  // Run for remaining time (subtract soft-start duration ~810ms)
  unsigned long runMs = (ms > 810) ? ms - 810 : 0;
  if(runMs > 0) delay(runMs);
  digitalWrite(RELAY_PIN, HIGH); // OFF
  Serial.println("[PUMP] OFF");
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

// Keep image small for reliable SSL upload over WiFi
// VGA (640x480) was causing -3 send failures — QVGA (320x240) is much more stable
if(psramFound()){
cfg.frame_size=FRAMESIZE_QVGA;
cfg.jpeg_quality=15;  // 15 = good quality, ~15-25KB — reliable over SSL
cfg.fb_count=2;
}
else{
cfg.frame_size=FRAMESIZE_QVGA;
cfg.jpeg_quality=18;
cfg.fb_count=1;
}

if(esp_camera_init(&cfg)!=ESP_OK){
Serial.println("[CAM] Init FAILED");
return false;
}

camera_fb_t *fb=esp_camera_fb_get();
if(fb)esp_camera_fb_return(fb);

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
  slaves[idx].moisture_pct    = pkt.moisture_pct;
  slaves[idx].temperature_c   = pkt.temperature_c;
  slaves[idx].emergency_pump  = pkt.emergency_pump;
  slaves[idx].last_seen       = millis();
  slaves[idx].active          = true;
  portEXIT_CRITICAL(&slaveMux);

  Serial.printf("[ESPNOW] ← %s | moisture=%d%% temp=%.1fC\n",
    pkt.slave_id, pkt.moisture_pct, pkt.temperature_c);

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

// Send pump command to a specific slave by index
void sendPumpCommand(int idx, bool pumpOn, uint32_t pumpMs) {
  if (idx < 0 || idx >= slaveCount) return;
  if (!slaves[idx].peer_registered) return;

  CommandPacket cmd;
  strncpy(cmd.slave_id, slaves[idx].slave_id, 15);
  cmd.pump_on  = pumpOn;
  cmd.pump_ms  = pumpMs;
  cmd.beep     = pumpOn;

  esp_err_t res = esp_now_send(slaves[idx].mac, (uint8_t*)&cmd, sizeof(cmd));
  Serial.printf("[ESPNOW] → %s pump=%s (%s)\n",
    cmd.slave_id, pumpOn ? "ON" : "OFF",
    res == ESP_OK ? "sent" : "error");
}

// Decide pump for each slave based on their moisture (local fallback)
void processSlaveCommands() {
  for (int i = 0; i < slaveCount; i++) {
    if (!slaves[i].active) continue;
    // If slave moisture is critical and hasn't had emergency already
    if (slaves[i].moisture_pct < 25 && !slaves[i].emergency_pump) {
      sendPumpCommand(i, true, 6000);
    }
  }
}

// Build slaves JSON array for HTTP report
String buildSlavesJson() {
  String json = "[";
  for (int i = 0; i < slaveCount; i++) {
    if (!slaves[i].active) continue;
    if (i > 0) json += ",";
    bool online = (millis() - slaves[i].last_seen) < 120000; // 2 min timeout
    json += "{";
    json += "\"slave_id\":\"" + String(slaves[i].slave_id) + "\",";
    json += "\"zone_name\":\"" + String(slaves[i].zone_name) + "\",";
    json += "\"moisture_pct\":" + String(slaves[i].moisture_pct) + ",";
    json += "\"temperature_c\":" + String(slaves[i].temperature_c, 1) + ",";
    json += "\"online\":" + String(online ? "true" : "false") + ",";
    json += "\"last_seen_s\":" + String((millis() - slaves[i].last_seen) / 1000);
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

// Static IP — assigned for this device on CILP_Open network
IPAddress local_IP(172, 31, 29, 200);
IPAddress gateway(172, 31, 29, 1);   // standard gateway for 172.31.29.x subnet
IPAddress subnet(255, 255, 255, 0);
IPAddress dns(8, 8, 8, 8);           // Google DNS
if(!WiFi.config(local_IP, gateway, subnet, dns)) Serial.println("[WiFi] Static IP config failed — falling back to DHCP");

for(int a=1;a<=maxRetries;a++){

Serial.printf("[WiFi] Attempt %d — %s\n",a,WIFI_SSID);

WiFi.begin(WIFI_SSID,WIFI_PASSWORD);

int t=0;

while(WiFi.status()!=WL_CONNECTED && t++<20){
delay(500);
Serial.print(".");
esp_task_wdt_reset();
}

Serial.println();

if(WiFi.status()==WL_CONNECTED){

Serial.printf("[WiFi] Connected IP:%s RSSI:%d\n",
WiFi.localIP().toString().c_str(),
WiFi.RSSI());

return true;
}

WiFi.disconnect(true);
delay(1000*a);
}

Serial.println("[WiFi] FAILED");
return false;
}

// ───────────────── WAKE RENDER (cold-start ping) ─────────────────
// Render free tier sleeps after inactivity — ping /health first
// and wait up to 40 seconds for it to wake before sending image
bool wakeBackend(){
  // Render free tier can take up to 60s on cold start
  // We try up to 4 times with 60s timeout each
  for(int attempt=1; attempt<=4; attempt++){
    WiFiClientSecure wc;
    wc.setInsecure();
    HTTPClient hh;
    String pingUrl = String(BACKEND_URL) + "/health";
    if(!hh.begin(wc, pingUrl)){ hh.end(); continue; }
    hh.setTimeout(60000); // 60s — covers worst-case Render cold start
    Serial.printf("[WAKE] Pinging backend (attempt %d/4)...\n", attempt);
    int c = hh.GET();
    hh.end();
    if(c > 0){
      Serial.printf("[WAKE] Backend ready (attempt %d, HTTP %d)\n", attempt, c);
      delay(1500); // small grace period — let server fully settle before main request
      esp_task_wdt_reset();
      return true;
    }
    Serial.printf("[WAKE] Attempt %d failed (err %d) — waiting 8s\n", attempt, c);
    for(int w=0;w<8;w++){ delay(1000); esp_task_wdt_reset(); }
  }
  Serial.println("[WAKE] Backend unreachable after 4 attempts");
  return false;
}

// ───────────────── HTTP REPORT ─────────────────
ReportResult sendDeviceReport(int moisture,float tempC){

ReportResult res={false,5000,false,-1,false};

// Wake Render first — avoids SSL timeout on cold start
if(!wakeBackend()) return res;

// Build URL with master sensor data + slaves JSON
String slavesJson = buildSlavesJson();
String url=String(BACKEND_URL)+"/api/device-report?moisture="+String(moisture)
           +"&temperature="+String(tempC,2)
           +"&slave_count="+String(slaveCount);
Serial.printf("[HTTP] POST %s\n",url.c_str());

// Retry up to 3 times on send failure (-3 chunk error)
for(int attempt=1; attempt<=3; attempt++){

  if(attempt > 1){
    Serial.printf("[HTTP] Retry %d/3 — waiting 3s\n", attempt);
    for(int w=0;w<3;w++){ delay(1000); esp_task_wdt_reset(); }
  }

  WiFiClientSecure client;
  client.setInsecure();
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
    res.ok   = true;
    res.pump = body.indexOf("\"pump\":true") != -1;
    http.end();
    return res; // success — exit retry loop
  }

  http.end();

  if(code == -3 || code == -11){
    Serial.printf("[HTTP] Send failed (err %d) — will retry\n", code);
    continue; // retry on chunk/timeout errors
  }

  break; // non-retryable error — stop trying
}

Serial.println("[HTTP] All attempts failed");
return res;
}

// ───────────────── SETUP ─────────────────
void setup(){

Serial.begin(115200);

// Set relay OFF *before* pinMode — prevents auto-trigger at boot
// Active LOW relay: HIGH = OFF, LOW = ON
digitalWrite(RELAY_PIN, HIGH); // ensure OFF state first
pinMode(RELAY_PIN, OUTPUT);
digitalWrite(RELAY_PIN, HIGH); // double-set after pinMode

// Set buzzer OFF *before* pinMode — prevents continuous sound at boot
// Active buzzer: HIGH = ON, LOW = OFF
digitalWrite(BUZZER_PIN, LOW); // silence first
pinMode(BUZZER_PIN, OUTPUT);
digitalWrite(BUZZER_PIN, LOW); // double-set after pinMode

esp_task_wdt_init(180,true); // 3 min — covers 4x wake attempts (60s each) + main request
esp_task_wdt_add(NULL);

tempSensor.begin();

cameraOK=initCamera();

bool wifiOK=connectWiFi();

// Init ESP-NOW AFTER WiFi connects — they must share the same channel
if(wifiOK){
  initESPNOW();
  Serial.println("[SETUP] ESP-NOW ready — waiting for slave nodes...");
  Serial.println("[SETUP] ↑ Copy the MAC + Channel above into each slave's config");
}

wifiOK?beepBoot():beepFail();

Serial.println("[SETUP] Done — Master node online");
}

// ───────────────── LOOP ─────────────────
void loop(){

esp_task_wdt_reset();

int moisture=readMoisturePct();
float tempC=readTemperatureC();

Serial.printf("[READ] moisture=%d%% temp=%.1fC\n",moisture,tempC);

bool sensorsValid=(tempC>-100);

if(sensorsValid && moisture<MOISTURE_CRITICAL){
beepAlert();
pumpRun(PUMP_EMERGENCY_MS);
}

if(WiFi.status()==WL_CONNECTED){

ReportResult r=sendDeviceReport(moisture,tempC);

if(r.ok && r.pump && sensorsValid){
pumpRun(r.duration_ms);
}

}else{

Serial.println("[OFFLINE] WiFi lost");
WiFi.reconnect();
}

// Process slave pump decisions (runs every cycle whether WiFi is up or not)
if(slaveCount > 0){
  Serial.printf("[SLAVES] %d zone(s) connected — checking commands\n", slaveCount);
  processSlaveCommands();
}

Serial.printf("[WAIT] %ds\n",REPORT_INTERVAL_S);

for(int i=0;i<REPORT_INTERVAL_S;i++){
delay(1000);
esp_task_wdt_reset();
}

}