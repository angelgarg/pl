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

// ── ESP-NOW Packet Structures (must match slave_monitor.ino) ──

typedef struct SensorPacket {
  char slave_id[16];
  char zone_name[32];
  int  moisture_pct;
  float temperature_c;
  bool emergency_valve;    // true if slave already fired emergency valve locally
  uint32_t uptime_s;
  float land_area_acres;   // zone land size in acres (sent from slave config)
} SensorPacket;

typedef struct CommandPacket {
  char slave_id[16];
  bool valve_on;           // true = open solenoid valve
  uint32_t valve_ms;       // how long to keep valve open (milliseconds)
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
  bool emergency_valve;   // true if slave already fired emergency valve locally
  float land_area_acres;
  uint32_t last_seen;     // millis() of last ESP-NOW packet
  bool active;
  bool peer_registered;
};

SlaveRecord slaves[MAX_SLAVES];
int slaveCount = 0;
portMUX_TYPE slaveMux = portMUX_INITIALIZER_UNLOCKED;

// ───────────────── USER CONFIG (EDIT THESE BEFORE FLASHING) ─────────────────
// Add / remove networks below — device auto-picks strongest available
WiFiMulti wifiMulti;
void setupWiFiNetworks() {
  wifiMulti.addAP("CILP_Open",  "cilp@tiet#b122");   // college
  wifiMulti.addAP("Tiuu",       "12345678");          // home
  // wifiMulti.addAP("FarmHotspot", "password");      // ← add more here
}

#define BACKEND_URL  "https://pl-kp57.onrender.com"  // ← BhoomiIQ backend
#define DEVICE_KEY   "piq-1D7ADC-E53119"             // ← from BhoomiIQ dashboard

#define REPORT_INTERVAL_S 30

#define MOISTURE_CRITICAL 20
#define MOISTURE_DRY 30
#define VALVE_EMERGENCY_MS 8000            // ms to open valve during local emergency
#define VALVE_EMERGENCY_COOLDOWN_MS 120000 // 2 min cooldown — stops repeated emergency openings

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

#define SOIL_DRY_RAW 4000
#define SOIL_WET_RAW 1100

// ───────────────── GLOBALS ─────────────────
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);
bool cameraOK = false;
unsigned long lastEmergencyValveMs = 0; // cooldown tracker for local emergency valve open

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
  slaves[idx].emergency_valve = pkt.emergency_valve;
  slaves[idx].land_area_acres = pkt.land_area_acres;
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

// Send valve command to a specific slave by index
void sendValveCommand(int idx, bool valveOn, uint32_t valveMs) {
  if (idx < 0 || idx >= slaveCount) return;
  if (!slaves[idx].peer_registered) return;

  CommandPacket cmd;
  strncpy(cmd.slave_id, slaves[idx].slave_id, 15);
  cmd.valve_on = valveOn;
  cmd.valve_ms = valveMs;
  cmd.beep     = valveOn;

  esp_err_t res = esp_now_send(slaves[idx].mac, (uint8_t*)&cmd, sizeof(cmd));
  Serial.printf("[ESPNOW] → %s valve=%s (%s)\n",
    cmd.slave_id, valveOn ? "OPEN" : "CLOSED",
    res == ESP_OK ? "sent" : "error");
}

// Decide valve for each slave based on their moisture (local fallback)
void processSlaveCommands() {
  for (int i = 0; i < slaveCount; i++) {
    if (!slaves[i].active) continue;
    // If slave moisture is critical and hasn't had emergency already
    if (slaves[i].moisture_pct < 25 && !slaves[i].emergency_valve) {
      sendValveCommand(i, true, 6000);
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
    json += "\"land_area_acres\":" + String(slaves[i].land_area_acres, 2) + ",";
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
    res.valve          = body.indexOf("\"pump\":true")           != -1; // backend still sends "pump" key
    res.buzzer         = body.indexOf("\"buzzer\":true")         != -1;
    res.animal_detected= body.indexOf("\"animal_detected\":true")!= -1;

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
  unsigned long now = millis();
  if(now - lastEmergencyValveMs > VALVE_EMERGENCY_COOLDOWN_MS){
    Serial.printf("[VALVE] Moisture critical (%d%%) — emergency valve OPEN\n", moisture);
    valveRun(VALVE_EMERGENCY_MS); // silent — buzzer is reserved for animal detection only
    lastEmergencyValveMs = now;
  } else {
    Serial.printf("[VALVE] Moisture critical (%d%%) — cooldown active, skipping\n", moisture);
  }
}

if(WiFi.status()==WL_CONNECTED){

ReportResult r=sendDeviceReport(moisture,tempC);

if(r.ok && r.valve && sensorsValid){
  valveRun(r.duration_ms);
}

// Animal detected — sound buzzer to scare it away
if(r.ok && r.animal_detected){
  Serial.printf("[ANIMAL] %s detected (threat:%s) — sounding buzzer\n",
    r.animal_type, r.animal_threat);
  // High threat = aggressive 5-cycle alarm, low = 2-cycle warning
  int cycles = (strcmp(r.animal_threat,"high")==0) ? 5 :
               (strcmp(r.animal_threat,"low") ==0) ? 2 : 3;
  beepAnimal(cycles);
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