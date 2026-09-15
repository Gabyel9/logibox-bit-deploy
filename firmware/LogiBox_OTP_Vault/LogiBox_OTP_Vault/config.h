#ifndef CONFIG_H
#define CONFIG_H

// ─── Feature Flags ───
// Set to 1 when hardware is connected, 0 to skip sensor init/monitoring.
#define ENABLE_REED_SWITCHES  1
#define ENABLE_IR_SENSORS     1

// ─── Device Identity ───
#define DEVICE_ID      "esp32-test-001"
#define FUNCTION_URL   "https://logibox-bit-deploy-3xzd.vercel.app/api/device-verify-otp"
#define EVENT_FUNCTION_URL "https://logibox-bit-deploy-3xzd.vercel.app/api/device-event"

// ─── Vaults ───
#define NUM_VAULTS     3

// ─── Camera (mDNS) ───
#define CAMERA_MDNS_HOST  "logiboxcam"
#define CAMERA_PORT       80

// ─── LCD (I2C 16x2) ───
#define LCD_SDA   21
#define LCD_SCL   22
#define LCD_ADDR  0x27
#define LCD_COLS  16
#define LCD_ROWS  2

// ─── Keypad (4x4 matrix) ───
#define KEYPAD_ROWS  4
#define KEYPAD_COLS  4

// ─── Reed Switches (vault doors) ───
// Closed door = LOW, open door = HIGH (INPUT_PULLUP, wire to GND)
#define REED_PIN_V1  33
#define REED_PIN_V2  19
#define REED_PIN_V3  27

// ─── IR Sensors (parcel detection) ───
// Parcel present = LOW, empty = HIGH (LM393 push-pull, 3.3V supply)
// IR_PIN_V1/V2/V3 = GPIO34/35/36 are INPUT-ONLY on ESP32 (no internal
// pull-up/pull-down). Any replacement IR module MUST be genuine push-pull
// output (e.g. LM393 comparator); open-collector/drain modules will FLOAT
// the line and read randomly. Do not add INPUT_PULLUP — it will not work
// on these pins.
#define IR_PIN_V1  34
#define IR_PIN_V2  35
#define IR_PIN_V3  36

// ─── Solenoid Locks (4-channel relay module) ───
// One relay channel per vault. With RELAY_ACTIVE_LOW=1 (standard opto
// boards) the relay energizes when the GPIO is driven LOW. Fail-secure:
// on power loss or reset the GPIOs float high, so relays stay OFF (locked).
#define ENABLE_SOLENOID_LOCKS  1
#define RELAY_ACTIVE_LOW       1

#define RELAY_PIN_V1           32
#define RELAY_PIN_V2           25
#define RELAY_PIN_V3           26
// RELAY_PINS hardware reminder (not enforceable in software): (1) fit a
// flyback/suppression diode across each relay coil (or use a relay module
// that already has one) to clamp back-EMF; (2) verify a COMMON GROUND
// between the ESP32, the relay board supply, and the IR/sensor supplies —
// floating grounds plus inductive coils is a classic reset/corruption source.

// Failsafe: force re-lock this long after an unlock even if the door
// never reports closed. Also caps how long an open door stays unlocked.
#define UNLOCK_MAX_TIMEOUT_MS  30000UL

// Re-lock delay used ONLY when reed switches are disabled (no way to
// detect that the door was opened and closed again).
#define UNLOCK_FALLBACK_MS     7000UL

// ─── Cash Pod Servos (PCA9685 16ch PWM driver + MG996R) ───
// INDEPENDENT of the solenoid locks: the pod is the cash-drop trapdoor,
// one servo per vault. The servo pulls a sliding metal sheet UP to release
// the cash pod. It fires ONLY on a fully confirmed delivery (door closed +
// parcel placed = door_closed_locked). It re-locks itself after a fixed
// window (SERVO_POD_OPEN_MS) - timed auto re-lock, nothing else drives it.
#define ENABLE_SERVO_LOCKS      1

// PCA9685 sits on the SAME I2C bus as the LCD (GPIO 21/22). Default
// address 0x40 (no address jumpers soldered). Does not conflict with the
// LCD at 0x27.
#define PCA9685_ADDR            0x40
#define SERVO_FREQ_HZ           50          // MG996R standard 50Hz (20ms frame)
#define SERVO_OSC_HZ            25000000UL  // PCA9685 internal oscillator (Hz) - calibrate if angle drifts

