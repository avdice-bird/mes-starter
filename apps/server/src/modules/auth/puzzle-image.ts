import { deflateSync } from 'node:zlib';

/** 滑块拼图尺寸（与前端布局、偏移校验共用一份常量） */
export const WIDTH = 260;
export const HEIGHT = 130;
export const PIECE_SIZE = 44;
export const PIECE_TOP = 42;

type Rgb = [number, number, number];

function rand(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** 最小 PNG 编码器：IHDR(RGBA8) + IDAT(zlib) + IEND，无第三方依赖 */
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngDataUri(width: number, height: number, rgba: Buffer): string {
  return `data:image/png;base64,${encodePng(width, height, rgba).toString('base64')}`;
}

function setPx(buf: Buffer, w: number, h: number, x: number, y: number, r: number, g: number, b: number, a = 255) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = clamp(r);
  buf[i + 1] = clamp(g);
  buf[i + 2] = clamp(b);
  buf[i + 3] = clamp(a);
}

function blendPx(buf: Buffer, w: number, h: number, x: number, y: number, [r, g, b]: Rgb, a: number) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = clamp(buf[i] * (1 - a) + r * a);
  buf[i + 1] = clamp(buf[i + 1] * (1 - a) + g * a);
  buf[i + 2] = clamp(buf[i + 2] * (1 - a) + b * a);
}

/** 随机彩色底图：渐变 + 半透明色块，纯像素，不含任何坐标文本 */
function makeScene(): Buffer {
  const buf = Buffer.alloc(WIDTH * HEIGHT * 4);
  const base: Rgb = [rand(35, 210), rand(35, 210), rand(35, 210)];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const t = y / HEIGHT;
      setPx(buf, WIDTH, HEIGHT, x, y, base[0] + t * 30, base[1] + t * 20, base[2] + t * 40);
    }
  }
  for (let i = 0; i < 18; i += 1) {
    const color: Rgb = [rand(20, 235), rand(20, 235), rand(20, 235)];
    const alpha = rand(45, 140) / 255;
    if (i % 2 === 0) {
      const x0 = rand(0, WIDTH - 40);
      const y0 = rand(0, HEIGHT - 30);
      const rw = rand(20, 60);
      const rh = rand(16, 40);
      for (let y = y0; y < y0 + rh; y += 1) {
        for (let x = x0; x < x0 + rw; x += 1) blendPx(buf, WIDTH, HEIGHT, x, y, color, alpha);
      }
    } else {
      const cx = rand(0, WIDTH);
      const cy = rand(0, HEIGHT);
      const r = rand(8, 26);
      for (let y = cy - r; y <= cy + r; y += 1) {
        for (let x = cx - r; x <= cx + r; x += 1) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) blendPx(buf, WIDTH, HEIGHT, x, y, color, alpha);
        }
      }
    }
  }
  return buf;
}

/** 缺口：压暗 + 带抖动的柔边，位置只体现在像素里，没有规整的亮色矩形可供脚本直接扫描定位 */
function drawNotch(buf: Buffer, tx: number, ty: number) {
  const round = 7;
  for (let y = ty; y < ty + PIECE_SIZE; y += 1) {
    for (let x = tx; x < tx + PIECE_SIZE; x += 1) {
      const dx = x - tx;
      const dy = y - ty;
      // 圆角：四角外侧不画
      const corner =
        (dx < round && dy < round && (dx - round) ** 2 + (dy - round) ** 2 > round ** 2) ||
        (dx >= PIECE_SIZE - round && dy < round && (dx - (PIECE_SIZE - 1 - round)) ** 2 + (dy - round) ** 2 > round ** 2) ||
        (dx < round && dy >= PIECE_SIZE - round && (dx - round) ** 2 + (dy - (PIECE_SIZE - 1 - round)) ** 2 > round ** 2) ||
        (dx >= PIECE_SIZE - round && dy >= PIECE_SIZE - round &&
          (dx - (PIECE_SIZE - 1 - round)) ** 2 + (dy - (PIECE_SIZE - 1 - round)) ** 2 > round ** 2);
      if (corner) continue;
      blendPx(buf, WIDTH, HEIGHT, x, y, [0, 0, 0], 0.42);
    }
  }
  // 柔边：亮度带随机抖动，避免形成纯白等宽直线
  const edge = (x: number, y: number) => {
    const shade = rand(150, 220);
    blendPx(buf, WIDTH, HEIGHT, x, y, [shade, shade, shade], 0.55);
  };
  for (let x = tx; x < tx + PIECE_SIZE; x += 1) {
    edge(x, ty);
    edge(x, ty + 1);
    edge(x, ty + PIECE_SIZE - 1);
    edge(x, ty + PIECE_SIZE - 2);
  }
  for (let y = ty; y < ty + PIECE_SIZE; y += 1) {
    edge(tx, y);
    edge(tx + 1, y);
    edge(tx + PIECE_SIZE - 1, y);
    edge(tx + PIECE_SIZE - 2, y);
  }
}

/** 拼图块：底图在缺口处的裁切，略提亮 + 带抖动的柔边，仍然只是一张位图 */
function makePiece(scene: Buffer, tx: number, ty: number): Buffer {
  const buf = Buffer.alloc(PIECE_SIZE * PIECE_SIZE * 4);
  for (let y = 0; y < PIECE_SIZE; y += 1) {
    for (let x = 0; x < PIECE_SIZE; x += 1) {
      const si = ((ty + y) * WIDTH + (tx + x)) * 4;
      setPx(buf, PIECE_SIZE, PIECE_SIZE, x, y, scene[si] + 10, scene[si + 1] + 10, scene[si + 2] + 10);
    }
  }
  const edge = (x: number, y: number) => {
    const shade = rand(200, 245);
    blendPx(buf, PIECE_SIZE, PIECE_SIZE, x, y, [shade, shade, shade], 0.7);
  };
  for (let x = 0; x < PIECE_SIZE; x += 1) {
    edge(x, 0);
    edge(x, PIECE_SIZE - 1);
  }
  for (let y = 0; y < PIECE_SIZE; y += 1) {
    edge(0, y);
    edge(PIECE_SIZE - 1, y);
  }
  return buf;
}

/**
 * 生成两张不透明 PNG（base64 data URI）。
 * 目标横坐标 target 只作为像素呈现，绝不出现在返回文本里；客户端拿不到可解析的答案。
 */
export function renderPuzzle(target: number): { background: string; piece: string } {
  const scene = makeScene();
  const background = Buffer.from(scene);
  drawNotch(background, target, PIECE_TOP);
  return {
    background: pngDataUri(WIDTH, HEIGHT, background),
    piece: pngDataUri(PIECE_SIZE, PIECE_SIZE, makePiece(scene, target, PIECE_TOP)),
  };
}
