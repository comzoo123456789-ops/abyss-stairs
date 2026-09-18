/* 규칙만 돌리는 검사들이 함께 쓰는 판.
 *
 * ⚠ **두 벌로 두지 말 것.** kite-check 와 mob-check 가 각자 판을 만들면 미세하게
 *   달라지고, 한쪽에서만 재현되는 결과가 나온다. 판을 고칠 일이 있으면 여기만 고친다.
 * ⚠ 화면(DOM)을 안 쓴다. sound.js · sprites* 는 안 올린다 — game.js 가
 *   `if (global.SFX)` 로 감싸 두어 없어도 돈다(그러라고 감쌌다).
 */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JS = path.join(ROOT, "public", "js");

export function loadRules() {
  const win = {};
  const ctx = vm.createContext({ window: win, Math, console, Uint8Array, Uint16Array, Int32Array });
  for (const f of ["data.js", "items.js", "dungeon.js", "game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
  }
  return win;
}

/* 위아래로 오갈 수 있고 오른쪽에 적을 세울 수 있는 빈 자리를 찾는다.
 * runLeft 를 주면 왼쪽으로 그만큼 트인 자리(도망을 재는 통로)를 찾는다.
 * ⚠ 함정 위에서 재면 안 된다 — 재는 도중 함정이 터져 피해가 섞인다. */
export function openSpot(D, lv, runLeft, runRight) {
  const free = (x, y) => lv.inside(x, y) && !lv.blocked(x, y) &&
                         lv.traps[lv.idx(x, y)] === 0 && lv.at(x, y) !== D.STAIRS;
  for (let y = 2; y < lv.h - 2; y++) {
    for (let x = 2; x < lv.w - 2; x++) {
      if (!(free(x, y) && free(x, y - 1) && free(x, y + 1) && free(x + 1, y) &&
            free(x + 1, y - 1) && free(x + 1, y + 1))) continue;
      let run = true;
      for (let k = 1; k <= (runLeft || 0); k++) if (!free(x - k, y)) { run = false; break; }
      for (let k = 1; run && k <= (runRight || 0); k++) if (!free(x + k, y)) { run = false; break; }
      if (run) return { x: x, y: y };
    }
  }
  return null;
}

/* 적 하나를 세운 판.
 *
 *   opt.mon    몬스터 id (기본 orc)
 *   opt.at     플레이어에게서 몇 칸 떨어뜨릴지 (기본 1 · 오른쪽으로)
 *   opt.runLeft 왼쪽으로 트인 통로가 필요한 만큼
 *   opt.awake  깨운 채로 둘지 (기본 true)
 *   opt.monHp  몬스터 체력 고정 (기본 99999 — 안 죽어야 여러 번 잰다)
 *   opt.depth  층 (기본 그대로)
 *
 * 돌려주는 것에 `swings()` 가 있다. **몬스터가 때린 횟수**다 —
 * 피해 0 만 보면 빗나간 것인지 애초에 안 때린 것인지 갈리지 않는다.
 * ⚠ 가로채는 attack 은 인자를 **전부** 넘겨야 한다. 세 번째(사유 문구)를
 *   빠뜨리면 원거리 공격의 기록이 조용히 달라진다. */
export function makeArena(W, opt) {
  opt = opt || {};
  const { Game, DUNGEON: D, DATA } = W;
  const g = new Game("warrior");
  g.reset(opt.seed === undefined ? 31337 : opt.seed, "warrior");
  if (opt.depth) g.depth = opt.depth;
  const at0 = opt.at === undefined ? 1 : opt.at;
  const spot = openSpot(D, g.level, opt.runLeft, at0);
  if (!spot) return null;
  g.player.x = spot.x; g.player.y = spot.y;
  g.player.hp = g.player.maxhp = opt.playerHp || 99999;   /* 죽으면 act() 가 멈춰 못 잰다 */

  const def = DATA.byId(DATA.MONSTERS, opt.mon || "orc");
  if (!def) return null;
  const m = g.spawn(def, spot.x + at0, spot.y);
  const hp = opt.monHp === undefined ? 99999 : opt.monHp;
  m.hp = m.maxhp = hp;
  m.awake = opt.awake === undefined ? true : !!opt.awake;
  g.monsters = [m];
  g.merchant = null;
  g.items = [];
  /* ⚠ 플레이어를 손으로 옮겼으면 **시야를 다시 계산해야 한다.** 안 하면
   *   isVisible 이 처음 자리 기준이라 원거리 몬스터가 "안 보인다" 로 판정돼
   *   한 발도 안 쏜다 — 제품이 아니라 판이 틀린 것이다. */
  g.updateFov();

  let swings = 0;
  g.attack = function (...args) {
    if (args[0] !== g.player) swings++;
    return Game.prototype.attack.apply(g, args);
  };
  return { g: g, m: m, def: def, spot: spot, hp0: g.player.hp, swings: () => swings };
}

/* 가만히 있기 — 대조군. 무엇을 재든 "아무것도 안 했을 때" 와 비교해야 뜻이 생긴다. */
export function stand(a, turns) {
  const t0 = a.g.turn;
  for (let i = 0; i < turns && !a.g.over; i++) a.g.wait();
  return a.g.turn - t0;
}
