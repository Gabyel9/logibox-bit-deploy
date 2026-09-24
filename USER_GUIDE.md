# LogiBox — How to Use (Owner Guide)

LogiBox is a delivery vault: you (the owner) generate a one-time code in the web
app, your rider types it into the keypad at the vault, the door unlocks, and the
whole thing is captured on camera. Only a proper delivery (parcel placed, door
closed) releases the cash.

This guide is the owner's day-to-day manual. Builders/installers: see
`firmware/SETUP_INSTRUCTIONS.txt` and `README.md`.

---

## 1. Sign in

1. Open the LogiBox web app in a browser.
2. Click **Sign in** (or **Sign up** and verify your email the first time).
3. You land on the **Dashboard**.

## 2. Generate an OTP for a delivery

On the **Dashboard**:

1. Find the vault you want (Vault 1 / 2 / 3).
2. Click **Generate OTP** (or **Regenerate** if a code already exists).
3. Optionally start a delivery first (see below) so the code is tied to a
   receiver — otherwise you get a plain code you can share.
4. Copy the 6-digit OTP and send it to your rider.

**Rules that matter:**

- An OTP is **single-use**. The moment your rider enters it correctly, it's dead
  — even if the delivery then fails. A retry needs a **new** code.
- An OTP **expires** after 5 minutes by default (change on the **Settings** page
  under OTP duration). After expiry the app won't verify it.
- You can only generate/re-generate an OTP for the **same vault every 60 seconds**
  — the button greys out and shows a countdown.
- Server safety cap: at most **3 OTP generations per 10 minutes** per vault. If
  you hit it, the app tells you to wait a few minutes.

## 3. Start a delivery (optional but recommended)

From the Dashboard, click **New Delivery** and fill in:

- **Selected Vault** — which compartment
- **Delivery Rider** — receiver name
- **Contact** — phone
- **Parcel Info** — what's being delivered
- **Delivery Fee** — amount to be released from the cash pod

Then **Confirm** only when you are **physically at or near the vault** and the
rider is there. The dashboard will show the delivery progress live:
*delivery started → door opened → parcel placed → door closed → completed*.

## 4. What your rider sees at the vault

1. Keypad screen shows **Select Vault** — press 1, 2, or 3.
2. Enter the 6-digit OTP, press `#`.
3. **ACCESS GRANTED** → the door unlocks, the camera starts recording the session.
   The LCD says *"Vault N unlocked / Pull door open"*.
4. Rider opens the door, places the parcel, closes it.
5. On a good close the lock re-engages and the cash pod releases for the vault.
6. The LCD returns to the vault-selection screen.

## 5. Aborted / failed deliveries (what you'll see)

Nothing cancels silently — every case logs to **Activity Logs**:

| What happened | Event you'll see | Cash pod |
|---|---|---|
| Wrong or expired code, too many tries | *Device OTP Verification Failed*, device temporarily locked (15 min) | No |
| Door opened but never closed (30 s) | *Auto-locked* (forced re-lock) | No |
| Rider pulled the parcel back out before closing | *Parcel Removed Before Lock* — delivery aborts, lock re-arms | No |
| Door closed with **no** parcel in it (even a fast pull-out-and-close) | *No Parcel* (`no_parcel`) — lock re-engages | Never |
| Parcel placed, door closed properly | *Delivery confirmed* → pod releases | Yes |

**Retry after an abort:** the used OTP is burned. Generate a **new** code (wait
out the 60-second button cooldown if needed) and start again. The vault re-arms
cleanly — no reset needed.

## 6. View the evidence

- **Camera Feed** (`/camera`) — all capture sessions tagged by vault. Frames are
  normally shot every ~3 seconds while a delivery is in progress and stop when
  the vault returns to idle. Open a session to view/download the sequence.
- **Activity Logs** (`/logs`) — full history: deliveries, aborts, OTP
  verifications, lockouts, resets. Use this to see exactly what happened for any
  vault at any time.

## 7. Good to know

- **Fail-safe by design:** power loss, WiFi loss, or a device crash always leaves
  every door locked and every cash pod closed. A reboot snaps the pods back to
  locked — it can never open a pod.
- **The keypad camera keeps recording** while the rider is at the screen and only
  stops when it returns to the idle welcome screen (≤15 s after the last key
  press).
- If the vault ever shows a message you don't understand, the **Help** page in
  the app and the Activity Logs are the first places to check.