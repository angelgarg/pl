/*
 * ╔══════════════════════════════════════════════════════════╗
 * ║      BhoomiIQ — ESP32-S3 AI Field Monitor v2.3          ║
 * ║      भूमि IQ — AI-powered soil & plant monitor          ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * SETUP INSTRUCTIONS (before flashing):
 *   1. Set WIFI_SSID and WIFI_PASSWORD to your network
 *   2. Set DEVICE_KEY to the key shown in BhoomiIQ dashboard
 *      (Fields & Devices → your device → copy key)
 *   3. BACKEND_URL: keep default for production
 *      or change to http://localhost:3001 for local dev
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "esp_camera.h"
#include "esp_task_wdt.h"

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

// ───────────────── USER CONFIG (EDIT THESE BEFORE FLASHING) ─────────────────
#define WIFI_SSID       "Tiuu"       // ← your WiFi name
#define WIFI_PASSWORD   "12345678"      // ← your WiFi password
#define BACKEND_URL     "https://pl-kp57.onrender.com"  // ← BhoomiIQ backend
#define DEVICE_KEY      "piq-0ACFCB-F2E26B"    // ← from BhoomiIQ dashboard

#define REPORT_INTERVAL_S 30

#define MOISTURE_CRITICAL 20
#define MOISTURE_DRY 30
#define PUMP_EMERGENCY_MS 8000

// ───────────────── PINS ─────────────────
#define SOIL_PIN 1
#define DS18B20_PIN 14
#define RELAY_PIN 21
#define BUZZER_PIN 47

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
void pumpRun(unsigned long ms){
  Serial.printf("[PUMP] ON %lu ms\n",ms);
  beepPump();
  digitalWrite(RELAY_PIN,LOW);
  esp_task_wdt_reset();
  delay(ms);
  digitalWrite(RELAY_PIN,HIGH);
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
float readTemperatureC(){
  tempSensor.requestTemperatures();
  float t=tempSensor.getTempCByIndex(0);
  if(t==DEVICE_DISCONNECTED_C){
    Serial.println("[TEMP] Sensor disconnected!");
    return -999;
  }
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

if(psramFound()){
cfg.frame_size=FRAMESIZE_VGA;
cfg.jpeg_quality=10;
cfg.fb_count=2;
}
else{
cfg.frame_size=FRAMESIZE_QVGA;
cfg.jpeg_quality=12;
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

// ───────────────── WIFI (STATIC IP) ─────────────────
bool connectWiFi(int maxRetries=3){

WiFi.mode(WIFI_STA);

// DHCP (auto IP — recommended; comment out and use static block below if needed)
// To use static IP, uncomment the block below:
// IPAddress local_IP(192,168,1,200);
// IPAddress gateway(192,168,1,1);
// IPAddress subnet(255,255,255,0);
// IPAddress dns(8,8,8,8);
// if(!WiFi.config(local_IP,gateway,subnet,dns)) Serial.println("[WiFi] Static IP Failed");

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

// ───────────────── HTTP REPORT ─────────────────
ReportResult sendDeviceReport(int moisture,float tempC){

ReportResult res={false,5000,false,-1,false};

WiFiClientSecure client;
client.setInsecure();
client.setTimeout(50);

HTTPClient http;

String url=String(BACKEND_URL)+"/api/device-report?moisture="+String(moisture)+"&temperature="+String(tempC,2);

Serial.printf("[HTTP] POST %s\n",url.c_str());

if(!http.begin(client,url)){
Serial.println("[HTTP] begin failed");
return res;
}

http.addHeader("x-device-key",DEVICE_KEY);
http.setTimeout(45000);

camera_fb_t *fb=esp_camera_fb_get();

int code;

if(fb){
Serial.printf("[CAM] %u bytes\n",fb->len);
http.addHeader("Content-Type","image/jpeg");
code=http.POST(fb->buf,fb->len);
esp_camera_fb_return(fb);
}
else{
code=http.POST((uint8_t*)"",0);
}

Serial.printf("[HTTP] %d\n",code);

if(code==200){
String body=http.getString();
res.ok=true;
res.pump=body.indexOf("\"pump\":true")!=-1;
}

http.end();

return res;
}

// ───────────────── SETUP ─────────────────
void setup(){

Serial.begin(115200);

pinMode(RELAY_PIN,OUTPUT);
digitalWrite(RELAY_PIN,HIGH);

pinMode(BUZZER_PIN,OUTPUT);

esp_task_wdt_init(120,true);
esp_task_wdt_add(NULL);

tempSensor.begin();

cameraOK=initCamera();

bool wifiOK=connectWiFi();

wifiOK?beepBoot():beepFail();

Serial.println("[SETUP] Done");
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

Serial.printf("[WAIT] %ds\n",REPORT_INTERVAL_S);

for(int i=0;i<REPORT_INTERVAL_S;i++){
delay(1000);
esp_task_wdt_reset();
}

}