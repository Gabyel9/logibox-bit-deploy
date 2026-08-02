/*
  LogiBox - ESP32 Door Controller (Door Controller)
  -------------------------------------------------
  Receives commands from ESP32 #1 (Keypad/LCD) via HTTP to unlock doors.
  Controls 3 solenoid locks, reads door sensors, and parcel detection.

  Board: ESP32 DevKit (30-pin)
  Connections:
    - Relays: GPIO 18, 19, 21 (for 3 doors)
    - Reed switches: GPIO 22, 23, 25 (door sensors)
    - IR sensor: GPIO 26 (parcel detection)

  HARDWARE WIRING (see below for detailed pinout):
    Door 1: Relay IN1 = GPIO 18, Reed Switch 1 = GPIO 22
    Door 2: Relay IN2 = GPIO 19, Reed Switch 2 = GPIO 23
    Door 3: Relay IN3 = GPIO 21, Reed Switch 3 = GPIO 25
    Parcel Sensor: GPIO 26

  HOW IT WORKS:
    1. ESP32 #1 (Keypad/LCD) verifies OTP via web server
    2. ESP32 #1 sends HTTP request to this ESP32 to unlock door
    3. This ESP32 activates relay for 500ms to unlock door
    4. Reports door status back to ESP32 #1 (optional)

  IMPORTANT: Set the IP address of ESP32 #1 so it can receive
  status updates. Also set THIS ESP32's static IP below.
*/

#include <WiFi.h>
#include <WebServer.h>
#include <Arduino.h>

// ---------------- CONFIG: EDIT THESE ----------------
// WiFi credentials - same as ESP32 #1
const char* WIFI_SSID     = "Converge_2.4GHz_zF2e";
const char* WIFI_PASSWORD = "t2dnEvwC";

// Static IP for this ESP32 (choose an IP not used on your network)
// This is the IP you'll call from ESP32 #1
IPAddress staticIP(192, 168, 1, 150);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);

// ESP32 #1's IP address (for sending status updates back)
const char* ESP32_MASTER_IP = "192.168.1.100";

// -----------------------------------------------------

// ---------------- HARDWARE PINS ----------------
// Relay pins (connect to Relay IN1, IN2, IN3)
const int RELAY_1_PIN = 18;  // Door 1
const int RELAY_2_PIN = 19;  // Door 2
const int RELAY_3_PIN = 21;  // Door 3

// Reed switch pins (door sensors)
// Connect one side to GPIO, other side to GND
const int REED_1_PIN = 22;   // Door 1 sensor
const int REED_2_PIN = 23;   // Door 2 sensor
const int REED_3_PIN = 25;   // Door 3 sensor

// IR Parcel sensor pins (one per door)
// FC-51 IR sensor: LOW = object detected, HIGH = no object
const int IR_1_PIN = 12;    // Door 1 parcel sensor
const int IR_2_PIN = 13;    // Door 2 parcel sensor
const int IR_3_PIN = 14;    // Door 3 parcel sensor

// Status LED (optional)
const int LED_PIN = 2;       // Built-in LED on most ESP32 boards
// ---------------------------------------------------

// ---------------- STATE ----------------
WebServer server(80);

// Door unlock duration (milliseconds)
const unsigned long UNLOCK_DURATION_MS = 500;

// Track which doors are currently unlocked
bool door1Unlocked = false;
bool door2Unlocked = false;
bool door3Unlocked = false;

unsigned long door1UnlockTime = 0;
unsigned long door2UnlockTime = 0;
unsigned long door3UnlockTime = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("=== LogiBox Door Controller Starting ===");
  delay(500);

  // Initialize relay pins as OUTPUT
  pinMode(RELAY_1_PIN, OUTPUT);
  pinMode(RELAY_2_PIN, OUTPUT);
  pinMode(RELAY_3_PIN, OUTPUT);

  // Initialize reed switches as INPUT_PULLUP
  pinMode(REED_1_PIN, INPUT_PULLUP);
  pinMode(REED_2_PIN, INPUT_PULLUP);
  pinMode(REED_3_PIN, INPUT_PULLUP);

  // Initialize IR sensors as INPUT (one per door)
  pinMode(IR_1_PIN, INPUT);
  pinMode(IR_2_PIN, INPUT);
  pinMode(IR_3_PIN, INPUT);

  // Initialize LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);  // LED off

  // Start with all relays OFF (doors locked)
  digitalWrite(RELAY_1_PIN, LOW);
  digitalWrite(RELAY_2_PIN, LOW);
  digitalWrite(RELAY_3_PIN, LOW);

  // Connect to WiFi
  connectWiFi();

  // Setup web server routes
  setupRoutes();

  Serial.println("Door Controller ready!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  server.handleClient();

  // Check if unlocked doors should relock
  unsigned long now = millis();

  if (door1Unlocked && (now - door1UnlockTime >= UNLOCK_DURATION_MS)) {
    lockDoor(1);
  }
  if (door2Unlocked && (now - door2UnlockTime >= UNLOCK_DURATION_MS)) {
    lockDoor(2);
  }
  if (door3Unlocked && (now - door3UnlockTime >= UNLOCK_DURATION_MS)) {
    lockDoor(3);
  }
}

// ---------------- WiFi ----------------

