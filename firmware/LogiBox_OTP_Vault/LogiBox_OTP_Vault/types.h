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
