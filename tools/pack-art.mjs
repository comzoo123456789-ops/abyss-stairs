/* 낱장 그림을 **한 장으로 묶는다** — 아틀라스 굽는 도구.
 *
 * ⚠ 왜 묶는가: 재주 아이콘 18 · 칸 아이콘 8 · 마을 것들을 낱장으로 올리면
 *   첫 화면에서 요청이 서른 번 는다. 시트 한 장이면 한 번이다.
 *
 * ⚠ 외부 라이브러리를 쓰지 않는다(이 저장소는 의존성 0개다). PNG 는 zlib 만
 *   있으면 읽고 쓸 수 있다 — node 에 들어 있다.
 *   읽기는 색 유형 2(RGB) · 3(팔레트) · 6(RGBA) 만 다룬다. 이 팩들은 전부 그 안이다.
 *   ⚠ 인터레이스(Adam7)는 안 다룬다 — 만나면 멈춘다(조용히 깨진 그림을 내느니).
 *
 * 쓰기: node tools/pack-art.mjs  → public/art/fx.png 와 좌표표를 찍는다.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";

/* ── PNG 읽기 ───────────────────────────────────── */
function readPNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG 아님: " + file);
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0, pal = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; inter = d[12];
    } else if (type === "PLTE") pal = d;
    else if (type === "tRNS") trns = d;
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (inter) throw new Error("인터레이스 PNG 는 못 읽는다: " + file);
  if (depth !== 8) throw new Error("8비트만 읽는다(" + depth + "): " + file);
  const ch = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 0 ? 1 : 1;   /* 3=팔레트 index 1바이트 */
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const line = raw.subarray(q, q + stride); q += stride;
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0, x = line[i];
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else {                                  /* Paeth */
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
  }
  /* 무엇이 들어오든 RGBA 로 편다 — 뒤에서 한 가지만 다루면 된다 */
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    let r, g, b, a = 255;
    if (ctype === 6) { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    else if (ctype === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (ctype === 3) { const k = out[i]; r = pal[k * 3]; g = pal[k * 3 + 1]; b = pal[k * 3 + 2]; if (trns && k < trns.length) a = trns[k]; }
    else { r = g = b = out[i]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w, h, rgba };
}

/* ── PNG 쓰기 ───────────────────────────────────── */
function crc32(b) {
  let c, t = crc32.t;
  if (!t) { t = crc32.t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } }
  c = 0xffffffff; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]));
}
export { readPNG, writePNG };
