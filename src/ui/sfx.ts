// 音と振動。音はすべてコードで合成する（音声ファイルは使わない）。
// 押した瞬間に鳴らす。設定で切れる。
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

export function setSound(on: boolean) {
  enabled = on;
}

function ac(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOpt { type?: OscillatorType; vol?: number; at?: number; to?: number; attack?: number }
function tone(freq: number, dur: number, o: ToneOpt = {}) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + (o.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const vol = o.vol ?? 0.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + (o.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, from: number, to: number, vol: number, at = 0) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  // ボタン：木をたたくような短い音
  tap() {
    tone(540, 0.05, { type: 'triangle', vol: 0.16, to: 400 });
    noise(0.025, 2400, 1200, 0.05);
  },
  // タブ：少し高く軽い音
  tab() {
    tone(760, 0.045, { type: 'triangle', vol: 0.11, to: 640 });
  },
  accept() {
    tone(660, 0.08, { type: 'triangle', vol: 0.17 });
    tone(990, 0.14, { type: 'triangle', vol: 0.17, at: 0.07 });
  },
  decline() {
    tone(440, 0.09, { type: 'triangle', vol: 0.13, to: 330 });
  },
  // お金が入る：硬貨の2音
  coin(big = false) {
    tone(1318, 0.07, { vol: 0.16 });
    tone(1760, big ? 0.42 : 0.24, { vol: 0.17, at: 0.06 });
    if (big) tone(2637, 0.3, { vol: 0.07, at: 0.12 });
  },
  // 1日が過ぎる：風のような音
  day() {
    noise(0.5, 380, 1700, 0.05);
    tone(196, 0.3, { vol: 0.07, to: 262 });
  },
  // まとめて進めるときの、1日ごとの小さな音
  tick() {
    tone(880, 0.025, { type: 'triangle', vol: 0.05 });
  },
  fail() {
    tone(196, 0.24, { type: 'sawtooth', vol: 0.11, to: 120 });
  },
  hit() {
    tone(880, 0.06, { type: 'triangle', vol: 0.15, to: 1100 });
  },
  miss() {
    tone(220, 0.1, { type: 'triangle', vol: 0.14, to: 170 });
  },
  great() {
    [784, 1047, 1319].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.15, at: i * 0.07 }));
  },
  // 月末の締め：良い月は上がる和音、悪い月は下がる2音
  month(good: boolean) {
    if (good) [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.14, at: i * 0.085 }));
    else [330, 262].forEach((f, i) => tone(f, 0.34, { type: 'triangle', vol: 0.14, at: i * 0.16 }));
  },
};

export function buzz(ms: number) {
  try {
    if (enabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
  } catch {
    /* 振動できない端末では何もしない */
  }
}
