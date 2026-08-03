/*
  LogiBox - ESP32-CAM Snapshot Camera
  -----------------------------------
  Captures a JPEG every CAPTURE_INTERVAL_MS while "capturing" and uploads it
  to the LogiBox web app via the Vercel /api/camera-upload endpoint.

  The capture loop is started/stopped by the keypad ESP32 (LogiBox_OTP_Vault):
      http://<THIS_IP>/start   -> begin capturing
      http://<THIS_IP>/stop    -> stop capturing

  Board: AI-Thinker ESP32-CAM (OV2640)
  Libraries required (Arduino Library Manager or git clone into Arduino/libraries):
    - esp32-camera  (https://github.com/espressif/esp32-camera)
    - WiFiManager   (tablatronix, via Library Manager)
    - Built-in: WiFi, WebServer, HTTPClient, WiFiClientSecure, ESPmDNS

  IMPORTANT:
    - Must be on the SAME 2.4GHz WiFi network as the keypad ESP32.
    - WiFi is configured with WiFiManager: on first boot (or when the saved
      network is gone) this device starts a portal AP named "LogiBoxCam".
      Join it from a phone, open http://192.168.4.1, and enter the WiFi
      credentials once - they are stored in NVS and survive re-flashes.
    - The keypad finds this camera via the mDNS hostname "logiboxcam".
    - The ESP32-CAM has no USB; use a USB-TTL adapter (3.3V) connected to
      GPIO1 (TX), GPIO3 (RX), GND, and hold GPIO0 to GND while plugging in
      to enter download mode.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <WiFiManager.h>
#include <ESPmDNS.h>
#include "esp_camera.h"
#include <string.h>

// ---------------- CONFIG: EDIT THESE ----------------
// WiFi credentials are NOT stored here - configure them once per device via
// the WiFiManager portal (AP name "LogiBoxCam", http://192.168.4.1).

// This device's ID - must match a device doc in Firestore:
//   devices/esp32-cam-001 = { ownerUid: "<your uid>", status: "active" }
const char* DEVICE_ID     = "esp32-cam-001";

// Vercel API endpoint for snapshot uploads
const char* FUNCTION_URL  = "https://logibox-bit-deploy-3xzd.vercel.app/api/camera-upload";

// Capture interval - 5 seconds keeps us under Firestore's free write quota
const unsigned long CAPTURE_INTERVAL_MS = 5000;

// mDNS hostname the keypad uses to find this camera on the LAN.
const char* MDNS_HOSTNAME = "logiboxcam";
// -----------------------------------------------------

// ---------------- Camera State ----------------
WebServer server(80);
bool capturing = false;
unsigned long lastCaptureTime = 0;
unsigned long framesUploaded = 0;
unsigned long lastUploadMs = 0;
int lastHttpCode = 0;

// Delivery session state. Every frame uploaded during a session is tagged with
// these so the web app can group them and label the session with a vault id.
String sessionId = "";
String currentVaultId = "";

// ---------------- Camera Pin Configuration (AI-Thinker) ----------------

#define CAMERA_MODEL_AI_THINKER
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM       5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

void setup() {
  Serial.begin(115200);
  Serial.println("=== LogiBox ESP32-CAM Starting ===");
  delay(300);

  initCamera();

  connectWiFi();

  setupRoutes();

  Serial.println("ESP32-CAM ready!");
  Serial.print("Stream control: http://");
  Serial.print(MDNS_HOSTNAME);
  Serial.println(".local/start");
  Serial.print("or via IP: http://");
  Serial.print(WiFi.localIP());
  Serial.println("/start");
}

void loop() {
  server.handleClient();

  if (capturing && millis() - lastCaptureTime >= CAPTURE_INTERVAL_MS) {
    lastCaptureTime = millis();
    captureAndUpload();
  }
}

// ---------------- Camera Init ----------------

void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.fb_count = 2;

  // VGA (640x480) keeps each snapshot small enough to store in Firestore
  config.frame_size = FRAMESIZE_VGA;
  config.jpeg_quality = 12;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    return;
  }

  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_framesize(s, FRAMESIZE_VGA);
    s->set_quality(s, 12);
  }
}

// ---------------- WiFi ----------------

void connectWiFi() {
  Serial.println("Connecting to WiFi via WiFiManager...");

  WiFi.mode(WIFI_STA);

  WiFiManager wm;
  wm.setConfigPortalTimeout(180); // give 3 min for phone setup, then reboot

  wm.setAPCallback([](WiFiManager* wm) {
    Serial.println("\n=== WIFI SETUP REQUIRED ===");
    Serial.println("Join the 'LogiBoxCam' hotspot from your phone,");
    Serial.println("open http://192.168.4.1 and enter your WiFi credentials.");
  });

  if (!wm.autoConnect("LogiBoxCam")) {
    Serial.println("\nWiFi FAILED to connect!");
    return;
  }

  Serial.println("\nWiFi connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  if (MDNS.begin(MDNS_HOSTNAME)) {
    Serial.print("mDNS started: ");
    Serial.print(MDNS_HOSTNAME);
    Serial.println(".local");
  }
}

// ---------------- Web Server Routes ----------------

void setupRoutes() {
  // Start capturing (called by the keypad ESP32 when a session starts).
  // Optional query param: ?vault=<id> labels the session with the vault being
  // opened (sent by the keypad once the delivery vault is selected).
  server.on("/start", HTTP_GET, []() {
    capturing = true;
    lastCaptureTime = millis();

    if (sessionId.length() == 0) {
      sessionId = "s" + String((uint32_t)millis());
      framesUploaded = 0;
    }

    String vault = server.arg("vault");
    if (vault.length() > 0) {
      currentVaultId = vault;
      Serial.print("Vault set: ");
      Serial.println(currentVaultId);
    }

    Serial.print("Capture STARTED (session ");
    Serial.print(sessionId);
    Serial.println(")");
    server.send(200, "application/json", "{\"success\":true,\"capturing\":true}");
  });

  // Stop capturing (called by the keypad ESP32 when returning to idle)
  server.on("/stop", HTTP_GET, []() {
    capturing = false;
    sessionId = "";
    currentVaultId = "";
    Serial.println("Capture STOPPED");
    server.send(200, "application/json", "{\"success\":true,\"capturing\":false}");
  });

  // Debug status
  server.on("/status", HTTP_GET, []() {
    String json = "{";
    json += "\"capturing\":" + String(capturing ? "true" : "false") + ",";
    json += "\"framesUploaded\":" + String(framesUploaded) + ",";
    json += "\"lastHttpCode\":" + String(lastHttpCode);
    json += "}";
    server.send(200, "application/json", json);
  });

  server.begin();
  Serial.println("Web server started");
}

// ---------------- Capture + Upload ----------------

void captureAndUpload() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Camera capture failed");
    return;
  }

  if (fb->len == 0) {
    Serial.println("Empty frame captured");
    esp_camera_fb_return(fb);
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi down, skipping upload");
    esp_camera_fb_return(fb);
    return;
  }

  uploadFrame(fb);

  esp_camera_fb_return(fb);
}

// Uploads the raw JPEG bytes as a binary POST body.
// deviceId travels in the query string to keep the body purely the image.
void uploadFrame(camera_fb_t* fb) {
  Serial.printf("Uploading frame: %u bytes\n", fb->len);

  WiFiClientSecure client;
  client.setInsecure(); // Skips certificate validation - fine for bench testing.
                        // Pin Vercel's cert with setCACert() before real deployment.

  HTTPClient http;
  http.setTimeout(15000);

  String url = String(FUNCTION_URL) + "?deviceId=" + DEVICE_ID;
  if (sessionId.length() > 0) {
    url += "&sessionId=" + sessionId;
  }
  if (currentVaultId.length() > 0) {
    url += "&vaultId=" + currentVaultId;
  }

  if (!http.begin(client, url)) {
    Serial.println("HTTP begin failed");
    return;
  }

  http.addHeader("Content-Type", "application/octet-stream");

  int httpCode = http.POST(fb->buf, fb->len);
  lastHttpCode = httpCode;

  if (httpCode > 0) {
    if (httpCode == 200) {
      framesUploaded++;
      lastUploadMs = millis();
      Serial.print("Upload OK (");
      Serial.print(framesUploaded);
      Serial.println(" frames)");
    } else {
      Serial.print("Upload failed, HTTP ");
      Serial.println(httpCode);
    }
  } else {
    Serial.print("Upload error: ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
}
