/*
  LogiBox - ESP32 OTP Vault Verification (Multi-Vault)
  --------------------------------------------------------
  Reads a 6-digit OTP from a 4x4 keypad, displays status on an I2C LCD,
  and verifies it against the Vercel /api/device-verify-otp endpoint.

  Supports multiple vaults per device - user selects which vault to open
  from a menu, then enters OTP for that specific vault.

  On a successful OTP the vault's solenoid lock (via a 4-channel relay
  module) energizes to release the door. The lock stays released until the
  reed switch reports the door was opened and closed again, or a failsafe
  timeout forces it locked. Fail-secure: power loss or reset = locked.

  CASH POD (optional, independent of the door locks): each vault also has
  a cash-drop trapdoor controlled by an MG996R servo on a PCA9685 16ch PWM
  driver (same I2C bus as the LCD). The pod fires ONLY on a fully confirmed
  delivery (door closed + parcel placed = door_closed_locked event): the
  servo slowly pulls the metal sheet UP (pulse-width ramp at
  SERVO_RAMP_US_PER_SEC, a wire/pulley-like motion), holds open for
  SERVO_POD_OPEN_MS, slowly lowers back, then the signal goes OFF so the
  servo sleeps (no endstop grinding). It never fires on wrong OTP,
  no_parcel, or auto_locked timeouts. Fail-secure at boot: all servos snap
  to the LOCKED position (staggered) before anything else runs, then go
  limp with the sheet resting locked by gravity.

  While a delivery session is active, the keypad tells the ESP32-CAM
  (LogiBox_ESP32CAM.ino) to start/stop capturing via a LAN HTTP call.
  The captured frames are stored in the web app as delivery evidence.

  NON-BLOCKING ARCHITECTURE:
  All network work (camera commands, OTP verification) runs in a FreeRTOS
  task pinned to core 0, fed through a request queue. The main loop never
  blocks: the keypad, LCD, door and parcel monitoring stay responsive even
  while HTTP/mDNS calls are in flight. OTP results come back through a
  result queue and are applied on the main loop. UI flash messages are
  timer-based instead of delay()-based.

  Board: ESP32 Dev Module (38-pin DevKit, CP2102)
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

  All tunables live in config.h. Types and enums live in types.h.
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
#include <Adafruit_PWMServoDriver.h>
#include <string.h>
#include <Preferences.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_task_wdt.h"
#include "config.h"
#include "types.h"

// Allowed vault IDs for this device - MUST match the allowedVaultIds array
// in the device's Firestore document. Used for local UX filtering only;
// the server re-validates this.
const char* ALLOWED_VAULTS[] = {"1", "2", "3"};

// ---------------- LCD (I2C) ----------------
LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);

// ---------------- Keypad (4x4) ----------------
char keys[KEYPAD_ROWS][KEYPAD_COLS] = {
  {'1','4','7','*'},
  {'2','5','8','0'},
  {'3','6','9','#'},
  {'A','B','C','D'}
};
byte rowPins[KEYPAD_ROWS] = {4, 5, 14, 13};
// KEYPAD_COLS starts at GPIO15 (MTDO), an ESP32 boot-strapping pin with a
// boot-time pull-DOWN. It must NOT be pulled HIGH at reset (that can select
// a different boot mode). The keypad's column drive on this pin is the
// riskiest of the set — confirm the column wiring does not assert HIGH during
// power-on reset.
byte colPins[KEYPAD_COLS] = {15, 16, 17, 18};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, KEYPAD_ROWS, KEYPAD_COLS);

// ---------------- Reed Switches (Vault Doors) ----------------
#if ENABLE_REED_SWITCHES
const byte REED_PINS[NUM_VAULTS] = {REED_PIN_V1, REED_PIN_V2, REED_PIN_V3};
#endif

// ---------------- IR Sensors (Parcel Detection) ----------------
#if ENABLE_IR_SENSORS
const byte IR_PINS[NUM_VAULTS] = {IR_PIN_V1, IR_PIN_V2, IR_PIN_V3};
#endif

// ---------------- Solenoid Locks (via relay module) ----------------
// Relay energizes on the level that matches RELAY_ACTIVE_LOW in config.h.
#if ENABLE_SOLENOID_LOCKS
const byte RELAY_PINS[NUM_VAULTS] = {RELAY_PIN_V1, RELAY_PIN_V2, RELAY_PIN_V3};
#if RELAY_ACTIVE_LOW
const byte RELAY_ON_LEVEL  = LOW;
const byte RELAY_OFF_LEVEL = HIGH;
#else
const byte RELAY_ON_LEVEL  = HIGH;
const byte RELAY_OFF_LEVEL = LOW;
#endif
LockState locks[NUM_VAULTS] = {{false, false, false, 0, 0}, {false, false, false, 0, 0}, {false, false, false, 0, 0}};
#endif

// ---------------- Cash Pod Servos (PCA9685 + MG996R) ----------------
// Independent of the solenoid locks. Shares the I2C bus with the LCD:
// Wire.begin(LCD_SDA, LCD_SCL) in setup() initializes the bus the PCA9685
// uses too, so no extra Wire.begin() is needed.
#if ENABLE_SERVO_LOCKS
Adafruit_PWMServoDriver servoDriver(PCA9685_ADDR);
const byte SERVO_CH[NUM_VAULTS] = {SERVO_CH_V1, SERVO_CH_V2, SERVO_CH_V3};
PodState pods[NUM_VAULTS] = {{POD_IDLE, 0, 0, 0}, {POD_IDLE, 0, 0, 0}, {POD_IDLE, 0, 0, 0}};
#endif

// ---------------- NVS Persistence ----------------
Preferences nvs;

// ---------------- State ----------------
ScreenState currentState = WELCOME;
ScreenState previousState = WELCOME;

char selectedVault[2] = "";
char otpInput[7] = "";

// Timers
unsigned long lastKeyTime = 0;
unsigned long lastActivityTime = 0;
unsigned long resultShownAt = 0;
unsigned long verifyStartedAt = 0;

// Live "Verifying..." progress indicator (non-blocking)
bool verifyBlinkOn = false;
unsigned long lastVerifyBlink = 0;

// Local lockout
int localFailCount = 0;
unsigned long lockoutUntilMs = 0;

// Result tracking for display
char lastResultMessage[33] = "";
bool lastResultSuccess = false;
char lastResultVault[2] = "";

// Sensor state
DoorState doors[NUM_VAULTS] = {{false, false, 0}, {false, false, 0}, {false, false, 0}};
ParcelState parcels[NUM_VAULTS] = {{false, false, 0}, {false, false, 0}, {false, false, 0}};

// ---------------- Network Task (non-blocking core) ----------------
QueueHandle_t netReqQueue;
QueueHandle_t netResultQueue;
TaskHandle_t networkTaskHandle = NULL;

// Camera IP cache (used only inside the network task)
IPAddress cachedCamIP;
unsigned long camIpCachedAt = 0;
bool camIpValid = false;

// Non-blocking flash messages
bool flashActive = false;
unsigned long flashUntil = 0;
ScreenState flashReturnTo = WELCOME;
// Set true when a key press arrives while a flash message is up. Captured in
// loop() BEFORE flashActive is cleared so the key handler can honor the
// "press any key to skip the wait" behaviour (e.g. in DOOR_UNLOCKED, which
// otherwise ignores all keys).
bool flashSkipRequested = false;

// ---------------- Parallax Scrolling ----------------
// Supports two independent scroll lines (line 0 and line 1)
struct ScrollLine {
  char text[33];            // Full message to scroll
  int textLen;              // Length of text
  int scrollPos;            // Current scroll position
  unsigned long lastScroll; // Last scroll timestamp
  bool active;              // Whether this line is scrolling
};

ScrollLine scrollLines[2] = {
  {"", 0, 0, 0, false},
  {"", 0, 0, 0, false}
};

// ---------------- Boot Self-Test ----------------

void showBootSplash() {
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("  LogiBox");
  lcd.setCursor(0, 1);
  lcd.print(" Smart Vault v1.0");
  delay(BOOT_SPLASH_MS);
}

bool runBootSelfTest() {
  bool allOk = true;

  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Self-test...");

  // Test reed switches (if enabled)
#if ENABLE_REED_SWITCHES
  for (int i = 0; i < NUM_VAULTS; i++) {
    bool raw = (digitalRead(REED_PINS[i]) == LOW);
    doors[i].pending = doors[i].closed = raw;
    doors[i].pendingSince = millis();
    Serial.print("  Vault ");
    Serial.print(i + 1);
    Serial.print(" door: ");
    Serial.println(raw ? "CLOSED" : "OPENED");
  }
#endif

  // Test IR sensors (if enabled)
#if ENABLE_IR_SENSORS
  for (int i = 0; i < NUM_VAULTS; i++) {
    bool raw = (digitalRead(IR_PINS[i]) == LOW);
    parcels[i].pending = parcels[i].present = raw;
    parcels[i].pendingSince = millis();
    Serial.print("  Vault ");
    Serial.print(i + 1);
    Serial.print(" parcel: ");
    Serial.println(raw ? "PRESENT" : "EMPTY");
  }
#endif

  // Solenoid locks: report idle state only - never actuate at boot.
#if ENABLE_SOLENOID_LOCKS
  for (int i = 0; i < NUM_VAULTS; i++) {
    Serial.print("  Vault ");
    Serial.print(i + 1);
    Serial.println(" lock: LOCKED");
  }
#endif

  // Cash pod servos: report idle state - snapped to LOCKED and released to
  // limp (sheet rests locked by gravity) earlier in setup().
#if ENABLE_SERVO_LOCKS
  for (int i = 0; i < NUM_VAULTS; i++) {
    Serial.print("  Vault ");
    Serial.print(i + 1);
    Serial.print(" cash pod: LOCKED - asleep (ch ");
    Serial.print(SERVO_CH[i]);
    Serial.println(")");
  }
#endif

  // Test keypad responsiveness: show message, wait briefly for any key
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Press any key");
  lcd.setCursor(0, 1);
  lcd.print("to continue...");

  unsigned long waitStart = millis();
  bool keyReceived = false;
  while (millis() - waitStart < 5000) {
    char k = keypad.getKey();
    if (k) {
      keyReceived = true;
      break;
    }
    delay(10);
  }

  if (keyReceived) {
    Serial.println("Keypad: OK");
  } else {
    Serial.println("Keypad: no press (still OK)");
  }

  // Increment boot count in NVS
  nvs.begin(NVS_NAMESPACE, false);
  uint32_t bootCount = nvs.getUInt(NVS_KEY_BOOT_COUNT, 0);
  bootCount++;
  nvs.putUInt(NVS_KEY_BOOT_COUNT, bootCount);
  nvs.end();

  Serial.print("Boot #");
  Serial.println(bootCount);

  lcdClear();
  lcd.setCursor(0, 0);
  if (allOk) {
    lcd.print("All OK - Boot #");
    lcd.print(bootCount);
  } else {
    lcd.print("Check sensors");
    allOk = false;
  }
  delay(1000);

  return allOk;
}

// ---------------- NVS Lockout Persistence ----------------

void saveLockoutToNVS() {
  nvs.begin(NVS_NAMESPACE, false);
  nvs.putULong(NVS_KEY_LOCKOUT_UNTIL, lockoutUntilMs);
  nvs.putUChar(NVS_KEY_FAIL_COUNT, (uint8_t)localFailCount);
  nvs.end();
}

void loadLockoutFromNVS() {
  nvs.begin(NVS_NAMESPACE, true);
  lockoutUntilMs = nvs.getULong(NVS_KEY_LOCKOUT_UNTIL, 0);
  localFailCount = nvs.getInt(NVS_KEY_FAIL_COUNT, 0);
  nvs.end();

  // If the lockout period has already expired, clear it
  if (lockoutUntilMs > 0 && millis() >= lockoutUntilMs) {
    lockoutUntilMs = 0;
    localFailCount = 0;
    saveLockoutToNVS();
    Serial.println("NVS: expired lockout cleared");
  } else if (lockoutUntilMs > 0) {
    unsigned long remainingMs = lockoutUntilMs - millis();
    unsigned long remainingMin = (remainingMs / 60000UL) + 1;
    Serial.print("NVS: restored lockout (");
    Serial.print(remainingMin);
    Serial.println(" min remaining)");
  }
}

// ---------------- Setup ----------------

void setup() {
  Serial.begin(115200);
  Serial.println("=== LogiBox Starting ===");

  // Relays FIRST - drive every channel to the locked level before anything
  // else runs so no solenoid can fire during boot. Fail-secure default.
#if ENABLE_SOLENOID_LOCKS
  Serial.println("Initializing solenoid locks...");
  initRelays();
#endif

  delay(500);

  // Initialize LCD first (needed for boot splash and self-test)
  Serial.println("Initializing LCD...");
  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();

  // Cash pod servos: init immediately after Wire.begin() so they are driven
  // to LOCKED before anything else runs (fail-secure at power-on). The
  // PCA9685 shares the I2C bus with the LCD (same Wire instance).
#if ENABLE_SERVO_LOCKS
  Serial.println("Initializing cash pod servos (PCA9685)...");
  servoDriver.begin();
  servoDriver.setOscillatorFrequency(SERVO_OSC_HZ);
  servoDriver.setPWMFreq(SERVO_FREQ_HZ);
  delay(10);
  // Fail-secure first: snap every servo to LOCKED (staggered so the buck
  // isn't hit by all inrush at once), then release them to idle/limp after
  // settling. A dead servo holds nothing - the sheet must rest locked by
  // gravity/spring (see FAILSECURE in SETUP_INSTRUCTIONS.txt).
  initCashPods();
  Serial.println("  All cash pod servos: LOCKED (asleep/idle)");
#endif

  // Boot splash
  showBootSplash();

  // Reed switches (if enabled)
#if ENABLE_REED_SWITCHES
  Serial.println("Initializing reed switches...");
  for (int i = 0; i < NUM_VAULTS; i++) {
    pinMode(REED_PINS[i], INPUT_PULLUP);
  }
#endif

  // IR sensors (if enabled)
#if ENABLE_IR_SENSORS
  Serial.println("Initializing IR sensors...");
  for (int i = 0; i < NUM_VAULTS; i++) {
    pinMode(IR_PINS[i], INPUT);
  }
#endif

  // Boot self-test
  runBootSelfTest();

  // WiFi
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");

  Serial.println("Connecting to WiFi...");
  connectWiFi();

  delay(100);
  lcdClear();
  lcd.home();

  // FreeRTOS queues and network task
  netReqQueue = xQueueCreate(NET_REQ_QUEUE_SIZE, sizeof(NetMsg));
  netResultQueue = xQueueCreate(NET_RES_QUEUE_SIZE, sizeof(NetMsg));
  xTaskCreatePinnedToCore(networkTask, "network", NET_TASK_STACK_SIZE, NULL, 1, &networkTaskHandle, 0);

  // Restore lockout state from NVS
  loadLockoutFromNVS();

  // Enable hardware watchdog on the main loop task
#if WDT_TIMEOUT_SEC > 0
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms = WDT_TIMEOUT_SEC * 1000,
    .idle_core_mask = 0,
    .trigger_panic = true,
  };
  esp_task_wdt_init(&wdt_config);
  esp_task_wdt_add(NULL);
  Serial.print("Watchdog enabled (");
  Serial.print(WDT_TIMEOUT_SEC);
  Serial.println("s timeout)");
#endif

  lastActivityTime = millis();
  showScreen(WELCOME);
}

// ---------------- Loop ----------------

void loop() {
#if WDT_TIMEOUT_SEC > 0
  esp_task_wdt_reset();
#endif

  checkNetworkResults();
  checkFlashMessage();
  updateScrolling();
  updateVerifyingScreen();
#if ENABLE_SOLENOID_LOCKS
  checkLockStates();
#endif
#if ENABLE_SERVO_LOCKS
  updatePods();
#endif

  char key = keypad.getKey();
  if (!key) {
    checkIdleTimeout();
#if ENABLE_REED_SWITCHES
    checkDoorStates();
#endif
#if ENABLE_IR_SENSORS
    checkParcelStates();
#endif
    checkVerifyTimeout();
    return;
  }

  unsigned long now = millis();
  if (now - lastKeyTime < KEY_DEBOUNCE_MS) return;
  lastKeyTime = now;
  lastActivityTime = now;

  // Capture whether a flash was up so the key handler can honor the skip
  // (flashActive is cleared before handleKeyPress runs).
  flashSkipRequested = flashActive;
  flashActive = false;

  Serial.print("Key pressed: ");
  Serial.println(key);
  Serial.print("Current state: ");
  Serial.println(stateToString(currentState));

  handleKeyPress(key);
}

// ---------------- Network Task Implementation ----------------

void networkTask(void* param) {
  NetMsg msg;
  for (;;) {
    if (xQueueReceive(netReqQueue, &msg, pdMS_TO_TICKS(50)) == pdPASS) {
      switch (msg.op) {
        case OP_START_CAMERA:
          sendCameraCommandInternal("start", msg.reqVault);
          break;
        case OP_STOP_CAMERA:
          sendCameraCommandInternal("stop", "");
          break;
        case OP_VERIFY_OTP:
          msg.resultCode = 0;
          msg.resultBody[0] = '\0';
          submitOtpInternal(msg.reqOtp, msg.reqVault, &msg);
          xQueueSend(netResultQueue, &msg, 0);
          break;
        case OP_REPORT_EVENT:
          sendEventInternal(msg.reqEvent, msg.reqVault);
          break;
        default:
          break;
      }
    }
  }
}

// Main loop side: consumes completed OTP verifications.
void checkNetworkResults() {
  NetMsg msg;
  while (xQueueReceive(netResultQueue, &msg, 0) == pdPASS) {
    handleOtpResult(msg.resultCode, msg.resultBody);
  }
}

void handleOtpResult(int code, const char* body) {
  if (code == -1) {
    lastResultSuccess = false;
    strncpy(lastResultMessage, "No WiFi!", sizeof(lastResultMessage) - 1);
    strcpy(lastResultVault, selectedVault);
    showScreen(RESULT);
    return;
  }
  if (code == -2) {
    lastResultSuccess = false;
    strncpy(lastResultMessage, "Connect failed", sizeof(lastResultMessage) - 1);
    strcpy(lastResultVault, selectedVault);
    showScreen(RESULT);
    return;
  }
  handleResponse(code, body);
}

void checkVerifyTimeout() {
  if (currentState == VERIFYING && millis() - verifyStartedAt >= VERIFY_TIMEOUT_MS) {
    lastResultSuccess = false;
    strncpy(lastResultMessage, "Network error", sizeof(lastResultMessage) - 1);
    strcpy(lastResultVault, selectedVault);
    showScreen(RESULT);
  }
}

// ---------------- State Machine Handler ----------------

void handleKeyPress(char key) {
  switch (currentState) {
    case WELCOME:
      showScreen(SELECT_VAULT);
      break;

    case SELECT_VAULT:
      handleSelectVaultKey(key);
      break;

    case ENTER_OTP:
      handleEnterOtpKey(key);
      break;

    case VERIFYING:
      break;

    case RESULT:
      showScreen(SELECT_VAULT);
      break;

    case LOCKOUT:
      break;

    case SHOW_STATUS:
      showScreen(WELCOME);
      break;

    case DOOR_UNLOCKED:
      // INVARIANT: at most ONE vault is unlocked at a time. This keypad
      // block is the SOLE enforcement point. firstUnlockedVaultIndex()
      // (which assumes single-unlock) and the RESULT->DOOR_UNLOCKED handoff
      // in checkIdleTimeout() BOTH rely on it. If you relax this block to
      // allow a second vault, you must also rework firstUnlockedVaultIndex()
      // plus showDoorUnlockedScreen()/updateDoorUnlockedPrompt() (which key
      // off the single global selectedVault).
      // Keys are ignored while the door is released; re-locking is driven
      // by checkLockStates() (door close or failsafe timeout).
      // EXCEPTION: if a flash message was up when the key arrived (e.g.
      // "Releasing cash!", "Auto-locked") it means the rider pressed a key
      // to skip the wait - jump straight to flashReturnTo. Without this,
      // clearing flashActive would leave the keypad stuck on the flash
      // screen forever (DOOR_UNLOCKED is excluded from idle timeout).
      if (flashSkipRequested) {
        flashSkipRequested = false;
        showScreen(flashReturnTo);
      }
      break;
  }
}

// SELECT_VAULT screen keys
void handleSelectVaultKey(char key) {
  if (key == '*') {
    requestCameraCommand(OP_STOP_CAMERA, "");
    showScreen(WELCOME);
  } else if (isDigit(key)) {
    char vault[2] = {key, '\0'};
    if (isVaultAllowed(vault)) {
      strcpy(selectedVault, vault);
      requestCameraCommand(OP_START_CAMERA, selectedVault);
      otpInput[0] = '\0';
      showScreen(ENTER_OTP);
    } else {
      showInvalidVaultMessage();
    }
  }
}

// ENTER_OTP screen keys
void handleEnterOtpKey(char key) {
  if (key == '*') {
    // Close the camera session started at vault selection (asymmetry fix).
    requestCameraCommand(OP_STOP_CAMERA, "");
    // Clear any half-typed OTP so leftover digits don't carry over if the
    // same vault is re-picked and a new OTP is submitted.
    otpInput[0] = '\0';
    showScreen(SELECT_VAULT);
  } else if (key == 'D') {
    int len = strlen(otpInput);
    if (len > 0) {
      otpInput[len - 1] = '\0';
      updateOtpDisplay();
    }
  } else if (key == '#') {
    if (isLockedOutLocally()) {
      showScreen(LOCKOUT);
      return;
    }
    if (strlen(otpInput) == OTP_LENGTH) {
      submitOtp(otpInput);
    } else {
      showNeed6DigitsMessage();
    }
  } else if (isDigit(key) && strlen(otpInput) < OTP_LENGTH) {
    int len = strlen(otpInput);
    otpInput[len] = key;
    otpInput[len + 1] = '\0';
    updateOtpDisplay();
  }
}

// ---------------- Screen Display Functions ----------------

void lcdClear() {
  delay(5);
  lcd.clear();
  // Stop all scrolling when clearing
  scrollLines[0].active = false;
  scrollLines[1].active = false;
}

void flashLine(const char* line, unsigned long ms, ScreenState returnTo) {
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print(line);
  flashUntil = millis() + ms;
  flashActive = true;
  flashReturnTo = returnTo;
}

void checkFlashMessage() {
  if (flashActive && millis() >= flashUntil) {
    flashActive = false;
    showScreen(flashReturnTo);
  }
}

void showScreen(ScreenState state) {
  flashActive = false;
  currentState = state;

  switch (state) {
    case WELCOME:
      // Stop the camera whenever the UI returns to idle. Any path landing on
      // WELCOME ends the active attempt (idle timeout and '*' also stop, so
      // this is a belt-and-braces safety net; duplicate stops are no-ops).
      requestCameraCommand(OP_STOP_CAMERA, "");
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
    case SHOW_STATUS:
      break;
    case DOOR_UNLOCKED:
      showDoorUnlockedScreen();
      break;
  }
}

// ---------------- Parallax Scrolling Implementation ----------------

// Start scrolling on a specific line (0 or 1)
void startScrolling(int line, const char* text) {
  if (line < 0 || line > 1) return;
  
  ScrollLine* sl = &scrollLines[line];
  strncpy(sl->text, text, sizeof(sl->text) - 1);
  sl->text[sizeof(sl->text) - 1] = '\0';
  sl->textLen = strlen(sl->text);
  sl->scrollPos = 0;
  sl->lastScroll = millis();
  
  // Only activate scrolling if text is longer than LCD_COLS
  if (sl->textLen > LCD_COLS) {
    sl->active = true;
    // Show initial window (first LCD_COLS characters)
    lcd.setCursor(0, line);
    lcd.print("                ");
    lcd.setCursor(0, line);
    for (int i = 0; i < LCD_COLS && i < sl->textLen; i++) {
      lcd.print(sl->text[i]);
    }
  } else {
    sl->active = false;
    // Text fits, just display it
    lcd.setCursor(0, line);
    lcd.print("                ");
    lcd.setCursor(0, line);
    lcd.print(sl->text);
  }
}

// Stop scrolling on a specific line
void stopScrolling(int line) {
  if (line < 0 || line > 1) return;
  scrollLines[line].active = false;
}

// Update scrolling - call this in loop() frequently
void updateScrolling() {
  unsigned long now = millis();
  
  for (int line = 0; line < 2; line++) {
    ScrollLine* sl = &scrollLines[line];
    if (!sl->active) continue;
    
    // Check if it's time to scroll
    if (now - sl->lastScroll < SCROLL_SPEED_MS) continue;
    
    sl->lastScroll = now;
    sl->scrollPos++;
    
    // Pause at the end before restarting
    if (sl->scrollPos >= sl->textLen - LCD_COLS) {
      sl->scrollPos = 0;
      sl->lastScroll = now + SCROLL_PAUSE_MS; // Extra pause at restart
    }
    
    // Update display
    lcd.setCursor(0, line);
    lcd.print("                "); // Clear line
    lcd.setCursor(0, line);
    
    for (int i = 0; i < LCD_COLS; i++) {
      int srcIdx = sl->scrollPos + i;
      if (srcIdx < sl->textLen) {
        lcd.print(sl->text[srcIdx]);
      } else {
        lcd.print(' ');
      }
    }
  }
}

void showWelcomeScreen() {
  lcdClear();
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
  for (int i = 0; i < NUM_VAULTS; i++) {
    lcd.print(ALLOWED_VAULTS[i]);
    if (i < NUM_VAULTS - 1) {
      lcd.print("  ");
    }
  }
  lcd.print(" *=bk");
}

void showInvalidVaultMessage() {
  flashLine("Invalid vault", 800, SELECT_VAULT);
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
  lcd.print("                ");
  lcd.setCursor(0, 1);
  int len = strlen(otpInput);
  for (int i = 0; i < len; i++) {
    lcd.print("*");
  }
}

void showNeed6DigitsMessage() {
  flashLine("Need 6 digits", 1000, ENTER_OTP);
}

void showVerifyingScreen() {
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Verifying...");
  lcd.setCursor(0, 1);
  lcd.print("Vault ");
  lcd.print(selectedVault);
  verifyBlinkOn = false;
  lastVerifyBlink = millis();
}

// Non-blocking live progress indicator while VERIFYING: blinks a dot group in
// the free columns of row 0 (cols 12-15, clear of "Verifying..." which spans
// cols 0-11) so the user can see the device is working during the network
// wait. Called every loop().
void updateVerifyingScreen() {
  if (currentState != VERIFYING) return;
  unsigned long now = millis();
  if (now - lastVerifyBlink < VERIFY_PROGRESS_BLINK_MS) return;
  lastVerifyBlink = now;
  verifyBlinkOn = !verifyBlinkOn;
  lcd.setCursor(12, 0);
  lcd.print("    ");
  lcd.setCursor(12, 0);
  lcd.print(verifyBlinkOn ? "...." : "    ");
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
    char line0[17] = "";
    char line1[17] = "";
    
    if (strstr(lastResultMessage, "not authorized") != NULL) {
      strcpy(line0, "Not authorized");
      // Actionable: this OTP wasn't valid for this vault — tell the user to
      // re-enter (vault number preserved on the line for context).
      snprintf(line1, sizeof(line1), "Vault %s re-enter", lastResultVault);
    } else if (strstr(lastResultMessage, "Invalid OTP") != NULL) {
      strcpy(line0, "ACCESS DENIED");
      // Actionable: bad credentials — tell the user to re-enter.
      snprintf(line1, sizeof(line1), "Vault %s re-enter", lastResultVault);
    } else if (strstr(lastResultMessage, "Too many") != NULL) {
      snprintf(line0, sizeof(line0), "Vault %s -", lastResultVault);
      // 429 already states the wait — leave as-is, no extra action needed.
      strncpy(line1, lastResultMessage, sizeof(line1) - 1);
    } else {
      snprintf(line0, sizeof(line0), "Vault %s", lastResultVault);
      // Transient network/server failures: tell the user to retry. Permanent
      // errors (Bad request / Not registered / etc.) keep their message with
      // no misleading "retry".
      bool retryable = strstr(lastResultMessage, "No WiFi") != NULL
                    || strstr(lastResultMessage, "Connect failed") != NULL
                    || strstr(lastResultMessage, "Network error") != NULL
                    || strstr(lastResultMessage, "Server error") != NULL;
      if (retryable) {
        snprintf(line1, sizeof(line1), "%s - retry", lastResultMessage);
      } else {
        strncpy(line1, lastResultMessage, sizeof(line1) - 1);
      }
    }
    
    // Use scrolling for long messages
    startScrolling(0, line0);
    startScrolling(1, line1);
  }
}

// ---------------- Door State (Reed Switches) ----------------

#if ENABLE_REED_SWITCHES
void checkDoorStates() {
  for (int i = 0; i < NUM_VAULTS; i++) {
    bool raw = (digitalRead(REED_PINS[i]) == LOW);
    if (raw != doors[i].pending) {
      doors[i].pending = raw;
      doors[i].pendingSince = millis();
    } else if (millis() - doors[i].pendingSince >= DOOR_DEBOUNCE_MS) {
      if (doors[i].closed != raw) {
        doors[i].closed = raw;
        onDoorChange(i);
      }
    }
  }
}

void onDoorChange(int vaultIndex) {
  const char* state = doors[vaultIndex].closed ? "CLOSED" : "OPENED";
  Serial.print("Vault ");
  Serial.print(vaultIndex + 1);
  Serial.print(" door ");
  Serial.println(state);
}
#endif

// ---------------- Parcel State (IR Sensors) ----------------

#if ENABLE_IR_SENSORS
void checkParcelStates() {
  for (int i = 0; i < NUM_VAULTS; i++) {
    bool raw = (digitalRead(IR_PINS[i]) == LOW);
    if (raw != parcels[i].pending) {
      parcels[i].pending = raw;
      parcels[i].pendingSince = millis();
    } else if (millis() - parcels[i].pendingSince >= PARCEL_DEBOUNCE_MS) {
      if (parcels[i].present != raw) {
        parcels[i].present = raw;
        onParcelChange(i);
      }
    }
  }
}

void onParcelChange(int vaultIndex) {
  const char* state = parcels[vaultIndex].present ? "PLACED" : "REMOVED";
  Serial.print("Vault ");
  Serial.print(vaultIndex + 1);
  Serial.print(" parcel ");
  Serial.println(state);
}
#endif

// ---------------- Solenoid Lock Control ----------------

#if ENABLE_SOLENOID_LOCKS

void initRelays() {
  // RELAY SAFETY (confirmed, no behavior change): writing RELAY_OFF_LEVEL
  // BEFORE pinMode preloads the GPIO output register, so the pin does not
  // glitch the instant it becomes an output (no output-register pulse),
  // and writing it again AFTER confirms the level. The pre-init boot window
  // (GPIOs floating hi-Z until this runs) is also safe: with RELAY_ACTIVE_LOW=1
  // a floating/high pin reads as OFF (de-energized / fail-secure), so no
  // relay can fire before initRelays() executes.
  // Write the inactive level BEFORE pinMode so the output register is
  // preloaded the instant the pin becomes an output (no glitch pulse).
  for (int i = 0; i < NUM_VAULTS; i++) {
    digitalWrite(RELAY_PINS[i], RELAY_OFF_LEVEL);
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], RELAY_OFF_LEVEL);
  }
}

void unlockVault(int vaultIndex) {
  if (vaultIndex < 0 || vaultIndex >= NUM_VAULTS) return;
  locks[vaultIndex].unlocked = true;
  locks[vaultIndex].doorOpenedDuringUnlock = false;
  locks[vaultIndex].parcelDetectedDuringUnlock = false;
  locks[vaultIndex].parcelRemovedSince = 0;
  locks[vaultIndex].unlockedAt = millis();
  digitalWrite(RELAY_PINS[vaultIndex], RELAY_ON_LEVEL);
  Serial.print("Vault ");
  Serial.print(vaultIndex + 1);
  Serial.println(" UNLOCKED");
}

void relockVault(int vaultIndex) {
  if (vaultIndex < 0 || vaultIndex >= NUM_VAULTS) return;
  locks[vaultIndex].unlocked = false;
  digitalWrite(RELAY_PINS[vaultIndex], RELAY_OFF_LEVEL);
  Serial.print("Vault ");
  Serial.print(vaultIndex + 1);
  Serial.println(" RELOCKED");
}

int vaultIndexFromId(const char* vaultId) {
  for (int i = 0; i < NUM_VAULTS; i++) {
    if (strcmp(vaultId, ALLOWED_VAULTS[i]) == 0) {
      return i;
    }
  }
  return -1;
}

int firstUnlockedVaultIndex() {
  // Assumes at most ONE vault is ever unlocked at a time — the "return
  // first" here is only correct because of the keypad block in
  // handleKeyPress()'s DOOR_UNLOCKED case (single-vault-at-a-time).
  // Do NOT remove that keypad block without also reworking this function,
  // the RESULT->DOOR_UNLOCKED handoff in checkIdleTimeout(), and
  // showDoorUnlockedScreen()/updateDoorUnlockedPrompt(), which key off the
  // single global selectedVault.
  for (int i = 0; i < NUM_VAULTS; i++) {
    if (locks[i].unlocked) return i;
  }
  return -1;
}

// Re-lock policy: after a successful OTP the solenoid releases and walks the
// rider through a 3-stage sequence enforced by the sensors:
//   1. Pull the door open (reed switch reports OPEN)
//   2. Place the parcel inside (IR sensor reports PRESENT)
//   3. Close the door (reed switch reports CLOSED) -> lock re-engages
// If the door closes before a parcel was detected, the lock re-engages
// immediately with a warning and the sequence must start over. The failsafe
// timeout forces a re-lock even if the rider stalls at any stage. Without
// reed switches there is no door feedback, so a plain timed unlock is used.
void checkLockStates() {
  for (int i = 0; i < NUM_VAULTS; i++) {
    if (!locks[i].unlocked) continue;

    unsigned long elapsed = millis() - locks[i].unlockedAt;
    bool timedOut = elapsed >= UNLOCK_MAX_TIMEOUT_MS;

#if ENABLE_REED_SWITCHES
    bool doorOpen = !doors[i].closed;

    // Stage 1: rider pulls the door open — record it and prompt to place
    // the parcel.
    if (!locks[i].doorOpenedDuringUnlock && doorOpen) {
      locks[i].doorOpenedDuringUnlock = true;
      requestEventReport("door_opened", ALLOWED_VAULTS[i]);
      updateDoorUnlockedPrompt(i);
      continue;
    }

    // Stage 2: with the door open, watch the IR sensor until a parcel is
    // placed inside the vault, then tell the rider to close the door.
#if ENABLE_IR_SENSORS
    if (locks[i].doorOpenedDuringUnlock &&
        !locks[i].parcelDetectedDuringUnlock &&
        parcels[i].present) {
      locks[i].parcelDetectedDuringUnlock = true;
      requestEventReport("parcel_placed", ALLOWED_VAULTS[i]);
      updateDoorUnlockedPrompt(i);
      continue;
    }

    // Stage 2b: the rider pulled the parcel back out after it was detected.
    // The IR is a beam-break sensor, so a parcel resting just off the beam
    // (or a hand briefly clearing it during repositioning) would otherwise
    // read as "removed". To avoid false aborts, a removal is only declared
    // after the beam stays empty for PARCEL_REMOVED_CONFIRM_MS; the beam
    // returning before that cancels the pending removal. Do NOT continue
    // here: the close-door evaluation must run in the same pass so a
    // simultaneous close+empty is caught immediately.
    if (locks[i].doorOpenedDuringUnlock &&
        locks[i].parcelDetectedDuringUnlock) {
      if (parcels[i].present) {
        // Parcel is back in the beam - cancel any pending removal.
        locks[i].parcelRemovedSince = 0;
      } else if (locks[i].parcelRemovedSince == 0) {
        // First sustained-empty sample: start the confirm window.
        locks[i].parcelRemovedSince = millis();
      } else if (millis() - locks[i].parcelRemovedSince >= PARCEL_REMOVED_CONFIRM_MS) {
        locks[i].parcelDetectedDuringUnlock = false;
        locks[i].parcelRemovedSince = 0;
        requestEventReport("parcel_removed", ALLOWED_VAULTS[i]);
        updateDoorUnlockedPrompt(i);
      }
    }
#endif

    // With IR sensors enabled, the close-door contract is only satisfied
    // once a parcel has actually been detected inside the vault. The latch
    // alone is not enough: the beam must be blocking at the moment the rider
    // closes the door. Without the live check, pulling the parcel back out
    // and shutting the door within PARCEL_REMOVED_CONFIRM_MS (before the
    // pending-removal timer elapses) would fire the cash pod on an empty
    // vault. Fail-safe: a parcel that doesn't sit in the beam aborts the
    // delivery (rider retries) rather than releasing cash.
    bool parcelOk = true;
#if ENABLE_IR_SENSORS
    parcelOk = locks[i].parcelDetectedDuringUnlock && parcels[i].present;
#endif

    if (!timedOut) {
      if (doorOpen) continue;                        // still holding the door open
      if (!locks[i].doorOpenedDuringUnlock) continue; // door was never opened
      if (!parcelOk) {
        // Door closed before a parcel was detected — relock and warn the
        // rider so they restart the delivery sequence.
        relockVault(i);
        requestEventReport("no_parcel", ALLOWED_VAULTS[i]);
        if (currentState == DOOR_UNLOCKED) {
          lastActivityTime = millis();
          flashLine("No parcel detected", 1500, SELECT_VAULT);
        }
        continue;
      }
    }

    relockVault(i);
    // Normal completion (door closed + parcel confirmed) marks the vault
    // occupied; a failsafe timeout just aborts the session.
    bool deliveryConfirmed = !timedOut;
    requestEventReport(deliveryConfirmed ? "door_closed_locked" : "auto_locked", ALLOWED_VAULTS[i]);
    // Cash pod fires ONLY on a fully confirmed delivery. Never on a failsafe
    // timeout (auto_locked) or a no_parcel abort. The pod then raises slowly,
    // auto re-locks after SERVO_POD_OPEN_MS via updatePods(), and goes limp.
#if ENABLE_SERVO_LOCKS
    if (deliveryConfirmed) {
      fireCashPod(i);
    }
#endif
#else
    if (!timedOut && elapsed < UNLOCK_FALLBACK_MS) {
      continue;
    }
    relockVault(i);
    // No door/parcel feedback without reed + IR: a timed unlock is reported
    // as a plain auto-lock (it only clears deliveryInProgress).
    requestEventReport("auto_locked", ALLOWED_VAULTS[i]);
#endif

    if (currentState == DOOR_UNLOCKED) {
      lastActivityTime = millis();
      if (timedOut) {
        flashLine("Auto-locked", 1500, SELECT_VAULT);
      } else {
        // Confirmed delivery: show the cash-drop footer instead of bouncing
        // straight back to vault selection. Pressing any key skips the wait.
#if ENABLE_SERVO_LOCKS
        showCashDropMessage(i);
#else
        showScreen(SELECT_VAULT);
#endif
      }
    }
  }
}

void showDoorUnlockedScreen() {
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Vault ");
  lcd.print(selectedVault);
  lcd.print(" unlocked");

  lcd.setCursor(0, 1);
#if ENABLE_REED_SWITCHES
  int idx = vaultIndexFromId(selectedVault);
  if (idx >= 0) {
#if ENABLE_IR_SENSORS
    if (locks[idx].parcelDetectedDuringUnlock) {
      lcd.print("Close door now");
    } else if (!doors[idx].closed) {
      lcd.print("Put parcel inside");
    } else {
      lcd.print("Pull door open");
    }
#else
    if (!doors[idx].closed) {
      lcd.print("Close door now");
    } else {
      lcd.print("Pull door open");
    }
#endif
  } else {
    lcd.print("Pull door open");
  }
#else
  lcd.print("Close door soon");
#endif
}

// Swap the hint on the unlocked screen once the user has pulled the door open.
void updateDoorUnlockedPrompt(int vaultIndex) {
  if (currentState != DOOR_UNLOCKED) return;
  if (vaultIndexFromId(selectedVault) != vaultIndex) return;
  lcd.setCursor(0, 1);
  lcd.print("                ");
  lcd.setCursor(0, 1);
#if ENABLE_IR_SENSORS
  if (locks[vaultIndex].parcelDetectedDuringUnlock) {
    lcd.print("Close door now");
  } else {
    lcd.print("Put parcel inside");
  }
#else
  lcd.print("Close door now");
#endif
}

#endif // ENABLE_SOLENOID_LOCKS

// ---------------- Cash Pod Control (PCA9685 Servos) ----------------

#if ENABLE_SERVO_LOCKS

// Drive a channel's signal fully OFF (0% duty = no pulses) so the MG996R
// goes limp. This is the normal idle state: no endstop grinding, ~0 servo
// drive current. The sheet MUST rest in the LOCKED position by gravity or a
// spring (fail-secure hardware requirement - see FAILSECURE below).
void servoChannelOff(int channel) {
  servoDriver.setPWM(channel, 0, 4096);   // PCA9685 "full off"
}

// Boot fail-secure: snap every servo to LOCKED (staggered ~BOOT_SERVO_STAGGER_MS
// apart so the buck isn't hit by all servo inrush at once), hold briefly, then
// set the signal OFF so the servos go limp instead of grinding the endstops.
// The sheet sits on its mechanical stop by gravity from here on.
void initCashPods() {
  for (int i = 0; i < NUM_VAULTS; i++) {
    servoDriver.writeMicroseconds(SERVO_CH[i], SERVO_PULSE_LOCKED_US);
    delay(BOOT_SERVO_STAGGER_MS);
  }
  delay(SERVO_POD_SETTLE_MS);
  for (int i = 0; i < NUM_VAULTS; i++) {
    servoChannelOff(SERVO_CH[i]);
  }
}

// Release the cash pod: re-energize the servo and begin the slow raise ramp
// (LOCKED -> UNLOCKED at SERVO_RAMP_US_PER_SEC, like a wire-pulled trapdoor).
// Only ever called from checkLockStates() on a confirmed delivery
// (door_closed_locked) - never on wrong OTP, no_parcel, or auto_locked.
// The pod auto re-locks after ramp + SERVO_POD_OPEN_MS + ramp via updatePods().
void fireCashPod(int vaultIndex) {
  if (vaultIndex < 0 || vaultIndex >= NUM_VAULTS) return;
  PodState* p = &pods[vaultIndex];
  if (p->phase != POD_IDLE) return;          // already raising/open - don't re-fire
  servoDriver.writeMicroseconds(SERVO_CH[vaultIndex], SERVO_PULSE_LOCKED_US);
  p->phase = POD_RAISING;
  p->pulseUs = SERVO_PULSE_LOCKED_US;
  p->phaseStartedAt = millis();
  p->openAt = 0;
  Serial.print("Vault ");
  Serial.print(vaultIndex + 1);
  Serial.println(" CASH POD released (raising)");
}

// Force the pod back toward locked (sheet down). Safe to call mid-cycle.
void relockCashPod(int vaultIndex) {
  if (vaultIndex < 0 || vaultIndex >= NUM_VAULTS) return;
  PodState* p = &pods[vaultIndex];
  if (p->phase == POD_IDLE || p->phase == POD_SETTLING) return;  // already locked
  p->phase = POD_LOWERING;
  p->phaseStartedAt = millis();
  Serial.print("Vault ");
  Serial.print(vaultIndex + 1);
  Serial.println(" CASH POD re-locking (lowering)");
}

// Advance one pod's ramp toward its phase target at SERVO_RAMP_US_PER_SEC.
// The pulse is derived from elapsed time since the phase began, so it is
// smooth and independent of how often loop() runs. Returns true when the
// ramp reaches the target so the caller can switch phases.
bool rampPodPulse(int vaultIndex) {
  PodState* p = &pods[vaultIndex];
  bool lowering = (p->phase == POD_LOWERING);
  uint16_t target = lowering ? SERVO_PULSE_LOCKED_US : SERVO_PULSE_UNLOCKED_US;
  unsigned long elapsedMs = millis() - p->phaseStartedAt;
  unsigned long stepUs = (elapsedMs * SERVO_RAMP_US_PER_SEC) / 1000UL;

  uint16_t next;
  bool reached;
  if (lowering) {
    long v = SERVO_PULSE_UNLOCKED_US - (long)stepUs;
    reached = v <= (long)target;
    next = reached ? target : (uint16_t)v;
  } else {
    long v = SERVO_PULSE_LOCKED_US + (long)stepUs;
    reached = v >= (long)target;
    next = reached ? target : (uint16_t)v;
  }

  if (next != p->pulseUs) {
    p->pulseUs = next;
    servoDriver.writeMicroseconds(SERVO_CH[vaultIndex], next);
  }
  return reached;
}

// Cash pod state machine + timed auto re-lock. Called every loop(). Runs
// fully independent of the solenoid/door cycle and of the current screen
// state: once a pod fires it raises slowly, holds open for SERVO_POD_OPEN_MS,
// lowers slowly, settles, then goes limp - no keypad interaction required.
void updatePods() {
  for (int i = 0; i < NUM_VAULTS; i++) {
    PodState* p = &pods[i];

    switch (p->phase) {
      case POD_RAISING:
        if (rampPodPulse(i)) {
          p->phase = POD_OPEN;
          p->openAt = millis();
          p->phaseStartedAt = millis();
          Serial.print("Vault ");
          Serial.print(i + 1);
          Serial.println(" CASH POD open");
        }
        break;

      case POD_OPEN:
        if (millis() - p->phaseStartedAt >= SERVO_POD_OPEN_MS) {
          p->phase = POD_LOWERING;
          p->phaseStartedAt = millis();
          Serial.print("Vault ");
          Serial.print(i + 1);
          Serial.println(" CASH POD lowering (auto re-lock)");
        }
        break;

      case POD_LOWERING:
        if (rampPodPulse(i)) {
          p->phase = POD_SETTLING;
          p->phaseStartedAt = millis();
        }
        break;

      case POD_SETTLING:
        if (millis() - p->phaseStartedAt >= SERVO_POD_SETTLE_MS) {
          servoChannelOff(SERVO_CH[i]);
          p->pulseUs = 0;
          p->phase = POD_IDLE;
          Serial.print("Vault ");
          Serial.print(i + 1);
          Serial.println(" CASH POD locked (servo asleep)");
        }
        break;

      case POD_IDLE:
      default:
        break;
    }
  }
}

// Footer for a confirmed delivery: holds the LCD on "Releasing cash!" with
// the vault number on line 1 while the pod servo slowly pulls the sheet up,
// then returns to SELECT_VAULT after CASH_DROP_MSG_MS. Called only from the
// delivery-success branch of checkLockStates().
void showCashDropMessage(int vaultIndex) {
  flashLine("Releasing cash!", CASH_DROP_MSG_MS, SELECT_VAULT);
  lcd.setCursor(0, 1);
  lcd.print("Vault ");
  lcd.print(ALLOWED_VAULTS[vaultIndex]);
}

#endif // ENABLE_SERVO_LOCKS

// ---------------- Idle Timeout ----------------

void checkIdleTimeout() {
  if (currentState == RESULT) {
    if (millis() - resultShownAt >= RESULT_DISPLAY_MS) {
#if ENABLE_SOLENOID_LOCKS
      // A granted OTP with a vault still released hands over to the
      // unlocked screen instead of bouncing back to vault selection.
      if (lastResultSuccess && firstUnlockedVaultIndex() >= 0) {
        showScreen(DOOR_UNLOCKED);
      } else {
        showScreen(SELECT_VAULT);
      }
#else
      showScreen(SELECT_VAULT);
#endif
    }
  } else if (currentState != LOCKOUT && currentState != VERIFYING &&
             currentState != DOOR_UNLOCKED) {
    if (millis() - lastActivityTime >= IDLE_TIMEOUT_MS) {
      lastActivityTime = millis();
      if (currentState != WELCOME) {
        requestCameraCommand(OP_STOP_CAMERA, "");
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
  unsigned long remainingMin = (remainingMs / 60000UL) + 1;

  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("Locked out");
  
  char line1[17];
  snprintf(line1, sizeof(line1), "Wait ~%lu min", remainingMin);
  startScrolling(1, line1);
  
  flashUntil = millis() + 1500;
  flashActive = true;
  flashReturnTo = SELECT_VAULT;
}

void registerLocalFailure() {
  localFailCount++;
  if (localFailCount >= LOCAL_FAIL_THRESHOLD) {
    lockoutUntilMs = millis() + LOCAL_LOCKOUT_MS;
  }
  saveLockoutToNVS();
}

void clearLocalFailures() {
  localFailCount = 0;
  lockoutUntilMs = 0;
  saveLockoutToNVS();
}

// ---------------- Helper Functions ----------------

bool isVaultAllowed(const char* vaultId) {
  for (int i = 0; i < NUM_VAULTS; i++) {
    if (strcmp(vaultId, ALLOWED_VAULTS[i]) == 0) {
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
    case SHOW_STATUS: return "SHOW_STATUS";
    case DOOR_UNLOCKED: return "DOOR_UNLOCKED";
    default: return "UNKNOWN";
  }
}

// ---------------- WiFi ----------------

void connectWiFi() {
  WiFi.mode(WIFI_STA);

  WiFiManager wm;
  wm.setConfigPortalTimeout(180);

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

  Serial.print("\nWiFi connected. IP: ");
  Serial.println(WiFi.localIP().toString());
  MDNS.begin("logiboxkeypad");
  lcdClear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi Connected");
}

bool ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) return true;

  // Show feedback on LCD
  if (currentState != VERIFYING && currentState != RESULT) {
    lcdClear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi lost!");
    lcd.setCursor(0, 1);
    lcd.print("Reconnecting...");
  }
  Serial.println("WiFi disconnected, reconnecting...");

  WiFi.reconnect();
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_RECONNECT_TIMEOUT_MS) {
    delay(200);
  }

  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected) {
    Serial.println("WiFi reconnected");
  } else {
    Serial.println("WiFi reconnect failed");
  }

  return connected;
}

// ---------------- Camera Control ----------------

void requestCameraCommand(NetworkOp op, const char* vaultId) {
  NetMsg msg;
  msg.op = op;
  msg.reqVault[0] = (vaultId != NULL) ? vaultId[0] : '\0';
  msg.reqVault[1] = '\0';
  msg.reqOtp[0] = '\0';
  msg.reqEvent[0] = '\0';
  msg.resultCode = 0;
  msg.resultBody[0] = '\0';
  if (xQueueSend(netReqQueue, &msg, 0) != pdPASS) {
    Serial.println("Network queue full - camera command dropped");
  }
}

// Fire-and-forget delivery stage event to /api/device-event. Enqueued to the
// network task exactly like camera commands and OTP verification so the main
// loop never blocks on the POST.
void requestEventReport(const char* event, const char* vaultId) {
  NetMsg msg;
  msg.op = OP_REPORT_EVENT;
  msg.reqVault[0] = (vaultId != NULL) ? vaultId[0] : '\0';
  msg.reqVault[1] = '\0';
  strncpy(msg.reqEvent, event, sizeof(msg.reqEvent) - 1);
  msg.reqEvent[sizeof(msg.reqEvent) - 1] = '\0';
  msg.reqOtp[0] = '\0';
  msg.resultCode = 0;
  msg.resultBody[0] = '\0';
  if (xQueueSend(netReqQueue, &msg, 0) != pdPASS) {
    Serial.println("Network queue full - event report dropped");
  }
}

void sendCameraCommandInternal(const char* command, const char* vaultId) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Camera command skipped: no WiFi");
    return;
  }

  IPAddress camIP = resolveCameraIPInternal();
  if (camIP == IPAddress()) {
    Serial.println("Camera command skipped: ESP32-CAM not found on this network.");
    Serial.println("Is the camera on the SAME network as the keypad?");
    return;
  }

  HTTPClient http;
  http.setTimeout(5000);

  char url[128];
  if (vaultId != NULL && vaultId[0] != '\0') {
    snprintf(url, sizeof(url), "http://%s:%d/%s?vault=%s",
             camIP.toString().c_str(), CAMERA_PORT, command, vaultId);
  } else {
    snprintf(url, sizeof(url), "http://%s:%d/%s",
             camIP.toString().c_str(), CAMERA_PORT, command);
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

void sendEventInternal(const char* event, const char* vaultId) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Event report skipped: no WiFi");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(5000);

  if (!http.begin(client, EVENT_FUNCTION_URL)) {
    Serial.println("Event report: HTTP begin failed");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> reqDoc;
  reqDoc["deviceId"] = DEVICE_ID;
  reqDoc["vaultId"] = vaultId;
  reqDoc["event"] = event;
  char requestBody[256];
  serializeJson(reqDoc, requestBody, sizeof(requestBody));

  Serial.print("Event report: "); Serial.println(requestBody);
  int httpCode = http.POST(requestBody);
  Serial.print("Event report -> HTTP ");
  Serial.println(httpCode);

  http.end();
}

IPAddress resolveCameraIPInternal() {
  if (camIpValid && millis() - camIpCachedAt < CAM_IP_CACHE_MS) {
    return cachedCamIP;
  }

  IPAddress ip = MDNS.queryHost(CAMERA_MDNS_HOST, 2000);
  if (ip != IPAddress()) {
    cachedCamIP = ip;
    camIpCachedAt = millis();
    camIpValid = true;
    Serial.print("mDNS resolved ");
    Serial.print(CAMERA_MDNS_HOST);
    Serial.print(" -> ");
    Serial.println(ip.toString());
  } else {
    camIpValid = false;
    Serial.println("mDNS lookup failed - camera not found");
  }
  return ip;
}

// ---------------- OTP Submission ----------------

void submitOtp(const char* otp) {
  NetMsg msg;
  msg.op = OP_VERIFY_OTP;
  strncpy(msg.reqOtp, otp, sizeof(msg.reqOtp) - 1);
  msg.reqOtp[sizeof(msg.reqOtp) - 1] = '\0';
  strncpy(msg.reqVault, selectedVault, sizeof(msg.reqVault) - 1);
  msg.reqVault[sizeof(msg.reqVault) - 1] = '\0';
  msg.resultCode = 0;
  msg.resultBody[0] = '\0';

  if (xQueueSend(netReqQueue, &msg, 0) != pdPASS) {
    Serial.println("Network queue full - verify dropped");
    lastResultSuccess = false;
    strncpy(lastResultMessage, "Busy - try again", sizeof(lastResultMessage) - 1);
    strcpy(lastResultVault, selectedVault);
    showScreen(RESULT);
    return;
  }

  verifyStartedAt = millis();
  showScreen(VERIFYING);
}

void submitOtpInternal(const char* otp, const char* vault, NetMsg* msg) {
  if (!ensureWiFiConnected()) {
    msg->resultCode = -1;
    strcpy(msg->resultBody, "No WiFi!");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(10000);

  if (!http.begin(client, FUNCTION_URL)) {
    msg->resultCode = -2;
    strcpy(msg->resultBody, "Connect failed");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<200> reqDoc;
  reqDoc["deviceId"] = DEVICE_ID;
  reqDoc["otp"] = otp;
  reqDoc["vaultId"] = vault;
  char requestBody[200];
  serializeJson(reqDoc, requestBody, sizeof(requestBody));

  Serial.print("Sending JSON: "); Serial.println(requestBody);
  Serial.print("Selected vault: "); Serial.println(vault);
  int httpCode = http.POST(requestBody);

  // http.getString() returns Arduino String - copy to char[] buffer immediately
  String respStr = http.getString();

  Serial.print("HTTP code: ");
  Serial.println(httpCode);
  Serial.print("Response: ");
  Serial.println(respStr);

  http.end();

  msg->resultCode = httpCode;
  strncpy(msg->resultBody, respStr.c_str(), sizeof(msg->resultBody) - 1);
  msg->resultBody[sizeof(msg->resultBody) - 1] = '\0';
}

void handleResponse(int httpCode, const char* responseBody) {
  StaticJsonDocument<512> resDoc;
  DeserializationError err = deserializeJson(resDoc, responseBody);

  char message[33] = "";
  char debugMsg[101] = "";
  bool success = false;

  if (!err) {
    success = resDoc["success"] | false;
    if (resDoc.containsKey("message")) {
      strncpy(message, resDoc["message"].as<const char*>(), sizeof(message) - 1);
    }
    if (resDoc.containsKey("debug")) {
      strncpy(debugMsg, resDoc["debug"].as<const char*>(), sizeof(debugMsg) - 1);
    }
  }

  strcpy(lastResultVault, selectedVault);
  lastResultSuccess = false;

  if (httpCode == 200 && success) {
    clearLocalFailures();
    lastResultSuccess = true;
#if ENABLE_SOLENOID_LOCKS
    unlockVault(vaultIndexFromId(selectedVault));
#endif
    // Start the delivery session on the server (opens deliveryInProgress).
    requestEventReport("session_start", selectedVault);
    Serial.println("OTP Verified!");
  } else if (httpCode == 429) {
    lockoutUntilMs = millis() + LOCAL_LOCKOUT_MS;
    strncpy(lastResultMessage, strlen(message) ? message : "Too many attempts", sizeof(lastResultMessage) - 1);
    saveLockoutToNVS();
  } else if (httpCode == 404) {
    strncpy(lastResultMessage, "Not registered", sizeof(lastResultMessage) - 1);
  } else if (httpCode == 403) {
    registerLocalFailure();
    strncpy(lastResultMessage, strlen(message) ? message : "Invalid OTP", sizeof(lastResultMessage) - 1);
  } else if (httpCode == 400) {
    registerLocalFailure();
    strncpy(lastResultMessage, strlen(message) ? message : "Bad request", sizeof(lastResultMessage) - 1);
  } else if (httpCode == 500) {
    if (strlen(debugMsg) > 0) {
      snprintf(lastResultMessage, sizeof(lastResultMessage), "Err: %s", debugMsg);
    } else {
      strncpy(lastResultMessage, strlen(message) ? message : "Server error", sizeof(lastResultMessage) - 1);
    }
  } else if (httpCode <= 0) {
    strncpy(lastResultMessage, "Network error", sizeof(lastResultMessage) - 1);
  } else {
    snprintf(lastResultMessage, sizeof(lastResultMessage), "Error: %d", httpCode);
  }

  Serial.print("Response message: "); Serial.println(message);
  Serial.print("Debug info: "); Serial.println(debugMsg);

  showScreen(RESULT);
}
