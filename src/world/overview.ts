// 街ぜんたいの地図を、1枚の絵にする（小さい地図と全体地図で使う）。コードで描く。
import type { City } from '../core/city';
import { BLOCK, LAND, ROAD, WATER } from './MapView';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function drawOverview(city: City, px: number, riverHalf: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const x = cv.getContext('2d')!;
  const k = px / city.size;
  x.fillStyle = hex(LAND);
  x.fillRect(0, 0, px, px);
  for (const b of city.blocks) {
    if (b.d === 'water') continue;
    x.fillStyle = hex(BLOCK[b.d]);
    x.fillRect(b.x0 * k, b.y0 * k, (b.x1 - b.x0) * k + 0.5, (b.y1 - b.y0) * k + 0.5);
  }
  x.fillStyle = hex(WATER);
  x.beginPath();
  x.moveTo(0, 0);
  for (let y = 0; y <= city.size; y += 80) x.lineTo(city.coast(y) * k, y * k);
  x.lineTo(0, px);
  x.fill();
  x.beginPath();
  for (let y = 0; y <= city.size; y += 60) x.lineTo((city.river(y) - riverHalf) * k, y * k);
  for (let y = city.size; y >= 0; y -= 60) x.lineTo((city.river(y) + riverHalf) * k, y * k);
  x.fill();
  const NX = city.xs.length;
  const NY = city.ys.length;
  for (const major of [false, true]) {
    x.strokeStyle = hex(major ? ROAD.major : ROAD.minor);
    x.lineWidth = Math.max(major ? 2.2 : 1, city.half(major) * 2 * k);
    x.beginPath();
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      if (city.h[j * NX + i] && city.h[j * NX + i] >= 2 === major) {
        x.moveTo(city.xs[i] * k, city.ys[j] * k);
        x.lineTo(city.xs[i + 1] * k, city.ys[j] * k);
      }
      if (city.v[j * NX + i] && city.v[j * NX + i] >= 2 === major) {
        x.moveTo(city.xs[i] * k, city.ys[j] * k);
        x.lineTo(city.xs[i] * k, city.ys[j + 1] * k);
      }
    }
    x.stroke();
  }
  return cv;
}