// Servo PWM channel -> vault mapping (plug MG996R signal into these channels).
// NOTE: PCA9685 software channels are 0-15. If your board labels its headers
// 1-16 (many clones do), subtract 1: label "4" = channel 3, "12" = 11, "16" = 15.
#define SERVO_CH_V1             3
#define SERVO_CH_V2             11
#define SERVO_CH_V3             15

// MG996R pulse widths (microseconds). Calibrate these against your actual
// servo + trapdoor linkage:
//   LOCKED   = sheet DOWN, blocking the cash pod.
//   UNLOCKED = sheet pulled UP, cash pod released.
// Defaults sit at the mechanical endstops (500us ~ 0deg, 2300us ~ 170deg).
// Because the pod servos normally idle with the signal OFF (limp, sheet held
// by gravity), these are only used during firing/ramping - see CALIBRATION
// in SETUP_INSTRUCTIONS.txt for trimming just inside the stops.
#define SERVO_PULSE_LOCKED_US    500        // MG996R ~0°
#define SERVO_PULSE_UNLOCKED_US 2300        // MG996R ~170° (calibrate!)

// Slow "wire pull" sweep rate in microseconds per second. At 700us/s the
// servo takes ~2.6s to sweep the full 500->2300us travel (the MG996R's own
// mechanical speed is ~0.5s, so the ramp, not the servo, controls speed).
// Raise for faster, lower for slower (does NOT apply at boot - boot snaps).
#define SERVO_RAMP_US_PER_SEC    700UL

// How long the cash pod stays held fully open before it starts lowering.
// NOTE: this window begins AFTER the raise ramp completes, so the pod is
// genuinely open for the full duration (total cycle ~ ramp + OPEN + ramp).
#define SERVO_POD_OPEN_MS       10000UL

// How long the pod holds the LOCKED pulse after re-lock before the signal is
// turned OFF (servo goes limp; sheet rests on the stop by gravity). Prevents
// the servos grinding their endstops 24/7.
#define SERVO_POD_SETTLE_MS      1000UL

// Delay between channels when the servos snap to LOCKED at boot, so the buck
// converter isn't hit by all servo inrush at once.
#define BOOT_SERVO_STAGGER_MS    100

// How long the LCD holds the "Releasing cash!" message after a confirmed
// delivery before returning to SELECT_VAULT. Pressing any keypad key skips
// the wait (flashLine behaviour).
#define CASH_DROP_MSG_MS        4000UL

// ─── Timing ───
#define KEY_DEBOUNCE_MS           200
#define IDLE_TIMEOUT_MS           30000UL
#define RESULT_DISPLAY_MS         2000UL
#define VERIFY_TIMEOUT_MS         25000UL
#define DOOR_DEBOUNCE_MS          50
#define PARCEL_DEBOUNCE_MS        50
#define WIFI_RECONNECT_TIMEOUT_MS 8000
#define CAM_IP_CACHE_MS           60000UL
#define VERIFY_PROGRESS_BLINK_MS  500

// ─── Rate Limiting ───
#define OTP_LENGTH            6
#define LOCAL_FAIL_THRESHOLD  5
#define LOCAL_LOCKOUT_MS      (15UL * 60UL * 1000UL)

// ─── Network Task ───
#define NET_TASK_STACK_SIZE   10000
#define NET_REQ_QUEUE_SIZE    4
#define NET_RES_QUEUE_SIZE    2

// ─── Watchdog ───
// Seconds of inactivity before the ESP32 auto-resets. Set to 0 to disable.
#define WDT_TIMEOUT_SEC       15

// ─── NVS Persistence ───
#define NVS_NAMESPACE         "logibox"
#define NVS_KEY_LOCKOUT_UNTIL "lockout_until"
#define NVS_KEY_FAIL_COUNT    "fail_count"
#define NVS_KEY_BOOT_COUNT    "boot_count"

// ─── Boot ───
#define BOOT_SPLASH_MS        1500
#define BOOT_SENSOR_TEST_MS   300

// ─── Parallax Scrolling ───
#define SCROLL_SPEED_MS       300     // Delay between scroll steps
#define SCROLL_PAUSE_MS       1000    // Pause at start/end before scrolling

#endif
