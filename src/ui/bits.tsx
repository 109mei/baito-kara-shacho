// 小さな部品。絵はすべてコード（SVG）。
import type { ReactNode } from 'react';

export const yen = (n: number) => `${n < 0 ? '−' : ''}¥${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`;
export const clockText = (hour: number) => `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;

const ICONS: Record<string, ReactNode> = {
  map: <path d="M9 4 3 6.500v13.500l6-2.500 6 2.500 6-2.500V4l-6 2.500zM9 4v13.500M15 6.500V20" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  sound: <path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500zM15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11" />,
  mute: <path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500zM16 9.500l5 5M21 9.500l-5 5" />,
  door: <path d="M6 20V4h9v16M4 20h16M12.500 12h.010" />,
  car: <path d="M4 15v-3l2-5h12l2 5v3M4 15h16v3h-3v-1.500H7V18H4zM7.500 12h.010M16.500 12h.010" />,
  aim: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 12h.010M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  eye: <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  flag: <path d="M6 21V4M6 5h11l-2 3.500 2 3.500H6" />,
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}
