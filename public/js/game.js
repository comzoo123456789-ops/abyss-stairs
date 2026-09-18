/* 게임 상태와 규칙 — 턴 진행 · 전투 · 아이템 · 층 이동 · 직업 능력.
 *
 * 화면(render.js)은 이 객체를 읽기만 한다. 규칙은 전부 여기에 있다.
 * 턴 원칙: 플레이어가 "한 번 행동" 하면 그때 몬스터가 전부 한 번 움직인다.
 *          그래서 아무리 오래 생각해도 손해가 없다 — 이게 턴제 로그라이크의 핵심이다.
 */
(function (global) {
  "use strict";

  var D = global.DUNGEON;
  var DATA = global.DATA;

  var MAP_W = 62, MAP_H = 38;
  var FOV_RADIUS = 8;

  /* ⚠ 이동은 4방향이다(화살표만). 그래서 **근접 판정도 4방향**이어야 한다.
   *   체비쇼프 거리(대각 포함)로 두면 플레이어는 대각에 있는 적을 때릴 수 없는데
   *   적은 대각에서 때린다 — 일방적으로 맞는다. 인접은 맨해튼 거리 1 이다.
   *   범위 효과(화염·폭발)는 그대로 대각을 포함한다 — 그건 '폭발' 이라 자연스럽다. */
  var STEPS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  function adjacent(ax, ay, bx, by) {
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  }
  global.STEPS = STEPS;

  /* 소리는 없어도 게임이 돌아야 한다 — 파일을 안 읽었을 때를 대비해 감싼다. */
  function sfx(name) { if (global.SFX) global.SFX.play(name); }

  /* 한국어 조사 — 받침이 있으면 앞엣것, 없으면 뒤엣것.
   *   josa("고블린", "을", "를") → "고블린을"   ·  josa("쥐", "을", "를") → "쥐를"
   *
   * ⚠ "이름 + ' 을(를) 주웠다'" 로 두면 "굶주린 쥐 을(를) 주웠다" 처럼 나온다.
   *   띄어쓰기도 틀리고 괄호도 그대로 보인다 — 실측 화면에서 바로 눈에 걸렸다. */
  function josa(word, withBatchim, without) {
    var s = String(word);
    var c = s.charCodeAt(s.length - 1);
    var has;
    if (c >= 0xac00 && c <= 0xd7a3) {
      has = (c - 0xac00) % 28 !== 0;             /* 종성 인덱스가 0 이면 받침 없음 */
    } else if (c >= 0x30 && c <= 0x39) {
      /* 숫자는 읽는 소리로 가른다 — 0(영) 1(일) 3(삼) 6(육) 7(칠) 8(팔) 이 받침 있다 */
      has = "013678".indexOf(s[s.length - 1]) >= 0;
    } else {
      has = true;                                /* 영문·기호는 있는 쪽으로 (더 안 어색하다) */
    }
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
    this.traps = 0;

    var cls = DATA.byId(DATA.CLASSES, classId || "warrior") || DATA.CLASSES[0];
    this.cls = cls;

    this.player = {
      x: 0, y: 0,
      name: cls.name,
      cls: cls.id,
      sprite: cls.sprite,
      hp: cls.hp, maxhp: cls.hp,
      atk: cls.atk, def: cls.def,
      level: 1, xp: 0,
      weapon: null, armor: null,
      inventory: [],
      cooldown: 0                 /* 직업 능력이 다시 준비되기까지 남은 턴 */
    };

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
    for (var n = 0; n < DATA.ITEMS.length; n++) {
      if (DATA.ITEMS[n].kind === "potion") {
        this.potionLook[DATA.ITEMS[n].id] = looks[k % looks.length];
        k++;
      }
    }

    this.say("어두운 계단을 내려간다. 던전 " + DATA.MAX_DEPTH + "층 아래에 심연의 군주가 있다.");
    this.descend();

    /* 시작 장비는 첫 층이 만들어진 뒤에 준다 */
    for (var s = 0; s < cls.start.length; s++) {
      var def = DATA.byId(DATA.ITEMS, cls.start[s]);
      if (!def) continue;
      var it = this.makeItem(def, 0, 0);
      this.player.inventory.push(it);
      if (it.kind === "weapon" || it.kind === "armor") this.equip(it, true);
    }
    this.say(cls.name + " — 능력 「" + cls.ability.name + "」 는 Q 키. " + cls.ability.desc, "level");
  };

  Game.prototype.say = function (text, tone) {
    this.log.push({ text: text, tone: tone || "", turn: this.turn });
    if (this.log.length > 200) this.log.shift();
  };

  /* ── 아이템 이름: 미식별 물약은 겉모습으로 부른다 ────── */

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

  /* ── 층 ─────────────────────────────────────────────── */

  Game.prototype.descend = function () {
    this.depth += 1;
    var levelSeed = (this.seed + this.depth * 2654435761) >>> 0;
    var lv = D.generate(MAP_W, MAP_H, this.depth, levelSeed);
    this.level = lv;
    this.monsters = [];
    this.items = [];

    this.player.x = lv.upAt.x;
    this.player.y = lv.upAt.y;

    var self = this;
    function taken(x, y) {
      if (self.player.x === x && self.player.y === y) return true;
      for (var i = 0; i < self.monsters.length; i++)
        if (self.monsters[i].x === x && self.monsters[i].y === y) return true;
      for (var j = 0; j < self.items.length; j++)
        if (self.items[j].x === x && self.items[j].y === y) return true;
      return false;
    }
    /* 보물방 안은 일반 생성에서 비워 둔다 — 따로 채운다 */
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
      /* 마지막 층 — 보스는 계단(= 가장 먼 방)에 세운다 */
      def = DATA.byId(DATA.MONSTERS, "lord");
      this.monsters.push(this.spawn(def, lv.downAt.x, lv.downAt.y));
      this.say("공기가 무겁다. 이 층에 군주가 있다.", "bad");
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
      def = DATA.pick(DATA.ITEMS, this.depth, this.rng);
      if (!def) continue;
      spot = freeSpot(null);
      if (!spot) continue;
      this.items.push(this.makeItem(def, spot.x, spot.y));
    }

    /* 보물방 채우기 — 아이템을 몰아 두고 지키는 적을 붙인다.
     * 지키는 적이 없으면 그냥 공짜라 '보물' 이 아니다. */
    if (lv.treasure) {
      var tr = lv.treasure, placed = 0, guards = 0, tries = 0;
      while ((placed < DATA.TREASURE_ITEMS || guards < DATA.TREASURE_GUARDS) && tries++ < 300) {
        var tx = tr.x + Math.floor(this.rng() * tr.w);
        var ty = tr.y + Math.floor(this.rng() * tr.h);
        if (lv.at(tx, ty) !== D.FLOOR || taken(tx, ty)) continue;
        if (placed < DATA.TREASURE_ITEMS) {
          /* 보물방은 두 층 더 깊은 표에서 뽑는다 — 그래야 들어갈 값이 있다 */
          def = DATA.pick(DATA.ITEMS, this.depth + 2, this.rng);
          if (def) { this.items.push(this.makeItem(def, tx, ty)); placed++; }
        } else {
          def = DATA.pick(DATA.MONSTERS, this.depth + 1, this.rng);
          if (def) { var gd = this.spawn(def, tx, ty); gd.awake = true; this.monsters.push(gd); guards++; }
        }
      }
    }

    /* 함정 — 숨겨 둔다. 계단 바로 옆은 피한다(내려오자마자 밟으면 억울하다) */
    var tcount = DATA.trapCount(this.depth);
    for (i = 0; i < tcount; i++) {
      spot = D.randomFloor(lv, this.rng, taken, this.player);
      if (!spot) continue;
      if (Math.abs(spot.x - lv.downAt.x) + Math.abs(spot.y - lv.downAt.y) < 3) continue;
      lv.traps[lv.idx(spot.x, spot.y)] = 1;
    }

    this.updateFov();
    this.say("던전 " + this.depth + "층.", "depth");
    if (lv.treasure) this.say("문으로 둘러싸인 방이 있다 — 보물이다. 지키는 놈도 있다.", "item");
  };

  /* ⚠ 정의는 `src` 에 담는다. 전에 `def` 로 뒀더니 방어력 필드와 이름이 겹쳐
   *   뒤엣것이 이겨 `m.def` 가 숫자가 됐고, `m.def.xp` 가 undefined →
   *   경험치가 NaN 이 되어 레벨업이 영영 안 됐다(문법 오류가 아니라 조용히 틀렸다). */
  Game.prototype.spawn = function (def, x, y) {
    return {
      src: def, id: def.id, name: def.name, sprite: def.sprite,
      x: x, y: y,
      hp: def.hp, maxhp: def.hp,
      atk: def.atk, def: def.def,
      awake: false, boss: !!def.boss
    };
  };

  Game.prototype.makeItem = function (def, x, y) {
    var it = {
      src: def, id: def.id, name: def.name, sprite: def.sprite,
      kind: def.kind, power: def.power, effect: def.effect,
      desc: def.desc, x: x, y: y
    };
    if (def.kind === "gold") {
      it.amount = Math.round((10 + Math.floor(this.rng() * 20 * this.depth)) * this.cls.goldBoost);
      it.name = "금화 " + it.amount;
    }
    return it;
  };

  Game.prototype.updateFov = function () {
    D.computeFov(this.level, this.player.x, this.player.y, FOV_RADIUS);
    /* 도적은 발밑과 바로 옆의 함정을 알아챈다 — 그게 이 직업의 성격이다 */
    if (this.cls.id === "rogue") {
      var lv = this.level;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var x = this.player.x + dx, y = this.player.y + dy;
          if (!lv.inside(x, y)) continue;
          var id = lv.idx(x, y);
          if (lv.traps[id] === 1) {
            lv.traps[id] = 2;
            this.say("쇠붙이 냄새가 난다 — 함정을 찾았다.", "warn");
          }
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

  /* ── 능력치 ─────────────────────────────────────────── */

  Game.prototype.power = function () {
    return this.player.atk + (this.player.weapon ? this.player.weapon.power : 0);
  };
  Game.prototype.guard = function () {
    return this.player.def + (this.player.armor ? this.player.armor.power : 0);
  };

  /* ── 플레이어 행동 ──────────────────────────────────── */

  /* 모든 행동은 여기를 통과한다 — 턴을 소모했으면 true 를 돌려주고,
   * 그때만 몬스터가 움직인다. 인벤토리를 열어 보는 것 같은 건 턴이 아니다. */
  Game.prototype.act = function (spent) {
    if (!spent || this.over) return false;
    this.turn += 1;
    if (this.player.cooldown > 0) this.player.cooldown -= 1;
    this.monsterTurn();
    this.updateFov();
    return true;
  };

  Game.prototype.move = function (dx, dy) {
    if (this.over) return false;
    var nx = this.player.x + dx, ny = this.player.y + dy;
    if (!this.level.inside(nx, ny)) return false;

    var m = this.monsterAt(nx, ny);
    if (m) { this.attack(this.player, m); return this.act(true); }

    if (this.level.blocked(nx, ny)) return false;

    this.player.x = nx;
    this.player.y = ny;
    this.springTrap(nx, ny);
    if (this.over) return true;

    /* 밟은 자리에 뭐가 있으면 알려 준다 — 매번 눌러 확인하게 두면 피곤하다 */
    var it = this.itemAt(nx, ny);
    if (it) this.say(josa(this.itemName(it), "이", "가") + " 발 밑에 있다. (Space 로 줍기)", "item");
    if (this.level.at(nx, ny) === D.STAIRS) this.say("아래로 내려가는 계단이다. (Enter 로 내려가기)", "depth");

    return this.act(true);
  };

  /* 함정 — 밟으면 터지고 그 자리에 드러난 채 남는다(두 번은 안 당한다). */
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
    this.traps += 1;
    this.say("가시 함정을 밟았다. " + dmg + " 피해.", "bad");
    sfx("trap");
    if (this.player.hp <= 0) { this.player.hp = 0; this.die("함정에 걸려 쓰러졌다."); }
    return true;
  };

  Game.prototype.wait = function () {
    return this.act(true);
  };

  Game.prototype.descendIfStairs = function () {
    if (this.over) return false;
    if (this.level.at(this.player.x, this.player.y) !== D.STAIRS) {
      this.say("여기엔 계단이 없다.", "warn");
      sfx("deny");
      return false;
    }
    if (this.depth >= DATA.MAX_DEPTH) {
      this.say("더 아래는 없다. 군주를 쓰러뜨려야 한다.", "warn");
      sfx("deny");
      return false;
    }
    sfx("stairs");
    this.descend();
    return this.act(true);
  };

  Game.prototype.pickUp = function () {
    if (this.over) return false;
    var it = this.itemAt(this.player.x, this.player.y);
    if (!it) { this.say("주울 것이 없다.", "warn"); sfx("deny"); return false; }

    this.items.splice(this.items.indexOf(it), 1);

    if (it.kind === "gold") {
      this.gold += it.amount;
      this.say(josa("금화 " + it.amount, "을", "를") + " 주웠다.", "good");
      sfx("gold");
      return this.act(true);
    }

    if (this.player.inventory.length >= 16) {
      this.items.push(it);
      this.say("가방이 가득 찼다.", "warn");
      sfx("deny");
      return false;
    }

    this.player.inventory.push(it);
    this.say(josa(this.itemName(it), "을", "를") + " 주웠다.", "item");
    sfx("pickup");

    /* 장비는 더 좋으면 바로 입는다 — 매번 인벤토리를 열게 하면 손이 아프다 */
    if (it.kind === "weapon" && (!this.player.weapon || it.power > this.player.weapon.power)) {
      this.equip(it);
    } else if (it.kind === "armor" && (!this.player.armor || it.power > this.player.armor.power)) {
      this.equip(it);
    }

    return this.act(true);
  };

  Game.prototype.equip = function (it, quiet) {
    if (it.kind === "weapon") {
      this.player.weapon = it;
      if (!quiet) this.say(josa(it.name, "을", "를") + " 들었다. 공격력 " + this.power(), "good");
    } else if (it.kind === "armor") {
      this.player.armor = it;
      if (!quiet) this.say(josa(it.name, "을", "를") + " 입었다. 방어력 " + this.guard(), "good");
    }
  };

  Game.prototype.useItem = function (index) {
    if (this.over) return false;
    var it = this.player.inventory[index];
    if (!it) return false;

    if (it.kind === "weapon" || it.kind === "armor") {
      var already = (it === this.player.weapon) || (it === this.player.armor);
      if (already) { this.say("이미 착용 중이다.", "warn"); sfx("deny"); return false; }
      this.equip(it);
      return this.act(true);
    }

    var p = this.player, hit, i, m;
    var shown = this.itemName(it);
    var boost = (it.kind === "scroll") ? this.cls.scrollBoost : 1;

    /* 마시는 순간 정체가 드러난다 — 그게 미식별의 거래다 */
    if (it.kind === "potion" && !this.identified[it.id]) {
      this.identified[it.id] = true;
      this.say(shown + "의 정체는 " + it.name + "이었다.", "level");
    }

    if (it.effect === "heal") {
      var before = p.hp;
      p.hp = Math.min(p.maxhp, p.hp + it.power);
      this.say(josa(it.name, "을", "를") + " 마셨다. 체력 +" + (p.hp - before), "good");
      sfx("potion");

    } else if (it.effect === "might") {
      p.atk += it.power;
      this.say("힘이 솟는다. 공격력 +" + it.power, "good");
      sfx("potion");

    } else if (it.effect === "vigor") {
      p.maxhp += it.power;
      p.hp += it.power;
      this.say("몸이 단단해진다. 최대 체력 +" + it.power, "good");
      sfx("potion");

    } else if (it.effect === "venom") {
      var v = it.power + this.depth * 2;
      p.hp -= v;
      this.say("독이다. " + v + " 피해.", "bad");
      sfx("bad");
      if (p.hp <= 0) {
        p.hp = 0;
        this.player.inventory.splice(index, 1);
        this.die("독을 삼키고 쓰러졌다.");
        return true;
      }

    } else if (it.effect === "fire") {
      var fpow = Math.round(it.power * boost);
      hit = 0;
      for (i = this.monsters.length - 1; i >= 0; i--) {
        m = this.monsters[i];
        if (Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 3) {
          this.damage(m, fpow, "화염");
          hit++;
        }
      }
      this.say(hit ? "불길이 " + hit + "체를 덮쳤다." : "불길이 허공에서 꺼졌다.", hit ? "good" : "warn");
      sfx(hit ? "ability" : "deny");

    } else if (it.effect === "bolt") {
      var target = this.nearestVisible();
      if (!target) { this.say("보이는 적이 없다. 두루마리를 도로 넣었다.", "warn"); sfx("deny"); return false; }
      this.damage(target, Math.round(it.power * boost), "번개");
      sfx("ability");

    } else if (it.effect === "blink") {
      var self = this;
      var spot = D.randomFloor(this.level, this.rng, function (x, y) {
        return !!self.monsterAt(x, y);
      }, null);
      if (!spot) { this.say("공간이 뒤틀리지 않는다.", "warn"); sfx("deny"); return false; }
      p.x = spot.x; p.y = spot.y;
      this.say("몸이 어딘가로 튕겨 나갔다.", "good");
      sfx("ability");

    } else if (it.effect === "map") {
      D.revealAll(this.level);
      /* 지도에는 함정도 드러난다 — 그래야 '지도' 다 */
      for (i = 0; i < this.level.traps.length; i++) if (this.level.traps[i] === 1) this.level.traps[i] = 2;
      this.say("이 층의 지형과 함정이 머릿속에 그려졌다.", "good");
      sfx("ability");
    }

    this.player.inventory.splice(index, 1);
    return this.act(true);
  };

  /* 버리기 — 가방 자리를 비우는 수단이다.
   *
   * ⚠ 발 밑에 물건이 있으면 **교환**한다. 전에는 "발 밑에 이미 뭔가 있다" 며 거절했는데,
   *   그게 정확히 막다른 골목이었다: 가방이 꽉 찬 상태로 물건 위에 서 있으면
   *   ① 주울 수 없고(가방이 참) ② 버릴 수도 없다(그 자리에 물건이 있음) —
   *   자리를 비우려고 부른 기능이 그때 안 되는 셈이다.
   *   교환으로 두면 한 칸에 물건이 둘 쌓이는 일도 없다. */
  Game.prototype.dropItem = function (index) {
    if (this.over) return false;
    var it = this.player.inventory[index];
    if (!it) return false;

    var under = this.itemAt(this.player.x, this.player.y);

    if (it === this.player.weapon) this.player.weapon = null;
    if (it === this.player.armor) this.player.armor = null;
    this.player.inventory.splice(index, 1);
    it.x = this.player.x; it.y = this.player.y;
    this.items.push(it);

    if (!under) {
      this.say(josa(this.itemName(it), "을", "를") + " 내려놓았다.");
      sfx("pickup");
      return this.act(true);
    }

    this.items.splice(this.items.indexOf(under), 1);
    if (under.kind === "gold") {
      this.gold += under.amount;
      this.say(josa(this.itemName(it), "을", "를") + " 내려놓고 " + josa(under.name, "을", "를") + " 챘다.", "good");
      sfx("gold");
    } else {
      this.player.inventory.push(under);
      this.say(josa(this.itemName(it), "을", "를") + " 내려놓고 " +
               josa(this.itemName(under), "을", "를") + " 집었다.", "item");
      sfx("pickup");
      if (under.kind === "weapon" && (!this.player.weapon || under.power > this.player.weapon.power)) {
        this.equip(under);
      } else if (under.kind === "armor" && (!this.player.armor || under.power > this.player.armor.power)) {
        this.equip(under);
      }
    }
    return this.act(true);
  };

  /* ── 직업 능력 ──────────────────────────────────────── */

  Game.prototype.nearestVisible = function () {
    var p = this.player, best = null, bestD = 1e9;
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (!this.isVisible(m.x, m.y)) continue;
      var d = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  };

  Game.prototype.useAbility = function () {
    if (this.over) return false;
    var p = this.player, ab = this.cls.ability;
    if (p.cooldown > 0) {
      this.say("「" + ab.name + "」 준비까지 " + p.cooldown + "턴.", "warn");
      sfx("deny");
      return false;
    }

    var i, m, hit = 0, dmg;

    if (ab.kind === "cleave") {
      /* 휩쓸기라 **주위 8칸**을 다 때린다(평타는 4방향이다).
       *
       * ⚠ 이걸 인접 4칸으로 맞췄더니 전사 승률이 21% 로 떨어지고 직업 격차가
       *   41%p 가 됐다 — 전사의 유일한 화력 증폭기가 반토막 나서다.
       *   몸을 한 바퀴 돌려 휘두르는 동작이니 대각을 포함하는 편이 자연스럽고,
       *   4방향 이동에서 전사가 갖는 유일한 우위가 된다. */
      dmg = Math.round(this.power() * ab.power);
      for (i = this.monsters.length - 1; i >= 0; i--) {
        m = this.monsters[i];
        if (Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= ab.range) {
          this.damage(m, this.roll(dmg, m.def), ab.name);
          hit++;
        }
      }
      if (!hit) { this.say("휘둘렀지만 닿는 적이 없다.", "warn"); sfx("deny"); return false; }

    } else if (ab.kind === "throw") {
      m = this.nearestVisible();
      if (!m) { this.say("보이는 적이 없다.", "warn"); sfx("deny"); return false; }
      if (Math.abs(m.x - p.x) + Math.abs(m.y - p.y) > ab.range) {
        this.say("너무 멀다. (사거리 " + ab.range + ")", "warn"); sfx("deny"); return false;
      }
      this.damage(m, this.roll(Math.round(this.power() * ab.power), m.def), ab.name);
      hit = 1;

    } else if (ab.kind === "blast") {
      dmg = 10 + p.level * 6;
      for (i = this.monsters.length - 1; i >= 0; i--) {
        m = this.monsters[i];
        if (Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= ab.range) {
          this.damage(m, dmg, ab.name);
          hit++;
        }
      }
      if (!hit) { this.say("폭발이 허공에서 흩어졌다.", "warn"); sfx("deny"); return false; }
    }

    p.cooldown = ab.cd;
    sfx("ability");
    return this.act(true);
  };

  /* ── 전투 ───────────────────────────────────────────── */

  /* 피해 = (공격력 + 굴림) 을 방어력이 비율로 깎는다. 최소 1.
   *
   * ⚠ 전에는 `공격 − 방어` 였다. 그게 절벽이라 방어가 공격을 넘는 순간 피해가
   *   통째로 1 로 떨어졌다 — 실측에서 레벨당 방어 +1 을 +0.5 로 줄인 것만으로
   *   승률이 72.7% → 11.7% 로 뒤집혔다(밸런스를 잡을 수가 없는 형태다).
   *   비율 감쇄는 방어를 아무리 올려도 완만하게만 줄어 조정이 먹힌다.
   *     방어 0 → 1.00배 · 5 → 0.74배 · 10 → 0.58배 · 18 → 0.44배 */
  Game.prototype.roll = function (atk, def) {
    var swing = Math.floor(this.rng() * (atk / 3 + 1));   /* 공격력의 0~33% */
    var mitigation = 14 / (14 + Math.max(0, def));
    return Math.max(1, Math.round((atk + swing) * mitigation));
  };

  Game.prototype.attack = function (who, target) {
    if (who === this.player) {
      this.damage(target, this.roll(this.power(), target.def), null);
      return;
    }

    /* 도적의 회피 — 완전히 흘린다. 확률이 낮아 "가끔 살아남는" 정도다 */
    if (this.cls.evade > 0 && this.rng() < this.cls.evade) {
      this.say(who.name + "의 공격을 흘려 냈다.", "good");
      return;
    }

    var dmg = this.roll(who.atk, this.guard());
    this.player.hp -= dmg;
    this.say(who.name + "의 공격. " + dmg + " 피해.", "bad");
    sfx("hurt");
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.die(who.name + "에게 쓰러졌다.");
    }
  };

  Game.prototype.damage = function (m, dmg, source) {
    m.hp -= dmg;
    m.awake = true;
    var head = source ? josa(source, "이", "가") + " " : "";
    if (m.hp <= 0) {
      this.say(head + josa(m.name, "을", "를") + " 쓰러뜨렸다. (" + dmg + " 피해)", "good");
      sfx("kill");
      this.kill(m);
    } else {
      this.say(head + m.name + "에게 " + dmg + " 피해. (남은 체력 " + m.hp + ")", "hit");
      sfx("hit");
    }
  };

  Game.prototype.kill = function (m) {
    var i = this.monsters.indexOf(m);
    if (i >= 0) this.monsters.splice(i, 1);
    this.kills += 1;
    this.gainXp(m.src.xp);
    if (m.boss) {
      this.over = true;
      this.won = true;
      this.say("심연의 군주가 무너졌다. 던전은 조용해졌다.", "win");
      sfx("win");
    }
  };

  Game.prototype.gainXp = function (amount) {
    var p = this.player, c = this.cls;
    p.xp += amount;
    var t = DATA.XP_TABLE;
    while (p.level < t.length && p.xp >= t[p.level]) {
      p.level += 1;
      p.maxhp += c.hpPerLevel;
      p.hp = p.maxhp;              /* 레벨업은 완전 회복 — 진격의 보상이다 */
      p.atk += c.atkPerLevel;
      /* ⚠ 방어력은 2레벨마다 1 이다. 매 레벨 +1 로 뒀더니 11레벨에 방어 10,
       *   룬 판금까지 입으면 18 이 되어 트롤(공격 15)조차 최소 피해 1 밖에 못 줬다 —
       *   실측에서 6~9층 사망이 300판 중 0 건이었다(그 구간이 통째로 무의미해진다). */
      if (p.level % 2 === 0) p.def += c.defPerLevel;
      this.say("레벨 " + p.level + " 달성 — 체력이 전부 회복됐다.", "level");
      sfx("level");
    }
  };

  Game.prototype.die = function (reason) {
    this.over = true;
    this.won = false;
    this.say(reason, "bad");
    this.say("여기서 끝이다. 기록은 남지 않는다.", "bad");
    sfx("die");
  };

  /* ── 몬스터 턴 ──────────────────────────────────────── */

  /* 플레이어까지의 거리 지도(흐름장)를 한 턴에 **한 번** 만든다.
   *
   * ⚠ 전에는 몬스터마다 탐욕적으로 한 걸음씩 골랐다. 4방향이 되자 그 방식이
   *   깨졌다 — 두 축이 다 막히면 아무 방향으로나 한 칸 갔다가 다음 턴에 되돌아와
   *   제자리에서 떨었고, 쫓는 플레이어와 거울처럼 오가며 **영원히 안 만났다**
   *   (실측: 두 칸을 6만 턴 왕복, 깨어 있는 해골 1마리를 못 잡음).
   *   거리 지도를 깔면 몬스터는 값이 줄어드는 칸으로만 가므로 그런 순환이 없다.
   *
   * 비용은 턴당 BFS 한 번이다(몬스터 수와 무관). 반경을 잘라 두어 먼 칸은
   * 아예 계산하지 않는다 — 그래서 멀리 있는 놈은 여전히 못 쫓아온다(도망이 통한다). */
  var FLOW_MAX = 20;
  var FLOW_UNREACHED = 65535;

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
      var cur = q[head++];
      var d = this.flow[cur];
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

  Game.prototype.monsterTurn = function () {
    this.buildFlow();
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (m.hp <= 0) continue;
      this.stepMonster(m);
      if (this.over) return;
    }
  };

  Game.prototype.stepMonster = function (m) {
    var p = this.player;
    var dist = Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y));

    /* 플레이어가 볼 수 있으면 상대도 본다 — 대칭이라야 납득이 된다.
     * 한 번 깨어난 놈은 시야를 벗어나도 쫓아온다(도망이 통하지만 공짜는 아니다). */
    if (!m.awake) {
      if (this.isVisible(m.x, m.y) && dist <= 8) m.awake = true;
      else return;
    }

    /* 때리는 것도 4방향이다 — 대각에서 맞으면 되받아칠 방법이 없다 */
    if (adjacent(m.x, m.y, p.x, p.y)) { this.attack(m, p); return; }

    var step = this.stepToward(m);
    if (step) { m.x = step.x; m.y = step.y; }
  };

  /* 거리 지도를 내려가는 한 걸음. **4방향만** 쓴다.
   *
   * ⚠ 몬스터가 대각으로 오면 플레이어(화살표 4방향)는 도망칠 수도 되받아칠 수도 없다.
   *   같은 규칙을 양쪽에 걸어야 한다 — 이동 규칙을 한쪽만 바꾸면 일방적으로 맞는다.
   * ⚠ 값이 **줄어드는 칸만** 고른다. 같거나 커지는 칸을 허용하면 왕복이 생긴다. */
  Game.prototype.stepToward = function (m) {
    var lv = this.level, flow = this.flow;
    if (!flow) return null;
    var here = flow[lv.idx(m.x, m.y)];
    if (here === FLOW_UNREACHED) return null;    /* 너무 멀다 — 못 쫓아온다 */

    var best = null, bestD = here;
    for (var s = 0; s < STEPS.length; s++) {
      var nx = m.x + STEPS[s][0], ny = m.y + STEPS[s][1];
      if (!lv.inside(nx, ny) || lv.blocked(nx, ny)) continue;
      if (this.monsterAt(nx, ny)) continue;
      if (this.player.x === nx && this.player.y === ny) continue;
      var d = flow[ny * lv.w + nx];
      if (d < bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
    return best;
  };

  /* ── 점수 ───────────────────────────────────────────── */

  Game.prototype.score = function () {
    return this.gold + this.player.xp * 2 + this.depth * 100 + (this.won ? 5000 : 0);
  };

  global.Game = Game;
  global.MAP_W = MAP_W;
  global.MAP_H = MAP_H;
})(window);