void connectWiFi() {
  Serial.println("Connecting to WiFi...");

  if (!WiFi.config(staticIP, gateway, subnet)) {
    Serial.println("Failed to configure static IP");
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected!");
    digitalWrite(LED_PIN, HIGH);  // LED on = connected
  } else {
    Serial.println("\nWiFi FAILED to connect!");
    digitalWrite(LED_PIN, LOW);
  }
}

// ---------------- Web Server Routes ----------------

void setupRoutes() {
  // Unlock Door 1
  server.on("/open/1", HTTP_GET, []() {
    unlockDoor(1);
    server.send(200, "application/json", "{\"success\":true,\"door\":1,\"status\":\"unlocked\"}");
  });

  // Unlock Door 2
  server.on("/open/2", HTTP_GET, []() {
    unlockDoor(2);
    server.send(200, "application/json", "{\"success\":true,\"door\":2,\"status\":\"unlocked\"}");
  });

  // Unlock Door 3
  server.on("/open/3", HTTP_GET, []() {
    unlockDoor(3);
    server.send(200, "application/json", "{\"success\":true,\"door\":3,\"status\":\"unlocked\"}");
  });

  // Get all sensor statuses
  server.on("/status", HTTP_GET, []() {
    String json = "{";
    json += "\"door1\":{\"open\":" + String(getDoorStatus(1)) + ",\"parcel\":" + String(getParcelStatus(1)) + "},";
    json += "\"door2\":{\"open\":" + String(getDoorStatus(2)) + ",\"parcel\":" + String(getParcelStatus(2)) + "},";
    json += "\"door3\":{\"open\":" + String(getDoorStatus(3)) + ",\"parcel\":" + String(getParcelStatus(3)) + "}";
    json += "}";
    server.send(200, "application/json", json);
  });

  // Get door status
  server.on("/door/1", HTTP_GET, []() {
    server.send(200, "application/json", "{\"door\":1,\"open\":" + String(getDoorStatus(1)) + ",\"parcel\":" + String(getParcelStatus(1)) + "}");
  });
  server.on("/door/2", HTTP_GET, []() {
    server.send(200, "application/json", "{\"door\":2,\"open\":" + String(getDoorStatus(2)) + ",\"parcel\":" + String(getParcelStatus(2)) + "}");
  });
  server.on("/door/3", HTTP_GET, []() {
    server.send(200, "application/json", "{\"door\":3,\"open\":" + String(getDoorStatus(3)) + ",\"parcel\":" + String(getParcelStatus(3)) + "}");
  });

  // Parcel status
  server.on("/parcel", HTTP_GET, []() {
    server.send(200, "application/json", "{\"detected\":" + String(getParcelStatus()) + "}");
  });

  // Health check
  server.on("/health", HTTP_GET, []() {
    server.send(200, "text/plain", "OK");
  });

  server.begin();
  Serial.println("Web server started");
}

// ---------------- Door Control ----------------

void unlockDoor(int doorNum) {
  Serial.print("Unlocking door ");
  Serial.println(doorNum);

  int relayPin;
  switch (doorNum) {
    case 1: relayPin = RELAY_1_PIN; break;
    case 2: relayPin = RELAY_2_PIN; break;
    case 3: relayPin = RELAY_3_PIN; break;
    default: return;
  }

  // Activate relay (HIGH = unlock for relay module)
  digitalWrite(relayPin, HIGH);

  // Record unlock time for auto-lock
  unsigned long now = millis();
  switch (doorNum) {
    case 1:
      door1Unlocked = true;
      door1UnlockTime = now;
      break;
    case 2:
      door2Unlocked = true;
      door2UnlockTime = now;
      break;
    case 3:
      door3Unlocked = true;
      door3UnlockTime = now;
      break;
  }

  // Blink LED to confirm
  digitalWrite(LED_PIN, LOW);
  delay(100);
  digitalWrite(LED_PIN, HIGH);
}

void lockDoor(int doorNum) {
  Serial.print("Locking door ");
  Serial.println(doorNum);

  int relayPin;
  switch (doorNum) {
    case 1:
      relayPin = RELAY_1_PIN;
      door1Unlocked = false;
      break;
    case 2:
      relayPin = RELAY_2_PIN;
      door2Unlocked = false;
      break;
    case 3:
      relayPin = RELAY_3_PIN;
      door3Unlocked = false;
      break;
    default: return;
  }

  // Deactivate relay (LOW = lock)
  digitalWrite(relayPin, LOW);
}

// ---------------- Sensors ----------------

// Returns true if door is open (reed switch NOT pressed)
// Reed switch: CLOSED (magnet near) = door closed = HIGH
//             OPEN (magnet far) = door open = LOW
bool getDoorStatus(int doorNum) {
  int pin;
  switch (doorNum) {
    case 1: pin = REED_1_PIN; break;
    case 2: pin = REED_2_PIN; break;
    case 3: pin = REED_3_PIN; break;
    default: return false;
  }

  // If digitalRead returns LOW, door is OPEN
  // If returns HIGH, door is CLOSED
  return (digitalRead(pin) == LOW);
}

// Returns true if parcel detected at the specified door
// IR Sensor: Object detected = LOW, No object = HIGH
bool getParcelStatus(int doorNum) {
  int pin;
  switch (doorNum) {
    case 1: pin = IR_1_PIN; break;
    case 2: pin = IR_2_PIN; break;
    case 3: pin = IR_3_PIN; break;
    default: return false;
  }

  // LOW = parcel detected (object blocking IR beam)
  return (digitalRead(pin) == LOW);
}
