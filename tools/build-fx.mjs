/* 재주 아이콘과 몇몇 물건을 **한 장으로 굽는다** → public/art/fx.png
 *
 * 원본: Pixel-Boy & AAA "Ninja Adventure" 팩 (CC0).
 *
 * ⚠ 이펙트 시트에서 **가장 꽉 찬 장**을 고른다. 처음에 가운데 장을 골랐더니
 *   흩어진 불티만 남은 장이 걸려 재주 칸에서 무슨 그림인지 안 읽혔다
 *   (돌진·전장의 함성이 점 몇 개로 나왔다). 칠해진 픽셀 수로 고른다.
 * ⚠ 고른 뒤 **투명한 여백을 깎고 칸에 맞게 정수배로 키운다.** 이펙트는 화면에
 *   크게 터지라고 그린 것이라 가운데만 차 있다 — 그대로 쓰면 아이콘이 콩알만 하다.
 * ⚠ 장 크기는 **시트 높이**다. 가로가 높이로 안 나눠떨어지는 시트가 있어
 *   나머지는 버린다(그 자리는 빈 칸이다).
 *
 * 쓰기: node tools/build-fx.mjs <Ninja 팩 경로>
 */
import fs from "fs";
import path from "path";
import { readPNG, writePNG } from "./pack-art.mjs";

const SRC = process.argv[2];
if (!SRC) { console.error("Ninja 팩 경로를 달라"); process.exit(1); }

const FX = {
  /* ⚠ 아무 시트나 쓰면 안 된다. skill-check 가 아이콘을 두 가지로 잰다 —
   *   **거의 비었는가**(칠해진 점)와 **색이 두 가지뿐인가**. 처음 고른 것 중
   *   넷이 두 색짜리였고 둘은 거의 비어 있었다. 아래는 색 3가지 이상 ·
   *   칠해진 점 190 이상인 것들만 골랐다(tools 로 44장을 재서 뽑았다). */
  s_cleave:    "FX/Attack/Claw/SpriteSheet.png",
  s_whirl:     "FX/Attack/CircularSlash/SpriteSheet.png",
  s_backstab:  "FX/Attack/ClawDouble/SpriteSheet.png",
  s_dash:      "FX/Attack/SlashDoubleCurved/SpriteSheet.png",
  s_knives:    "FX/Projectile/Kunai/SpriteSheet.png",
  s_throw:     "FX/Projectile/Shuriken/SpriteSheet.png",
  s_bash:      "FX/Elemental/RockSpike/SpriteSheet.png",
  s_stomp:     "FX/Elemental/Rock/SpriteSheet.png",
  s_nova:      "FX/Elemental/Explosion/SpriteSheet.png",
  s_burn:      "FX/Elemental/Flam/SpriteSheet.png",
  s_frost:     "FX/Elemental/Ice/SpriteSheetB.png",
  s_lightning: "FX/Elemental/Thunder/SpriteSheet.png",
  s_venom:     "FX/Elemental/Plant/SpriteSheet.png",
  s_smoke:     "FX/Elemental/WaterPillar/SpriteSheet.png",
  s_guard:     "FX/Magic/Shield/SpriteSheetBlue.png",
  s_ward:      "FX/Magic/Shield/SpriteSheetYellow.png",
  s_provoke:   "FX/Magic/Circle/SpriteSheetSpark.png",
  s_shout:     "FX/Magic/Aura/SpriteSheet.png"
};
/* 통째로 쓰는 낱장 */
const WHOLE = {
  scroll:   "Items/Scroll/Scroll.png",
  t_anvil:  "Items/Tool/Anvil.png",
  eq_magic: "Items/Resource/GemGreen.png",
  eq_rare:  "Items/Resource/GemPurple.png",
  eq_relic: "Items/Resource/GemYellow.png",
  /* 구역 장식 — 도서관의 장부, 바닥의 이끼와 물웅덩이, 마을의 장작 */
  p_books:  "Items/Object/Book.png",
  p_papers: "Items/Scroll/ScrollEmpty.png",
  p_moss:   "Items/Resource/Grass.png",
  p_puddle: "Items/Resource/Water.png",
  t_logs:   "Items/Resource/Branch.png"
};


