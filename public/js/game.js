/* 게임 상태와 규칙 — 턴 · 전투(치명타·상태이상) · 장비 · 스킬 · 레벨업 · 상점.
 *
 * 화면(render.js)은 이 객체를 읽기만 한다. 규칙은 전부 여기에 있다.
 * 턴 원칙: 플레이어가 "한 번 행동" 하면 그때 몬스터가 전부 한 번 움직인다.
 *          그래서 아무리 오래 생각해도 손해가 없다 — 이게 턴제 로그라이크의 핵심이다.
 *
 * 빌드 원칙: **정해진 틀이 없다.** 직업은 출발점만 정하고, 레벨업 선택 · 아이템 옵션 ·
 * 상점에서 배운 스킬이 쌓여 각자 다른 캐릭터가 된다. 어떤 조합도 막지 않는다.
 */
(function (global) {
  "use strict";

  var D = global.DUNGEON;
  var DATA = global.DATA;
  var IT = global.ITEMS;

  var MAP_W = 62, MAP_H = 38;
  var FOV_RADIUS = 8;

  /* ⚠ 이동은 4방향이다(화살표만). 그래서 **근접 판정도 4방향**이어야 한다.
   *   체비쇼프 거리(대각 포함)로 두면 플레이어는 대각에 있는 적을 때릴 수 없는데
   *   적은 대각에서 때린다 — 일방적으로 맞는다. 인접은 맨해튼 거리 1 이다.
   *   범위 효과(폭발·지진)는 그대로 대각을 포함한다 — 그건 '폭발' 이라 자연스럽다. */
  var STEPS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  function manhattan(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }
  function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
  global.STEPS = STEPS;

  function sfx(name) { if (global.SFX) global.SFX.play(name); }

  /* 한국어 조사 — 받침이 있으면 앞엣것, 없으면 뒤엣것.
   * ⚠ "이름 + ' 을(를)'" 로 두면 "굶주린 쥐 을(를) 주웠다" 처럼 나온다. */
  function josa(word, withBatchim, without) {
    var s = String(word);
    var c = s.charCodeAt(s.length - 1);
    var has;
    if (c >= 0xac00 && c <= 0xd7a3) has = (c - 0xac00) % 28 !== 0;
    else if (c >= 0x30 && c <= 0x39) has = "013678".indexOf(s[s.length - 1]) >= 0;
    else has = true;
    return s + (has ? withBatchim : without);
  }
  global.josa = josa;

  function Game(classId) {
    this.reset(Math.floor(Math.random() * 0xffffffff), classId);
  }

  Game.prototype.reset = function (seed, classId) {
    this.seed = seed >>> 0;
    this.rng = D.makeRng(this.seed);
    this.depth = 0;
    this.turn = 0;
    this.over = false;
    this.won = false;
    this.log = [];
    this.gold = 0;
    this.kills = 0;
    this.crits = 0;
    this.effects = [];
    this.pendingPerks = null;      /* 레벨업 선택이 열려 있으면 여기에 3개 */
    this.shop = null;              /* 상점 화면이 열려 있으면 목록 */

    var cls = DATA.byId(DATA.CLASSES, classId || "warrior") || DATA.CLASSES[0];
    this.cls = cls;

    this.player = {
      x: 0, y: 0,
      name: cls.name, cls: cls.id, sprite: cls.sprite,
      hp: cls.hp, maxhpBase: cls.hp,
      atkBase: cls.atk, defBase: cls.def,
      level: 1, xp: 0,
      weapon: null, armor: null, offhand: null,
      inventory: [],
      perks: IT.blank(),           /* 레벨업으로 쌓은 것 */
      relics: [],                  /* 규칙을 바꾸는 유물 id 들 */
      bloodHp: 0,                  /* 「피를 먹는 검」 으로 쌓인 최대 체력 */
      skills: [],                  /* {id, rank, cd} */
      ail: {},                     /* {poison:{turns}, ...} */
      ward: 0                      /* 흡수막 남은 양 */
    };

    /* 시작 스킬 */
    this.learn(cls.skill, true);

    /* 물약 겉모습 섞기 — 이 판에서 "붉은 물약" 이 무엇인지는 마셔 봐야 안다.
     * ⚠ 판마다 다시 섞어야 한다. 고정이면 두 번째 판부터 모두가 식별된 셈이다. */
    this.potionLook = {};
    this.identified = {};
    var looks = DATA.POTION_LOOKS.slice();
    for (var i = looks.length - 1; i > 0; i--) {
      var j = Math.floor(this.rng() * (i + 1));
      var t = looks[i]; looks[i] = looks[j]; looks[j] = t;
    }
    var k = 0;
    for (var n = 0; n < DATA.CONSUMABLES.length; n++) {
      if (DATA.CONSUMABLES[n].kind === "potion") {
        this.potionLook[DATA.CONSUMABLES[n].id] = looks[k % looks.length];
        k++;
      }
    }

    this.say("관리소 장부에 층수 칸만 비워 두고 계단을 내려간다. " + DATA.MAX_DEPTH + "층 아래에 군주가 있다.");
    this.descend();

    /* 시작 장비 — 굴리지 않고 일반 등급으로 준다(출발점은 모두 같아야 한다) */
    var w = IT.makeGear("weapon", 1, this.rng,
      { tier: cls.startWeapon.tier, weaponKind: cls.startWeapon.kind, affixes: 0, rarity: DATA.RARITY[0] });
    this.player.inventory.push(w); this.equip(w, true);
    var a = IT.makeGear("armor", 1, this.rng, { tier: cls.startArmor, affixes: 0, rarity: DATA.RARITY[0] });
    this.player.inventory.push(a); this.equip(a, true);
    if (cls.startOffhand) {
      var o = IT.makeGear("offhand", 1, this.rng, { tier: 0, affixes: 0, rarity: DATA.RARITY[0] });
      this.player.inventory.push(o); this.equip(o, true);
    }

    this.say(cls.name + "(" + cls.title + ") — " + cls.why + " 내려왔다.", "level");
    this.say("스킬 「" + DATA.byId(DATA.SKILLS, cls.skill).name + "」 는 Q 키.", "level");
  };

  Game.prototype.say = function (text, tone) {
    this.log.push({ text: text, tone: tone || "", turn: this.turn });
    if (this.log.length > 240) this.log.shift();
  };

  /* 화면 효과 신호 — 규칙이 화면에게 "이런 일이 있었다" 고 알리는 통로.
   * ⚠ 공격은 좌표가 안 변해서 렌더러가 알 길이 없다. 목록에 쌓아 두고 렌더러가
   *   비워 간다. 화면이 없어도(검사) 그냥 쌓이고 만다. */
  /* 규칙 → 화면 신호. 여섯 번째 인자로 딸린 값을 넘긴다(피해량 · 무기 종류 · 스킬 id).
   * ⚠ 화면이 없어도(검사·헤드리스) 쌓이고 말 뿐이라 규칙이 안 깨진다. 40개에서
   *   잘라내므로 아무도 안 비워 가도 메모리가 안 는다. */
  Game.prototype.fx = function (type, x, y, dx, dy, opt) {
    var e = { type: type, x: x, y: y, dx: dx || 0, dy: dy || 0 };
    if (opt) for (var k in opt) e[k] = opt[k];
    this.effects.push(e);
    if (this.effects.length > 40) this.effects.shift();
  };

  /* ── 능력치 — 한 곳에서만 계산한다 ───────────────────────
   * ⚠ 화면과 규칙이 각자 더하면 반드시 어긋난다(표시된 공격력과 실제가 다르다). */
  /* ── 유물 ─────────────────────────────────────────────
   *
   * 유물은 **규칙을 바꾼다.** 그래서 stats() 로는 표현되지 않고, 정해진 자리에서
   * hasRelic() 으로 읽힌다. 어디서 읽는지를 여기 모아 둔다 — 흩어 두면 어떤 이상
   * 동작이 어느 유물 때문인지 추적이 안 된다.
   *
   *   r_brush      applyAil      상태이상 지속 ×2
   *   r_blank      attack        치명타 + 체력 25% 이하 → 즉사
   *   r_reverse    attack        체력이 낮을수록 피해 증가
   *   r_hourglass  act           쿨다운 −2/턴
   *   r_scales     kill · stats  금화 ×2 · 최대 체력 −20%
   *   r_bloodblade kill          처치마다 최대 체력 +2
   *   r_thorns     attack        받은 피해의 40% 반사
   *   r_stairs     descend       층마다 체력 30% 회복
   *   r_lordseye   descend       층 전체 공개 + 전부 깨어 있음
   *   r_memory     descend·openShop  물약 식별 · 상인 없음
   */
  Game.prototype.hasRelic = function (id) {
    var r = this.player.relics;
    if (!r) return false;
    for (var i = 0; i < r.length; i++) if (r[i] === id) return true;
    return false;
  };

  Game.prototype.takeRelic = function (id) {
    var def = DATA.byId(DATA.RELICS, id);
    if (!def || this.hasRelic(id)) return false;   /* 같은 유물을 두 번 주지 않는다 */
    if (!this.player.relics) this.player.relics = [];
    this.player.relics.push(id);
    this.say("유물 「" + def.name + "」 — " + def.note, "level");
    /* 지금 층에 바로 듣는 유물은 여기서 한 번 적용한다.
     * ⚠ 안 하면 "주웠는데 아무 일도 없다" 가 되어 다음 층까지 고장으로 느낀다. */
    if (id === "r_lordseye") this.revealLevel();
    if (id === "r_memory") this.identifyAllPotions();
    if (id === "r_scales" && this.player.hp > this.maxhp()) this.player.hp = this.maxhp();
    return true;
  };

  /* 층 전체를 보이게 한다(군주의 눈) */
  /* 층 전체를 보이게 한다(군주의 눈).
   * ⚠ 몬스터를 깨우지 않는다 — 대가는 **감지 범위**로 받는다(stepMonster).
   *   전부 깨우면 물러서서 싸우는 직업에게 그냥 나쁜 유물이 된다(실측 −12.5%p). */
  Game.prototype.revealLevel = function () {
    var lv = this.level;
    for (var i = 0; i < lv.seen.length; i++) lv.seen[i] = 1;
  };

  /* 물약을 전부 식별한다(남의 기억) */
  Game.prototype.identifyAllPotions = function () {
    for (var i = 0; i < DATA.CONSUMABLES.length; i++) this.identified[DATA.CONSUMABLES[i].id] = true;
  };

  Game.prototype.stats = function () {
    var p = this.player, c = this.cls;
    var s = IT.blank();
    IT.addInto(s, c.base);
    IT.addInto(s, p.perks);
    IT.addInto(s, IT.gearStats(p.weapon));
    IT.addInto(s, IT.gearStats(p.armor));
    IT.addInto(s, IT.gearStats(p.offhand));
    /* 레벨 성장 */
    s.atkFlat += p.atkBase + (p.level - 1) * c.atkPerLevel;
    s.defFlat += p.defBase + Math.floor((p.level - 1) / 2) * c.defPerLevel;
    s.hpFlat += p.maxhpBase + (p.level - 1) * c.hpPerLevel;
    /* 장비 자체의 공격력·방어력 */
    if (p.weapon) s.atkFlat += p.weapon.power;
    if (p.armor) s.defFlat += p.armor.power;
    if (p.offhand) s.defFlat += p.offhand.power;
    /* 유물: 탐욕의 저울 — 금화 두 배의 대가로 최대 체력 20% 감소.
     * ⚠ 마지막에 곱한다. 중간에 곱하면 뒤에 더해지는 값이 깎이지 않아 대가가 흐려진다. */
    if (this.hasRelic("r_scales")) s.hpFlat *= 0.8;
    if (!s.critMult) s.critMult = 1.8;
    return s;
  };

  Game.prototype.maxhp = function () { return Math.max(1, Math.round(this.stats().hpFlat)); };
  Game.prototype.power = function () { return Math.max(1, Math.round(this.stats().atkFlat)); };
  Game.prototype.guard = function () { return Math.max(0, Math.round(this.stats().defFlat)); };

  /* ── 아이템 이름 ─────────────────────────────────────── */

  Game.prototype.itemName = function (it) {
    if (it.kind !== "potion" || this.identified[it.id]) return it.name;
    var look = this.potionLook[it.id];
    return look ? look.label : it.name;
  };
  Game.prototype.itemDesc = function (it) {
    if (it.kind !== "potion" || this.identified[it.id]) return it.desc;
    return "무엇인지 모른다. 마셔 봐야 안다.";
  };
  Game.prototype.itemColor = function (it) {
    if (it.kind !== "potion") return null;
    var look = this.potionLook[it.id];
    return look ? look.color : null;
  };
  /* 목록·툴팁이 쓰는 줄들 */
  Game.prototype.itemLines = function (it) {
    if (it.slot) return IT.gearLines(it);
    return [this.itemDesc(it)];
  };

  /* ── 층 ─────────────────────────────────────────────── */

  Game.prototype.descend = function () {
    this.depth += 1;
    var levelSeed = (this.seed + this.depth * 2654435761) >>> 0;
    var lv = D.generate(MAP_W, MAP_H, this.depth, levelSeed);
    this.level = lv;
    this.monsters = [];
    this.items = [];
    this.merchant = null;
    this.shop = null;

    this.player.x = lv.upAt.x;
    this.player.y = lv.upAt.y;

    var self = this;
    function taken(x, y) {
      if (self.player.x === x && self.player.y === y) return true;
      if (self.merchant && self.merchant.x === x && self.merchant.y === y) return true;
      for (var i = 0; i < self.monsters.length; i++)
        if (self.monsters[i].x === x && self.monsters[i].y === y) return true;
      for (var j = 0; j < self.items.length; j++)
        if (self.items[j].x === x && self.items[j].y === y) return true;
      return false;
    }
    function outsideTreasure(x, y) {
      var t = lv.treasure;
      if (!t) return true;
      return !(x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
    }
    function freeSpot(avoid) {
      for (var tries = 0; tries < 60; tries++) {
        var spot = D.randomFloor(lv, self.rng, taken, avoid);
        if (!spot) return null;
        if (outsideTreasure(spot.x, spot.y)) return spot;
      }
      return null;
    }

    var i, spot, def;

    if (this.depth >= DATA.MAX_DEPTH) {
      def = DATA.byId(DATA.MONSTERS, "lord");
      this.monsters.push(this.spawn(def, lv.downAt.x, lv.downAt.y, true));
      this.say("이름들이 웅웅거린다. 이 층에 군주가 있다.", "bad");
    }

    var mcount = DATA.monsterCount(this.depth);
    for (i = 0; i < mcount; i++) {
      def = DATA.pick(DATA.MONSTERS, this.depth, this.rng);
      if (!def) continue;
      spot = freeSpot(this.player);
      if (!spot) continue;
      this.monsters.push(this.spawn(def, spot.x, spot.y));
    }

    var icount = DATA.itemCount(this.depth);
    for (i = 0; i < icount; i++) {
      spot = freeSpot(null);
      if (!spot) continue;
      this.items.push(this.rollFloorItem(spot.x, spot.y, this.depth));
    }

    /* 보물방 — 아이템을 몰아 두고 지키는 적을 붙인다. 두 층 더 깊은 값으로 굴린다. */
    if (lv.treasure) {
      var tr = lv.treasure, placed = 0, guards = 0, tries = 0;
      while ((placed < DATA.TREASURE_ITEMS || guards < DATA.TREASURE_GUARDS) && tries++ < 300) {
        var tx = tr.x + Math.floor(this.rng() * tr.w);
        var ty = tr.y + Math.floor(this.rng() * tr.h);
        if (lv.at(tx, ty) !== D.FLOOR || taken(tx, ty)) continue;
        if (placed < DATA.TREASURE_ITEMS) {
          this.items.push(this.rollFloorItem(tx, ty, this.depth + 2, true));
          placed++;
        } else {
          def = DATA.pick(DATA.MONSTERS, this.depth + 1, this.rng);
          if (def) { var gd = this.spawn(def, tx, ty); gd.awake = true; this.monsters.push(gd); guards++; }
        }
      }
    }

    /* 상인 — 2층마다. 금화가 점수판 숫자로만 남으면 탐험할 이유가 준다.
     * ⚠ 유물 「남의 기억」 은 물약을 전부 식별해 주는 대신 상인을 없앤다 — 그게 대가다. */
    if (DATA.hasShop(this.depth)) {
      spot = freeSpot(null);
      if (spot) {
        this.merchant = { x: spot.x, y: spot.y, stock: this.rollShop(this.depth) };
        this.say("어딘가에서 등불이 흔들린다 — 상인이 있다. 걸어가면 물건을 본다.", "item");
      }
    }

    /* 함정 — 숨겨 둔다. 계단 바로 옆은 피한다(내려오자마자 밟으면 억울하다) */
    var tcount = DATA.trapCount(this.depth);
    for (i = 0; i < tcount; i++) {
      spot = D.randomFloor(lv, this.rng, taken, this.player);
      if (!spot) continue;
      if (manhattan(spot.x, spot.y, lv.downAt.x, lv.downAt.y) < 3) continue;
      lv.traps[lv.idx(spot.x, spot.y)] = 1;
    }

    /* 구역 장식 — 그 층이 어디인지 바닥이 말해 준다.
     * ⚠ 계단·문·함정 칸은 피한다. 장식이 그 위에 깔리면 계단을 못 알아보거나
     *   드러난 함정을 덮어 버린다(덮으면 밟는다 — 규칙은 그대로인데 화면만 거짓말한다).
     * ⚠ 너무 많이 뿌리면 바닥이 시끄러워 몬스터·아이템이 안 보인다. 바닥 칸의 4% 다. */
    var zone = DATA.zoneAt(this.depth);
    if (zone.props && zone.props.length) {
      lv.props.fill(0);
      /* 굴림에서 뺄 횃불을 셈에 넣지 않은 개수 */
      var noTorch = zone.props.length - (zone.props.indexOf("torch") >= 0 ? 1 : 0);
      if (noTorch < 1) noTorch = zone.props.length;
      var floors = 0;
      for (i = 0; i < lv.tiles.length; i++) if (lv.tiles[i] === D.FLOOR) floors++;
      var want = Math.round(floors * 0.04);
      for (i = 0; i < want; i++) {
        spot = D.randomFloor(lv, this.rng, null, null);
        if (!spot) continue;
        var pid = lv.idx(spot.x, spot.y);
        if (lv.tiles[pid] !== D.FLOOR) continue;
        if (lv.traps[pid]) continue;
        if (spot.x === lv.downAt.x && spot.y === lv.downAt.y) continue;
        if (spot.x === lv.upAt.x && spot.y === lv.upAt.y) continue;
        /* ⚠ 횃불은 이 굴림에서 **뺀다.** 위 칸이 벽인 자리에만 놓을 수 있어
         *   여기서 같이 굴리면 대부분 버려진다(실측 층당 1.4개 — 눈에 안 띈다).
         *   아래에서 따로 놓는다. */
        var pick = 1 + Math.floor(this.rng() * noTorch);
        lv.props[pid] = pick;
      }

      /* 벽 횃불 — 따로 놓는다.
       * ⚠ **위 칸이 벽인 자리**에만. 방 한가운데 떠 있으면 벽에 걸린 것으로
       *   안 읽히고 주우러 갈 물건처럼 보인다.
       * ⚠ 서로 너무 붙으면 빛이 겹쳐 한 덩어리가 된다 — 네 칸은 띄운다.
       * ⚠ 층당 목표를 정해 두고 시도 횟수를 넉넉히 준다. 굴림에 맡기면
       *   층마다 0개에서 8개까지 들쭉날쭉해 어떤 층은 아예 깜깜하다. */
      var ti = zone.props.indexOf("torch") + 1;
      if (ti > 0) {
        var placed = [], wantT = 5;
        for (i = 0; i < wantT * 24 && placed.length < wantT; i++) {
          spot = D.randomFloor(lv, this.rng, null, null);
          if (!spot) continue;
          var tid = lv.idx(spot.x, spot.y);
          if (lv.tiles[tid] !== D.FLOOR || lv.props[tid] || lv.traps[tid]) continue;
          if (!lv.blocked(spot.x, spot.y - 1)) continue;
          if (spot.x === lv.downAt.x && spot.y === lv.downAt.y) continue;
          if (spot.x === lv.upAt.x && spot.y === lv.upAt.y) continue;
          var near = false;
          for (var t = 0; t < placed.length; t++) {
            if (Math.abs(placed[t].x - spot.x) + Math.abs(placed[t].y - spot.y) < 5) { near = true; break; }
          }
          if (near) continue;
          lv.props[tid] = ti;
          placed.push({ x: spot.x, y: spot.y });
        }
      }
    }

    /* ── 층에 내려설 때 듣는 유물 ──
     * ⚠ 몬스터·함정·상인을 다 배치한 **뒤**에 둔다. 앞에 두면 군주의 눈이
     *   아직 없는 몬스터를 깨우고, 계단의 기억이 최대 체력이 바뀌기 전 값으로 회복한다. */
    if (this.hasRelic("r_lordseye")) this.revealLevel();
    if (this.hasRelic("r_memory")) this.identifyAllPotions();
    if (this.hasRelic("r_stairs") && this.depth > 1) {
      var back = Math.round(this.maxhp() * 0.3);
      var was = this.player.hp;
      this.player.hp = Math.min(this.maxhp(), this.player.hp + back);
      if (this.player.hp > was) this.say("계단을 밟자 숨이 돌아온다. +" + (this.player.hp - was), "good");
    }

    this.updateFov();
    /* ⚠ 열 층이 전부 "지형이 어제와 다르다" 였다 — 내려가는 느낌이 없었다.
     *   구역에 처음 들어설 때는 그 구역의 문구를, 그다음 층은 짧게. */
    var firstOfZone = (this.depth === zone.from);
    this.say("심연 " + this.depth + "층 · " + zone.name +
             (firstOfZone ? " — " + zone.enter.replace(/^[^.]*. /, "") : ". 지형이 어제와 다르다."), "depth");
    if (lv.treasure) this.say("문으로 둘러싸인 방이 있다 — 먼저 내려간 누군가의 짐이다.", "item");
  };

  /* 바닥에 떨어질 물건 — 장비냐 소모품이냐를 먼저 가른다 */
  Game.prototype.rollFloorItem = function (x, y, depth, rich) {
    var gearChance = rich ? 0.72 : 0.42;
    if (this.rng() < gearChance) {
      var slots = ["weapon", "weapon", "armor", "offhand"];
      var slot = slots[Math.floor(this.rng() * slots.length)];
      var g = IT.makeGear(slot, depth, this.rng);
      g.x = x; g.y = y;
      return g;
    }
    var def = DATA.pick(DATA.CONSUMABLES, depth, this.rng) || DATA.CONSUMABLES[0];
    return this.makeItem(def, x, y);
  };

  Game.prototype.rollShop = function (depth) {
    var stock = [], i;
    /* ⚠ 한때 「남의 기억」 이 값을 1.6배로 올렸다 — 그래도 −14~−20%p 였다.
     *   상점은 빌드를 만드는 자리라 조금만 건드려도 판이 무너진다. 지금은 대가가 없다. */
    var priceMul = 1;
    for (i = 0; i < DATA.SHOP_ITEMS; i++) {
      var it;
      if (this.rng() < 0.62) {
        var slots = ["weapon", "weapon", "armor", "offhand"];
        it = IT.makeGear(slots[Math.floor(this.rng() * slots.length)], depth + 1, this.rng);
      } else {
        var def = DATA.pick(DATA.CONSUMABLES, depth, this.rng) || DATA.CONSUMABLES[0];
        if (def.id === "gold" || def.cost === 0) def = DATA.byId(DATA.CONSUMABLES, "heal_s");
        it = this.makeItem(def, 0, 0);
        it.cost = def.cost;
      }
      stock.push({ what: "item", item: it, cost: Math.round(it.cost * priceMul) });
    }
    /* 유물 — 상인이 하나쯤 갖고 있다. ⚠ 항상 두면 금화만 모아 전부 사게 되어
     *   레벨업에서 고르는 맛이 사라진다. 절반쯤만 둔다. */
    var relicPool = [];
    for (i = 0; i < DATA.RELICS.length; i++) {
      if (!this.hasRelic(DATA.RELICS[i].id)) relicPool.push(DATA.RELICS[i]);
    }
    if (relicPool.length && this.rng() < 0.5) {
      var rel = relicPool[Math.floor(this.rng() * relicPool.length)];
      stock.push({ what: "relic", relic: rel.id, cost: Math.round(rel.cost * priceMul) });
    }

    /* 스킬 — 안 배운 것 먼저, 없으면 단계 올리기 */
    var offered = {};
    for (i = 0; i < DATA.SHOP_SKILLS; i++) {
      var pick = null;
      for (var t = 0; t < 20; t++) {
        var sk = DATA.SKILLS[Math.floor(this.rng() * DATA.SKILLS.length)];
        if (offered[sk.id]) continue;
        var have = this.skillOf(sk.id);
        if (have && have.rank >= DATA.SKILL_MAX_RANK) continue;
        if (!have && this.player.skills.length >= DATA.SKILL_SLOTS) continue;
        pick = sk; break;
      }
      if (!pick) continue;
      offered[pick.id] = 1;
      var cur = this.skillOf(pick.id);
      var rank = cur ? cur.rank + 1 : 1;
      stock.push({ what: "skill", skill: pick.id, rank: rank,
                   cost: Math.round(DATA.skillCost(depth, rank) * priceMul) });
    }
    return stock;
  };

  /* ── 몬스터 ─────────────────────────────────────────── */

  Game.prototype.spawn = function (def, x, y, noElite) {
    /* ⚠ 보스는 층 배수를 **안 받는다.** 보스에도 곱하면 기울기 하나가 "잡몹 난이도" 와
     *   "보스 난이도" 를 동시에 흔들어 조정이 불가능해진다 — 실측에서 기울기를
     *   0.16 → 0.30 으로 올린 것만으로 승률이 95% → 10% 로 떨어졌고, 그 대부분이
     *   보스층 사망이었다. 손잡이 하나에는 한 가지만 달려 있어야 한다.
     *   보스 수치는 data.js 의 lord 항목에서 직접 잡는다. */
    var sc = def.boss ? { hp: 1, atk: 1, def: 1 } : DATA.scaleAt(this.depth);
    var hp = def.hp * sc.hp, atk = def.atk * sc.atk, dfn = def.def * sc.def, xp = def.xp;
    var name = def.name, elite = null;

    if (!noElite && !def.boss && this.rng() < DATA.eliteChance(this.depth)) {
      elite = DATA.ELITES[Math.floor(this.rng() * DATA.ELITES.length)];
      hp *= elite.hp; atk *= elite.atk; xp = Math.round(xp * elite.xp);
      if (elite.def) dfn *= elite.def;
      name = elite.pre + " " + name;
    }
    return {
      src: def, id: def.id, name: name, sprite: def.sprite,
      x: x, y: y,
      hp: Math.round(hp), maxhp: Math.round(hp),
      atk: Math.round(atk), def: Math.round(dfn), xp: xp,
      ailKind: (elite && elite.ail) || def.ail || null,
      elite: elite ? elite.id : null,
      awake: false, boss: !!def.boss,
      /* ── 행동 ────────────────────────────────────────
       * spd     100 이 사람과 같은 속도. 150 이면 두 턴에 세 걸음이다.
       * ranged  이 칸 수 안에서 **보이면 쏜다**. 붙으면 그냥 때린다.
       * timid   체력이 이 비율 밑으로 내려가면 등을 돌린다.
       * summon  {id, every, max} — 몇 턴마다 무엇을 몇 마리까지 부르는가.
       * swing   화면이 그릴 공격 모양(발톱·돌). */
      spd: def.spd || 100, energy: 0,
      ranged: def.ranged || 0,
      timid: def.timid || 0, fleeLeft: def.fleeFor || 5,
      summon: def.summon || null, lastSummon: -999,
      swing: def.swing || "claw",
      ail: {}
    };
  };

  Game.prototype.makeItem = function (def, x, y) {
    var it = {
      src: def, id: def.id, name: def.name, sprite: def.sprite,
      kind: def.kind, power: def.power, effect: def.effect,
      desc: def.desc, cost: def.cost, x: x, y: y
    };
    if (def.kind === "gold") {
      var mul = 1 + this.stats().goldBoost;
      it.amount = Math.round((12 + Math.floor(this.rng() * 22 * this.depth)) * mul);
      it.name = "금화 " + it.amount;
    }
    return it;
  };

  Game.prototype.updateFov = function () {
    D.computeFov(this.level, this.player.x, this.player.y, FOV_RADIUS);
    if (this.cls.trapSense) {
      var lv = this.level;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var x = this.player.x + dx, y = this.player.y + dy;
          if (!lv.inside(x, y)) continue;
          var id = lv.idx(x, y);
          if (lv.traps[id] === 1) { lv.traps[id] = 2; this.say("쇠붙이 냄새가 난다 — 함정을 찾았다.", "warn"); }
        }
      }
    }
  };

  Game.prototype.isVisible = function (x, y) {
    if (!this.level.inside(x, y)) return false;
    return !!this.level.visible[this.level.idx(x, y)];
  };
  Game.prototype.monsterAt = function (x, y) {
    for (var i = 0; i < this.monsters.length; i++)
      if (this.monsters[i].x === x && this.monsters[i].y === y) return this.monsters[i];
    return null;
  };
  Game.prototype.itemAt = function (x, y) {
    for (var i = this.items.length - 1; i >= 0; i--)
      if (this.items[i].x === x && this.items[i].y === y) return this.items[i];
    return null;
  };

  /* ── 스킬 ───────────────────────────────────────────── */

  Game.prototype.skillOf = function (id) {
    for (var i = 0; i < this.player.skills.length; i++)
      if (this.player.skills[i].id === id) return this.player.skills[i];
    return null;
  };

  Game.prototype.learn = function (id, quiet) {
    var have = this.skillOf(id);
    var def = DATA.byId(DATA.SKILLS, id);
    if (!def) return false;
    if (have) {
      if (have.rank >= DATA.SKILL_MAX_RANK) return false;
      have.rank += 1;
      if (!quiet) this.say("「" + def.name + "」 가 " + have.rank + "단계가 됐다.", "level");
      return true;
    }
    if (this.player.skills.length >= DATA.SKILL_SLOTS) return false;
    this.player.skills.push({ id: id, rank: 1, cd: 0 });
    if (!quiet) this.say("「" + def.name + "」 를 배웠다. " + def.desc, "level");
    return true;
  };

  Game.prototype.skillCd = function (s) {
    var def = DATA.byId(DATA.SKILLS, s.id);
    return Math.max(2, DATA.skillCdAt(def, s.rank) - Math.round(this.stats().cdReduce));
  };

  /* ── 행동 ───────────────────────────────────────────── */

  /* 모든 행동은 여기를 통과한다 — 턴을 소모했으면 true 를 돌려주고,
   * 그때만 몬스터가 움직인다. 목록을 열어 보는 것 같은 건 턴이 아니다.
   * ⚠ 레벨업 선택·상점이 열려 있는 동안은 행동을 막는다(뒤에서 몬스터가 때리면 안 된다). */
  Game.prototype.busy = function () { return !!(this.pendingPerks || this.shop); };

  Game.prototype.act = function (spent) {
    if (!spent || this.over) return false;
    this.turn += 1;
    var i, s;
    /* 유물: 깨진 모래시계 — 쿨다운이 턴마다 2씩 줄어든다 */
    var cdStep = this.hasRelic("r_hourglass") ? 2 : 1;
    for (i = 0; i < this.player.skills.length; i++) {
      s = this.player.skills[i];
      if (s.cd > 0) s.cd = Math.max(0, s.cd - cdStep);
    }
    this.tickAil(this.player, true);
    if (this.over) return true;
    for (i = 0; i < this.monsters.length; i++) this.tickAil(this.monsters[i], false);
    this.monsterTurn();
    this.updateFov();
    return true;
  };

  /* 상태이상 — 턴마다 갉아먹는다. 걸어 둔 독이 일하는 것이 빌드의 즐거움이다. */
  Game.prototype.tickAil = function (who, isPlayer) {
    var any = false;
    for (var key in who.ail) {
      var st = who.ail[key];
      if (!st || st.turns <= 0) { delete who.ail[key]; continue; }
      var def = DATA.AILMENTS[key];
      st.turns -= 1;
      if (def.perTurn > 0) {
        var dmg = Math.max(1, Math.round(st.power || def.perTurn));
        who.hp -= dmg;
        any = true;
        if (isPlayer) {
          this.say(def.name + "으로 " + dmg + " 피해.", "bad");
          if (who.hp <= 0) { who.hp = 0; this.die(def.name + "이 몸을 다 태웠다."); return; }
        } else {
          this.fx("hit", who.x, who.y);
          if (who.hp <= 0) { this.say(def.name + "이 " + josa(who.name, "을", "를") + " 끝냈다.", "good"); this.kill(who); return; }
        }
      }
      if (st.turns <= 0) {
        delete who.ail[key];
        if (isPlayer) this.say(def.name + "이 가라앉았다.", "good");
      }
    }
    return any;
  };

  Game.prototype.applyAil = function (target, kind, powerMul) {
    var def = DATA.AILMENTS[kind];
    if (!def) return false;
    var cur = target.ail[kind];
    var power = def.perTurn * (1 + (powerMul || 0));
    /* 유물: 두 번 새기는 붓 — 지속이 두 배. 내가 거는 것만 해당한다
     * (몬스터가 나에게 거는 것까지 늘리면 내 유물이 나를 때린다). */
    var turns = def.turns;
    if (target !== this.player && this.hasRelic("r_brush")) turns *= 2;
    /* 이미 걸려 있으면 turns 를 새로 고치고 더 센 쪽을 남긴다(중첩 대신 갱신) */
    target.ail[kind] = { turns: turns, power: Math.max(power, cur ? cur.power : 0) };
    return true;
  };

  Game.prototype.move = function (dx, dy) {
    if (this.over || this.busy()) return false;
    if (this.player.ail.stun) {
      this.say("몸이 굳어 움직일 수 없다.", "warn");
      return this.act(true);
    }
    var nx = this.player.x + dx, ny = this.player.y + dy;
    if (!this.level.inside(nx, ny)) return false;

    var m = this.monsterAt(nx, ny);
    if (m) { this.attack(this.player, m); return this.act(true); }

    if (this.level.blocked(nx, ny)) return false;

    /* 붙어 있는 적은 **떠나기 전에** 센다. 옮기고 나서 세면 이미 아무도 안 붙어 있다. */
    var foes = this.adjacentFoes(this.player.x, this.player.y);
    this.player.x = nx;
    this.player.y = ny;
    this.opportunity(foes, nx, ny);
    if (this.over) return true;

    /* 상인 칸을 밟으면 상점이 열린다.
     * ⚠ 예전에는 상인이 **길을 막고** 밟으면 턴을 안 쓴 채 상점만 열었다. 그러면
     *   계단 가는 길이 상인을 지나갈 때 열고 닫기를 무한 반복한다(실측: AI 120판 중
     *   65판이 그렇게 갇혔다). 사람에게도 나쁘다 — 지나갈 때마다 창이 뜨는데
     *   비켜 갈 수도 없다. 지금은 **막지 않고**, 밟으면 들어가면서 창이 열린다. */
    if (this.merchant && this.merchant.x === nx && this.merchant.y === ny) {
      this.openShop();
      return this.act(true);
    }
    this.springTrap(nx, ny);
    if (this.over) return true;

    var it = this.itemAt(nx, ny);
    if (it) this.say(josa(this.itemName(it), "이", "가") + " 발 밑에 있다. (Space 로 줍기)", "item");
    if (this.level.at(nx, ny) === D.STAIRS) this.say("아래로 내려가는 계단이다. (Space 로 내려가기)", "depth");

    return this.act(true);
  };

  /* 붙어 있는 적 — 깨어 있고 기절하지 않은 놈만. */
  Game.prototype.adjacentFoes = function (x, y) {
    var out = [];
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (m.hp <= 0 || !m.awake || m.ail.stun) continue;
      if (manhattan(m.x, m.y, x, y) === 1) out.push(m);
    }
    return out;
  };

  /* 기회 공격 — 붙어 있던 적에게서 걸어서 물러나면 한 대 맞는다.
   *
   * ⚠ 이것이 없으면 **쿨다운이 공짜가 된다.** 이동이 4방향이라 대각선에 선 놈은
   *   못 때리고(stepMonster 의 근접 판정이 맨해튼 1 이다), 몬스터의 한 턴은
   *   "때리거나 걷거나" 둘 중 하나다. 그래서 붙은 적 앞에서 위아래로만 오가면
   *   상대는 매 턴 다시 붙는 데에만 턴을 쓰고 영영 못 때린다 —
   *   실측 100턴 동안 **0 피해로 스킬 20번**. tools/kite-check.mjs 가 지킨다.
   * ⚠ 물러나는 것을 막지는 않는다. **값을 매길 뿐이다** — 도망은 여전히 통하고
   *   한 칸마다 한 대를 낸다. 막아 버리면 불리한 싸움을 접을 방법이 사라진다.
   * ⚠ 걸어서 물러날 때만이다. 스킬로 자리를 옮기는 것(돌진)과 층 이동은 move() 를
   *   안 타므로 안 걸린다. 지금 돌진은 **달려드는** 기술이라 도망 수단은 아니다 —
   *   물러서는 스킬이 생기면 그것이 이 규칙의 출구가 된다.
   * ⚠ 4방향에서는 붙은 적 옆에서 **어디로 가든** 맨해튼 2 가 된다. 그래도 조건을
   *   "붙어 있다가 걸었다" 로 적지 않고 거리를 다시 본다 — 나중에 대각선이
   *   생기더라도 이 규칙이 저절로 맞는다. */
  Game.prototype.opportunity = function (foes, nx, ny) {
    for (var i = 0; i < foes.length; i++) {
      var m = foes[i];
      if (m.hp <= 0 || m.ail.stun) continue;
      if (manhattan(m.x, m.y, nx, ny) === 1) continue;   /* 아직 붙어 있으면 아니다 */
      this.attack(m, this.player, josa(m.name, "이", "가") + " 물러서는 틈을 노렸다.");
      if (this.over) return;
    }
  };

  Game.prototype.springTrap = function (x, y) {
    var lv = this.level, id = lv.idx(x, y);
    if (lv.traps[id] !== 1) return false;
    lv.traps[id] = 2;
    if (this.cls.evade > 0 && this.rng() < this.cls.evade) {
      this.say("발밑이 꺼졌지만 몸을 틀어 피했다.", "good");
      sfx("ability");
      return true;
    }
    var dmg = DATA.trapDamage(this.depth);
    this.player.hp -= dmg;
    this.say("가시 함정을 밟았다. " + dmg + " 피해.", "bad");
    this.fx("hit", x, y);
    sfx("trap");
    if (this.player.hp <= 0) { this.player.hp = 0; this.die("함정에 걸려 쓰러졌다."); }
    return true;
  };

  Game.prototype.wait = function () {
    if (this.busy()) return false;
    return this.act(true);
  };

  Game.prototype.descendIfStairs = function () {
    if (this.over || this.busy()) return false;
    if (this.level.at(this.player.x, this.player.y) !== D.STAIRS) {
      this.say("여기엔 계단이 없다.", "warn"); sfx("deny"); return false;
    }
    if (this.depth >= DATA.MAX_DEPTH) {
      this.say("더 아래는 없다. 군주를 쓰러뜨려야 한다.", "warn"); sfx("deny"); return false;
    }
    sfx("stairs");
    this.descend();
    return this.act(true);
  };

  Game.prototype.pickUp = function () {
    if (this.over || this.busy()) return false;
    var it = this.itemAt(this.player.x, this.player.y);
    if (!it) { this.say("주울 것이 없다.", "warn"); sfx("deny"); return false; }

    this.items.splice(this.items.indexOf(it), 1);

    if (it.kind === "gold") {
      this.gold += it.amount;
      this.say(josa("금화 " + it.amount, "을", "를") + " 주웠다.", "good");
      sfx("gold");
      return this.act(true);
    }

    if (this.player.inventory.length >= DATA.BAG_MAX) {
      this.items.push(it);
      this.say("가방이 가득 찼다. (우클릭으로 버리면 교환된다)", "warn");
      sfx("deny");
      return false;
    }

    this.player.inventory.push(it);
    this.say(josa(this.itemName(it), "을", "를") + " 주웠다.", it.slot ? (it.rarity === "common" ? "item" : "level") : "item");
    sfx("pickup");

    /* 장비는 **더 좋을 때만** 자동 착용한다. 옵션까지 비교해야 하므로 점수로 잰다 */
    if (it.slot) {
      var cur = this.player[it.slot];
      if (!cur || this.gearScore(it) > this.gearScore(cur)) this.equip(it);
    }
    return this.act(true);
  };

  /* 장비 비교 점수 — "공격력만 높은 흰 템" 이 "옵션 셋 달린 파란 템" 을 밀어내면 안 된다 */
  Game.prototype.gearScore = function (it) {
    var s = IT.gearStats(it);
    var v = it.power * (it.slot === "weapon" ? 1.0 : 1.4);
    v += s.atkFlat * 1.0 + s.defFlat * 1.4 + s.hpFlat * 0.16;
    v += s.crit * 60 + s.critMult * 22 + s.ailChance * 40 + s.ailPower * 18;
    v += s.skillPower * 34 + s.cdReduce * 14 + s.lifesteal * 60;
    v += s.potionBoost * 10 + s.goldBoost * 6;
    return v;
  };

  Game.prototype.equip = function (it, quiet) {
    if (!it.slot) return;
    var p = this.player;
    var before = p.hp / Math.max(1, this.maxhp());
    p[it.slot] = it;
    /* 최대 체력이 바뀌면 비율을 유지한다 — 안 하면 체력 옵션을 갈 때마다 손해/이득이 난다 */
    p.hp = Math.max(1, Math.min(this.maxhp(), Math.round(this.maxhp() * before)));
    if (!quiet) {
      var lbl = it.slot === "weapon" ? "들었다" : "착용했다";
      this.say(josa(it.name, "을", "를") + " " + lbl + ". 공격 " + this.power() + " · 방어 " + this.guard(),
               it.rarity === "common" ? "good" : "level");
    }
  };

  Game.prototype.useItem = function (index) {
    if (this.over || this.busy()) return false;
    var it = this.player.inventory[index];
    if (!it) return false;

    if (it.slot) {
      if (this.player[it.slot] === it) { this.say("이미 착용 중이다.", "warn"); sfx("deny"); return false; }
      this.equip(it);
      return this.act(true);
    }

    var p = this.player, st = this.stats(), hit, i, m;
    var shown = this.itemName(it);
    var boost = (it.kind === "scroll") ? (this.cls.scrollBoost || 1) : 1;
    var potBoost = 1 + st.potionBoost;

    if (it.kind === "potion" && !this.identified[it.id]) {
      this.identified[it.id] = true;
      this.say(shown + "의 정체는 " + it.name + "이었다.", "level");
    }

    if (it.effect === "heal") {
      var before = p.hp;
      p.hp = Math.min(this.maxhp(), p.hp + Math.round(it.power * potBoost));
      this.say(josa(it.name, "을", "를") + " 마셨다. 체력 +" + (p.hp - before), "good");
      sfx("potion");

    } else if (it.effect === "might") {
      p.perks.atkFlat += it.power;
      this.say("힘이 솟는다. 공격력 +" + it.power, "good"); sfx("potion");

    } else if (it.effect === "vigor") {
      p.perks.hpFlat += it.power;
      p.hp += it.power;
      this.say("몸이 단단해진다. 최대 체력 +" + it.power, "good"); sfx("potion");

    } else if (it.effect === "cure") {
      p.ail = {};
      this.say("속이 가라앉는다. 상태이상이 씻겼다.", "good"); sfx("potion");

    } else if (it.effect === "venom") {
      var v = Math.round((it.power + this.depth * 2) / potBoost);
      p.hp -= v;
      this.say("독이다. " + v + " 피해.", "bad"); sfx("bad");
      if (p.hp <= 0) { p.hp = 0; this.player.inventory.splice(index, 1); this.die("독을 삼키고 쓰러졌다."); return true; }

    } else if (it.effect === "fire") {
      hit = 0;
      var fpow = Math.round(it.power * boost);
      for (i = this.monsters.length - 1; i >= 0; i--) {
        m = this.monsters[i];
        if (cheb(m.x, m.y, p.x, p.y) <= 3) { this.damage(m, fpow, "화염"); hit++; }
      }
      this.say(hit ? "불길이 " + hit + "체를 덮쳤다." : "불길이 허공에서 꺼졌다.", hit ? "good" : "warn");
      this.fx("burst", p.x, p.y);
      sfx(hit ? "ability" : "deny");

    } else if (it.effect === "bolt") {
      var target = this.nearestVisible();
      if (!target) { this.say("보이는 적이 없다. 두루마리를 도로 넣었다.", "warn"); sfx("deny"); return false; }
      this.damage(target, Math.round(it.power * boost), "번개");
      sfx("ability");

    } else if (it.effect === "blink") {
      var self = this;
      var spot = D.randomFloor(this.level, this.rng, function (x, y) { return !!self.monsterAt(x, y); }, null);
      if (!spot) { this.say("공간이 뒤틀리지 않는다.", "warn"); sfx("deny"); return false; }
      p.x = spot.x; p.y = spot.y;
      this.say("몸이 어딘가로 튕겨 나갔다.", "good"); sfx("ability");

    } else if (it.effect === "map") {
      D.revealAll(this.level);
      for (i = 0; i < this.level.traps.length; i++) if (this.level.traps[i] === 1) this.level.traps[i] = 2;
      this.say("이 층의 지형과 함정이 머릿속에 그려졌다.", "good"); sfx("ability");

    } else if (it.effect === "forge") {
      /* 벼림 — 착용 중인 장비 하나에 옵션을 하나 더 붙인다. 빌드를 의도대로 밀 수 있다 */
      var slots = [];
      if (p.weapon) slots.push(p.weapon);
      if (p.armor) slots.push(p.armor);
      if (p.offhand) slots.push(p.offhand);
      if (!slots.length) { this.say("벼릴 장비가 없다.", "warn"); sfx("deny"); return false; }
      var tgt = slots[Math.floor(this.rng() * slots.length)];
      var extra = IT.makeGear(tgt.slot, this.depth, this.rng, { affixes: 1, tier: tgt.tier }).affixes[0];
      if (extra) {
        tgt.affixes.push(extra);
        tgt.name = tgt.name;   /* 이름은 유지 — 갑자기 이름이 바뀌면 다른 물건처럼 보인다 */
        this.say(josa(tgt.name, "이", "가") + " 벼려졌다. " + IT.affixText(extra), "level");
        sfx("level");
      }
    }

    this.player.inventory.splice(index, 1);
    return this.act(true);
  };

  Game.prototype.dropItem = function (index) {
    if (this.over || this.busy()) return false;
    var it = this.player.inventory[index];
    if (!it) return false;
    var under = this.itemAt(this.player.x, this.player.y);

    if (it.slot && this.player[it.slot] === it) this.player[it.slot] = null;
    this.player.inventory.splice(index, 1);
    it.x = this.player.x; it.y = this.player.y;
    this.items.push(it);

    if (!under) {
      this.say(josa(this.itemName(it), "을", "를") + " 내려놓았다.");
      sfx("pickup");
      return this.act(true);
    }
    /* ⚠ 발 밑에 물건이 있으면 **교환**한다. 거절하면 가방이 꽉 찬 채 물건 위에 선
     *   순간 주울 수도 버릴 수도 없는 골목이 생긴다. */
    this.items.splice(this.items.indexOf(under), 1);
    if (under.kind === "gold") {
      this.gold += under.amount;
      this.say(josa(this.itemName(it), "을", "를") + " 내려놓고 " + josa(under.name, "을", "를") + " 챘다.", "good");
      sfx("gold");
    } else {
      this.player.inventory.push(under);
      this.say(josa(this.itemName(it), "을", "를") + " 내려놓고 " + josa(this.itemName(under), "을", "를") + " 집었다.", "item");
      sfx("pickup");
      if (under.slot) {
        var cur = this.player[under.slot];
        if (!cur || this.gearScore(under) > this.gearScore(cur)) this.equip(under);
      }
    }
    return this.act(true);
  };

  /* ── 전투 ───────────────────────────────────────────── */

  /* 피해 = (공격력 + 굴림) 을 방어력이 비율로 깎는다. 최소 1.
   *
   * ⚠ 전에는 `공격 − 방어` 였다. 그게 절벽이라 방어가 공격을 넘는 순간 피해가
   *   통째로 1 로 떨어졌다 — 실측에서 레벨당 방어 +1 을 +0.5 로 줄인 것만으로
   *   승률이 72.7% → 11.7% 로 뒤집혔다(밸런스를 잡을 수가 없는 형태다). */
  Game.prototype.roll = function (atk, def) {
    var swing = Math.floor(this.rng() * (atk / 3 + 1));
    var mitigation = 14 / (14 + Math.max(0, def));
    return Math.max(1, Math.round((atk + swing) * mitigation));
  };

  /* 치명타 — d20 의 20. 같은 전투가 매번 다르게 느껴지는 가장 싼 방법이다.
   * ⚠ 빗나감(명중 판정)은 넣지 않는다. 턴이 귀한 로그라이크에서 헛스윙은
   *   "운이 나빴다" 로만 남고 즐겁지 않다 — 대신 잘 터지는 쪽으로 변주를 준다. */
  Game.prototype.critRoll = function (bonus) {
    var st = this.stats();
    var chance = Math.min(0.95, st.crit * (bonus || 1));
    if (this.rng() >= chance) return null;
    return Math.max(1.1, st.critMult);
  };

  Game.prototype.attack = function (who, target, note) {
    var adx = Math.sign(target.x - who.x), ady = Math.sign(target.y - who.y);
    this.fx("lunge", who.x, who.y, adx, ady);
    /* 무엇으로 때렸는지 — 검은 내리치고 단검은 두 번 긋고 지팡이는 터진다.
     * ⚠ 치명타 여부는 아직 모른다(굴림이 아래에 있다). 화면은 뒤따라오는
     *   crit/hit 신호로 세기를 정한다 — 여기서 굴림을 앞당기면 규칙이 바뀐다. */
    this.fx("swing", target.x, target.y, adx, ady,
            { w: (who === this.player)
                   ? (this.player.weapon ? this.player.weapon.weaponKind : "fist")
                   : (who.swing || "claw") });

    if (who === this.player) {
      var st = this.stats();
      var dmg = this.roll(this.power(), target.def);
      /* 유물: 거꾸로 읽는 장부 — 체력이 낮을수록 세진다(빈사에서 +70%).
       * ⚠ 치명타 배수보다 **먼저** 곱한다. 나중에 곱하면 치명타와 함께 폭증한다. */
      if (this.hasRelic("r_reverse")) {
        var lack = 1 - (this.player.hp / Math.max(1, this.maxhp()));
        dmg = Math.round(dmg * (1 + 0.7 * Math.max(0, Math.min(1, lack))));
      }
      var crit = this.critRoll(1);
      if (crit) { dmg = Math.round(dmg * crit); this.crits += 1; }
      /* 유물: 빈 이름 — 치명타가 터지고 상대가 이미 약하면 그 자리에서 지운다.
       * ⚠ 보스에는 안 통한다. 통하면 10층이 치명타 한 방으로 끝난다. */
      if (crit && !target.boss && this.hasRelic("r_blank") &&
          target.hp <= target.maxhp * 0.25) {
        this.say("「" + target.name + "」 의 이름이 지워졌다.", "crit");
        dmg = target.hp;
      }
      /* 상태이상 — 확률이 있으면 때릴 때 걸린다 */
      var ailed = null;
      if (st.ailChance > 0 && this.rng() < st.ailChance) {
        ailed = this.rng() < 0.5 ? "poison" : "bleed";
        this.applyAil(target, ailed, st.ailPower);
      }
      this.damage(target, dmg, null, crit, ailed);
      /* 생명 흡수 */
      if (st.lifesteal > 0) {
        var back = Math.max(1, Math.round(dmg * st.lifesteal));
        var mx = this.maxhp();
        if (this.player.hp < mx) {
          this.player.hp = Math.min(mx, this.player.hp + back);
          this.fx("heal", this.player.x, this.player.y);
        }
      }
      return;
    }

    /* 도적의 회피 — 완전히 흘린다 */
    if (this.cls.evade > 0 && this.rng() < this.cls.evade) {
      this.say(who.name + "의 공격을 흘려 냈다.", "good");
      return;
    }

    var d = this.roll(who.atk, this.guard());
    /* 방벽이 먼저 깎인다 */
    if (this.player.ward > 0) {
      var absorb = Math.min(this.player.ward, d);
      this.player.ward -= absorb;
      d -= absorb;
      this.fx("ward", this.player.x, this.player.y, 0, 0, { n: absorb });
      this.say("방벽이 " + absorb + " 을 막았다." + (this.player.ward <= 0 ? " 방벽이 깨졌다." : ""), "warn");
    }
    if (d > 0) {
      this.player.hp -= d;
      this.fx("hurt", this.player.x, this.player.y, 0, 0, { n: d });
      this.say((note || (who.name + "의 공격.")) + " " + d + " 피해.", "bad");
      sfx("hurt");
      /* 유물: 가시 갑옷 — 받은 만큼 되돌려 준다.
       * ⚠ 반사로 적이 죽으면 kill() 을 타야 경험치·금화가 들어온다 — damage() 를
       *   그대로 쓴다(직접 hp 를 깎으면 시체만 남고 보상이 사라진다). */
      if (this.hasRelic("r_thorns")) {
        var back = Math.max(1, Math.round(d * 0.3));
        this.damage(who, back, "가시", null, null);
      }
    }
    /* 몬스터가 상태이상을 건다 */
    if (who.ailKind && this.rng() < 0.35) {
      this.applyAil(this.player, who.ailKind, 0);
      this.say(DATA.AILMENTS[who.ailKind].name + "에 걸렸다.", "bad");
    }
    if (this.player.hp <= 0) { this.player.hp = 0; this.die(who.name + "에게 쓰러졌다."); }
  };

  Game.prototype.damage = function (m, dmg, source, crit, ailed) {
    m.hp -= dmg;
    m.awake = true;
    this.fx(crit ? "crit" : "hit", m.x, m.y, 0, 0, { n: dmg, ail: ailed || null });
    var head = source ? josa(source, "이", "가") + " " : "";
    var tail = ailed ? " · " + DATA.AILMENTS[ailed].name : "";

    if (m.hp <= 0) {
      this.say(head + josa(m.name, "을", "를") + " 쓰러뜨렸다. (" +
               (crit ? "치명타 " : "") + dmg + " 피해)" + tail, crit ? "crit" : "good");
      sfx("kill");
      this.kill(m);
    } else {
      this.say(head + m.name + "에게 " + (crit ? "치명타 " : "") + dmg + " 피해. (남은 " + m.hp + ")" + tail,
               crit ? "crit" : "hit");
      sfx(crit ? "ability" : "hit");
    }
  };

  Game.prototype.kill = function (m) {
    var i = this.monsters.indexOf(m);
    if (i >= 0) this.monsters.splice(i, 1);
    this.kills += 1;
    /* 금화를 떨군다 — 상점이 있으니 금화가 곧 힘이다 */
    var g = Math.round((3 + this.depth * 2 + (m.elite ? 30 : 0)) * (1 + this.stats().goldBoost));
    if (this.hasRelic("r_scales")) g *= 2;              /* 유물: 탐욕의 저울 */
    this.gold += g;
    /* 유물: 피를 먹는 검 — 처치마다 최대 체력이 영구히 늘어난다.
     * ⚠ 늘어난 만큼 지금 체력도 함께 올린다. 안 그러면 최대치만 오르고 체감이 없다. */
    /* 유물: 피를 먹는 검 — 처치마다 회복한다.
     * ⚠ 최대 체력을 불리는 방식이었다가 걷어냈다(실측 +36%p → +22%p 로도 과했다).
     *   회복은 최대 체력이 천장이라 저절로 묶인다. */
    if (this.hasRelic("r_bloodblade")) {
      var mx = this.maxhp();
      if (this.player.hp < mx) {
        this.player.hp = Math.min(mx, this.player.hp + 4);
        this.fx("heal", this.player.x, this.player.y);
      }
    }
    this.gainXp(m.xp || m.src.xp);
    if (m.boss) {
      this.over = true;
      this.won = true;
      this.say("군주가 무너졌다. 먹힌 이름들이 한꺼번에 돌아온다 — 당신의 것까지.", "win");
      sfx("win");
    }
  };

  Game.prototype.gainXp = function (amount) {
    var p = this.player, t = DATA.XP_TABLE;
    p.xp += amount;
    while (p.level < t.length && p.xp >= t[p.level]) {
      p.level += 1;
      p.hp = this.maxhp();                  /* 레벨업은 완전 회복 — 진격의 보상이다 */
      this.say("레벨 " + p.level + " 달성 — 체력이 전부 회복됐다.", "level");
      sfx("level");
      this.offerPerks();                    /* 고를 것을 띄운다 */
    }
  };

  /* ── 레벨업 선택 ────────────────────────────────────────
   * 매번 3개를 제시하고 하나를 고른다. 능력치와 스킬이 같은 풀에서 나오므로
   * "세로로 깊게" 와 "가로로 넓게" 가 경쟁한다 — 그게 빌드다. */
  Game.prototype.offerPerks = function () {
    var pool = [], i;
    for (i = 0; i < DATA.PERKS.length; i++) {
      pool.push({ what: "perk", perk: DATA.PERKS[i] });
    }
    for (i = 0; i < DATA.SKILLS.length; i++) {
      var sk = DATA.SKILLS[i], have = this.skillOf(sk.id);
      if (have) {
        if (have.rank < DATA.SKILL_MAX_RANK)
          pool.push({ what: "skillup", skill: sk.id, rank: have.rank + 1 });
      } else if (this.player.skills.length < DATA.SKILL_SLOTS) {
        pool.push({ what: "skillnew", skill: sk.id });
      }
    }
    /* 유물 — 아직 없는 것만. ⚠ 특성·스킬과 같은 통에 넣으면 유물이 10개뿐이라
     *   후반에는 거의 안 나온다. 따로 뽑아 **한 자리를 확률로 내준다**. */
    var relicPool = [];
    for (i = 0; i < DATA.RELICS.length; i++) {
      if (!this.hasRelic(DATA.RELICS[i].id)) relicPool.push(DATA.RELICS[i]);
    }

    /* 셋 뽑기 */
    var out = [];
    if (relicPool.length && this.rng() < DATA.RELIC_CHANCE) {
      var ri = Math.floor(this.rng() * relicPool.length);
      out.push({ what: "relic", relic: relicPool[ri] });
    }
    for (i = out.length; i < 3 && pool.length; i++) {
      var k = Math.floor(this.rng() * pool.length);
      out.push(pool[k]);
      pool.splice(k, 1);
    }
    /* 이미 열려 있으면 뒤에 쌓는다(레벨이 두 번 오를 수 있다) */
    if (this.pendingPerks) this.pendingQueue = (this.pendingQueue || []).concat([out]);
    else this.pendingPerks = out;
  };

  Game.prototype.choosePerk = function (index) {
    if (!this.pendingPerks) return false;
    var c = this.pendingPerks[index];
    if (!c) return false;
    if (c.what === "perk") {
      this.player.perks[c.perk.stat] = (this.player.perks[c.perk.stat] || 0) + c.perk.amt;
      if (c.perk.stat === "hpFlat") this.player.hp += c.perk.amt;
      this.say("「" + c.perk.label + "」 를 골랐다.", "level");
    } else if (c.what === "relic") {
      this.takeRelic(c.relic.id);
    } else {
      this.learn(c.skill);
    }
    sfx("level");
    this.pendingPerks = null;
    if (this.pendingQueue && this.pendingQueue.length) this.pendingPerks = this.pendingQueue.shift();
    return true;
  };

  /* ── 상점 ───────────────────────────────────────────── */

  Game.prototype.openShop = function () {
    if (!this.merchant) return false;
    this.shop = this.merchant.stock;
    this.say("상인이 등불을 들어 물건을 비춘다.", "item");
    return true;
  };
  Game.prototype.closeShop = function () { this.shop = null; return true; };

  Game.prototype.buy = function (index) {
    if (!this.shop) return false;
    var row = this.shop[index];
    if (!row || row.sold) return false;
    if (this.gold < row.cost) { this.say("금화가 " + (row.cost - this.gold) + " 부족하다.", "warn"); sfx("deny"); return false; }

    /* ⚠ 유물은 가방을 차지하지 않는다 — 가방 칸을 먹으면 "좋은데 자리가 없어 못 산다"
     *   가 되어 유물의 뜻(규칙을 바꾼다)이 자리 관리 문제로 바뀐다. */
    if (row.what === "relic") {
      this.gold -= row.cost;
      this.takeRelic(row.relic);
      row.sold = true;
      sfx("level");
      return true;
    }

    if (row.what === "skill") {
      var have = this.skillOf(row.skill);
      if (!have && this.player.skills.length >= DATA.SKILL_SLOTS) {
        this.say("스킬 자리가 없다 (" + DATA.SKILL_SLOTS + "개까지).", "warn"); sfx("deny"); return false;
      }
      this.gold -= row.cost;
      this.learn(row.skill);
      row.sold = true;
      sfx("level");
      return true;
    }

    if (this.player.inventory.length >= DATA.BAG_MAX) {
      this.say("가방이 가득 찼다.", "warn"); sfx("deny"); return false;
    }
    this.gold -= row.cost;
    var it = row.item;
    this.player.inventory.push(it);
    row.sold = true;
    this.say(josa(it.name, "을", "를") + " 샀다. (" + row.cost + " 금화)", "level");
    sfx("gold");
    if (it.slot) {
      var cur = this.player[it.slot];
      if (!cur || this.gearScore(it) > this.gearScore(cur)) this.equip(it);
    }
    return true;
  };

  /* 팔기 — 가방을 비우면서 금화가 된다. 안 쓰는 장비가 자원이 된다 */
  Game.prototype.sell = function (index) {
    if (!this.shop) return false;
    var it = this.player.inventory[index];
    if (!it) return false;
    var price = Math.max(4, Math.round((it.cost || 10) * 0.42));
    if (it.slot && this.player[it.slot] === it) this.player[it.slot] = null;
    this.player.inventory.splice(index, 1);
    this.gold += price;
    this.say(josa(it.name, "을", "를") + " 팔았다. (+" + price + " 금화)", "good");
    sfx("gold");
    return true;
  };

  /* ── 스킬 사용 ──────────────────────────────────────── */

  Game.prototype.nearestVisible = function (maxRange) {
    var p = this.player, best = null, bestD = 1e9;
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (!this.isVisible(m.x, m.y)) continue;
      var d = manhattan(m.x, m.y, p.x, p.y);
      if (maxRange && d > maxRange) continue;
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  };
  Game.prototype.farthestVisible = function (maxRange) {
    var p = this.player, best = null, bestD = -1;
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (!this.isVisible(m.x, m.y)) continue;
      var d = manhattan(m.x, m.y, p.x, p.y);
      if (maxRange && d > maxRange) continue;
      if (d > bestD) { bestD = d; best = m; }
    }
    return best;
  };

  Game.prototype.useSkill = function (slot) {
    if (this.over || this.busy()) return false;
    var p = this.player, s = p.skills[slot];
    if (!s) return false;
    var def = DATA.byId(DATA.SKILLS, s.id);
    if (s.cd > 0) {
      this.say("「" + def.name + "」 준비까지 " + s.cd + "턴.", "warn"); sfx("deny"); return false;
    }

    var st = this.stats();
    var mul = DATA.skillPowerAt(def, s.rank) * (1 + st.skillPower);
    var base = Math.round(this.power() * mul);
    var hit = 0, i, m, dmg, crit;
    var self = this;

    function strike(target, amount, bonusCrit) {
      crit = self.critRoll(bonusCrit || 1);
      var v = crit ? Math.round(amount * crit) : amount;
      if (crit) self.crits += 1;
      var ailed = null;
      if (st.ailChance > 0 && self.rng() < st.ailChance) {
        ailed = self.rng() < 0.5 ? "poison" : "bleed";
        self.applyAil(target, ailed, st.ailPower);
      }
      self.damage(target, v, def.name, crit, ailed);
      return v;
    }

    if (def.kind === "cleave") {
      /* 휩쓸기라 **주위 8칸**을 다 때린다(평타는 4방향이다).
       * ⚠ 이걸 인접 4칸으로 맞췄더니 전사 승률이 21% 로 떨어지고 격차가 41%p 가 됐다. */
      for (i = this.monsters.length - 1; i >= 0; i--) {
        m = this.monsters[i];
        if (cheb(m.x, m.y, p.x, p.y) <= 1) { strike(m, this.roll(base, m.def)); hit++; }
      }
      if (!hit) { this.say("휘둘렀지만 닿는 적이 없다.", "warn"); sfx("deny"); return false; }

    } else if (def.kind === "throw" || def.kind === "drain") {
      m = this.nearestVisible(def.range);
      if (!m) { this.say("사거리 안에 적이 없다. (" + def.range + "칸)", "warn"); sfx("deny"); return false; }
      dmg = strike(m, this.roll(base, m.def));
      if (def.kind === "drain") {
        var mx = this.maxhp();
        p.hp = Math.min(mx, p.hp + Math.round(dmg * 0.7));
        this.fx("heal", p.x, p.y);
        this.say("빨아들인 만큼 몸이 데워진다.", "good");
      }
      hit = 1;

    } else if (def.kind === "snipe") {
      m = this.farthestVisible(def.range);
      if (!m) { this.say("사거리 안에 적이 없다. (" + def.range + "칸)", "warn"); sfx("deny"); return false; }
      strike(m, this.roll(base, m.def), 2);      /* 치명타 확률 2배 */
      hit = 1;

    } else if (def.kind === "blast" || def.kind === "quake") {
      var flat = DATA.skillFlatAt(def, s.rank, p.level);
      for (i = this.monsters.length - 1; i >= 0; i--) {
        m = this.monsters[i];
        if (cheb(m.x, m.y, p.x, p.y) <= def.range) {
          strike(m, flat ? Math.round(flat * (1 + st.skillPower)) : this.roll(base, m.def));
          if (def.kind === "quake") this.applyAil(m, "stun", 0);
          hit++;
        }
      }
      this.fx("burst", p.x, p.y);
      if (!hit) { this.say("허공에서 흩어졌다.", "warn"); sfx("deny"); return false; }

    } else if (def.kind === "ail") {
      for (i = 0; i < this.monsters.length; i++) {
        m = this.monsters[i];
        if (cheb(m.x, m.y, p.x, p.y) <= def.range) { this.applyAil(m, def.ail, st.ailPower); hit++; }
      }
      this.fx("burst", p.x, p.y);
      if (!hit) { this.say("닿는 적이 없다.", "warn"); sfx("deny"); return false; }
      this.say(hit + "체에 " + DATA.AILMENTS[def.ail].name + "을 걸었다.", "good");

    } else if (def.kind === "charge") {
      m = this.nearestVisible(def.range);
      if (!m) { this.say("달려들 적이 없다.", "warn"); sfx("deny"); return false; }
      /* 적 옆 빈 칸으로 이동한 뒤 때린다 */
      for (var d2 = 0; d2 < STEPS.length; d2++) {
        var nx = m.x + STEPS[d2][0], ny = m.y + STEPS[d2][1];
        if (this.level.inside(nx, ny) && !this.level.blocked(nx, ny) && !this.monsterAt(nx, ny)) {
          p.x = nx; p.y = ny; break;
        }
      }
      strike(m, this.roll(base, m.def));
      this.applyAil(m, "stun", 0);
      hit = 1;

    } else if (def.kind === "heal") {
      var mxh = this.maxhp();
      var amt = Math.round(mxh * DATA.skillPowerAt(def, s.rank) * (1 + st.potionBoost));
      p.hp = Math.min(mxh, p.hp + amt);
      p.ail = {};
      this.say("응급 처치. 체력 +" + amt + " · 상태이상이 씻겼다.", "good");
      this.fx("heal", p.x, p.y);
      hit = 1;

    } else if (def.kind === "ward") {
      p.ward = Math.round(this.maxhp() * DATA.skillPowerAt(def, s.rank));
      this.say("방벽을 세웠다. " + p.ward + " 을 막는다.", "good");
      this.fx("heal", p.x, p.y);
      hit = 1;
    }

    /* 어떤 스킬이 터졌는지 — 화면이 스킬마다 다른 모션을 낸다.
     * 성공한 갈래만 여기 닿는다(거절은 위에서 전부 return 한다). */
    this.fx("skill", p.x, p.y, 0, 0, { id: def.id, sk: def.kind, range: def.range || 1 });
    s.cd = this.skillCd(s);
    sfx("ability");
    return this.act(true);
  };

  /* 활 — 무기가 원거리면 F 키로 쏜다. 스킬과 별개로 평타를 멀리서 날린다. */
  Game.prototype.shoot = function () {
    if (this.over || this.busy()) return false;
    var w = this.player.weapon;
    if (!w || !w.ranged) { this.say("원거리 무기가 없다. (활이 필요하다)", "warn"); sfx("deny"); return false; }
    var m = this.nearestVisible(w.ranged);
    if (!m) { this.say("사거리 안에 적이 없다. (" + w.ranged + "칸)", "warn"); sfx("deny"); return false; }
    this.fx("lunge", this.player.x, this.player.y,
            Math.sign(m.x - this.player.x), Math.sign(m.y - this.player.y));
    this.fx("bolt", this.player.x, this.player.y, m.x - this.player.x, m.y - this.player.y,
            { kind: "arrow" });
    var st = this.stats();
    var dmg = this.roll(this.power(), m.def);
    var crit = this.critRoll(1);
    if (crit) { dmg = Math.round(dmg * crit); this.crits += 1; }
    var ailed = null;
    if (st.ailChance > 0 && this.rng() < st.ailChance) {
      ailed = this.rng() < 0.5 ? "poison" : "bleed";
      this.applyAil(m, ailed, st.ailPower);
    }
    this.damage(m, dmg, "화살", crit, ailed);
    return this.act(true);
  };

  Game.prototype.die = function (reason) {
    this.over = true;
    this.won = false;
    this.pendingPerks = null;
    this.shop = null;
    this.say(reason, "bad");
    this.say("장부에는 층수만 적힐 것이다. 이름은 이미 지워졌다.", "bad");
    sfx("die");
  };

  /* ── 몬스터 턴 ──────────────────────────────────────── */

  var FLOW_MAX = 20;
  var FLOW_UNREACHED = 65535;

  /* 플레이어까지의 거리 지도(흐름장)를 한 턴에 **한 번** 만든다.
   * ⚠ 몬스터마다 탐욕적으로 한 걸음 고르는 방식은 4방향에서 깨진다 — 두 축이 다
   *   막히면 되돌아와 제자리에서 떨고, 쫓는 쪽과 거울처럼 오가며 영원히 안 만난다
   *   (실측: 두 칸을 6만 턴 왕복하며 해골 1마리를 못 잡음). */
  Game.prototype.buildFlow = function () {
    var lv = this.level, n = lv.w * lv.h;
    if (!this.flow || this.flow.length !== n) this.flow = new Uint16Array(n);
    this.flow.fill(FLOW_UNREACHED);
    if (!this.flowQ || this.flowQ.length !== n) this.flowQ = new Int32Array(n);
    var q = this.flowQ, head = 0, tail = 0;
    var start = lv.idx(this.player.x, this.player.y);
    this.flow[start] = 0;
    q[tail++] = start;
    while (head < tail) {
      var cur = q[head++], d = this.flow[cur];
      if (d >= FLOW_MAX) continue;
      var cx = cur % lv.w, cy = (cur / lv.w) | 0;
      for (var s = 0; s < STEPS.length; s++) {
        var nx = cx + STEPS[s][0], ny = cy + STEPS[s][1];
        if (!lv.inside(nx, ny) || lv.blocked(nx, ny)) continue;
        var id = ny * lv.w + nx;
        if (this.flow[id] !== FLOW_UNREACHED) continue;
        this.flow[id] = d + 1;
        q[tail++] = id;
      }
    }
  };

  /* 한 턴에 누가 몇 번 움직이는가 — **에너지**로 센다.
   *
   * 턴마다 spd 만큼 쌓고, 100 이 모일 때마다 한 번 움직인다. 사람은 늘 100 이다.
   * spd 150 이면 두 턴에 세 번, spd 70 이면 열 턴에 일곱 번 움직인다.
   *
   * ⚠ 이것이 있어야 **도망이 상대에 따라 달라진다.** 같은 속도끼리는 걸어서 절대
   *   못 떼어놓고(기회 공격이 그래서 필요했다), 빠른 놈에게서는 애초에 못 도망간다.
   * ⚠ 한 턴에 세 번까지만 움직인다. 데이터가 잘못 들어와도 화면이 멈추지 않는다.
   * ⚠ 기절한 놈은 에너지도 안 쌓는다 — 쌓아 두면 풀리는 순간 몰아서 움직인다. */
  var MAX_ACTS = 3;

  Game.prototype.monsterTurn = function () {
    this.buildFlow();
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (m.hp <= 0) continue;
      if (m.ail.stun) continue;                 /* 기절한 놈은 한 턴 쉰다 */
      m.energy += (m.spd || 100);
      var acts = 0;
      while (m.energy >= 100 && acts < MAX_ACTS) {
        m.energy -= 100;
        acts++;
        this.stepMonster(m);
        if (this.over) return;
        if (m.hp <= 0) break;                   /* 가시 갑옷 같은 것에 죽을 수 있다 */
      }
    }
  };

  Game.prototype.stepMonster = function (m) {
    var p = this.player;
    if (!m.awake) {
      /* 유물 「군주의 눈」 의 대가 — 두 배 멀리서 알아챈다 */
      var notice = this.hasRelic("r_lordseye") ? 16 : 8;
      if (this.isVisible(m.x, m.y) && cheb(m.x, m.y, p.x, p.y) <= notice) m.awake = true;
      else return;
    }
    var dist = manhattan(m.x, m.y, p.x, p.y);

    /* 소환 — 부르는 것이 곧 그 턴의 행동이다(부르고 때리면 두 배가 된다) */
    if (m.summon && this.turn - m.lastSummon >= m.summon.every &&
        this.broodOf(m) < m.summon.max && this.summonFor(m)) return;

    /* 도망 — 체력이 바닥나면 등을 돌린다. 몇 걸음만이다.
     *
     * ⚠ **끝이 있어야 한다.** 같은 속도라 걸어서는 절대 못 잡는데 끝없이 달아나면
     *   쫓는 쪽이 영원히 못 끝낸다 — 실측: 시뮬 120판 중 55판이 결판이 안 났다.
     *   사람도 똑같이 겪는다. 다섯 걸음 달아나고 나면 돌아서서 죽을 때까지 문다.
     * ⚠ 구석에 몰렸으면 **그 자리에서** 싸운다. 갈 곳이 없는데 계속 돌아서면
     *   제자리에서 떨기만 하는데, 사람 눈에 제일 먼저 띄는 것이 그 모습이다.
     * ⚠ 그래서 도망은 "못 잡는 상대" 가 아니라 **한 번의 이탈**이다. 쫓을지
     *   보낼지를 고르게 만드는 것이 목적이지 약을 올리는 것이 아니다. */
    if (m.timid && !m.brave && m.hp <= m.maxhp * m.timid) {
      var away = m.fleeLeft > 0 ? this.stepAway(m) : null;
      if (away) {
        if (!m.fleeing) { this.say(josa(m.name, "이", "가") + " 등을 돌렸다.", "warn"); m.fleeing = true; }
        m.fleeLeft -= 1;
        m.x = away.x; m.y = away.y;
        return;
      }
      m.brave = true;                           /* 다 달아났거나 몰렸다 — 이제 문다 */
      if (m.fleeing) { m.fleeing = false; this.say(josa(m.name, "이", "가") + " 돌아섰다.", "bad"); }
    }

    /* 원거리 — 보이는 자리에서 던진다. 붙으면 그냥 때린다.
     * ⚠ 판정을 "플레이어가 그 칸을 보는가" 로 둔다. 내가 보면 저쪽도 본다 —
     *   안 보이는 데서 날아오면 무엇에 맞았는지 알 수가 없다. */
    if (m.ranged && dist > 1 && dist <= m.ranged && this.isVisible(m.x, m.y)) {
      this.fx("bolt", m.x, m.y, p.x - m.x, p.y - m.y, { kind: "stone" });
      this.attack(m, p, josa(m.name, "이", "가") + " 멀리서 던졌다.");
      return;
    }

    if (dist === 1) { this.attack(m, p); return; }
    var step = this.stepToward(m);
    if (step) { m.x = step.x; m.y = step.y; }
  };

  /* 흐름장을 **거슬러** 한 걸음. 값이 커지는 칸이 플레이어에게서 먼 칸이다.
   * ⚠ 흐름장 밖(FLOW_UNREACHED = 65535)은 "여기서 20칸 넘게 멀다" 는 뜻이라
   *   도망 대상으로는 가장 좋은 칸이다. 그대로 크기 비교에 태운다. */
  Game.prototype.stepAway = function (m) {
    var lv = this.level, flow = this.flow;
    if (!flow) return null;
    var here = flow[lv.idx(m.x, m.y)];
    var best = null, bestD = here;
    for (var s = 0; s < STEPS.length; s++) {
      var nx = m.x + STEPS[s][0], ny = m.y + STEPS[s][1];
      if (!lv.inside(nx, ny) || lv.blocked(nx, ny)) continue;
      if (this.monsterAt(nx, ny)) continue;
      if (this.player.x === nx && this.player.y === ny) continue;
      if (this.merchant && this.merchant.x === nx && this.merchant.y === ny) continue;
      var d = flow[ny * lv.w + nx];
      if (d > bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
    return best;
  };

  /* 이 놈이 불러 놓은 것이 지금 몇 마리인가 */
  Game.prototype.broodOf = function (m) {
    var n = 0;
    for (var i = 0; i < this.monsters.length; i++)
      if (this.monsters[i].summonedBy === m && this.monsters[i].hp > 0) n++;
    return n;
  };

  /* 옆 빈 칸에 하나 부른다. 자리가 없으면 안 부른 것으로 친다(턴을 안 쓴다). */
  Game.prototype.summonFor = function (m) {
    var def = DATA.byId(DATA.MONSTERS, m.summon.id);
    if (!def) return false;
    var lv = this.level;
    for (var s = 0; s < STEPS.length; s++) {
      var nx = m.x + STEPS[s][0], ny = m.y + STEPS[s][1];
      if (!lv.inside(nx, ny) || lv.blocked(nx, ny)) continue;
      if (this.monsterAt(nx, ny)) continue;
      if (this.player.x === nx && this.player.y === ny) continue;
      var born = this.spawn(def, nx, ny, true);   /* 불려 나온 것은 엘리트가 아니다 */
      born.awake = true;
      born.summonedBy = m;
      this.monsters.push(born);
      m.lastSummon = this.turn;
      this.say(josa(m.name, "이", "가") + " " + josa(def.name, "을", "를") + " 불러냈다.", "bad");
      this.fx("burst", nx, ny);
      sfx("ability");
      return true;
    }
    return false;
  };

  /* 거리 지도를 내려가는 한 걸음. **값이 줄어드는 칸만** 고른다 —
   * 같거나 커지는 칸을 허용하면 왕복이 생긴다. */
  Game.prototype.stepToward = function (m) {
    var lv = this.level, flow = this.flow;
    if (!flow) return null;
    var here = flow[lv.idx(m.x, m.y)];
    if (here === FLOW_UNREACHED) return null;
    var best = null, bestD = here;
    for (var s = 0; s < STEPS.length; s++) {
      var nx = m.x + STEPS[s][0], ny = m.y + STEPS[s][1];
      if (!lv.inside(nx, ny) || lv.blocked(nx, ny)) continue;
      if (this.monsterAt(nx, ny)) continue;
      if (this.player.x === nx && this.player.y === ny) continue;
      if (this.merchant && this.merchant.x === nx && this.merchant.y === ny) continue;
      var d = flow[ny * lv.w + nx];
      if (d < bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
    return best;
  };

  /* ── 목적지까지의 길 ──────────────────────────────────
   *
   * 칸을 눌러 걸어가기(탭 이동)에 쓴다. 몬스터가 쓰는 흐름장과 **방향이 반대**다 —
   * 그쪽은 "플레이어까지", 이쪽은 "플레이어에서 목적지까지" 라 따로 만든다.
   *
   * ⚠ **한 번이라도 본 칸(seen)만 지나간다.** 안 막으면 아직 못 본 지형을 뚫고
   *   최적 경로로 가 버린다 — 탐험이 통째로 사라지고, 사람이 모르는 길을
   *   캐릭터만 아는 셈이 된다.
   * ⚠ 몬스터가 선 칸은 **지나가지 않는다**(목적지인 경우만 허용). 지나갈 수 있게
   *   두면 길이 막힌 걸 모르고 걸어 들어가 얻어맞는다.
   * ⚠ 함정은 **아는 것만** 피한다(도적이 알아챈 것). 모르는 함정을 피하면
   *   캐릭터가 사람보다 많이 아는 것이 된다. */
  Game.prototype.pathTo = function (tx, ty) {
    var lv = this.level;
    if (!lv.inside(tx, ty) || lv.blocked(tx, ty)) return null;
    if (!lv.seen[lv.idx(tx, ty)]) return null;
    if (tx === this.player.x && ty === this.player.y) return [];

    var n = lv.w * lv.h;
    if (!this.pathPrev || this.pathPrev.length !== n) this.pathPrev = new Int32Array(n);
    var prev = this.pathPrev;
    prev.fill(-1);
    var q = new Int32Array(n), head = 0, tail = 0;
    var start = lv.idx(this.player.x, this.player.y);
    var goal = lv.idx(tx, ty);
    prev[start] = start;
    q[tail++] = start;

    var found = false;
    while (head < tail) {
      var cur = q[head++];
      if (cur === goal) { found = true; break; }
      var cx = cur % lv.w, cy = (cur / lv.w) | 0;
      for (var s = 0; s < STEPS.length; s++) {
        var nx = cx + STEPS[s][0], ny = cy + STEPS[s][1];
        if (!lv.inside(nx, ny) || lv.blocked(nx, ny)) continue;
        var id = ny * lv.w + nx;
        if (prev[id] !== -1) continue;
        if (!lv.seen[id]) continue;
        if (id !== goal) {
          if (this.monsterAt(nx, ny)) continue;
          if (this.merchant && this.merchant.x === nx && this.merchant.y === ny) continue;
          if (lv.traps[id] === 2) continue;                /* 드러난 함정만 피한다(0=없음 1=숨음 2=드러남) */
        }
        prev[id] = cur;
        q[tail++] = id;
      }
    }
    if (!found) return null;

    /* 뒤에서 앞으로 되짚어 뒤집는다 */
    var out = [], cur2 = goal;
    while (cur2 !== start) {
      out.push({ x: cur2 % lv.w, y: (cur2 / lv.w) | 0 });
      cur2 = prev[cur2];
      if (out.length > n) return null;                     /* 있을 수 없는 일 — 무한 방지 */
    }
    out.reverse();
    return out;
  };

  /* 지금 눈에 보이는 몬스터들. 탭 이동이 "새로 나타난 놈" 을 알아채는 데 쓴다. */
  Game.prototype.visibleMonsters = function () {
    var out = [];
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (m.hp > 0 && this.isVisible(m.x, m.y)) out.push(m);
    }
    return out;
  };

  Game.prototype.score = function () {
    return this.gold + this.player.xp * 2 + this.depth * 100 +
           this.crits * 3 + (this.won ? 5000 : 0);
  };

  global.Game = Game;
  global.MAP_W = MAP_W;
  global.MAP_H = MAP_H;
})(window);
