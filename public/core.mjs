export const MAX_DURATION = 7 * 24 * 60 * 60 * 1000;
export function remaining(event, now) {
  if (!event) return 0;
  return Math.max(0, event.status === 'running' ? event.deadline_ms - now : event.remaining_ms);
}
export function digits(ms) {
  const n = Math.max(0, Math.ceil(ms / 1000));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(x => String(x).padStart(2, '0'));
}
export function transition(current, action, input, now) {
  const e = { ...current, revision: current.revision + 1, updated_at: now };
  if (action === 'configure') {
    if (current.status !== 'idle') throw new Error('請先重設賽事，再修改設定。');
    const duration = Number(input.duration_ms);
    if (!Number.isSafeInteger(duration) || duration < 1000 || duration > MAX_DURATION) throw new Error('時間須介於 1 秒與 168 小時之間。');
    const title = String(input.title || '').trim();
    const subtitle = String(input.subtitle || '').trim();
    if (!title || title.length > 80 || subtitle.length > 160) throw new Error('賽事名稱最多 80 字，說明最多 160 字。');
    return { ...e, title, subtitle, duration_ms: duration, remaining_ms: duration, deadline_ms: null };
  }
  if (action === 'start') {
    if (current.status !== 'idle') throw new Error('只有待命賽事可以開始。');
    const deadline = input.deadline_ms == null ? now + current.duration_ms : Number(input.deadline_ms);
    if (!Number.isSafeInteger(deadline) || deadline <= now || deadline - now > MAX_DURATION) throw new Error('截止時間須在未來 168 小時內。');
    return { ...e, status: 'running', deadline_ms: deadline, duration_ms: deadline - now, remaining_ms: deadline - now };
  }
  if (action === 'pause') {
    if (current.status !== 'running' || remaining(current, now) <= 0) throw new Error('目前沒有可暫停的倒數。');
    return { ...e, status: 'paused', remaining_ms: remaining(current, now), deadline_ms: null };
  }
  if (action === 'resume') {
    if (current.status !== 'paused') throw new Error('目前沒有暫停的賽事。');
    return { ...e, status: 'running', deadline_ms: now + current.remaining_ms };
  }
  if (action === 'reset') return { ...e, status: 'idle', deadline_ms: null, remaining_ms: current.duration_ms };
  throw new Error('不支援的操作。');
}
// 使用單調時鐘；使用者修改電腦時間不會改變已校準的倒數。
export class UtcClock {
  constructor(wall = Date.now, mono = () => performance.now()) { this.wall = wall; this.mono = mono; this.anchor = null; }
  calibrate(utcMs, sent, received) {
    const rtt = received - sent;
    if (!Number.isFinite(utcMs) || rtt < 0 || rtt > 10000) throw new Error('校時回應無效。');
    this.anchor = { utc: utcMs + rtt / 2, mono: received };
    this.uncertainty = rtt / 2;
    return this.now() - this.wall();
  }
  restore(offset) { this.anchor = { utc: this.wall() + offset, mono: this.mono() }; }
  now() { return this.anchor ? this.anchor.utc + this.mono() - this.anchor.mono : this.wall(); }
}
