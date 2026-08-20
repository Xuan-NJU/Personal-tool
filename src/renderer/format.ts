const zhWeekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function formatTimer(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours && minutes) return `${hours} 小时 ${minutes} 分钟`;
  if (hours) return `${hours} 小时`;
  if (minutes) return `${minutes} 分钟`;
  return `${seconds} 秒`;
}

export function startOfWeek(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const offset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - offset);
  return next;
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function sameDay(left: Date | number, right: Date | number): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  if (weekStart.getFullYear() !== end.getFullYear()) {
    return `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日 – ${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
  }
  if (weekStart.getMonth() !== end.getMonth()) {
    return `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
  }
  return `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()} – ${end.getDate()}日`;
}

export function formatDayHeader(date: Date): { weekday: string; date: string } {
  return { weekday: zhWeekdays[date.getDay()] ?? '', date: String(date.getDate()) };
}

export function formatClock(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
}

export function formatFullDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

export function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function relativeSyncTime(value?: number): string {
  if (!value) return '尚未同步';
  const diff = Date.now() - value;
  if (diff < 60_000) return '刚刚同步';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前同步`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前同步`;
  return `${Math.floor(diff / 86_400_000)} 天前同步`;
}
