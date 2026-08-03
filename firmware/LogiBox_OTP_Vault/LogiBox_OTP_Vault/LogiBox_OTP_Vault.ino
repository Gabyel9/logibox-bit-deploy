/*
  LogiBox - ESP32-S3 OTP Vault Verification (Multi-Vault)
  --------------------------------------------------------
  Reads a 6-digit OTP from a 4x4 keypad, displays status on an I2C LCD,
  and verifies it against the Vercel /api/device-verify-otp endpoint.

  Supports multiple vaults per device - user selects which vault to open
  from a menu, then enters OTP for that specific vault.

  While a delivery session is active, the keypad tells the ESP32-CAM
  (LogiBox_ESP32CAM.ino) to start/stop capturing via a LAN HTTP call.
  The captured frames are stored in the web app as delivery evidence.

  Board: ESP32-S3-WROOM DevKit
  Libraries required (install via Arduino IDE Library Manager):
    - Keypad (Mark Stanley)
    - LiquidCrystal I2C (Frank de Brabander)
    - ArduinoJson (Benoit Blanchon)
    - WiFiManager (tablatronix)

  WiFi credentials are configured once per device via WiFiManager:
  on first boot (or when the saved network is gone) this keypad starts a
  portal AP named "LogiBoxKeypad". Join it from a phone, open
  http://192.168.4.1, and enter the WiFi credentials. They are stored in
  NVS and survive re-flashes. The LCD shows the AP name during setup.

  FUNCTION_URL and DEVICE_ID are set below.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <Keypad.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <string.h>  // For strcpy, strlen

// ---------------- CONFIG: EDIT THESE ----------------
// WiFi credentials are NOT stored here - configure them once per device via
// the WiFiManager portal (AP name "LogiBoxKeypad", http://192.168.4.1).
const char* DEVICE_ID     = "esp32-test-001"; // must match the device doc in Firestore

const char* FUNCTION_URL  = "https://logibox-bit-deploy-3xzd.vercel.app/api/device-verify-otp";

// Allowed vault IDs for this device - MUST match the allowedVaultIds array
// in the device's Firestore document. Used for local UX filtering only;
// the server re-validates this.
const char* ALLOWED_VAULTS[] = {"1", "2", "3"};
const int NUM_VAULTS = 3;

// ESP32-CAM discovery. The keypad first resolves the camera's mDNS
// hostname "logiboxcam" (works on any WiFi network). CAMERA_IP is only
// a fallback if mDNS resolution fails.
const char* CAMERA_MDNS_HOST = "logiboxcam";
const char* CAMERA_IP = "192.168.100.151";
const int CAMERA_PORT = 80;
// -----------------------------------------------------

// ---------------- LCD (I2C) ----------------
// Common I2C LCD address is 0x27 or 0x3F - if the LCD shows nothing,
// try changing 0x27 to 0x3F.
LiquidCrystal_I2C lcd(0x27, 16, 2); // 16x2 LCD. Change to (0x27, 20, 4) if you have a 20x4.

// ---------------- Keypad (4x4) ----------------
const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[ROWS] = {4, 5, 6, 7};     // R1, R2, R3, R4
byte colPins[COLS] = {15, 16, 17, 18}; // C1, C2, C3, C4

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ---------------- State Machine ----------------
enum ScreenState {
  WELCOME,        // Initial screen, waiting for any key
  SELECT_VAULT,  // User selects which vault to open
  ENTER_OTP,     // User enters OTP for selected vault
  VERIFYING,     // HTTP request in progress
  RESULT,        // Show result of verification
  LOCKOUT        // Rate limited, show wait time
};

ScreenState currentState = WELCOME;
ScreenState previousState = WELCOME;  // For returning after lockout

// Current vault selection (char array to avoid String memory issues)
char selectedVault[2] = "";

// OTP input (char array to avoid String memory issues)
char otpInput[7] = "";  // 6 digits + null terminator
const int OTP_LENGTH = 6;

// Timers
unsigned long lastKeyTime = 0;
const unsigned long KEY_DEBOUNCE_MS = 200;

// Idle timeout - return to WELCOME after 30s of no input on RESULT screen
unsigned long lastActivityTime = 0;
const unsigned long IDLE_TIMEOUT_MS = 30000UL;

// Result screen display duration before auto-return
const unsigned long RESULT_DISPLAY_MS = 2000UL;
unsigned long resultShownAt = 0;

// Local lockout (rate limiting mirror)
int localFailCount = 0;
unsigned long lockoutUntilMs = 0;
const int LOCAL_FAIL_THRESHOLD = 5;
const unsigned long LOCAL_LOCKOUT_MS = 15UL * 60UL * 1000UL; // 15 min

// WiFi reconnect timing
const unsigned long WIFI_RECONNECT_TIMEOUT_MS = 8000;

// Result tracking for display
String lastResultMessage = "";
bool lastResultSuccess = false;
char lastResultVault[2] = "";

void setup() {
  Serial.begin(115200);
  Serial.println("=== LogiBox Starting ===");
  delay(500);  // Give time for serial to init

  Serial.println("Initializing LCD...");
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");

  Serial.println("Connecting to WiFi...");
  connectWiFi();

  // Small delay to let LCD stabilize
  delay(100);
  lcdClear();
  lcd.home();

  lastActivityTime = millis();
  showScreen(WELCOME);
}

void loop() {
  char key = keypad.getKey();
  if (!key) {
    checkIdleTimeout();
    return;
  }

  unsigned long now = millis();
  if (now - lastKeyTime < KEY_DEBOUNCE_MS) return;
  lastKeyTime = now;
  lastActivityTime = now;

  Serial.print("Key pressed: ");
  Serial.println(key);
  Serial.print("Current state: ");
  Serial.println(stateToString(currentState));

  handleKeyPress(key);
}

// ---------------- State Machine Handler ----------------

void handleKeyPress(char key) {
  switch (currentState) {
    case WELCOME:
      // Any key goes to vault selection
      // A session is starting - tell the ESP32-CAM to begin capturing
      sendCameraCommand("start");
      showScreen(SELECT_VAULT);
      break;

    case SELECT_VAULT:
      handleSelectVaultKey(key);
      break;

    case ENTER_OTP:
      handleEnterOtpKey(key);
      break;

    case VERIFYING:
      // Ignore all keys during verification
      break;

    case RESULT:
      // Any key goes back to SELECT_VAULT (faster than waiting for timeout)
      showScreen(SELECT_VAULT);
      break;

    case LOCKOUT:
      // Ignore keys during lockout - will return after showing lockout
      break;
  }
}

// SELECT_VAULT screen keys
void handleSelectVaultKey(char key) {
  if (key == '*') {
    // Go back to welcome - stop the camera capture
    sendCameraCommand("stop");
    showScreen(WELCOME);
  } else if (isDigit(key)) {
    // Check if it's an allowed vault - use char array
    char vault[2] = {key, '\0'};
    if (isVaultAllowed(vault)) {
      strcpy(selectedVault, vault);
      // The vault is known now - label the camera session with it
      sendCameraCommand("start", selectedVault);
      otpInput[0] = '\0';  // Clear otpInput
      showScreen(ENTER_OTP);
    } else {
      // Invalid vault - flash message
      showInvalidVaultMessage();
      // Redraw SELECT_VAULT screen
      showSelectVaultScreen();
    }
  }
  // A, B, C, D keys are ignored in vault selection
}

// ENTER_OTP screen keys
void handleEnterOtpKey(char key) {
  if (key == '*') {
    // Back to vault selection
    showScreen(SELECT_VAULT);
  } else if (key == 'D') {
    // Backspace - remove last digit if any
    int len = strlen(otpInput);
    if (len > 0) {
      otpInput[len - 1] = '\0';
      updateOtpDisplay();
    }
  } else if (key == '#') {
    // Submit
    if (isLockedOutLocally()) {
      showScreen(LOCKOUT);
      return;
    }
    if (strlen(otpInput) == OTP_LENGTH) {
      submitOtp(otpInput);
    } else {
      showNeed6DigitsMessage();
      showEnterOtpScreen();
    }
  } else if (isDigit(key) && strlen(otpInput) < OTP_LENGTH) {
    int len = strlen(otpInput);
    otpInput[len] = key;
    otpInput[len + 1] = '\0';
    updateOtpDisplay();
  }
  // A, B, C keys unused
}

// ---------------- Screen Display Functions ----------------

// Helper function to properly clear LCD - prevents ghosting/blurring
void lcdClear() {
  delay(30);  // Wait before clearing
  lcd.clear();
  delay(50);  // Wait after clearing for LCD to process
  lcd.home();
  delay(30);  // Extra wait
}

void showScreen(ScreenState state) {
  currentState = state;

  switch (state) {
    case WELCOME:
      showWelcomeScreen();
      break;
    case SELECT_VAULT:
      showSelectVaultScreen();
      break;
    case ENTER_OTP:
      showEnterOtpScreen();
      break;
    case VERIFYING:
      showVerifyingScreen();
      break;
    case RESULT:
      showResultScreen();
      resultShownAt = millis();
      break;
    case LOCKOUT:
      showLockoutScreen();
      break;
  }
}

void showWelcomeScreen() {
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("LogiBox Vault");
  lcd.setCursor(0, 1);
  lcd.print("Press any key");
}

void showSelectVaultScreen() {
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Select Vault:");
  lcd.setCursor(0, 1);
  // Print vaults directly without String concatenation
  for (int i = 0; i < NUM_VAULTS; i++) {
    lcd.print(ALLOWED_VAULTS[i]);
    if (i < NUM_VAULTS - 1) {
      lcd.print("  ");
    }
  }
  lcd.print(" *=bk");
}

void showInvalidVaultMessage() {
  lcd.setCursor(0, 1);
  lcd.print("                "); // Clear line first
  lcd.setCursor(0, 1);
  lcd.print("Invalid vault   ");
  delay(1000);
}

void showEnterOtpScreen() {
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Vault ");
  lcd.print(selectedVault);
  lcd.print(" - OTP:");
  lcd.setCursor(0, 1);
  lcd.print("______  #=ok D=del");
}

void updateOtpDisplay() {
  lcd.setCursor(0, 1);
  lcd.print("                "); // clear line
  lcd.setCursor(0, 1);
  // Mask digits as they're entered
  int len = strlen(otpInput);
  for (int i = 0; i < len; i++) {
    lcd.print("*");
  }
}

void showNeed6DigitsMessage() {
  lcd.setCursor(0, 1);
  lcd.print("Need 6 digits   ");
  delay(1200);
}

void showVerifyingScreen() {
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Verifying...");
  lcd.setCursor(0, 1);
  lcd.print("Vault ");
  lcd.print(selectedVault);
}

void showResultScreen() {
  lcdClear();
  lcd.setCursor(0, 0);

  if (lastResultSuccess) {
    lcd.print("ACCESS GRANTED");
    lcd.setCursor(0, 1);
    lcd.print("Vault ");
    lcd.print(lastResultVault);
    lcd.print(" - OK");
  } else {
    // Check specific error types for appropriate message
    if (lastResultMessage.indexOf("not authorized") >= 0) {
      lcd.print("Not authorized");
      lcd.setCursor(0, 1);
      lcd.print("for Vault ");
      lcd.print(lastResultVault);
    } else if (lastResultMessage.indexOf("Invalid OTP") >= 0) {
      lcd.print("ACCESS DENIED");
      lcd.setCursor(0, 1);
      lcd.print("Vault ");
      lcd.print(lastResultVault);
      lcd.print(" - bad OTP");
    } else if (lastResultMessage.indexOf("Too many") >= 0) {
      lcd.print("Vault ");
      lcd.print(lastResultVault);
      lcd.print(" - ");
      lcd.setCursor(0, 1);
      lcd.print(lastResultMessage.substring(0, 16));
    } else {
      // Generic error - show on line 1
      lcd.print("Vault ");
      lcd.print(lastResultVault);
      lcd.setCursor(0, 1);
      lcd.print(lastResultMessage.substring(0, 16));
    }
  }
}

// ---------------- Idle Timeout ----------------

void checkIdleTimeout() {
  if (currentState == RESULT) {
    if (millis() - resultShownAt >= RESULT_DISPLAY_MS) {
      // Auto-return to SELECT_VAULT after result display
      showScreen(SELECT_VAULT);
    }
  } else if (currentState != LOCKOUT && currentState != VERIFYING) {
    // Check for return to WELCOME after idle
    if (millis() - lastActivityTime >= IDLE_TIMEOUT_MS) {
      // Reset so this only fires once (was spamming stop every loop)
      lastActivityTime = millis();
      if (currentState != WELCOME) {
        // An active session timed out - stop the camera capture
        sendCameraCommand("stop");
      }
      showScreen(WELCOME);
    }
  }
}

// ---------------- Local Lockout ----------------

bool isLockedOutLocally() {
  return millis() < lockoutUntilMs;
}

void showLockoutScreen() {
  unsigned long remainingMs = lockoutUntilMs - millis();
  unsigned long remainingMin = (remainingMs / 60000UL) + 1; // round up

  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Locked out");
  lcd.setCursor(0, 1);
  lcd.print("Wait ~");
  lcd.print(remainingMin);
  lcd.print(" min");
  delay(1500);

  // After showing lockout, return to SELECT_VAULT
  showScreen(SELECT_VAULT);
}

void registerLocalFailure() {
  localFailCount++;
  if (localFailCount >= LOCAL_FAIL_THRESHOLD) {
    lockoutUntilMs = millis() + LOCAL_LOCKOUT_MS;
  }
}

void clearLocalFailures() {
  localFailCount = 0;
  lockoutUntilMs = 0;
}

// ---------------- Helper Functions ----------------

bool isVaultAllowed(const String& vaultId) {
  for (int i = 0; i < NUM_VAULTS; i++) {
    if (vaultId.equals(ALLOWED_VAULTS[i])) {
      return true;
    }
  }
  return false;
}

const char* stateToString(ScreenState state) {
  switch (state) {
    case WELCOME: return "WELCOME";
    case SELECT_VAULT: return "SELECT_VAULT";
    case ENTER_OTP: return "ENTER_OTP";
    case VERIFYING: return "VERIFYING";
    case RESULT: return "RESULT";
    case LOCKOUT: return "LOCKOUT";
    default: return "UNKNOWN";
  }
}

// ---------------- WiFi ----------------

void connectWiFi() {
  WiFi.mode(WIFI_STA);

  WiFiManager wm;
  wm.setConfigPortalTimeout(180); // give 3 min for phone setup, then reboot

  wm.setAPCallback([](WiFiManager* wm) {
    lcdClear();
    lcd.setCursor(0, 0);
    lcd.print("Join WiFi:");
    lcd.setCursor(0, 1);
    lcd.print("LogiBoxKeypad");
    Serial.println("\n=== WIFI SETUP REQUIRED ===");
    Serial.println("Join the 'LogiBoxKeypad' hotspot from your phone,");
    Serial.println("open http://192.168.4.1 and enter your WiFi credentials.");
  });

  if (!wm.autoConnect("LogiBoxKeypad")) {
    Serial.println("\nWiFi FAILED to connect.");
    lcdClear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi FAILED");
    lcd.setCursor(0, 1);
    lcd.print("Retrying setup...");
    delay(3000);
    return;
  }

  Serial.println("\nWiFi connected. IP: " + WiFi.localIP().toString());
  MDNS.begin("logiboxkeypad");
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi Connected");
  delay(1000);
}

bool ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) return true;

  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Reconnecting...");

  WiFi.reconnect();
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_RECONNECT_TIMEOUT_MS) {
    delay(200);
  }

  return WiFi.status() == WL_CONNECTED;
}

// ---------------- Camera Control ----------------

// Sends a LAN HTTP command to the ESP32-CAM to start/stop capturing.
// Fires-and-forgets: failures are logged but never block the keypad flow.
// vaultId (optional) labels the camera session with the vault being opened.
void sendCameraCommand(const char* command) {
  sendCameraCommand(command, "");
}

void sendCameraCommand(const char* command, const char* vaultId) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Camera command skipped: no WiFi");
    return;
  }

  IPAddress camIP = MDNS.queryHost(CAMERA_MDNS_HOST, 3000);
  if (camIP == IPAddress()) {
    camIP.fromString(CAMERA_IP);
    Serial.print("mDNS lookup failed, falling back to ");
    Serial.println(CAMERA_IP);
  } else {
    Serial.print("mDNS resolved ");
    Serial.print(CAMERA_MDNS_HOST);
    Serial.print(" -> ");
    Serial.println(camIP.toString());
  }

  HTTPClient http;
  http.setTimeout(5000);

  String url = String("http://") + camIP.toString() + ":" + CAMERA_PORT + "/" + command;
  if (vaultId != NULL && vaultId[0] != '\0') {
    url += "?vault=";
    url += vaultId;
  }

  if (!http.begin(url)) {
    Serial.println("Camera HTTP begin failed");
    return;
  }

  int httpCode = http.GET();
  Serial.print("Camera command ");
  Serial.print(command);
  Serial.print(" -> HTTP ");
  Serial.println(httpCode);

  http.end();
}

// ---------------- OTP Submission ----------------

void submitOtp(const char* otp) {
  showScreen(VERIFYING);

  if (!ensureWiFiConnected()) {
    lastResultSuccess = false;
    lastResultMessage = "No WiFi!";
    strcpy(lastResultVault, selectedVault);
    showScreen(RESULT);
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Skips certificate validation - fine for bench
                        // testing. Before this vault is deployed for
                        // real, pin Vercel's cert with setCACert().

  HTTPClient http;
  http.setTimeout(10000); // 10s timeout

  if (!http.begin(client, FUNCTION_URL)) {
    lastResultSuccess = false;
    lastResultMessage = "Connect failed";
    strcpy(lastResultVault, selectedVault);
    showScreen(RESULT);
    return;
  }

  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<200> reqDoc;
  reqDoc["deviceId"] = DEVICE_ID;
  reqDoc["otp"] = otp;
  reqDoc["vaultId"] = selectedVault;  // Include selected vault
  String requestBody;
  serializeJson(reqDoc, requestBody);

  Serial.print("Sending JSON: "); Serial.println(requestBody);
  Serial.print("Selected vault: "); Serial.println(selectedVault);
  int httpCode = http.POST(requestBody);
  String responseBody = http.getString();

  Serial.print("HTTP code: ");
  Serial.println(httpCode);
  Serial.println("Response: " + responseBody);

  http.end();

  handleResponse(httpCode, responseBody);
}

void handleResponse(int httpCode, String responseBody) {
  StaticJsonDocument<512> resDoc;  // Increased size for debug info
  DeserializationError err = deserializeJson(resDoc, responseBody);

  String message = "";
  String debugMsg = "";  // For server debug info
  bool success = false;

  if (!err) {
    success = resDoc["success"] | false;
    if (resDoc.containsKey("message")) {
      message = resDoc["message"].as<String>();
    }
    if (resDoc.containsKey("debug")) {
      debugMsg = resDoc["debug"].as<String>();
    }
  }

  // Store for display
  strcpy(lastResultVault, selectedVault);
  lastResultMessage = message;
  lastResultSuccess = false;

  if (httpCode == 200 && success) {
    clearLocalFailures();
    lastResultSuccess = true;
    Serial.println("OTP Verified!");
  } else if (httpCode == 429) {
    // Server already rate-limited us; sync local lockout
    lockoutUntilMs = millis() + LOCAL_LOCKOUT_MS;
    lastResultMessage = message.length() ? message : "Too many attempts";
  } else if (httpCode == 404) {
    lastResultMessage = "Not registered";
  } else if (httpCode == 403) {
    // Could be invalid OTP OR not authorized for vault
    registerLocalFailure();
    lastResultMessage = message.length() ? message : "Invalid OTP";
  } else if (httpCode == 400) {
    lastResultMessage = message.length() ? message : "Bad request";
  } else if (httpCode == 500) {
    // Show debug info if available, otherwise message, otherwise generic error
    if (debugMsg.length() > 0) {
      lastResultMessage = "Err: " + debugMsg;
    } else {
      lastResultMessage = message.length() ? message : "Server error";
    }
  } else if (httpCode <= 0) {
    lastResultMessage = "Network error";
  } else {
    lastResultMessage = "Error: " + String(httpCode);
  }

  // Print debug info to serial for troubleshooting
  Serial.print("Response message: "); Serial.println(message);
  Serial.print("Debug info: "); Serial.println(debugMsg);

  showScreen(RESULT);
}   