/* 타일셋에서 칸 단위로 오려 온다 — [파일, col, row, 몇 칸 너비, 몇 칸 높이].
 *
 * ⚠ **불빛은 여기 없다.** 횃불 · 등불 · 화덕 · 심연의 문은 게임에서 프레임이
 *   돌아간다(frame-check 가 t_fire 0,1,2 · t_lamp 0,1 로 확인한다). 타일셋의
 *   정지 그림으로 바꾸면 그 흔들림이 죽는다 — 횃불로 밝히는 던전에서 불이
 *   멈추면 바로 티가 난다. 움직이지 않는 것만 가져온다.
 *
 * ⚠ 칸 좌표는 눈으로 골랐다. tools 로 타일셋을 눈금과 함께 키워 보고 짚었고,
 *   구운 뒤 한 줄로 늘어놓고 다시 확인했다. 바꿀 때도 그렇게 할 것. */
const CELL = 16;
const CROP = {
  /* 마을 시설 (TilesetElement) */
  blacksmith: ["Backgrounds/Tilesets/TilesetElement.png", 12, 0, 1, 1],
  t_stall:    ["Backgrounds/Tilesets/TilesetElement.png",  7, 2, 1, 1],
  t_cart:     ["Backgrounds/Tilesets/TilesetElement.png",  0, 3, 2, 2],
  t_sign:     ["Backgrounds/Tilesets/TilesetElement.png",  5, 2, 1, 1],
  t_dummy:    ["Backgrounds/Tilesets/TilesetElement.png", 15, 0, 1, 1],
  t_bench:    ["Backgrounds/Tilesets/TilesetElement.png",  5, 6, 1, 1],
  altar:      ["Backgrounds/Tilesets/TilesetElement.png",  3, 2, 1, 1],
  p_grave:    ["Backgrounds/Tilesets/TilesetElement.png",  4, 2, 1, 1],

  /* 구역 장식 · 나무 (TilesetNature) */
  t_tree:     ["Backgrounds/Tilesets/TilesetNature.png",   0, 2, 2, 3],
  p_deadtree: ["Backgrounds/Tilesets/TilesetNature.png",   0, 5, 2, 3],
  t_bush:     ["Backgrounds/Tilesets/TilesetNature.png",   0, 10, 1, 1],

  /* 사람 — 넉 장짜리 걸음 시트의 첫 장(앞을 본다) */
  merchant:   ["Actor/Character/Villager/SpriteSheet.png", 0, 0, 1, 1],

  /* 펫 — 걸음 시트의 첫 장 */
  pet_cat:    ["Actor/Animal/CatOrange/SpriteSheet.png",    0, 0, 1, 1],
  pet_hound:  ["Actor/Animal/DogBlack/SpriteSheet.png",     0, 0, 1, 1],
  pet_slime:  ["Actor/Monster/Slime/Slime.png",       0, 0, 1, 1]
};

const items = [];
for (const [name, rel] of Object.entries(FX)) {
  const f = path.join(SRC, rel);
  if (!fs.existsSync(f)) { console.log("  ✘ 없다 " + rel); continue; }
  const img = readPNG(f);
  const fw = img.h, n = Math.floor(img.w / fw);
  if (n < 1) { console.log("  ✘ 장을 못 쪼갠다 " + rel); continue; }
  let best = 0, bestInk = -1;
  for (let k = 0; k < n; k++) {
    let ink = 0;
    for (let yy = 0; yy < img.h; yy++)
      for (let xx = 0; xx < fw; xx++)
        if (img.rgba[((yy * img.w) + k * fw + xx) * 4 + 3] > 40) ink++;
    if (ink > bestInk) { bestInk = ink; best = k; }
  }
  items.push({ name, img, sx: best * fw, sy: 0, w: fw, h: img.h });
}
for (const [name, spec] of Object.entries(CROP)) {
  const p = path.join(SRC, spec[0]);
  if (!fs.existsSync(p)) { console.log("  X 없다 " + spec[0]); continue; }
  const img = readPNG(p);
  items.push({ name, img, sx: spec[1] * CELL, sy: spec[2] * CELL,
               w: spec[3] * CELL, h: spec[4] * CELL });
}
for (const [name, rel] of Object.entries(WHOLE)) {
  const f = path.join(SRC, rel);
  if (!fs.existsSync(f)) { console.log("  ✘ 없다 " + rel); continue; }
  const img = readPNG(f);
  items.push({ name, img, sx: 0, sy: 0, w: img.w, h: img.h });
}

