export interface ConnectedGamepadInfo {
  index: number;
  id: string;
}

export interface GamepadReportPayload {
  type: 'gamepad';
  slot: number;
  buttonsMask: number;
  lt: number;
  rt: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

// Maps standard W3C Gamepad API buttons -> Win32 XUSB_GAMEPAD bitmask
const W3C_TO_XUSB: Array<[number, number]> = [
  [0, 0x1000],  // A
  [1, 0x2000],  // B
  [2, 0x4000],  // X
  [3, 0x8000],  // Y
  [4, 0x0100],  // LB
  [5, 0x0200],  // RB
  [8, 0x0020],  // Back / View
  [9, 0x0010],  // Start / Menu
  [10, 0x0040], // L3 (Left Thumb)
  [11, 0x0080], // R3 (Right Thumb)
  [12, 0x0001], // D-Pad Up
  [13, 0x0002], // D-Pad Down
  [14, 0x0004], // D-Pad Left
  [15, 0x0008], // D-Pad Right
  [16, 0x0400], // Guide / Xbox
];

function axisToInt16(val: number, invertY = false): number {
  const scaled = (invertY ? -val : val) * 32767;
  // Deadzone snap within +-900 (~2.7%) to prevent micro stick drift packets
  if (Math.abs(scaled) < 900) return 0;
  return Math.max(-32768, Math.min(32767, Math.round(scaled)));
}

export class GamepadBridge {
  private pollTimer: number | null = null;
  private active = false;
  private slot = 0;
  private lastPacketSig = '';
  private lastSentAt = 0;
  private onReport: ((rep: GamepadReportPayload) => void) | null = null;
  private onGamepadsChanged: ((pads: ConnectedGamepadInfo[]) => void) | null = null;
  private lastPadsSig = '';

  constructor(opts?: {
    onReport?: (rep: GamepadReportPayload) => void;
    onGamepadsChanged?: (pads: ConnectedGamepadInfo[]) => void;
  }) {
    this.onReport = opts?.onReport || null;
    this.onGamepadsChanged = opts?.onGamepadsChanged || null;
    window.addEventListener('gamepadconnected', this.handleGamepadHardwareChange);
    window.addEventListener('gamepaddisconnected', this.handleGamepadHardwareChange);
  }

  private handleGamepadHardwareChange = () => {
    const pads = this.getConnectedGamepads();
    const sig = pads.map((p) => `${p.index}:${p.id}`).join('|');
    if (sig !== this.lastPadsSig) {
      this.lastPadsSig = sig;
      this.onGamepadsChanged?.(pads);
    }
  };

  getConnectedGamepads(): ConnectedGamepadInfo[] {
    if (typeof navigator.getGamepads !== 'function') return [];
    const list = navigator.getGamepads();
    const res: ConnectedGamepadInfo[] = [];
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (gp && gp.connected) {
        res.push({ index: gp.index, id: gp.id });
      }
    }
    return res;
  }

  setActive(active: boolean, slot = 0) {
    this.slot = Math.max(0, Math.min(3, slot));
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this.lastPacketSig = '';
      this.pollTimer = window.setInterval(() => this.tick(), 8); // ~125 Hz ultra-low-latency polling
      this.handleGamepadHardwareChange();
    } else if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private tick() {
    if (!this.active || typeof navigator.getGamepads !== 'function') return;
    const list = navigator.getGamepads();
    let activePad: Gamepad | null = null;
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (gp && gp.connected) {
        activePad = gp;
        break;
      }
    }

    if (!activePad) {
      this.handleGamepadHardwareChange();
      return;
    }

    let mask = 0;
    for (const [btnIdx, xusbBit] of W3C_TO_XUSB) {
      const btn = activePad.buttons[btnIdx];
      if (btn && btn.pressed) mask |= xusbBit;
    }
    const lt = Math.max(0, Math.min(255, Math.round((activePad.buttons[6]?.value || 0) * 255)));
    const rt = Math.max(0, Math.min(255, Math.round((activePad.buttons[7]?.value || 0) * 255)));
    const lx = axisToInt16(activePad.axes[0] || 0, false);
    const ly = axisToInt16(activePad.axes[1] || 0, true);
    const rx = axisToInt16(activePad.axes[2] || 0, false);
    const ry = axisToInt16(activePad.axes[3] || 0, true);

    const sig = `${mask}:${lt}:${rt}:${lx}:${ly}:${rx}:${ry}`;
    const now = performance.now();
    const isNeutral = mask === 0 && lt === 0 && rt === 0 && lx === 0 && ly === 0 && rx === 0 && ry === 0;

    if (sig !== this.lastPacketSig || (!isNeutral && now - this.lastSentAt >= 50)) {
      this.lastPacketSig = sig;
      this.lastSentAt = now;
      this.onReport?.({
        type: 'gamepad',
        slot: this.slot,
        buttonsMask: mask,
        lt,
        rt,
        lx,
        ly,
        rx,
        ry,
      });
    }
  }

  playRumble(largeMotorByte: number, smallMotorByte: number) {
    if (typeof navigator.getGamepads !== 'function') return;
    const list = navigator.getGamepads();
    for (let i = 0; i < list.length; i++) {
      const gp = list[i] as (Gamepad & {
        vibrationActuator?: {
          playEffect?: (type: string, params: { startDelay: number; duration: number; weakMagnitude: number; strongMagnitude: number }) => Promise<string>;
        };
      }) | null;
      if (gp && gp.connected && gp.vibrationActuator?.playEffect) {
        gp.vibrationActuator
          .playEffect('dual-rumble', {
            startDelay: 0,
            duration: 180,
            strongMagnitude: Math.max(0, Math.min(1, largeMotorByte / 255)),
            weakMagnitude: Math.max(0, Math.min(1, smallMotorByte / 255)),
          })
          .catch(() => {});
        break;
      }
    }
  }

  destroy() {
    this.setActive(false);
    window.removeEventListener('gamepadconnected', this.handleGamepadHardwareChange);
    window.removeEventListener('gamepaddisconnected', this.handleGamepadHardwareChange);
  }
}
