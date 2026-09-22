#ifndef TYPES_H
#define TYPES_H

#include <Arduino.h>

// ─── Sensor State ───
struct DoorState {
  bool closed;
  bool pending;
  unsigned long pendingSince;
};

struct ParcelState {
  bool present;
  bool pending;
  unsigned long pendingSince;
};

// ─── Solenoid Lock State ───
struct LockState {
  bool unlocked;
  bool doorOpenedDuringUnlock;
  bool parcelDetectedDuringUnlock;
  unsigned long unlockedAt;
  unsigned long parcelRemovedSince;   // millis() when IR first went empty (0 = not pending)
};

// ─── Cash Pod Phase (PCA9685 servo trapdoor) ───
// The servo sweeps slowly (pulse-width ramp) instead of snapping, like a
// wire-pulled trapdoor. Phases drive that motion state machine.
enum PodPhase {
  POD_IDLE = 0,        // locked; servo signal OFF (limp, sheet rests by gravity)
  POD_RAISING,         // ramp LOCKED -> UNLOCKED (sheet pulling UP)
  POD_OPEN,            // held fully open (UNLOCKED pulse) for SERVO_POD_OPEN_MS
  POD_LOWERING,        // ramp UNLOCKED -> LOCKED (sheet dropping DOWN / re-lock)
  POD_SETTLING         // holding LOCKED for SERVO_POD_SETTLE_MS before going limp
};

struct PodState {
  PodPhase      phase;             // current motion phase (see PodPhase)
  uint16_t      pulseUs;           // last pulse width actually written
  unsigned long phaseStartedAt;    // millis() when the current phase began
  unsigned long openAt;            // millis() when the pod reached fully OPEN
};

// ─── Network Messages ───
enum NetworkOp {
  OP_START_CAMERA,
  OP_STOP_CAMERA,
  OP_VERIFY_OTP,
  OP_LOG_TAMPER,
  OP_REPORT_EVENT
};

typedef struct {
  NetworkOp op;
  char reqVault[2];
  char reqOtp[7];
  char reqEvent[24];
  int  resultCode;
  char resultBody[512];
} NetMsg;

// ─── Screen State Machine ───
enum ScreenState {
  WELCOME,
  SELECT_VAULT,
  ENTER_OTP,
  VERIFYING,
  RESULT,
  LOCKOUT,
  SHOW_STATUS,
  DOOR_UNLOCKED
};

#endif