/* 투명한 테두리를 깎고, 재주 칸(32px)에 맞게 정수배로 키운다 */
const FIT = 30;
for (const it of items) {
  let x0 = it.w, y0 = it.h, x1 = -1, y1 = -1;
  for (let yy = 0; yy < it.h; yy++) for (let xx = 0; xx < it.w; xx++)
    if (it.img.rgba[(((it.sy + yy) * it.img.w) + it.sx + xx) * 4 + 3] > 20) {
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
      if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
    }
  if (x1 < 0) continue;                       /* 통째로 비었다 — 그대로 둔다 */
  it.sx += x0; it.sy += y0; it.w = x1 - x0 + 1; it.h = y1 - y0 + 1;
  const k = Math.max(1, Math.floor(FIT / Math.max(it.w, it.h)));
  if (k > 1) {                                 /* 정수배만 — 도트가 고르게 */
    const nw = it.w * k, nh = it.h * k, buf = Buffer.alloc(nw * nh * 4);
    for (let yy = 0; yy < nh; yy++) for (let xx = 0; xx < nw; xx++) {
      const s2 = (((it.sy + ((yy / k) | 0)) * it.img.w) + it.sx + ((xx / k) | 0)) * 4;
      const d2 = (yy * nw + xx) * 4;
      buf[d2] = it.img.rgba[s2]; buf[d2 + 1] = it.img.rgba[s2 + 1];
      buf[d2 + 2] = it.img.rgba[s2 + 2]; buf[d2 + 3] = it.img.rgba[s2 + 3];
    }
    it.img = { w: nw, h: nh, rgba: buf }; it.sx = 0; it.sy = 0; it.w = nw; it.h = nh;
  }
}

/* 줄 단위로 눕힌다 — 가로 한계를 정해 놓고 넘치면 다음 줄 */
const MAXW = 256, PAD = 1;
let x = 0, y = 0, rowH = 0, W = 0;
for (const it of items) {
  if (x + it.w > MAXW) { x = 0; y += rowH + PAD; rowH = 0; }
  it.dx = x; it.dy = y; x += it.w + PAD; rowH = Math.max(rowH, it.h); W = Math.max(W, x);
}
const H = y + rowH;
const out = Buffer.alloc(W * H * 4);
for (const it of items) {
  for (let ry = 0; ry < it.h; ry++) {
    for (let rx = 0; rx < it.w; rx++) {
      const s = ((it.sy + ry) * it.img.w + (it.sx + rx)) * 4;
      const d = ((it.dy + ry) * W + (it.dx + rx)) * 4;
      out[d] = it.img.rgba[s]; out[d + 1] = it.img.rgba[s + 1];
      out[d + 2] = it.img.rgba[s + 2]; out[d + 3] = it.img.rgba[s + 3];
    }
  }
}
fs.mkdirSync("public/art", { recursive: true });
writePNG("public/art/fx.png", W, H, out);
const table = {};
for (const it of items) table[it.name] = [[it.dx, it.dy, it.w, it.h]];
fs.writeFileSync("tools/.fx-table.json", JSON.stringify(table));
console.log("fx.png " + W + "×" + H + " · " + items.length + "칸 · " + fs.statSync("public/art/fx.png").size + "B");
