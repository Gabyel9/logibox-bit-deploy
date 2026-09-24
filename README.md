# LogiBox — Smart Delivery Vault System

LogiBox is an OTP-secured delivery vault: an owner generates a one-time code in a
web app, a rider punches it into a keypad at the vault, the correct vault door
unlocks, and the delivery is captured on video as evidence. When the rider places
a parcel and closes the door correctly, the cash pod for that vault releases —
and only then. Any misuse (wrong code, no parcel, pull-out before lock, timeouts)
fails safe: door stays/re-engages locked and no cash is released.

## How a delivery works

1. **Owner generates an OTP** in the web app for a vault + receiver.
2. **Rider** walks up to the keypad: presses a key, picks the vault (1/2/3),
   and enters the 6-digit OTP.
3. The server verifies the code against the owner's vault (single-use, 5-min
   expiry by default). On success: the vault door lock **releases**, a camera
   session tag for that vault **starts** capturing evidence (~every 3 s).
4. **Rider** opens the door, places the parcel, closes the door.
5. On close the device validates live: the parcel must have been inside
   **during** the unlock **and still be present now**. If both hold, the lock
   re-engages, the delivery is **confirmed**, and the cash pod slowly drops.
6. Any shortfall aborts safely:
   - **Wrong OTP / expired / rate-limited** — no lock ever actuates.
   - **Parcel pulled out** (beam empty > 1.5 s) before close — `parcel_removed`;
     delivery aborts, lock re-arms, no pod.
   - **Parcel missing at door-close** (even a fast pull-out-and-close) —
     `no_parcel`; lock re-engages, cash pod never fires.
   - **Door never closed / stays open** — forced re-lock after 30 s (`auto_locked`).
7. Camera stops when the keypad returns to idle (welcome screen, ≤15 s after the
   last key press). Evidence frames live in the web app's Camera Feed.

## Web app

| Route            | Purpose |
|------------------|---------|
| `/dashboard`     | Vaults, generate/regenerate OTP, delivery form + confirm, live delivery progress |
| `/camera`        | Delivery evidence: capture sessions, frame gallery, download |
| `/logs`          | Activity history (deliveries, aborts, verifications, lockouts) |
| `/settings`      | Profile, password, OTP duration setting |
| `/simulator`     | Visual 3-stage delivery simulator (hardware-less demo) |
| `/help`          | In-app help |

An OTP is **single-use** — once verified it is burned. A failed delivery
therefore needs a **new** OTP, which the app gates with a **60-second
regeneration cooldown** per vault (so the owner can't spam codes robotically)
plus a server cap of **3 generations per 10 minutes** per vault. Regenerating
resets the code before it's used; the new code replaces the old.

## Security & safety model

- **Fail-secure by default**: on power loss, WiFi loss, crash, or watchdog reset,
  all solenoid locks drop closed and every cash pod servo snap-to-locked
  (then goes limp). A pod can never be released by a reboot.
- **Cash pod fires only on a confirmed delivery** (door opened → parcel placed →
  door closed with the parcel still in the beam). Never on wrong OTP, `no_parcel`,
  or `auto_locked` timeouts.
- **Device lockout**: 5 failed OTP attempts per device lock it out for 15 minutes
  (persisted in NVS — survives reboot).
- **Server-side checks**: OTP hashing (SHA-256), per-vault authorization
  (`allowedVaultIds` on the device), charted expiry at verify time.
- **Single-use OTP + anti-abuse limits** as described above.

## Architecture

```
                owner (web app)                 rider (at the vault)
                React + Vite                    4x4 keypad + LCD
              /dashboard etc.                   LogiBox_OTP_Vault.ino
                     |                                   |
                     | Firebase Auth/Firestore          | /api/device-verify-otp
                     v                                   v
             Vercel serverless API  <---------------------'
        /api/generate-otp
        /api/device-verify-otp
        /api/device-event
        /api/camera-upload
                     |                        |
                     v                        v
             Cloud Firestore           Firebase Storage
        users/{uid}/vaults/{id}       camera evidence (Camera Feed)
             devices/{deviceId}            ^   ^
                     |                        |   |
                     +-- keypad ESP32 sends staged events -------------+
                     +-- ESP32-CAM uploads frames -> /api/camera-upload
```

- **Keypad ESP32** (`firmware/LogiBox_OTP_Vault/`) — the vault brain: OTP entry +
  verification, solenoid locks, IR parcel sensors, reed door sensors, cash pod
  servos, camera start/stop over LAN HTTP.
- **ESP32-CAM** (`firmware/LogiBox_ESP32CAM/`) — captures delivery-evidence
  frames (~3 s interval) and uploads them to the app. Discovered over mDNS
  (`logiboxcam.local`).
- **Vercel serverless** (`api/`) — the security boundary: verifies OTPs against
  Firestore, enforces rate limits, accepts device staged events, and stores
  camera frames.
- **Firebase** — auth, Firestore (vaults/devices/activity logs), Storage
  (evidence), App Check.

## Hardware & firmware setup

Hardware wiring, pin maps, flashing, bench tests, calibration, and
troubleshooting live in **`firmware/SETUP_INSTRUCTIONS.txt`** — read it before
wiring.

High level:
- 1× keypad ESP32 (DevKit, CP2102) + 4x4 keypad + I2C LCD
- 3× door reed switches, 3× IR parcel sensors
- 3× 12 V solenoid locks on a relay module (shared 12 V rail)
- 3× MG996R cash-pod servos on a PCA9685 (6 V buck rail)
- 1× AI-Thinker ESP32-CAM (USB-TTL flash)
- WiFi is configured **once per device** via the WiFiManager phone portal — no
  credentials live in code.

## Deployment

The web app + API deploy to Vercel; **pushing to `main` auto-deploys**:

```powershell
git add .
git commit -m "docs: update setup instructions and add user guide"
git push origin main
```

Serverless endpoints need these secrets in Vercel: `FIREBASE_SERVICE_ACCOUNT_KEY`
(or the legacy `FIREBASE_PROJECT_ID` / `FIREBASE_PRIVATE_KEY` / `FIREBASE_CLIENT_EMAIL`),
plus your Firebase web app config in the frontend. Devices are registered in
Firestore as `devices/{deviceId}` with `ownerUid` + `allowedVaultIds`.

## Repo layout

```
api/                       Vercel serverless functions
src/                       React web app
   pages/Dashboard.jsx     OTP generation, delivery form + confirm
   pages/CameraFeed.jsx    evidence sessions/gallery
   pages/ActivityLogs.jsx  history
firmware/
   LogiBox_OTP_Vault/      keypad/lock/pod firmware
   LogiBox_ESP32CAM/       evidence camera firmware
   SETUP_INSTRUCTIONS.txt  wiring, flashing, tests, troubleshooting
USER_GUIDE.md              plain end-user instructions (no hardware)
```

## Docs

- **`USER_GUIDE.md`** — how to actually use the system day-to-day.
- **`firmware/SETUP_INSTRUCTIONS.txt`** — build, wire, flash, test, calibrate,
  and troubleshoot all hardware + firmware.