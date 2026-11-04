// BattleModel.swift の移植（カード・場のポケモン・プレイヤー・デッキ）
(function (G) {
  "use strict";

  // ---------- カードデータ（cards_rt.json） ----------
  var CARDS = {};
  var REG = { def: "I", map: {} };
  G.loadCards = function (json) {
    CARDS = json.cards || {};
    REG.def = json.regulationDefault || "I";
    REG.map = json.regulation || {};
  };
  G.loadCardsFromFile = function (path) {
    var fs = require("fs");
    G.loadCards(JSON.parse(fs.readFileSync(path, "utf8")));
  };
  G.catalog = function (id) { return CARDS[String(id)] || null; };
  G.catalogPokemon = function (id) { var c = CARDS[String(id)]; return c && c.kind === "pokemon" ? c : null; };
  G.catalogTrainer = function (id) { var c = CARDS[String(id)]; return c && c.kind === "trainer" ? c : null; };
  G.allCardIds = function () { return Object.keys(CARDS).map(Number); };

  // ---------- 日本語名 ----------
  var JP_ENERGY = { grass: "草", fire: "炎", water: "水", lightning: "雷", psychic: "超", fighting: "闘", darkness: "悪", metal: "鋼", dragon: "ドラゴン", colorless: "無色" };
  var JP_COND = { poisoned: "どく", burned: "やけど", asleep: "ねむり", paralyzed: "マヒ", confused: "こんらん" };
  G.energyJapaneseName = function (t) { return JP_ENERGY[t] || t; };
  G.conditionJapaneseName = function (c) { return JP_COND[c] || c; };

  // ---------- Slot ----------
  G.ACTIVE = { k: "a" };
  G.bench = function (i) { return { k: "b", i: i }; };
  G.slotEq = function (a, b) {
    if (!a || !b) return a === b;
    return a.k === b.k && (a.k === "a" || a.i === b.i);
  };

  // ---------- BattleCard ----------
  class BattleCard {
    constructor(id, data, energyType, name, imageName) {
      this.id = id; this.data = data; this.energyType = energyType; this.name = name; this.imageName = imageName;
    }
    get pokemonData() { return this.data && this.data.kind === "pokemon" ? this.data : null; }
    get trainerData() { return this.data && this.data.kind === "trainer" ? this.data : null; }
    get isPokemon() { var d = this.pokemonData; return d ? !d.isFossil : false; }
    get isFossil() { var d = this.pokemonData; return !!(d && d.isFossil); }
    get isEnergy() { return this.energyType != null; }
    get isBasicPokemon() { var d = this.pokemonData; return d ? (d.stage === "basic" && !d.isFossil) : false; }
    get isAllTypesEnergy() {
      var t = this.trainerData; if (!t || t.trainerKind !== "specialEnergy") return false;
      return t.effects.some(function (e) { return e.c === "specialEnergyAllTypes"; });
    }
    get isSpecialEnergy() { var t = this.trainerData; return !!(t && t.trainerKind === "specialEnergy"); }
    specialEnergyUnits(evolved) {
      var t = this.trainerData; if (!t || t.trainerKind !== "specialEnergy") return 0;
      for (var i = 0; i < t.effects.length; i++) {
        var e = t.effects[i];
        if (e.c === "specialEnergyDual") return e.a[0].length;
        if (e.c === "specialEnergyColorless") return evolved ? e.a[1] : e.a[0];
      }
      return 1;
    }
    get dualEnergyTypes() {
      var t = this.trainerData; if (!t || t.trainerKind !== "specialEnergy") return null;
      for (var i = 0; i < t.effects.length; i++) if (t.effects[i].c === "specialEnergyDual") return t.effects[i].a[0];
      return null;
    }
    get isPrismEnergy() {
      var t = this.trainerData; if (!t || t.trainerKind !== "specialEnergy") return false;
      return t.effects.some(function (e) { return e.c === "specialEnergyPrism"; });
    }
    get attachOnlyPrefix() {
      var t = this.trainerData; if (!t || t.trainerKind !== "specialEnergy") return null;
      for (var i = 0; i < t.effects.length; i++) if (t.effects[i].c === "attachOnlyToNamePrefix") return t.effects[i].a[0];
      return null;
    }
    get discardsAtEndOfYourTurn() {
      var t = this.trainerData; if (!t || t.trainerKind !== "specialEnergy") return false;
      return t.effects.some(function (e) { return e.c === "discardAtEndOfYourTurn"; });
    }
    static pokemon(id, data, imageName) { return new BattleCard(id, data, null, data.name, imageName || data.imageName); }
    static trainer(id, data, imageName) { return new BattleCard(id, data, null, data.name, imageName || data.imageName); }
    static energy(id, type, imageName) { return new BattleCard(id, null, type, "基本" + G.energyJapaneseName(type) + "エネルギー", imageName || ""); }
  }
  G.BattleCard = BattleCard;

  // ---------- レギュレーション ----------
  G.BattleRegulation = {
    rotatedOutMarks: new Set(),
    defaultMark: function () { return REG.def; },
    mark: function (n) { return REG.map[String(n)] || REG.def; },
    isBanned: function (n) { return G.BattleRegulation.rotatedOutMarks.has(G.BattleRegulation.mark(n)); }
  };

  // ---------- ミラーの基本エネルギー ----------
  G.MirrorEnergy = {
    list: [["grass", "SD100_M_121"], ["fire", "SD100_M_122"], ["water", "SD100_M_123"], ["lightning", "SD100_M_124"],
      ["psychic", "SD100_M_125"], ["fighting", "SD100_M_126"], ["darkness", "SD100_M_127"], ["metal", "SD100_M_128"]],
    type: function (img) { for (var i = 0; i < this.list.length; i++) if (this.list[i][1] === img) return this.list[i][0]; return null; },
    image: function (t) { for (var i = 0; i < this.list.length; i++) if (this.list[i][0] === t) return this.list[i][1]; return null; }
  };

  // 画像名 → カードID（デッキの「選んだイラスト」を使う対戦用。ページ側から G.setArtMap で渡す）
  var ART_TO_ID = {};
  G.setArtMap = function (m) { ART_TO_ID = m || {}; };

  // ---------- デッキ ----------
  // list = {cards:[{cardNumber,count}], energy:[{type,count}], arts:{画像名:枚数}}
  G.DeckList = {
    deckSize: 60,
    mirrorEnergyTotal: function (list) {
      var total = 0, arts = list.arts || {};
      Object.keys(arts).forEach(function (a) { if (G.MirrorEnergy.type(a) != null) total += arts[a]; });
      return total;
    },
    totalCount: function (list) {
      var c = 0, e = 0;
      list.cards.forEach(function (x) { c += x.count; });
      list.energy.forEach(function (x) { e += x.count; });
      return c + e + G.DeckList.mirrorEnergyTotal(list);
    },
    validate: function (list) {
      var problems = [];
      var total = G.DeckList.totalCount(list);
      if (total !== 60) problems.push("デッキは60枚ちょうどにしてください（今は" + total + "枚）");
      var byName = {}, hasBasic = false, ace = 0;
      list.cards.forEach(function (entry) {
        var p = G.catalogPokemon(entry.cardNumber), t = G.catalogTrainer(entry.cardNumber);
        if (p) { byName[p.name] = (byName[p.name] || 0) + entry.count; if (p.stage === "basic" && !p.isFossil) hasBasic = true; }
        else if (t) { byName[t.name] = (byName[t.name] || 0) + entry.count; if (t.isAceSpec) ace += entry.count; }
        else problems.push("カード番号" + entry.cardNumber + "は存在しません");
      });
      list.cards.forEach(function (entry) {
        if (G.BattleRegulation.isBanned(entry.cardNumber)) {
          var c = G.catalog(entry.cardNumber);
          problems.push("「" + (c ? c.name : "カード" + entry.cardNumber) + "」はレギュレーション" + G.BattleRegulation.mark(entry.cardNumber) + "のため使えません");
        }
      });
      Object.keys(byName).forEach(function (n) { if (byName[n] > 4) problems.push("「" + n + "」は同名カード4枚までです（" + byName[n] + "枚）"); });
      if (ace > 1) problems.push("「ACE SPEC」のカードは、デッキに1枚しか入れられません（今は" + ace + "枚）");
      if (!hasBasic) problems.push("たねポケモンが1枚も入っていません");
      return problems;
    },
    makeBattleCards: function (list, idStart, useChosenArt) {
      var result = [], nextId = idStart, arts = list.arts || {};
      var artKeys = Object.keys(arts).sort();
      list.cards.forEach(function (entry) {
        var queue = [];
        if (useChosenArt) {
          artKeys.forEach(function (a) { if (ART_TO_ID[a] === entry.cardNumber) for (var k = 0; k < arts[a]; k++) queue.push(a); });
        }
        var p = G.catalogPokemon(entry.cardNumber), t = p ? null : G.catalogTrainer(entry.cardNumber);
        for (var copy = 0; copy < entry.count; copy++) {
          if (p) { result.push(BattleCard.pokemon(nextId, p, copy < queue.length ? queue[copy] : p.imageName)); nextId++; }
          else if (t) { result.push(BattleCard.trainer(nextId, t, copy < queue.length ? queue[copy] : t.imageName)); nextId++; }
        }
      });
      list.energy.forEach(function (e) { for (var i = 0; i < e.count; i++) { result.push(BattleCard.energy(nextId, e.type)); nextId++; } });
      artKeys.forEach(function (a) {
        var type = G.MirrorEnergy.type(a); if (type == null || !(arts[a] > 0)) return;
        for (var i = 0; i < arts[a]; i++) { result.push(BattleCard.energy(nextId, type, useChosenArt ? a : "")); nextId++; }
      });
      return result;
    }
  };

  // ---------- 場のポケモン ----------
  class PokemonInPlay {
    constructor(id, card, turn) {
      this.id = id;
      this.cards = [card];
      this.attachedEnergy = [];
      this.tool = null;
      this.damage = 0;
      this.conditions = new Set();
      this.lastChangedTurn = turn;
      this.cannotRetreatUntilTurn = 0;
      this.protectedFromNonColorlessBasicUntilTurn = 0;
      this.weaknessColorlessUntilTurn = 0;
      this.noWeaknessUntilTurn = 0;
      this.mustFlipToAttackUntilTurn = 0;
      this.damageReduction = 0;
      this.damageReductionUntilTurn = 0;
      this.cannotAttackUntilTurn = 0;
      this.blockedAttackNames = {};
      this.protectedUntilTurn = 0;
      this.outgoingDamageReduction = 0;
      this.outgoingDamageReductionUntilTurn = 0;
      this.protectedFromBasicUntilTurn = 0;
      this.protectedFromExUntilTurn = 0;
      this.attachPunishUntilTurn = 0;
      this.attachPunishCounters = 0;
      this.poisonCounters = 1;
      this.retaliationUntilTurn = -1;
      this.retaliationCounters = 0;
      this.extraTool = null;
      this.lastDamageTakenTurn = -1;
      this.lastDamageTaken = 0;
      this.movedToActiveTurn = -1;
      this.healedTurn = -1;
      this.extraDamageTaken = 0;
      this.extraDamageTakenTurn = -1;
      this.attackBoostByName = {};
      this.stadiumHPPenalty = 0;
      this.selfAttackBoostTurn = -1;
      this.selfAttackBoost = 0;
      this.abilityHPBonus = 0;
      this.abilitySuppressed = false;
    }
    get top() { return this.cards[this.cards.length - 1]; }
    get data() { return this.top.pokemonData; }
    get name() { return this.data.name; }
    get ability() { return this.abilitySuppressed ? null : this.data.ability; }
    get hp() {
      var total = this.data.hp - this.stadiumHPPenalty + this.abilityHPBonus;
      var tools = [this.tool, this.extraTool];
      for (var i = 0; i < tools.length; i++) {
        var t = tools[i] && tools[i].trainerData; if (!t) continue;
        for (var j = 0; j < t.effects.length; j++) {
          var e = t.effects[j];
          if (e.c === "toolMaxHPBonus") { var prefix = e.a[0], amount = e.a[1]; if (prefix === "" || this.data.name.startsWith(prefix)) total += amount; }
        }
      }
      return Math.max(total, 10);
    }
    get isKnockedOut() { return this.damage >= this.hp; }
    get remainingHP() { return Math.max(this.hp - this.damage, 0); }
    addCondition(condition) {
      if (this.data.isFossil) return;
      if (condition === "poisoned" && !this.conditions.has("poisoned")) this.poisonCounters = 1;
      if (condition === "asleep" || condition === "paralyzed" || condition === "confused") {
        this.conditions.delete("asleep"); this.conditions.delete("paralyzed"); this.conditions.delete("confused");
      }
      this.conditions.add(condition);
    }
    evolve(card, turn, keepConfusion) {
      this.cards.push(card);
      this.lastChangedTurn = turn;
      var wasConfused = this.conditions.has("confused");
      this.conditions.clear();
      if (keepConfusion && wasConfused) this.conditions.add("confused");
      this.cannotRetreatUntilTurn = 0;
      this.mustFlipToAttackUntilTurn = 0;
      this.damageReduction = 0;
      this.damageReductionUntilTurn = 0;
      this.cannotAttackUntilTurn = 0;
      this.blockedAttackNames = {};
      this.protectedUntilTurn = 0;
      this.attachPunishUntilTurn = 0;
      this.attachPunishCounters = 0;
      this.retaliationUntilTurn = -1;
      this.retaliationCounters = 0;
      this.outgoingDamageReduction = 0;
      this.outgoingDamageReductionUntilTurn = 0;
      this.protectedFromExUntilTurn = 0;
      this.protectedFromBasicUntilTurn = 0;
      this.extraDamageTaken = 0;
      this.extraDamageTakenTurn = -1;
      this.attackBoostByName = {};
    }
  }
  G.PokemonInPlay = PokemonInPlay;

  // ---------- プレイヤー1人分 ----------
  class PlayerState {
    constructor() {
      this.deck = []; this.hand = []; this.discard = []; this.prizes = [];
      this.revealedPrizeIds = new Set();
      this.active = null; this.bench = [];
      this.energyAttachedThisTurn = false;
      this.supporterPlayedThisTurn = false;
      this.supporterNamesPlayedThisTurn = [];
      this.stadiumPlayedThisTurn = false;
      this.stadiumUsedThisTurn = false;
      this.cannotPlayStadiumUntilTurn = 0;
      this.cannotPlaySupportersUntilTurn = 0;
      this.lastAttackName = "";
      this.lastAttackTurn = -10;
      this.cannotPlayItemsUntilTurn = 0;
      this.retreatedThisTurn = false;
      this.usedAbilityPokemonIds = new Set();
      this.usedAbilityNames = new Set();
      this.attackBoostsThisTurn = [];
      this.exDamageBonusThisTurn = 0;
      this.attackLockUntilTurn = -1;
      this.attackLockEnergyAtMost = 0;
      this.damageReductions = [];
      this.turnsTaken = 0;
      this.lastKnockedOutTurn = -1;
      this.extraPrizeTurn = -1;
      this.extraPrizePrefix = "";
      this.extraPrizeCount = 0;
      this.lastPrizeTakenTurn = -1;
      this.lastPrizeTakenCount = 0;
      this.lastKnockedOutNames = [];
      this.extraPrizeTeraTurn = -1;
      this.extraPrizeTeraCount = 0;
      this.legacyEnergyUsed = false;
    }
    get allPokemon() {
      var list = [];
      if (this.active) list.push(this.active);
      for (var i = 0; i < this.bench.length; i++) list.push(this.bench[i]);
      return list;
    }
    resetTurnState() {
      this.energyAttachedThisTurn = false;
      this.supporterPlayedThisTurn = false;
      this.supporterNamesPlayedThisTurn = [];
      this.stadiumPlayedThisTurn = false;
      this.stadiumUsedThisTurn = false;
      this.retreatedThisTurn = false;
      this.usedAbilityPokemonIds.clear();
      this.usedAbilityNames.clear();
      this.attackBoostsThisTurn = [];
      this.exDamageBonusThisTurn = 0;
    }
  }
  G.PlayerState = PlayerState;

  if (typeof module !== "undefined") module.exports = G;
})(globalThis.PK = globalThis.PK || {});
// BattleEngine.swift の移植（対戦の流れ・ターン・きぜつ処理）
(function (G) {
  "use strict";
  var ACTIVE = G.ACTIVE, bench = G.bench;

  function hasEff(ab, name) { return ab.effects.some(function (e) { return e.c === name; }); }

  class BattleGame {
    constructor(deck0, deck1, agents, rules, seed) {
      this.rules = Object.assign({
        prizeCount: 6, maxBench: 5, maxTurns: 200,
        firstPlayerCannotAttackOnFirstTurn: true,
        firstPlayerCannotPlaySupporterOnFirstTurn: true,
        noEvolutionOnFirstTurn: true
      }, rules || {});
      this.agents = agents;
      this.players = [new G.PlayerState(), new G.PlayerState()];
      this.turnNumber = 0;
      this.currentPlayer = 0;
      this.firstPlayer = 0;
      this.stadiumCard = null;
      this.stadiumOwner = 0;
      this.currentAttackerName = null;
      this.exAttackerPlayer = null;
      this.result = null;
      this.logLines = [];
      this.onLog = null;
      this.nextPokemonId = 1;
      this._seed = (seed == null ? (Math.random() * 4294967296) >>> 0 : seed >>> 0);
      this.players[0].deck = deck0;
      this.players[1].deck = deck1;
    }

    // ---- 乱数（mulberry32。同じシードなら同じ順番） ----
    rand() {
      this._seed = (this._seed + 0x6D2B79F5) >>> 0;
      var t = this._seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    randBool() { return this.rand() < 0.5; }
    randInt(n) { return Math.floor(this.rand() * n); }
    randomElement(arr) { return arr.length ? arr[this.randInt(arr.length)] : null; }
    shuffleArray(arr) {
      for (var i = arr.length - 1; i > 0; i--) { var j = this.randInt(i + 1); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
      return arr;
    }

    // ---- 基本の道具 ----
    note(text) { this.logLines.push(text); if (this.onLog) this.onLog(text); }
    other(p) { return 1 - p; }
    flipCoin() {
      var heads = this.randBool();
      this.note(heads ? "🪙 コイン: オモテ" : "🪙 コイン: ウラ");
      return heads;
    }
    shuffleDeck(p) { this.shuffleArray(this.players[p].deck); }
    draw(p, count) {
      var drawn = 0;
      for (var n = 0; n < count; n++) {
        if (this.players[p].deck.length === 0) break;
        this.players[p].hand.push(this.players[p].deck.shift());
        drawn++;
      }
      return drawn;
    }
    makePokemon(card) {
      var pk = new G.PokemonInPlay(this.nextPokemonId, card, this.turnNumber);
      this.nextPokemonId++;
      return pk;
    }
    removeFromHand(p, card) {
      var h = this.players[p].hand, i = h.findIndex(function (c) { return c.id === card.id; });
      if (i >= 0) h.splice(i, 1);
    }
    removeCard(cards, id) {
      var i = cards.findIndex(function (c) { return c.id === id; });
      if (i >= 0) cards.splice(i, 1);
    }
    pokemon(p, slot) {
      if (!slot) return null;
      if (slot.k === "a") return this.players[p].active;
      var b = this.players[p].bench;
      return slot.i >= 0 && slot.i < b.length ? b[slot.i] : null;
    }
    slots(p) {
      var r = [];
      if (this.players[p].active) r.push(ACTIVE);
      for (var i = 0; i < this.players[p].bench.length; i++) r.push(bench(i));
      return r;
    }
    slotLabel(p, slot) {
      var pk = this.pokemon(p, slot);
      if (!pk) return "?";
      var place = slot.k === "b" ? "ベンチ" + (slot.i + 1) : "バトル場";
      return place + ": " + pk.name + "（HP " + pk.remainingHP + "/" + pk.hp + "）";
    }

    // ---- プレイヤーへの質問 ----
    async ask(p, kind, prompt, options, allowsNone, targetSlots, targetOwner, gallery, multi) {
      if (!options || options.length === 0) return null;
      var request = { kind: kind, prompt: prompt, options: options, allowsNone: !!allowsNone,
        targetSlots: targetSlots || null, targetOwner: targetOwner == null ? null : targetOwner, gallery: gallery || null, multi: multi || null };
      var answer = await this.agents[p].choose(this, p, request);
      if (answer != null && answer >= 0 && answer < options.length) return answer;
      if (allowsNone) return null;
      return 0;
    }
    async askYesNo(p, prompt) {
      var i = await this.ask(p, "yesNo", prompt, ["はい", "いいえ"]);
      if (i == null) i = 1;
      return i === 0;
    }
    async chooseSlot(chooser, owner, prompt, candidates) {
      if (!candidates || candidates.length === 0) return null;
      var labels = candidates.map(function (s) { return this.slotLabel(owner, s); }, this);
      var i = await this.ask(chooser, "target", prompt, labels, false, candidates, owner);
      if (i == null) return null;
      return candidates[i];
    }
    makeGallery(p, candidates) {
      if (!candidates || candidates.length === 0) return null;
      var st = this.players[p], deckIDs = new Set(st.deck.map(function (c) { return c.id; })), discardIDs = new Set(st.discard.map(function (c) { return c.id; }));
      var pool = null;
      if (candidates.every(function (c) { return deckIDs.has(c.id); })) pool = st.deck;
      else if (candidates.every(function (c) { return discardIDs.has(c.id); })) pool = st.discard;
      if (!pool) return null;
      function rank(c) { return c.pokemonData ? 0 : c.trainerData ? 1 : 2; }
      var sorted = pool.slice().sort(function (a, b) {
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return a.id - b.id;
      });
      return sorted.map(function (c) {
        var idx = candidates.findIndex(function (x) { return x.id === c.id; });
        return { card: c, optionIndex: idx >= 0 ? idx : null };
      });
    }
    async pickCards(p, candidates, count, prompt) {
      var remaining = candidates.slice(), picked = [];
      while (picked.length < count && remaining.length > 0) {
        var labels = remaining.map(function (c) { return c.name; });
        var text = prompt + "（" + picked.length + "/" + count + "枚）";
        var gallery = this.makeGallery(p, remaining);
        var multi = count > 1 ? { cards: remaining.slice(), max: count - picked.length, min: 0, first: picked.length === 0, cont: picked.length > 0, total: count } : null;
        var i = await this.ask(p, "card", text, labels, true, null, null, gallery, multi);
        if (i == null) break;
        picked.push(remaining.splice(i, 1)[0]);
      }
      return picked;
    }

    // ---- 対戦の流れ全体 ----
    async run() {
      await this.setup();
      if (this.result) return this.result;
      this.currentPlayer = this.firstPlayer;
      while (this.result == null) {
        await this.playTurn();
        if (this.result != null) break;
        this.currentPlayer = this.other(this.currentPlayer);
        if (this.turnNumber >= this.rules.maxTurns) {
          this.note("ターン数の上限に達したので引き分け");
          this.result = { draw: true };
        }
      }
      return this.result || { draw: true };
    }

    // ---- 対戦準備 ----
    canStartAsActive(card) {
      var d = card.pokemonData;
      if (!d || d.isFossil) return false;
      if (d.stage === "basic") return true;
      if (d.ability && d.ability.trigger === "whileInHandDuringSetup") return true;
      return false;
    }
    hasSetupPokemon(hand) { return hand.some(function (c) { return this.canStartAsActive(c); }, this); }

    async setup() {
      var p;
      for (p = 0; p < 2; p++) { this.shuffleDeck(p); this.draw(p, 7); }
      var mulligans = [0, 0], safety = 0;
      while (safety < 50) {
        safety++;
        var needs0 = !this.hasSetupPokemon(this.players[0].hand), needs1 = !this.hasSetupPokemon(this.players[1].hand);
        if (!needs0 && !needs1) break;
        for (p = 0; p < 2; p++) {
          var needs = p === 0 ? needs0 : needs1;
          if (!needs) continue;
          this.note("プレイヤー" + (p + 1) + "は手札にたねポケモンがいないので引き直し（マリガン）");
          var handNames = this.players[p].hand.map(function (c) { return c.name; }).join("、");
          await this.ask(p, "other", "手札にたねポケモンがいません（" + handNames + "）。手札を山札に戻して、7枚引き直します", ["手札を戻して引き直す"]);
          var back = this.players[p].hand.splice(0, this.players[p].hand.length);
          this.players[p].deck.push.apply(this.players[p].deck, back);
          this.shuffleDeck(p);
          this.draw(p, 7);
          mulligans[p]++;
        }
      }
      if (!this.hasSetupPokemon(this.players[0].hand) || !this.hasSetupPokemon(this.players[1].hand)) {
        this.note("たねポケモンが引けないので引き分け");
        this.result = { draw: true };
        return;
      }
      var diff = mulligans[0] - mulligans[1];
      if (diff > 0) this.draw(1, diff);
      if (diff < 0) this.draw(0, -diff);

      for (p = 0; p < 2; p++) {
        var cands = this.players[p].hand.filter(function (c) { return this.canStartAsActive(c); }, this);
        var labels = cands.map(function (c) { return c.name; });
        var i = await this.ask(p, "setupActive", "バトル場に出すポケモンを選んでください", labels);
        if (i == null) i = 0;
        var chosen = cands[i];
        this.removeFromHand(p, chosen);
        this.players[p].active = this.makePokemon(chosen);
        while (this.players[p].bench.length < this.rules.maxBench) {
          var bc = this.players[p].hand.filter(function (c) { return c.isBasicPokemon; });
          if (bc.length === 0) break;
          var j = await this.ask(p, "setupBench", "ベンチに出すポケモンを選んでください", bc.map(function (c) { return c.name; }), true);
          if (j == null) break;
          var c2 = bc[j];
          this.removeFromHand(p, c2);
          this.players[p].bench.push(this.makePokemon(c2));
        }
      }
      for (p = 0; p < 2; p++) {
        var n = 0;
        while (n < this.rules.prizeCount && this.players[p].deck.length > 0) { this.players[p].prizes.push(this.players[p].deck.shift()); n++; }
      }
      var tossWinner = this.randInt(2);
      var goFirst = await this.ask(tossWinner, "goFirst", "コイントスに勝ちました。先攻・後攻を選んでください", ["先攻", "後攻"]);
      if (goFirst == null) goFirst = 0;
      this.firstPlayer = goFirst === 0 ? tossWinner : this.other(tossWinner);
      this.note("コイントスの結果、プレイヤー" + (this.firstPlayer + 1) + "が先攻");
    }

    // ---- 1ターン ----
    async playTurn() {
      var p = this.currentPlayer, me = this.players[p];
      this.turnNumber++;
      me.resetTurnState();
      me.turnsTaken++;
      var t = this.turnNumber;
      me.damageReductions = me.damageReductions.filter(function (d) { return !(d.untilTurn < t); });
      this.note("―― ターン" + this.turnNumber + ": プレイヤー" + (p + 1) + " ――");
      if (me.deck.length === 0) {
        this.note("プレイヤー" + (p + 1) + "は山札が引けないので負け");
        this.result = { win: this.other(p) };
        return;
      }
      this.draw(p, 1);
      var actionCount = 0;
      while (this.result == null) {
        var actions = this.legalActions(p);
        var index = await this.agents[p].chooseAction(this, p, actions);
        if (index == null || index < 0 || index >= actions.length) index = actions.length - 1;
        actionCount++;
        var endsTurn = await this.perform(actions[index], p);
        await this.resolveKnockouts();
        this.currentAttackerName = null;
        if (endsTurn || this.result != null) break;
        if (actionCount >= 80) { this.note("1ターンの操作が多すぎるので、ここでターンを終える"); break; }
      }
      if (this.result != null) return;
      me.attackBoostsThisTurn = [];
      me.exDamageBonusThisTurn = 0;
      await this.applyEndOfTurnTools(p);
      this.discardEndOfTurnEnergy(p);
      await this.pokemonCheckup(p);
      await this.resolveKnockouts();
    }

    // ---- 今できる行動の一覧（最後は必ず「ターンを終える」） ----
    legalActions(p) {
      var me = this.players[p], actions = [];
      var isFirstTurnOfPlayer = me.turnsTaken <= 1;
      var allSlots = this.slots(p), i, s;
      if (!me.energyAttachedThisTurn) {
        for (i = 0; i < me.hand.length; i++) {
          var card = me.hand[i];
          if (!(card.energyType != null || card.isSpecialEnergy)) continue;
          for (s = 0; s < allSlots.length; s++) {
            var slot = allSlots[s], prefix = card.attachOnlyPrefix, pk0 = this.pokemon(p, slot);
            if (prefix && pk0 && !pk0.data.name.startsWith(prefix)) continue;
            actions.push({ t: "attachEnergy", handIndex: i, target: slot });
          }
        }
      }
      if (me.bench.length < this.rules.maxBench) {
        for (i = 0; i < me.hand.length; i++) if (me.hand[i].isBasicPokemon) actions.push({ t: "playBasic", handIndex: i });
      }
      if (me.bench.length < this.rules.maxBench && this.turnNumber > me.cannotPlayItemsUntilTurn) {
        for (i = 0; i < me.hand.length; i++) if (me.hand[i].isFossil) actions.push({ t: "playBasic", handIndex: i });
      }
      var firstTurnEvolveBlocked = this.rules.noEvolutionOnFirstTurn && isFirstTurnOfPlayer;
      for (i = 0; i < me.hand.length; i++) {
        var d = me.hand[i].pokemonData;
        if (!d || d.evolvesFrom == null) continue;
        if (d.ability && hasEff(d.ability, "canOnlyEnterPlayBySwap")) continue;
        for (s = 0; s < allSlots.length; s++) {
          var pk = this.pokemon(p, allSlots[s]);
          if (!pk) continue;
          var nameOK = pk.name === d.evolvesFrom || this.rainbowEvolveAllowed(pk, d);
          if (!nameOK) continue;
          var boosted = this.boostEvolveAllowed(p, pk);
          if (firstTurnEvolveBlocked && !boosted) continue;
          if (pk.lastChangedTurn < this.turnNumber || this.grassEvolveAllowed(pk, d) || boosted) {
            actions.push({ t: "evolve", handIndex: i, target: allSlots[s] });
          }
        }
      }
      for (i = 0; i < me.hand.length; i++) {
        var tr = me.hand[i].trainerData;
        if (!tr) continue;
        switch (tr.trainerKind) {
          case "item":
            if (this.turnNumber > me.cannotPlayItemsUntilTurn && this.canPlayTrainer(p, tr)) actions.push({ t: "playTrainer", handIndex: i });
            break;
          case "supporter": {
            var firstBlocked = this.rules.firstPlayerCannotPlaySupporterOnFirstTurn && p === this.firstPlayer && isFirstTurnOfPlayer
              && !tr.effects.some(function (e) { return e.c === "usableOnFirstTurnOfFirstPlayerTrainer"; });
            if (!me.supporterPlayedThisTurn && !firstBlocked && this.turnNumber > me.cannotPlaySupportersUntilTurn && this.canPlayTrainer(p, tr)) {
              actions.push({ t: "playTrainer", handIndex: i });
            }
            break;
          }
          case "stadium": {
            var sameName = this.stadiumCard && this.stadiumCard.name === me.hand[i].name;
            if (!me.stadiumPlayedThisTurn && !sameName && this.turnNumber > me.cannotPlayStadiumUntilTurn) actions.push({ t: "playTrainer", handIndex: i });
            break;
          }
          case "tool":
            for (s = 0; s < allSlots.length; s++) {
              var pk2 = this.pokemon(p, allSlots[s]);
              if (pk2 && (pk2.tool == null || (pk2.extraTool == null && this.canHoldTwoTools(p, pk2)))) actions.push({ t: "attachTool", handIndex: i, target: allSlots[s] });
            }
            break;
          default: break;
        }
      }
      if (this.canRetreat(p)) for (var b = 0; b < me.bench.length; b++) actions.push({ t: "retreat", benchIndex: b });
      for (s = 0; s < allSlots.length; s++) {
        var pk3 = this.pokemon(p, allSlots[s]);
        if (pk3 && this.canUseAbility(p, pk3)) actions.push({ t: "useAbility", target: allSlots[s] });
      }
      if (this.canUseStadium(p)) actions.push({ t: "useStadium" });
      if (me.active) {
        var active = me.active;
        var firstTurnBlocked2 = this.rules.firstPlayerCannotAttackOnFirstTurn && p === this.firstPlayer && isFirstTurnOfPlayer;
        var canAttackNow = !active.conditions.has("asleep") && !active.conditions.has("paralyzed") && this.turnNumber > active.cannotAttackUntilTurn;
        if (canAttackNow) {
          for (i = 0; i < active.data.attacks.length; i++) {
            var attack = active.data.attacks[i];
            if (firstTurnBlocked2) {
              var allowed = attack.effects.some(function (e) { return e.c === "usableOnFirstTurnOfFirstPlayer"; });
              if (!allowed) continue;
            }
            if (this.canUseAttack(active, attack)) actions.push({ t: "attack", index: i });
          }
        }
      }
      actions.push({ t: "endTurn" });
      return actions;
    }

    describe(action, p) {
      var me = this.players[p];
      switch (action.t) {
        case "attachEnergy": return me.hand[action.handIndex].name + "を" + this.slotLabel(p, action.target) + "につける";
        case "playBasic": return me.hand[action.handIndex].name + "をベンチに出す";
        case "evolve": return this.slotLabel(p, action.target) + "を" + me.hand[action.handIndex].name + "に進化させる";
        case "playTrainer": return me.hand[action.handIndex].name + "を使う";
        case "attachTool": return me.hand[action.handIndex].name + "を" + this.slotLabel(p, action.target) + "につける";
        case "retreat": return "にげる（ベンチ" + (action.benchIndex + 1) + "と入れ替え）";
        case "useAbility": {
          var pk = this.pokemon(p, action.target);
          if (pk && pk.data.isFossil) return pk.name + "をトラッシュする（" + this.slotLabel(p, action.target) + "）";
          var name = pk && pk.ability ? pk.ability.name : "特性";
          return "特性「" + name + "」を使う（" + this.slotLabel(p, action.target) + "）";
        }
        case "useStadium": return "スタジアム「" + (this.stadiumCard ? this.stadiumCard.name : "") + "」の効果を使う";
        case "attack": return "ワザ「" + (me.active ? me.active.data.attacks[action.index].name : "ワザ") + "」";
        default: return "ターンを終える";
      }
    }

    // ---- にげる ----
    retreatCost(pk) {
      var cost = pk.data.retreatCost, owner = this.ownerIndex(pk), holders = this.players[owner].allPokemon, i, j;
      if (pk.data.stage === "basic") {
        for (i = 0; i < holders.length; i++) {
          var ab = holders[i].ability;
          if (!ab || ab.trigger !== "passive") continue;
          if (hasEff(ab, "yourBasicPokemonHaveNoRetreatCost")) return 0;
        }
      }
      for (i = 0; i < holders.length; i++) {
        var ab2 = holders[i].ability;
        if (!ab2 || ab2.trigger !== "passive") continue;
        for (j = 0; j < ab2.effects.length; j++) {
          var e = ab2.effects[j];
          if (e.c === "noRetreatCostForYourPokemonWithEnergyOfType" && pk.attachedEnergy.some(function (x) { return x.energyType === e.a[0]; })) return 0;
        }
      }
      if (this.stadiumCard && this.stadiumCard.trainerData) {
        var st = this.stadiumCard.trainerData;
        for (i = 0; i < st.effects.length; i++) {
          if (st.effects[i].c === "retreatCostZeroForNamePrefix" && pk.data.name.startsWith(st.effects[i].a[0])) return 0;
        }
      }
      var ability = pk.ability;
      if (ability && ability.trigger === "passive" && pk.attachedEnergy.length === 0) {
        for (i = 0; i < ability.effects.length; i++) if (ability.effects[i].c === "noRetreatCostIfNoEnergy") cost = 0;
      }
      var tools = this.toolCards(pk);
      for (i = 0; i < tools.length; i++) {
        var tool = tools[i] && tools[i].trainerData;
        if (!tool) continue;
        for (j = 0; j < tool.effects.length; j++) if (tool.effects[j].c === "reduceRetreatCostOfAttachedPokemon") cost -= tool.effects[j].a[0];
      }
      return Math.max(cost, 0);
    }
    boostEvolveAllowed(p, pk) {
      if (this.players[p].active !== pk || pk.cards.length !== 1) return false;
      var ab = pk.ability;
      if (!ab || ab.trigger !== "passive") return false;
      return hasEff(ab, "canEvolveOnFirstTurnAndPlacedTurnWhileActive");
    }
    rainbowEvolveAllowed(pk, evolveCard) {
      if (evolveCard.stage === "basic" || evolveCard.prizeValue < 2 || evolveCard.evolvesFrom == null) return false;
      var ab = pk.ability;
      if (!ab || ab.trigger !== "passive") return false;
      for (var i = 0; i < ab.effects.length; i++) {
        var e = ab.effects[i];
        if (e.c === "acceptsEvolutionFromNameForEx" && e.a[0] === evolveCard.evolvesFrom) return true;
      }
      return false;
    }
    canRetreat(p) {
      var me = this.players[p], active = me.active;
      if (!active) return false;
      if (active.data.isFossil) return false;
      if (me.retreatedThisTurn) return false;
      if (me.bench.length === 0) return false;
      if (active.conditions.has("asleep") || active.conditions.has("paralyzed")) return false;
      if (this.turnNumber <= active.cannotRetreatUntilTurn) return false;
      return this.energyUnits(active) >= this.retreatCost(active);
    }
    async retreat(p, benchIndex) {
      var me = this.players[p], active = me.active;
      if (!active || benchIndex < 0 || benchIndex >= me.bench.length) return;
      var cost = this.retreatCost(active), n = 0, doubled = this.doubledEnergyType(p);
      while (n < cost && active.attachedEnergy.length > 0) {
        var labels = active.attachedEnergy.map(function (e) { return e.name; });
        var i = await this.ask(p, "card", "にげるために捨てるエネルギー（" + (n + 1) + "/" + cost + "）", labels);
        if (i == null) i = 0;
        var card = active.attachedEnergy.splice(i, 1)[0];
        me.discard.push(card);
        n += this.energyUnit(card, active, doubled);
      }
      var newActive = me.bench.splice(benchIndex, 1)[0];
      active.conditions.clear();
      me.bench.push(active);
      me.active = newActive;
      me.retreatedThisTurn = true;
      this.note(active.name + "がにげて、" + newActive.name + "がバトル場に出た");
      await this.afterBenchToActive(p, newActive);
      await this.afterActiveToBench(p, active);
    }

    // ---- 行動の実行（ターンが終わるなら true） ----
    async perform(action, p) {
      var me = this.players[p];
      switch (action.t) {
        case "endTurn":
          this.note("プレイヤー" + (p + 1) + "はターンを終えた");
          return true;
        case "attachEnergy": {
          var pk = this.pokemon(p, action.target);
          if (action.handIndex < 0 || action.handIndex >= me.hand.length || !pk) return false;
          var card = me.hand.splice(action.handIndex, 1)[0];
          pk.attachedEnergy.push(card);
          me.energyAttachedThisTurn = true;
          this.note(card.name + "を" + pk.name + "につけた");
          this.healOnAttachFromHand(p, pk);
          var td = card.trainerData, effs = td ? td.effects : [];
          for (var i = 0; i < effs.length; i++) {
            if (effs[i].c === "energyDrawWhenAttachedFromHand") {
              var drawn = this.draw(p, effs[i].a[0]);
              this.note(card.name + "の効果で、山札を" + drawn + "枚引いた");
            }
          }
          if (this.turnNumber <= pk.attachPunishUntilTurn && pk.attachPunishCounters > 0) {
            pk.damage += pk.attachPunishCounters * 10;
            this.note(pk.name + "にダメカンが" + pk.attachPunishCounters + "個のった");
          }
          return false;
        }
        case "playBasic": {
          if (action.handIndex < 0 || action.handIndex >= me.hand.length) return false;
          var c1 = me.hand.splice(action.handIndex, 1)[0];
          this.putOnBench(p, c1);
          this.note(c1.name + "をベンチに出した");
          if (me.bench.length > 0) await this.onPlayedFromHandToBench(p, me.bench[me.bench.length - 1]);
          return false;
        }
        case "evolve": {
          var pk2 = this.pokemon(p, action.target);
          if (action.handIndex < 0 || action.handIndex >= me.hand.length || !pk2) return false;
          var c2 = me.hand.splice(action.handIndex, 1)[0], before = pk2.name;
          pk2.evolve(c2, this.turnNumber, this.confusionLocked());
          this.refreshStadiumEffects();
          this.note(before + "が" + c2.name + "に進化した");
          await this.onEvolvedFromHand(p, pk2);
          return false;
        }
        case "playTrainer": {
          if (action.handIndex < 0 || action.handIndex >= me.hand.length || !me.hand[action.handIndex].trainerData) return false;
          var t = me.hand[action.handIndex].trainerData;
          var c3 = me.hand.splice(action.handIndex, 1)[0];
          this.note("プレイヤー" + (p + 1) + "は「" + c3.name + "」を使った");
          if (t.trainerKind === "supporter") { me.supporterPlayedThisTurn = true; me.supporterNamesPlayedThisTurn.push(t.name); }
          if (t.trainerKind === "stadium") {
            me.stadiumPlayedThisTurn = true;
            if (this.stadiumCard) this.players[this.stadiumOwner].discard.push(this.stadiumCard);
            this.stadiumCard = c3;
            this.stadiumOwner = p;
            this.refreshStadiumEffects();
          } else {
            await this.applyTrainerEffects(t, p);
            me.discard.push(c3);
          }
          return false;
        }
        case "attachTool": {
          var pk3 = this.pokemon(p, action.target);
          if (action.handIndex < 0 || action.handIndex >= me.hand.length || !pk3) return false;
          if (!(pk3.tool == null || (pk3.extraTool == null && this.canHoldTwoTools(p, pk3)))) return false;
          var c4 = me.hand.splice(action.handIndex, 1)[0];
          if (pk3.tool == null) pk3.tool = c4; else pk3.extraTool = c4;
          this.note(c4.name + "を" + pk3.name + "につけた");
          return false;
        }
        case "retreat": await this.retreat(p, action.benchIndex); return false;
        case "useAbility": await this.useAbility(p, action.target); return false;
        case "useStadium": await this.useStadium(p); return false;
        case "attack": await this.performAttack(p, action.index); return true;
      }
      return false;
    }

    putOnBench(p, card) {
      var pk = this.makePokemon(card);
      this.players[p].bench.push(pk);
      var stadium = this.stadiumCard;
      if (!stadium || !stadium.trainerData) return;
      var effs = stadium.trainerData.effects;
      for (var i = 0; i < effs.length; i++) {
        if (effs[i].c === "whenBasicPutOnBenchPlaceDamageCounters") {
          var excluded = effs[i].a[0], counters = effs[i].a[1];
          if (pk.data.type !== excluded) {
            pk.damage += counters * 10;
            this.note("「" + stadium.name + "」の効果で" + pk.name + "にダメカンを" + counters + "個のせた");
          }
        }
      }
    }

    // ---- ポケモンチェック ----
    async pokemonCheckup(p) {
      for (var side = 0; side < 2; side++) {
        var active = this.players[side].active;
        if (!active) continue;
        var i, j;
        if (active.conditions.has("poisoned")) {
          var total = active.poisonCounters, holder = this.players[1 - side].active;
          if (holder && holder.ability && holder.ability.trigger === "passive") {
            for (i = 0; i < holder.ability.effects.length; i++) {
              if (holder.ability.effects[i].c === "poisonDamageCountersBonusForOpponentPoisoned") total += holder.ability.effects[i].a[0];
            }
          }
          active.damage += total * 10;
          this.note("どくで" + active.name + "に" + (total * 10) + "ダメージ");
        }
        if (active.conditions.has("burned")) {
          var burn = 2, hs = this.players[1 - side].allPokemon;
          for (i = 0; i < hs.length; i++) {
            var ab = hs[i].ability;
            if (!ab || ab.trigger !== "passive") continue;
            for (j = 0; j < ab.effects.length; j++) if (ab.effects[j].c === "burnDamageCountersBonus") burn = Math.max(burn, 2 + ab.effects[j].a[0]);
          }
          active.damage += burn * 10;
          this.note("やけどで" + active.name + "に" + (burn * 10) + "ダメージ");
          if (this.flipCoin()) { active.conditions.delete("burned"); this.note(active.name + "のやけどが治った"); }
        }
        if (active.conditions.has("asleep")) {
          if (this.flipCoin()) { active.conditions.delete("asleep"); this.note(active.name + "が目を覚ました"); }
        }
        if (active.conditions.has("paralyzed") && side === p) {
          active.conditions.delete("paralyzed");
          this.note(active.name + "のマヒが治った");
        }
      }
    }

    // ---- きぜつ・サイド・勝敗 ----
    sendToDiscard(p, pk) {
      this.note(pk.name + "がきぜつした！");
      var side = this.players[p];
      side.discard.push.apply(side.discard, pk.cards);
      side.discard.push.apply(side.discard, pk.attachedEnergy);
      if (pk.tool) side.discard.push(pk.tool);
      if (pk.extraTool) side.discard.push(pk.extraTool);
      if (side.active === pk) side.active = null;
      for (var i = side.bench.length - 1; i >= 0; i--) if (side.bench[i] === pk) side.bench.splice(i, 1);
    }
    takePrizes(p, count) {
      var taken = 0;
      for (var n = 0; n < count; n++) {
        if (this.players[p].prizes.length === 0) break;
        this.players[p].hand.push(this.players[p].prizes.shift());
        taken++;
      }
      if (taken > 0) {
        var pl = this.players[p];
        if (pl.lastPrizeTakenTurn !== this.turnNumber) pl.lastPrizeTakenCount = 0;
        pl.lastPrizeTakenTurn = this.turnNumber;
        pl.lastPrizeTakenCount += taken;
        this.note("プレイヤー" + (p + 1) + "はサイドを" + taken + "枚とった（残り" + pl.prizes.length + "枚）");
        this.refreshStadiumEffects();
      }
    }
    checkWinConditions() {
      if (this.result != null) return;
      var winners = [];
      for (var p = 0; p < 2; p++) {
        var opp = this.other(p);
        var tookAll = this.players[p].prizes.length === 0;
        var oppNone = this.players[opp].active == null && this.players[opp].bench.length === 0;
        if (tookAll || oppNone) winners.push(p);
      }
      if (winners.length === 2) this.result = { draw: true };
      else if (winners.length === 1) this.result = { win: winners[0] };
    }

    async resolveKnockouts() {
      this.refreshStadiumEffects();
      if (this.result != null) return;
      var rounds = 0;
      while (rounds < 20) {
        rounds++;
        var anyKnockout = false;
        for (var p = 0; p < 2; p++) {
          var side = this.players[p], koList = [];
          if (side.active && side.active.isKnockedOut) koList.push(side.active);
          side.bench.forEach(function (b) { if (b.isKnockedOut) koList.push(b); });
          for (var k = 0; k < koList.length; k++) {
            var pk = koList[k], i, j, e, ab, tt;
            anyKnockout = true;
            var prizeValue = pk.data.prizeValue;
            if (p !== this.currentPlayer && side.active === pk && this.currentAttackerName != null) {
              var atk = this.players[this.currentPlayer];
              if (atk.extraPrizeTurn === this.turnNumber && this.currentAttackerName.startsWith(atk.extraPrizePrefix)) prizeValue += atk.extraPrizeCount;
            }
            if (side.active === pk) {
              var kissOwner = this.other(p);
              var hasKiss = this.players[kissOwner].allPokemon.some(function (h) {
                var a = h.ability; return a && a.trigger === "passive" && hasEff(a, "flipCoinExtraPrizeWhenOpponentActiveKnockedOut");
              });
              if (hasKiss) {
                if (this.flipCoin()) { prizeValue += 1; this.note("「ワンダーキッス」でコインがオモテ。サイドを1枚多くとる"); }
                else this.note("「ワンダーキッス」でコインがウラ");
              }
            }
            if (p !== this.currentPlayer && pk.data.stage === "basic" && pk.lastDamageTakenTurn === this.turnNumber) {
              var atkPk = this.players[this.currentPlayer].active;
              if (atkPk && atkPk.name === this.currentAttackerName && atkPk.ability && atkPk.ability.trigger === "passive" && hasEff(atkPk.ability, "extraPrizeWhenYourAttackKnocksOutOpponentBasic")) {
                prizeValue += 1;
                this.note("「" + atkPk.ability.name + "」で、サイドを1枚多くとる");
              }
            }
            if (p !== this.currentPlayer && side.active === pk && pk.lastDamageTakenTurn === this.turnNumber) {
              var atkSide = this.players[this.currentPlayer];
              if (atkSide.extraPrizeTeraTurn === this.turnNumber && atkSide.active && atkSide.active.name === this.currentAttackerName && atkSide.active.data.isTerastal) {
                prizeValue += atkSide.extraPrizeTeraCount;
                this.note("「ブライア」の効果で、サイドを" + atkSide.extraPrizeTeraCount + "枚多くとる");
              }
            }
            if (p !== this.currentPlayer && pk.lastDamageTakenTurn === this.turnNumber) {
              var pearl = false, tools = this.toolCards(pk);
              for (i = 0; i < tools.length; i++) {
                tt = tools[i] && tools[i].trainerData; if (!tt) continue;
                for (j = 0; j < tt.effects.length; j++) {
                  if (tt.effects[j].c === "toolReducePrizesWhenKnockedOutNamePrefix" && pk.data.name.startsWith(tt.effects[j].a[0])) pearl = true;
                }
              }
              if (pearl && prizeValue > 0) { prizeValue -= 1; this.note("「リーリエのしんじゅ」で、とられるサイドが1枚少なくなる"); }
              var legacy = false, ae = this.attachedEnergyEffects(pk);
              for (i = 0; i < ae.length; i++) if (ae[i].c === "energyReducePrizeOnceWhenKnockedOut") legacy = true;
              if (legacy && !this.players[p].legacyEnergyUsed && prizeValue > 0) {
                this.players[p].legacyEnergyUsed = true;
                prizeValue -= 1;
                this.note("「レガシーエネルギー」で、とられるサイドが1枚少なくなる");
              }
            }
            if (this.exAttackerPlayer != null && this.exAttackerPlayer !== p && prizeValue > 1) {
              var allP = side.allPokemon;
              for (i = 0; i < allP.length; i++) {
                ab = allP[i].ability;
                if (!ab || ab.trigger !== "passive") continue;
                var reduced = false;
                for (j = 0; j < ab.effects.length; j++) {
                  e = ab.effects[j];
                  if (e.c === "reducePrizesWhenYourTypePokemonKnockedOutByOpponentEx" && pk.data.type === e.a[0]) reduced = true;
                }
                if (reduced) { prizeValue -= 1; this.note("「" + ab.name + "」で、とられるサイドが1枚少なくなる"); break; }
              }
            }
            var noPrize = false;
            if (this.exAttackerPlayer != null && this.exAttackerPlayer !== p && pk.ability && pk.ability.trigger === "passive") {
              if (hasEff(pk.ability, "preventOpponentPrizesWhenKnockedOutByEx")) noPrize = true;
            }
            if (p !== this.currentPlayer) {
              if (this.players[p].lastKnockedOutTurn !== this.turnNumber) this.players[p].lastKnockedOutNames = [];
              this.players[p].lastKnockedOutTurn = this.turnNumber;
              this.players[p].lastKnockedOutNames.push(pk.name);
            }
            if (p !== this.currentPlayer && side.active === pk && pk.ability) {
              if (hasEff(pk.ability, "alsoWhenKnockedOutInActiveByAttack")) {
                this.note(pk.name + "の特性「" + pk.ability.name + "」が発動");
                for (i = 0; i < pk.ability.effects.length; i++) {
                  if (pk.ability.effects[i].c === "discardOpponentDeckTop") this.discardTopOfOpponentDeck(p, pk.ability.effects[i].a[0]);
                }
              }
            }
            var searchOnKO = false;
            if (p !== this.currentPlayer && pk.ability && pk.ability.trigger === "passive" && hasEff(pk.ability, "whenKnockedOutByOpponentAttackSearchDeckAnyCard")) searchOnKO = true;
            var koAbilityName = pk.ability ? pk.ability.name : "";
            var koName = pk.name;
            this.sendToDiscard(p, pk);
            if (searchOnKO && this.players[p].deck.length > 0) {
              this.note(koName + "の特性「" + koAbilityName + "」が発動");
              var picked = await this.pickCards(p, this.players[p].deck, 1, "手札に加えるカード");
              for (i = 0; i < picked.length; i++) {
                this.removeCard(this.players[p].deck, picked[i].id);
                this.players[p].hand.push(picked[i]);
                this.note("山札から「" + picked[i].name + "」を手札に加えた");
              }
              this.shuffleDeck(p);
            }
            if (noPrize) this.note(koName + "の特性「" + koAbilityName + "」で、相手はサイドをとれない");
            else this.takePrizes(this.other(p), prizeValue);
          }
        }
        if (!anyKnockout) break;
      }
      this.exAttackerPlayer = null;
      this.enforceToolLimits();
      this.checkWinConditions();
      if (this.result != null) return;
      for (var q = 0; q < 2; q++) {
        if (this.players[q].active == null && this.players[q].bench.length > 0) {
          var labels = [], slots = [];
          for (var b = 0; b < this.players[q].bench.length; b++) { labels.push(this.slotLabel(q, bench(b))); slots.push(bench(b)); }
          var idx = await this.ask(q, "promoteActive", "バトル場に出すポケモンを選んでください", labels, false, slots, q);
          if (idx == null) idx = 0;
          var newActive = this.players[q].bench.splice(idx, 1)[0];
          this.players[q].active = newActive;
          this.note("プレイヤー" + (q + 1) + "は" + newActive.name + "をバトル場に出した");
        }
      }
    }
  }
  G.BattleGame = BattleGame;

  // ---- 簡易エージェント（常に最初の選択肢）と自動対戦 ----
  G.FirstChoiceAgent = class {
    async chooseAction(game, p, actions) { return 0; }
    async choose(game, p, req) { return 0; }
  };
  G.runSelfPlay = async function (deckA, deckB, agents, seed) {
    var a = G.DeckList.makeBattleCards(deckA, 0, false), b = G.DeckList.makeBattleCards(deckB, 1000, false);
    var ag = agents || [new G.FirstChoiceAgent(), new G.FirstChoiceAgent()];
    var game = new BattleGame(a, b, ag, null, seed);
    var r = await game.run();
    return { result: r, turns: game.turnNumber, log: game.logLines, game: game };
  };

  if (typeof module !== "undefined") module.exports = G;
})(globalThis.PK = globalThis.PK || {});
// fx_a.js : BattleEffects.swift 1〜669 行（refreshStadiumEffects 〜 performAttack）の移植
// 担当範囲: コスト計算・エネルギー数・ダメージ計算・弱点抵抗・状態異常・inflict・performAttack
// （performAttackCore は fx_b.js の担当）
(function (G) {
  "use strict";

  // SpecialCondition.japaneseName（BattleModel.swift 22行〜）
  const CONDITION_JA = {
    poisoned: "どく",
    burned: "やけど",
    asleep: "ねむり",
    paralyzed: "マヒ",
    confused: "こんらん",
  };

  // cost から無色を1つ取り除く（firstIndex(of: .colorless) → remove）
  function removeOneColorless(cost) {
    const i = cost.indexOf("colorless");
    if (i >= 0) cost.splice(i, 1);
  }

  // 特性（ability）が passive でその効果の中に c が1つでもあるか（「if case .x = e」の contains 版）
  function abilityHas(ab, c) {
    return ab.effects.some((e) => e.c === c);
  }

  Object.assign(G.BattleGame.prototype, {

    // MARK: - ワザを使えるか
    /// スタジアムによる最大HP減少・特性無効を、場のポケモンに反映する
    refreshStadiumEffects() {
      let penalty = 0;
      let nullType = null;
      const stTrainer = this.stadiumCard ? this.stadiumCard.trainerData : null;
      if (stTrainer) {
        for (const e of stTrainer.effects) {
          if (e.c === "reduceMaxHPOfStage2Pokemon") { penalty = e.a[0]; }
          if (e.c === "nullifyAbilitiesOfType") { nullType = e.a[0]; }
        }
      }
      let negateRuleAbilities = false;
      for (const side of this.players) {
        const act = side.active;
        if (act && act.data.ability && act.data.ability.trigger === "passive") {
          const aab = act.data.ability;
          for (const e of aab.effects) {
            if (e.c === "negateRuleAbilitiesWhileActive") negateRuleAbilities = true;
          }
        }
      }
      for (const side of this.players) {
        for (const pk of side.allPokemon) {
          pk.stadiumHPPenalty = (pk.data.stage === "stage2") ? penalty : 0;
          pk.abilitySuppressed = (nullType != null && pk.data.type === nullType);
          if (negateRuleAbilities && (pk.data.prizeValue >= 2 || pk.name.endsWith("ex")) && !pk.data.isFuture) {
            pk.abilitySuppressed = true;
          }
          pk.abilityHPBonus = 0;
          const ownerIdx0 = (this.players[0].allPokemon.some((x) => x === pk)) ? 0 : 1;
          let teamHPBonus = 0;
          for (const holder of this.players[ownerIdx0].allPokemon) {
            const hab = holder.ability;
            if (!(hab && hab.trigger === "passive")) continue;
            for (const e of hab.effects) {
              if (e.c === "boostMaxHPOfAllYourPokemon") { teamHPBonus = Math.max(teamHPBonus, e.a[0]); }
            }
          }
          pk.abilityHPBonus += teamHPBonus;
          const ab = pk.ability;
          if (ab && ab.trigger === "passive") {
            const ownerIdx = (this.players[0].allPokemon.some((x) => x === pk)) ? 0 : 1;
            const taken = this.rules.prizeCount - this.players[1 - ownerIdx].prizes.length;
            for (const e of ab.effects) {
              if (e.c === "maxHPBonusPerOpponentPrizeTaken") { pk.abilityHPBonus += taken * e.a[0]; }
              if (e.c === "maxHPBonusPerAttachedEnergy") {
                const [t, per] = e.a;
                pk.abilityHPBonus += pk.attachedEnergy.filter((x) => x.energyType === t).length * per;
              }
              if (e.c === "maxHPBonusIfSelfHasEnergyOfType") {
                const [t, bonusHP] = e.a;
                if (pk.attachedEnergy.some((x) => x.energyType === t)) {
                  pk.abilityHPBonus += bonusHP;
                }
              }
            }
          }
        }
      }
      for (let owner = 0; owner < 2; owner++) {
        const act = this.players[owner].active;
        if (!act) continue;
        const aab = act.ability;
        if (!(aab && aab.trigger === "passive")) continue;
        if (aab.effects.some((x) => x.c === "suppressOpponentActiveAbilities")) {
          const oppAct = this.players[1 - owner].active;
          if (oppAct) {
            const oppAbName = oppAct.data.ability ? oppAct.data.ability.name : null;
            if (oppAbName !== aab.name) {
              oppAct.abilitySuppressed = true;
            }
          }
        }
      }
    },

    effectiveCost(pk, attack) {
      let cost = [...attack.cost];
      for (const effect of attack.effects) {
        if (effect.c === "costBecomesIfDamaged" && pk.damage > 0) {
          cost = [...effect.a[0]];
        }
      }
      // オンバーン「チューニングエコー」/ ガチグマ アカツキex「ろうれんのわざ」
      {
        const ab = pk.ability;
        if (ab && ab.trigger === "passive") {
          const owner0 = this.ownerIndex(pk);
          for (const e of ab.effects) {
            if (e.c === "noEnergyForOwnAttackIfHandSizesEqual" && attack.name === e.a[0]
              && this.players[owner0].hand.length === this.players[1 - owner0].hand.length) { cost = []; }
            if (e.c === "reduceColorlessCostForOwnAttackPerOpponentPrizeTaken" && attack.name === e.a[0]) {
              let reduce = this.rules.prizeCount - this.players[1 - owner0].prizes.length;
              while (reduce > 0) {
                removeOneColorless(cost);
                reduce -= 1;
              }
            }
          }
        }
      }
      // ガオガエンex「ハッスルプレー」: 相手のベンチポケモンの数ぶん、無色エネルギーが少なくなる
      {
        const ab = pk.ability;
        if (ab && ab.trigger === "passive" && ab.effects.some((e) => e.c === "reduceColorlessCostPerOpponentBenched")) {
          let reduce = this.players[1 - this.ownerIndex(pk)].bench.length;
          while (reduce > 0) {
            removeOneColorless(cost);
            reduce -= 1;
          }
        }
      }
      // ケケンカニ・ミガルーサ「したごしらえ」: トラッシュにある指定カードの枚数ぶん、無色エネルギーが少なくなる
      {
        const ab = pk.ability;
        if (ab && ab.trigger === "passive") {
          for (const e of ab.effects) {
            if (e.c === "reduceColorlessCostPerNamedCardInDiscard") {
              const name = e.a[0];
              let reduce = this.players[this.ownerIndex(pk)].discard.filter((x) => x.name === name).length;
              while (reduce > 0) {
                removeOneColorless(cost);
                reduce -= 1;
              }
            }
          }
        }
      }
      // スタジアム「夜の鉱山」
      if (pk.data.isTerastal) {
        const st = this.stadiumCard ? this.stadiumCard.trainerData : null;
        if (st) {
          for (const e of st.effects) {
            if (e.c === "terastalAttackCostPlusColorless") {
              const n = e.a[0];
              let k = 0;
              while (k < n) { cost.push("colorless"); k += 1; }
            }
          }
        }
      }
      // ポケモンのどうぐ「カウンターゲイン」「ホップのこだわりハチマキ」
      const owner = this.ownerIndex(pk);
      for (const toolCard of this.toolCards(pk)) {
        const t = toolCard ? toolCard.trainerData : null;
        if (!t) continue;
        for (const e of t.effects) {
          if (e.c === "toolReduceOneAnyEnergyForTerastal" && pk.data.isTerastal) {
            const i = cost.indexOf("colorless");
            if (i >= 0) cost.splice(i, 1);
            else if (cost.length > 0) cost.pop();
          }
          if (e.c !== "toolAttackCostReduceColorless") continue;
          const [prefix, needMore] = e.a;
          if (prefix != null && !pk.data.name.startsWith(prefix)) continue;
          if (needMore && !(this.players[owner].prizes.length > this.players[this.other(owner)].prizes.length)) continue;
          removeOneColorless(cost);
        }
      }
      return cost;
    },

    /// メガニウム「おいしげる」: 基本エネルギー1枚が2個ぶんとしてはたらくタイプ
    doubledEnergyType(owner) {
      for (const pk of this.players[owner].allPokemon) {
        const ability = pk.ability;
        if (!(ability && ability.trigger === "passive")) continue;
        for (const e of ability.effects) {
          if (e.c === "basicEnergyCountsAsDouble") return e.a[0];
        }
      }
      return null;
    },

    ownerIndex(pk) {
      return this.players[0].allPokemon.some((x) => x === pk) ? 0 : 1;
    },

    /// ついているエネルギーの「個数」（おいしげるを考えた数）
    energyUnits(pk) {
      const doubled = this.doubledEnergyType(this.ownerIndex(pk));
      let total = 0;
      for (const e of pk.attachedEnergy) {
        total += this.energyUnit(e, pk, doubled);
      }
      return total;
    },

    /// ついているエネルギー1枚が「何個ぶん」か（おいしげる・特殊エネルギーを考える）
    energyUnit(card, pk, doubled) {
      if (doubled === undefined) doubled = null;
      if (card.isSpecialEnergy) return card.specialEnergyUnits(pk.data.stage !== "basic");
      return (doubled != null && card.energyType === doubled) ? 2 : 1;
    },

    /// 自分の番の終わりに、自分のポケモンについている「番の終わりにトラッシュする」特殊エネルギーをトラッシュする
    discardEndOfTurnEnergy(p) {
      const me = this.players[p];
      for (const pk of me.allPokemon) {
        const leaving = pk.attachedEnergy.filter((x) => x.discardsAtEndOfYourTurn);
        if (leaving.length === 0) continue;
        for (const c of leaving) {
          this.removeCard(pk.attachedEnergy, c.id);
          me.discard.push(c);
          this.note(`${pk.name}についていた${c.name}をトラッシュした`);
        }
      }
    },

    // canPayCost(cost, energy, doubled = null, evolved = false)
    // （第3引数にオブジェクト {doubled, evolved} を渡す形も許容）
    canPayCost(cost, energy, doubled, evolved) {
      if (doubled !== null && typeof doubled === "object") {
        const o = doubled;
        doubled = o.doubled === undefined ? null : o.doubled;
        evolved = o.evolved === undefined ? false : o.evolved;
      }
      if (doubled === undefined) doubled = null;
      if (evolved === undefined) evolved = false;
      const available = {};
      const addAvail = (t, n) => { available[t] = (available[t] || 0) + n; };
      let wild = 0;
      for (const e of energy) {
        if (e.isSpecialEnergy) {
          if (e.isAllTypesEnergy) {
            wild += 1;
            continue;
          }
          const types = e.dualEnergyTypes;
          if (types != null) {
            for (const t of types) addAvail(t, 1);
          } else if (e.isPrismEnergy) {
            if (evolved) addAvail("colorless", 1); else wild += 1;
          } else {
            addAvail("colorless", e.specialEnergyUnits(evolved));
          }
          continue;
        }
        const t = e.energyType;
        if (t != null) addAvail(t, (doubled != null && t === doubled) ? 2 : 1);
      }
      let colorlessNeeded = 0;
      for (const c of cost) {
        if (c === "colorless") {
          colorlessNeeded += 1;
        } else if (available[c] !== undefined && available[c] > 0) {
          available[c] = available[c] - 1;
        } else if (wild > 0) {
          wild -= 1;
        } else {
          return false;
        }
      }
      let leftover = wild;
      for (const k of Object.keys(available)) leftover += available[k];
      return leftover >= colorlessNeeded;
    },

    canUseAttack(pk, attack) {
      const until = pk.blockedAttackNames[attack.name];
      if (until !== undefined && until !== null && this.turnNumber <= until) return false;
      // トドゼルガ「とうけつファング」: エネルギーが少ないポケモンはワザが使えない
      const lockOwner = this.ownerIndex(pk);
      if (this.turnNumber <= this.players[lockOwner].attackLockUntilTurn && pk.attachedEnergy.length <= this.players[lockOwner].attackLockEnergyAtMost) return false;
      // テラパゴスex「ユニオンビート」: 後攻プレイヤーの最初の番には使えない
      if (attack.effects.some((x) => x.c === "cannotUseOnSecondPlayerFirstTurn")) {
        const owner = this.ownerIndex(pk);
        if (owner !== this.firstPlayer && this.players[owner].turnsTaken <= 1) return false;
      }
      if (attack.effects.some((x) => x.c === "onlyUsableOnSecondPlayerFirstTurn")) {
        const owner2 = this.ownerIndex(pk);
        if (owner2 === this.firstPlayer || this.players[owner2].turnsTaken > 1) return false;
      }
      if (attack.effects.some((x) => x.c === "cannotUseIfUsedThisAttackLastTurn")) {
        const owner3 = this.ownerIndex(pk);
        if (this.players[owner3].lastAttackName === attack.name && this.players[owner3].lastAttackTurn === this.turnNumber - 2) return false;
      }
      // ケッキングex「さぼりたいしつ」: 相手の場に「ポケモンex」がいないなら、ワザが使えない
      const ab0 = pk.ability;
      if (ab0 && ab0.trigger === "passive"
        && ab0.effects.some((e) => e.c === "cannotAttackUnlessOpponentHasPokemonEx")
        && !this.players[1 - this.ownerIndex(pk)].allPokemon.some((x) => x.data.prizeValue >= 2)) return false;
      // ロケット団のミュウツーex「パワーセーバー」
      const ab = pk.ability;
      if (ab && ab.trigger === "passive") {
        for (const e of ab.effects) {
          if (e.c === "cannotAttackUnlessYouHaveNamePrefixPokemon") {
            const [prefix, n] = e.a;
            if (this.players[this.ownerIndex(pk)].allPokemon.filter((x) => x.name.startsWith(prefix)).length < n) return false;
          }
        }
      }
      return this.canPayCost(this.effectiveCost(pk, attack), pk.attachedEnergy, this.doubledEnergyType(this.ownerIndex(pk)), pk.data.stage !== "basic");
    },

    // MARK: - ダメージ計算
    // 順番: ①ワザのダメージ → ②攻撃側の効果(+30など) → ③弱点(×2) → ④抵抗力(-30) → ⑤防御側の効果(-30など)
    // 同じ名前の特性は重ねがけしない（1つぶんだけ効く）
    // attackBonus(p, attacker)
    attackBonus(p, attacker) {
      let bonus = 0;
      {
        const d = this.players[this.other(p)].active;
        if (this.players[p].exDamageBonusThisTurn > 0 && d && (d.data.prizeValue > 1 || d.name.endsWith("ex"))) {
          bonus += this.players[p].exDamageBonusThisTurn;
        }
      }
      for (const boost of this.players[p].attackBoostsThisTurn) {
        if (boost.type === attacker.data.type) bonus += boost.amount;
      }
      {
        const own = attacker.ability;
        if (own && own.trigger === "passive") {
          for (const e of own.effects) {
            if (e.c === "boostOwnAttackDamageIfYouHaveMegaEx") {
              const [type, amount] = e.a;
              if (this.hasMegaEx(p, type)) bonus += amount;
            }
            if (e.c === "boostOwnAttackDamageIfSelfHasEnergyOfType") {
              const [t, amount] = e.a;
              if (attacker.attachedEnergy.some((x) => x.energyType === t)) bonus += amount;
            }
          }
        }
      }
      {
        const own = attacker.ability;
        if (own && own.trigger === "passive") {
          for (const e of own.effects) {
            if (e.c === "boostOwnAttackDamagePerOpponentPrizeTaken") {
              bonus += (this.rules.prizeCount - this.players[this.other(p)].prizes.length) * e.a[0];
            }
          }
        }
      }
      {
        const own = attacker.ability;
        const oppActive = this.players[this.other(p)].active;
        if (own && own.trigger === "passive" && oppActive && oppActive.ability != null) {
          for (const e of own.effects) {
            if (e.c === "boostOwnAttackDamageIfDefenderHasAbility") bonus += e.a[0];
          }
        }
      }
      if (attacker.selfAttackBoostTurn === this.turnNumber) bonus += attacker.selfAttackBoost;
      const usedNames = new Set();
      for (const pk of this.players[p].allPokemon) {
        const ability = pk.ability;
        if (!(ability && ability.trigger === "passive")) continue;
        if (usedNames.has(ability.name)) continue;
        for (const effect of ability.effects) {
          if (effect.c === "boostAttackDamageOfAllYourPokemon") {
            bonus += effect.a[0];
            usedNames.add(ability.name);
          }
          if (effect.c === "boostAttackDamageOfYourPokemon" && effect.a[0] === attacker.data.type) {
            bonus += effect.a[1];
            usedNames.add(ability.name);
          }
          if (effect.c === "boostAttackDamageOfYourFuturePokemonExceptSelf" && attacker.data.isFuture && attacker.data.name !== "テツノカシラex") {
            bonus += effect.a[0];
            usedNames.add(ability.name);
          }
          if (effect.c === "boostAttackDamageOfYourNamePrefixPokemon" && attacker.data.name.startsWith(effect.a[0])) {
            bonus += effect.a[1];
            usedNames.add(ability.name);
          }
        }
      }
      return bonus;
    },

    // defenseReduction(owner, defender)
    defenseReduction(owner, defender) {
      let reduction = 0;
      if (this.turnNumber <= defender.damageReductionUntilTurn) reduction += defender.damageReduction;
      for (const effect of this.players[owner].damageReductions) {
        if (this.turnNumber <= effect.untilTurn && (effect.allTypes || effect.type === defender.data.type)) {
          reduction += effect.amount;
        }
      }
      // ギギギアル「ギアコーティング」: ○エネルギーがついている自分のポケモン全員が受けるワザのダメージを−○する
      for (const holder of this.players[owner].allPokemon) {
        const ab = holder.ability;
        if (!(ab && ab.trigger === "passive")) continue;
        for (const e of ab.effects) {
          if (e.c === "reduceDamageTakenByYourPokemonWithEnergyOfType") {
            const [t, n] = e.a;
            if (defender.attachedEnergy.some((x) => x.energyType === t)) reduction += n;
          }
        }
      }
      return reduction;
    },

    // finalDamage(base, p, attacker, defender, defenderOwner, ignoreWeakness, ignoreResistance, ignoreDefenderEffects = false)
    // （第1引数に {base, by, attacker, defender, defenderOwner, ignoreWeakness, ignoreResistance, ignoreDefenderEffects} を渡す形も許容）
    finalDamage(base, p, attacker, defender, defenderOwner, ignoreWeakness, ignoreResistance, ignoreDefenderEffects) {
      if (base !== null && typeof base === "object") {
        const o = base;
        base = o.base;
        p = o.by !== undefined ? o.by : o.p;
        attacker = o.attacker;
        defender = o.defender;
        defenderOwner = o.defenderOwner;
        ignoreWeakness = o.ignoreWeakness;
        ignoreResistance = o.ignoreResistance;
        ignoreDefenderEffects = o.ignoreDefenderEffects;
      }
      if (ignoreDefenderEffects === undefined) ignoreDefenderEffects = false;
      ignoreWeakness = !!ignoreWeakness;
      ignoreResistance = !!ignoreResistance;

      let amount = base;
      {
        const ab = defender.ability;
        if (attacker.data.prizeValue >= 2 && ab && ab.trigger === "passive"
          && ab.effects.some((x) => x.c === "immuneToAttackDamageFromOpponentEx")) {
          this.note(`${defender.name}の「${ab.name}」で、ダメージを受けない`);
          return 0;
        }
      }
      {
        const ab = defender.ability;
        if (attacker.data.prizeValue >= 2 && attacker.data.stage === "basic" && ab && ab.trigger === "passive"
          && ab.effects.some((x) => x.c === "immuneToAttackDamageFromOpponentBasicEx")) {
          this.note(`${defender.name}の「${ab.name}」で、ダメージを受けない`);
          return 0;
        }
      }
      {
        const ab = defender.ability;
        if (attacker.data.ability != null && ab && ab.trigger === "passive"
          && ab.effects.some((x) => x.c === "immuneToAttackDamageFromOpponentPokemonWithAbility")) {
          this.note(`${defender.name}の「${ab.name}」で、ダメージを受けない`);
          return 0;
        }
      }
      {
        const ab = defender.ability;
        if (attacker.data.isTerastal && ab && ab.trigger === "passive"
          && ab.effects.some((x) => x.c === "immuneToAttacksFromOpponentTerastal")) {
          this.note(`${defender.name}の「${ab.name}」で、ダメージを受けない`);
          return 0;
        }
      }
      {
        const dab = defender.ability;
        if (dab && dab.trigger === "passive") {
          for (const e of dab.effects) {
            if (e.c === "flipCoinPreventDamageIfSelfHasEnergyOfType") {
              const t = e.a[0];
              if (defender.attachedEnergy.some((x) => x.energyType === t)) {
                if (this.flipCoin()) {
                  this.note(`${defender.name}の「${dab.name}」で、ダメージを受けない`);
                  return 0;
                }
              }
            }
          }
        }
      }
      amount += this.attackBonus(p, attacker);
      {
        const st = this.stadiumCard ? this.stadiumCard.trainerData : null;
        if (st) {
          for (const e of st.effects) {
            if (e.c === "boostAttackDamageOfNamePrefixBothPlayers") {
              const [prefix, n] = e.a;
              if (attacker.data.name.startsWith(prefix)) amount += n;
            }
          }
        }
      }
      for (const toolCard of this.toolCards(attacker)) {
        const t = toolCard ? toolCard.trainerData : null;
        if (!t) continue;
        for (const e of t.effects) {
          if (e.c === "toolBonusDamageIfPoisoned" && attacker.conditions.has("poisoned")) amount += e.a[0];
          if (e.c !== "toolAttackDamageBonus") continue;
          const [n, prefix, excludeRule, onlyEx] = e.a;
          if (prefix != null && !attacker.data.name.startsWith(prefix)) continue;
          if (excludeRule && (attacker.data.prizeValue > 1 || attacker.data.name.endsWith("ex"))) continue;
          if (onlyEx && !(defender.data.prizeValue > 1 || defender.data.name.endsWith("ex"))) continue;
          amount += n;
        }
      }
      if (!ignoreWeakness && defender.noWeaknessUntilTurn < this.turnNumber) {
        const weakness = this.effectiveWeakness(defender, defenderOwner);
        if (weakness != null && weakness === attacker.data.type) {
          amount *= 2;
        }
      }
      if (!ignoreResistance) {
        const resistance = defender.data.resistance;
        if (resistance != null && resistance === attacker.data.type) {
          amount -= 30;
        }
      }
      if (!ignoreDefenderEffects) amount -= this.defenseReduction(defenderOwner, defender);
      if (!ignoreDefenderEffects && this.turnNumber === defender.extraDamageTakenTurn) amount += defender.extraDamageTaken;
      if (!ignoreDefenderEffects) {
        const holder = this.players[defenderOwner].active;
        const ability = holder ? holder.ability : null;
        if (holder && ability && ability.trigger === "passive") {
          for (const e of ability.effects) {
            if (e.c === "reduceDamageOfOpponentActiveAttacks") amount -= e.a[0];
          }
        }
      }
      if (!ignoreDefenderEffects) {
        for (const toolCard of this.toolCards(defender)) {
          const t = toolCard ? toolCard.trainerData : null;
          if (!t) continue;
          for (const e of t.effects) {
            if (e.c === "toolReduceDamageFromTypes") {
              const [holder, types, n] = e.a;
              if (defender.data.type === holder && types.includes(attacker.data.type)) amount -= n;
            }
            if (e.c === "toolBerry") {
              const [berryType, n] = e.a;
              if (base > 0 && attacker.data.type === berryType) amount -= n;
            }
          }
        }
      }
      if (!ignoreDefenderEffects && defender.data.type === "colorless" && defender.data.stage === "basic") {
        let applied = false;
        for (const holder of this.players[defenderOwner].allPokemon) {
          if (applied) continue; // where !applied
          const ab = holder.ability;
          if (!(ab && ab.trigger === "passive")) continue;
          for (const e of ab.effects) {
            if (e.c === "reduceDamageToYourColorlessBasicWhenTwoNamed") {
              const [name, n] = e.a;
              if (this.players[defenderOwner].allPokemon.filter((x) => x.name === name).length >= 2) {
                amount -= n;
                applied = true;
              }
            }
          }
        }
      }
      {
        const ability = defender.ability;
        if (ability && ability.trigger === "passive") {
          for (const e of ability.effects) {
            if (e.c === "reduceDamageFromAttackersOfTypes") {
              const [types, n] = e.a;
              if (types.includes(attacker.data.type)) amount -= n;
            }
            if (e.c === "reduceDamageTakenFromAttacks") {
              const n = e.a[0];
              const needsEnergy = ability.effects.some((x) => x.c === "requiresSelfHasEnergy");
              if (!needsEnergy || defender.attachedEnergy.length > 0) amount -= n;
            }
          }
        }
      }
      if (!ignoreDefenderEffects) {
        for (const toolCard of this.toolCards(defender)) {
          const tool = toolCard ? toolCard.trainerData : null;
          if (!(tool && attacker.ability != null)) continue;
          for (const e of tool.effects) {
            if (e.c === "reduceDamageFromAttackersWithAbility") amount -= e.a[0];
          }
        }
      }
      if (this.turnNumber <= attacker.outgoingDamageReductionUntilTurn) amount -= attacker.outgoingDamageReduction;
      return Math.max(amount, 0);
    },

    /// ベンチなどへのダメージ（弱点・抵抗力は計算しない）
    // dealDirectDamage(pk, amount, ignoreEffectsOnTarget = false)   ※Swiftの `to:` ラベルは位置引数
    dealDirectDamage(pk, amount, ignoreEffectsOnTarget) {
      if (ignoreEffectsOnTarget === undefined) ignoreEffectsOnTarget = false;
      if (!ignoreEffectsOnTarget && pk.protectedUntilTurn >= this.turnNumber) {
        this.note(`${pk.name}はワザのダメージや効果を受けない`);
        return;
      }
      // イワパレス「しんぴのいしゃど」: 相手の「ポケモンex」のワザのダメージを受けない
      {
        const ab = pk.ability;
        if (this.ownerIndex(pk) !== this.currentPlayer && this.exAttackerPlayer === this.currentPlayer && ab && ab.trigger === "passive"
          && ab.effects.some((x) => x.c === "immuneToAttackDamageFromOpponentEx")) {
          this.note(`${pk.name}の「${ab.name}」で、ダメージを受けない`);
          return;
        }
      }
      // リキキリンex「テイルアーマー」: 相手のたねポケモンの「ポケモンex」からワザのダメージを受けない
      {
        const atkr = this.players[this.currentPlayer].active;
        const ab = pk.ability;
        if (this.ownerIndex(pk) !== this.currentPlayer && atkr && atkr.data.prizeValue >= 2 && atkr.data.stage === "basic" && ab && ab.trigger === "passive"
          && ab.effects.some((x) => x.c === "immuneToAttackDamageFromOpponentBasicEx")) {
          this.note(`${pk.name}の「${ab.name}」で、ダメージを受けない`);
          return;
        }
      }
      // オーガポンex「いしずえのかまえ」: 相手の特性を持つポケモンからワザのダメージを受けない
      {
        const atkr = this.players[this.currentPlayer].active;
        const ab = pk.ability;
        if (this.ownerIndex(pk) !== this.currentPlayer && atkr && atkr.data.ability != null && ab && ab.trigger === "passive"
          && ab.effects.some((x) => x.c === "immuneToAttackDamageFromOpponentPokemonWithAbility")) {
          this.note(`${pk.name}の「${ab.name}」で、ダメージを受けない`);
          return;
        }
      }
      // カスミのコイキング「すごいもぐる」: ベンチにいるかぎり、相手のワザのダメージを受けない
      {
        const ab = pk.ability;
        if (this.ownerIndex(pk) !== this.currentPlayer && this.players[this.ownerIndex(pk)].bench.some((x) => x === pk) && ab && ab.trigger === "passive"
          && ab.effects.some((e) => e.c === "immuneToAttacksWhileBenched" || e.c === "immuneToAttackDamageWhileBenched")) {
          this.note(`${pk.name}は、ベンチにいるのでワザのダメージを受けない`);
          return;
        }
      }
      // 「テラスタル」のポケモンは、ベンチにいるかぎり、ワザのダメージを受けない
      if (pk.data.isTerastal && this.players[this.ownerIndex(pk)].bench.some((x) => x === pk)) {
        this.note(`${pk.name}は、ベンチにいるのでワザのダメージを受けない`);
        return;
      }
      // シェイミ「はなのカーテン」: 相手のワザでは、ベンチの（ルールを持たない）ポケモンはダメージを受けない
      const owner = this.ownerIndex(pk);
      if (owner !== this.currentPlayer && this.players[owner].bench.some((x) => x === pk) && !(pk.data.prizeValue > 1 || pk.name.endsWith("ex"))) {
        for (const holder of this.players[owner].allPokemon) {
          const ability = holder.ability;
          if (!(ability && ability.trigger === "passive")) continue;
          for (const e of ability.effects) {
            if (e.c === "protectYourBenchedNonRulePokemonFromOpponentAttackDamage") {
              this.note(`${holder.name}の「${ability.name}」で、${pk.name}はダメージを受けない`);
              return;
            }
          }
        }
      }
      const damageBefore = pk.damage;
      pk.damage += amount;
      this.applyAttackSurvival(pk, damageBefore);
      this.recordDamageTaken(pk, amount);
      this.note(`${pk.name}に${amount}ダメージ`);
    },

    /// ポケモンについているどうぐ（スタジアム「ジャミングタワー」があるときは、効果なし）
    /// 戻り値: [pk.tool, pk.extraTool]（BattleCard|null の配列）
    toolCards(pk) {
      if (this.stadiumHas((e) => e.c === "nullifyPokemonToolEffects")) return [];
      return [pk.tool, pk.extraTool];
    },

    /// ピカチュウex「がんばりハート」／メガルチャブルex「ふんばりボディ」: ワザのダメージできぜつするとき、HP10で残る
    applyAttackSurvival(pk, before) {
      const ab = pk.ability;
      if (!(pk.damage >= pk.hp && ab && ab.trigger === "passive")) return;
      for (const e of ab.effects) {
        switch (e.c) {
          case "surviveWithTenHPWhenKnockedOutIfFullHP":
            if (before === 0) {
              pk.damage = pk.hp - 10;
              this.note(`${pk.name}の「${ab.name}」で、残りHP10で場に残った`);
              return;
            }
            break;
          case "surviveWithTenHPWhenKnockedOutIfCoinHeads":
            if (this.flipCoin()) {
              pk.damage = pk.hp - 10;
              this.note(`${pk.name}の「${ab.name}」で、残りHP10で場に残った`);
              return;
            }
            break;
          default:
            break;
        }
      }
    },

    /// 弱点のタイプ（リーリエのピッピex「フェアリーゾーン」で、ドラゴンの弱点は超になる）
    effectiveWeakness(pk, owner) {
      if (this.turnNumber <= pk.weaknessColorlessUntilTurn) return "colorless";
      if (pk.data.type === "dragon") {
        for (const holder of this.players[this.other(owner)].allPokemon) {
          const ab = holder.ability;
          if (!(ab && ab.trigger === "passive")) continue;
          if (ab.effects.some((x) => x.c === "dragonWeaknessBecomesPsychicForOpponent")) {
            return "psychic";
          }
        }
      }
      if (pk.data.type === "darkness") {
        for (const holder of this.players[this.other(owner)].allPokemon) {
          const ab = holder.ability;
          if (!(ab && ab.trigger === "passive")) continue;
          if (ab.effects.some((x) => x.c === "darknessWeaknessBecomesPsychicForOpponent")) {
            return "psychic";
          }
        }
      }
      return pk.data.weakness;
    },

    /// 「古代」のポケモンか
    isAncientPokemon(pk) {
      return pk.data.isAncient;
    },

    /// ミカルゲ「うらみのうず」: 自分のバトル場の悪ポケモンがワザのダメージを受けたとき、使った相手のポケモンにダメカンをのせる
    // applyRevengeVortex(defenderOwner, defender, attacker)（オブジェクト {defenderOwner, defender, attacker} も許容）
    applyRevengeVortex(defenderOwner, defender, attacker) {
      if (defenderOwner !== null && typeof defenderOwner === "object") {
        const o = defenderOwner;
        defenderOwner = o.defenderOwner;
        defender = o.defender;
        attacker = o.attacker;
      }
      // デラックスボム・スパイクエネルギー（スタートデッキ100）
      this.applySD100RetaliationItems(defenderOwner, defender, attacker);
      // ポケモンのどうぐ「パンクメット」など
      for (const toolCard of this.toolCards(defender)) {
        const tool = toolCard ? toolCard.trainerData : null;
        if (!tool) continue;
        for (const effect of tool.effects) {
          if (effect.c === "attackerGetsCountersWhenAttachedActiveOfTypeDamaged") {
            const [type, counters] = effect.a;
            if (defender.data.type === type) {
              attacker.damage += counters * 10;
              this.note(`「${tool.name}」の効果で${attacker.name}にダメカンを${counters}個のせた`);
            }
          }
        }
      }
      // テツノイワオex「リパルサーアックス」: 次の相手の番、ワザのダメージを受けたとき、使ったポケモンにダメカンをのせる
      if (defender.retaliationUntilTurn >= this.turnNumber && defender.retaliationCounters > 0) {
        attacker.damage += defender.retaliationCounters * 10;
        this.note(`${defender.name}の効果で${attacker.name}にダメカンを${defender.retaliationCounters}個のせた`);
      }
      // ミミズズex「ボコスカがえし」: ワザのダメージを受けたとき、ついている○エネルギーの数×○個ぶんのダメカンを、ワザを使ったポケモンにのせる
      {
        const ab0 = defender.ability;
        if (ab0 && ab0.trigger === "passive") {
          for (const e of ab0.effects) {
            if (e.c === "placeCountersOnAttackerPerSelfEnergyWhenDamaged") {
              const [t, per] = e.a;
              const n = defender.attachedEnergy.filter((x) => x.energyType === t).length * per;
              if (n > 0) {
                attacker.damage += n * 10;
                this.note(`「${ab0.name}」の効果で${attacker.name}にダメカンを${n}個のせた`);
              }
            }
          }
        }
      }
      // ドンメル「しゃくねつボディ」など: バトル場でワザのダメージを受けたとき、使ったポケモンを特殊状態にする
      {
        const ability = defender.ability;
        if (this.players[defenderOwner].active === defender && ability && ability.trigger === "passive") {
          for (const e of ability.effects) {
            if (e.c === "inflictConditionOnAttackerWhenDamagedInActive") {
              const c = e.a[0];
              this.note(`「${ability.name}」の効果が発動`);
              this.inflict(c, attacker);
            }
            if (e.c === "placeCountersOnAttackerWhenDamagedInActive") {
              const counters = e.a[0];
              attacker.damage += counters * 10;
              this.note(`「${ability.name}」の効果で${attacker.name}にダメカンを${counters}個のせた`);
            }
          }
        }
      }
      const applied = new Set();
      for (const pk of this.players[defenderOwner].allPokemon) {
        const ability = pk.ability;
        if (!(ability && ability.trigger === "passive")) continue;
        if (applied.has(ability.name)) continue;
        for (const effect of ability.effects) {
          if (effect.c === "whenYourActiveOfTypeTakesAttackDamagePlaceCounterOnAttacker") {
            const [type, counters] = effect.a;
            if (defender.data.type === type) {
              applied.add(ability.name);
              attacker.damage += counters * 10;
              this.note(`「${ability.name}」の効果で${attacker.name}にダメカンを${counters}個のせた`);
            }
          }
        }
      }
    },

    inflict(condition, pk) {
      pk.addCondition(condition);
      this.note(`${pk.name}は${CONDITION_JA[condition]}になった`);
    },

    // MARK: - ワザの実行
    /// ワザを使う。カスミのコイキング「すごいもぐる」・ミロカロスex「きらめくウロコ」は、
    /// ワザのダメージだけでなく、ダメカンをのせる・エネルギーをトラッシュするなどの効果も受けない
    /// （ワザを使う前の状態を覚えておき、終わったあとに元にもどす）
    // performAttack(p, attackIndex, overrideAttack = null)  ※async。performAttackCore は fx_b.js
    async performAttack(p, attackIndex, overrideAttack) {
      if (overrideAttack === undefined) overrideAttack = null;
      const oppSide = this.players[this.other(p)];
      const pa = this.players[p].active;
      const attackerIsTerastal = pa ? pa.data.isTerastal : false;
      const protectedList = [];
      for (const pk of oppSide.allPokemon) {
        const ab = pk.ability;
        if (!(ab && ab.trigger === "passive")) continue;
        let guarded = false;
        const onBench = oppSide.bench.some((x) => x === pk);
        for (const e of ab.effects) {
          if (e.c === "immuneToAttacksWhileBenched" && onBench) guarded = true;
          if (e.c === "immuneToAttacksFromOpponentTerastal" && attackerIsTerastal) guarded = true;
        }
        // Swift は値型コピー: conditions(Set) と attachedEnergy(配列) は複製して保持
        if (guarded) protectedList.push({ pk, onBench, damage: pk.damage, conditions: new Set(pk.conditions), energy: [...pk.attachedEnergy] });
      }
      // ブーメランエネルギー: ワザの効果でトラッシュされたら、ワザのあとにもどす
      const boomerangHolder = this.players[p].active;
      const boomerangs = [];
      if (boomerangHolder) {
        for (const c of boomerangHolder.attachedEnergy) {
          const tt = c.trainerData;
          if (!(tt && tt.trainerKind === "specialEnergy")) continue;
          if (tt.effects.some((e) => e.c === "energyReattachIfDiscardedByYourAttackEffect")) boomerangs.push(c);
        }
      }
      await this.performAttackCore(p, attackIndex, overrideAttack);
      if (boomerangHolder && this.players[p].allPokemon.some((x) => x === boomerangHolder)) {
        for (const c of boomerangs) {
          const i = this.players[p].discard.findIndex((x) => x.id === c.id);
          if (i >= 0) {
            this.players[p].discard.splice(i, 1);
            boomerangHolder.attachedEnergy.push(c);
            this.note(`${c.name}を${boomerangHolder.name}につけなおした`);
          }
        }
      }
      for (const item of protectedList) {
        const stillThere = oppSide.allPokemon.some((x) => x === item.pk);
        const stillOnBench = oppSide.bench.some((x) => x === item.pk);
        if (!stillThere) continue;
        if (item.onBench && !stillOnBench) continue;
        if (item.pk.damage !== item.damage || item.pk.attachedEnergy.length !== item.energy.length) {
          this.note(`${item.pk.name}は、ワザの効果を受けない`);
        }
        item.pk.damage = item.damage;
        item.pk.conditions = item.conditions;
        item.pk.attachedEnergy = item.energy;
      }
    },
  });

  if (typeof module !== "undefined") module.exports = G;
})(globalThis.PK = globalThis.PK || {});
// fx_b.js : BattleEffects.swift 670〜1502 行（performAttackCore）の移植
// 担当範囲: performAttackCore（ワザ処理の中心。ワザを借りる系・失敗条件・ダメージを決める効果・ダメージ適用・ダメージ後効果の呼び出し）
// （performAttack は fx_a.js、applyAfterDamageEffect 以降は別担当）
(function (G) {
  "use strict";

  const J = (t) => G.energyJapaneseName(t);      // EnergyType.japaneseName
  const CJ = (c) => G.conditionJapaneseName(c);  // SpecialCondition.japaneseName

  Object.assign(G.BattleGame.prototype, {

    // performAttackCore(p, attackIndex, overrideAttack = null)  ※async
    async performAttackCore(p, attackIndex, overrideAttack) {
      if (overrideAttack === undefined) overrideAttack = null;
      const me = this.players[p];
      const oppIndex = this.other(p);
      const attacker = me.active;
      if (!attacker) return;
      if (!(attackIndex >= 0 && attackIndex < attacker.data.attacks.length)) return;
      const defender = this.players[oppIndex].active;
      if (!defender) return;
      const attack = overrideAttack != null ? overrideAttack : attacker.data.attacks[attackIndex];
      this.currentAttackerName = attacker.name;
      this.note(`⚔️ プレイヤー${p + 1}の${attacker.name}の「${attack.name}」`);
      this.players[p].lastAttackName = attack.name;
      this.players[p].lastAttackTurn = this.turnNumber;

      // ピクシー「ゆびをふる」: 相手のバトルポケモンが持つワザを借りる
      if (overrideAttack == null && attack.effects.some((e) => e.c === "useAttackOfOpponentActive")) {
        const borrowable = [];
        for (const a of defender.data.attacks) {
          if (!a.effects.some((e) => e.c === "useAttackOfOpponentActive")) borrowable.push(a);
        }
        if (borrowable.length === 0) {
          this.note("使えるワザがないので、ワザは失敗");
          return;
        }
        const labels = [];
        for (const a of borrowable) labels.push(a.name);
        const i = (await this.ask(p, "other", "使うワザを選んでください", labels)) ?? 0;
        await this.performAttack(p, attackIndex, borrowable[Math.max(0, Math.min(i, borrowable.length - 1))]);
        return;
      }

      // ロケット団のペルシアンex「こうまんしれい」: 相手の山札の上をオモテにして、その中のポケモンのワザを借りる
      let lookCountEffect = null;
      for (const e of attack.effects) {
        if (e.c === "revealOpponentDeckTopOptionallyUseAttack") { lookCountEffect = e; break; }
      }
      if (overrideAttack == null && lookCountEffect != null) {
        const lookCount = lookCountEffect.a[0];
        const oppPlayer = this.players[oppIndex];
        const top = [];
        let taken = 0;
        while (taken < lookCount && oppPlayer.deck.length > 0) {
          top.push(oppPlayer.deck.shift());
          taken += 1;
        }
        const names = [];
        for (const c of top) names.push(c.name);
        this.note(`相手の山札の上から${top.length}枚をオモテにした：${names.join("、")}`);
        const options = [];
        const labels = [];
        for (const c of top) {
          const d = c.pokemonData;
          if (!d) continue;
          for (const a of d.attacks) {
            if (a.effects.some((x) => x.c === "revealOpponentDeckTopOptionallyUseAttack" || x.c === "useAttackOfOpponentActive")) continue;
            options.push(a);
            labels.push(`${c.name}の「${a.name}」`);
          }
        }
        oppPlayer.deck.push(...top);
        this.shuffleDeck(oppIndex);
        if (options.length === 0) {
          this.note("使えるワザがないので、何も起こらなかった");
          return;
        }
        const i = await this.ask(p, "other", "このワザとして使うワザを選んでください（使わないなら「選ばない」）", labels, true);
        if (i == null) {
          this.note("ワザは使わなかった");
          return;
        }
        await this.performAttack(p, attackIndex, options[Math.max(0, Math.min(i, options.length - 1))]);
        return;
      }

      // ロケット団のミミッキュ「ほうせきごっこ」: 相手のバトル場のテラスタルのポケモンのワザを借りる
      if (overrideAttack == null && attack.effects.some((e) => e.c === "useAttackOfOpponentActiveTerastal")) {
        if (!(defender.data.isTerastal && defender.data.attacks.length > 0)) {
          this.note("相手のバトルポケモンが「テラスタル」ではないので、ワザは失敗");
          return;
        }
        const labels = [];
        for (const a of defender.data.attacks) labels.push(a.name);
        const i = (await this.ask(p, "other", "使うワザを選んでください", labels)) ?? 0;
        await this.performAttack(p, attackIndex, defender.data.attacks[Math.max(0, Math.min(i, labels.length - 1))]);
        return;
      }

      // Nのゾロアークex「ナイトジョーカー」: ベンチの「Nのポケモン」のワザを借りる
      let prefixEffect = null;
      for (const e of attack.effects) {
        if (e.c === "useAttackOfBenchedNamePrefixPokemon") { prefixEffect = e; break; }
      }
      if (overrideAttack == null && prefixEffect != null) {
        const prefix = prefixEffect.a[0];
        const options = [];
        const labels = [];
        for (const b of me.bench) {
          if (!b.name.startsWith(prefix)) continue;
          for (const a of b.data.attacks) {
            if (a.effects.some((e) => e.c === "useAttackOfBenchedNamePrefixPokemon")) continue;
            options.push(a);
            labels.push(`${b.name}の「${a.name}」`);
          }
        }
        if (options.length === 0) {
          this.note(`ベンチに使えるワザを持つ「${prefix}ポケモン」がいないので、ワザは失敗`);
          return;
        }
        const i = (await this.ask(p, "other", "使うワザを選んでください", labels)) ?? 0;
        await this.performAttack(p, attackIndex, options[Math.max(0, Math.min(i, options.length - 1))]);
        return;
      }

      // こんらん: コインがウラなら自分に30ダメージでワザは失敗
      if (attacker.conditions.has("confused")) {
        if (!this.flipCoin()) {
          attacker.damage += 30;
          this.note(`こんらんで${attacker.name}は自分に30ダメージ。ワザは失敗`);
          return;
        }
      }
      // すなかけ: コインがウラならワザは失敗
      if (this.turnNumber <= attacker.mustFlipToAttackUntilTurn) {
        if (!this.flipCoin()) {
          this.note("「すなかけ」の効果でワザは失敗");
          return;
        }
      }
      // ワザそのものが失敗する条件
      for (const effect of attack.effects) {
        if (effect.c === "failUnlessDefenderIsPokemonEx" && defender.data.prizeValue < 2) {
          this.note("相手のバトルポケモンが「ポケモンex」ではないので、ワザは失敗");
          return;
        }
        if (effect.c === "failUnlessDefenderHasCondition") {
          const c = effect.a[0];
          if (!defender.conditions.has(c)) {
            this.note(`相手のバトルポケモンが${CJ(c)}ではないので、ワザは失敗`);
            return;
          }
        }
        if (effect.c === "failUnlessOpponentPrizesRemainingIn") {
          const list = effect.a[0];
          if (!list.includes(this.players[oppIndex].prizes.length)) {
            this.note("相手のサイドの残り枚数が条件に合わないので、ワザは失敗");
            return;
          }
        }
        if (effect.c === "failUnlessStadiumInPlay" && this.stadiumCard == null) {
          this.note("場にスタジアムが出ていないので、ワザは失敗");
          return;
        }
        if (effect.c === "failIfYourBenchCountAtMost") {
          const n = effect.a[0];
          if (me.bench.length <= n) {
            this.note(`ベンチポケモンが${n}匹以下なので、ワザは失敗`);
            return;
          }
        }
        if (effect.c === "failUnlessHandSizesEqual" && me.hand.length !== this.players[oppIndex].hand.length) {
          this.note("自分と相手の手札の枚数がちがうので、ワザは失敗");
          return;
        }
        if (effect.c === "failUnlessHandSize") {
          const n = effect.a[0];
          if (me.hand.length !== n) {
            this.note(`手札が${n}枚ではないので、ワザは失敗`);
            return;
          }
        }
        if (effect.c === "failUnlessBenchHas") {
          const name = effect.a[0];
          if (!me.bench.some((x) => x.name === name)) {
            this.note(`ベンチに「${name}」がいないので、ワザは失敗`);
            return;
          }
        }
        if (effect.c === "discardBasicEnergyFromHandOrFail") {
          const [type, count] = effect.a;
          const have = me.hand.filter((x) => x.energyType === type);
          if (have.length < count) {
            this.note("手札に基本エネルギーが足りないので、ワザは失敗");
            return;
          }
          for (const c of have.slice(0, count)) {
            this.removeCard(me.hand, c.id);
            me.discard.push(c);
          }
          this.note(`手札の${J(type)}エネルギーを${count}枚トラッシュした`);
        }
        if (effect.c === "failUnlessBasicEnergyInYourDiscard") {
          const [type, count] = effect.a;
          if (me.discard.filter((x) => x.energyType === type).length < count) {
            this.note(`トラッシュに基本${J(type)}エネルギーが${count}枚以上ないので、ワザは失敗`);
            return;
          }
        }
        if (effect.c === "flipCoinTailsFailsHeadsProtectSelfNextTurn") {
          if (!this.flipCoin()) {
            this.note("コインはウラ！ワザは失敗");
            return;
          }
          attacker.protectedUntilTurn = this.turnNumber + 1;
          this.note(`コインはオモテ！${attacker.name}は次の相手の番、ワザのダメージや効果を受けない`);
        }
        if (effect.c === "flipCoinTailsFails") {
          if (!this.flipCoin()) {
            this.note("ワザは失敗");
            return;
          }
        }
      }

      this.exAttackerPlayer = (attacker.data.prizeValue >= 2) ? p : null;
      const isDefenderProtected = defender.protectedUntilTurn >= this.turnNumber
        || (defender.protectedFromExUntilTurn >= this.turnNumber && attacker.data.prizeValue >= 2)
        || (defender.protectedFromBasicUntilTurn >= this.turnNumber && attacker.data.stage === "basic")
        || (defender.protectedFromNonColorlessBasicUntilTurn >= this.turnNumber && attacker.data.stage === "basic" && attacker.data.type !== "colorless");
      let damage = attack.damage;
      {
        const boost = attacker.attackBoostByName[attack.name];
        if (boost && boost.turn === this.turnNumber) damage += boost.amount;
      }
      let ignoreWeakness = false;
      let ignoreResistance = false;
      let ignoreDefenderEffects = false;
      let paralyzeAfterDamage = false;
      {
        const ownAb = attacker.ability;
        if (ownAb && ownAb.trigger === "passive" &&
            ownAb.effects.some((e) => e.c === "ignoreEffectsOnDefenderForAllAttacks")) {
          ignoreDefenderEffects = true;
        }
      }

      // ダメージの大きさを決める効果
      for (const effect of attack.effects) {
        switch (effect.c) {
          case "damageAnyOpponentPokemon": {
            const n = effect.a[0];
            const candidates = this.slots(oppIndex);
            const slot = await this.chooseSlot(p, oppIndex, `${n}ダメージを与える相手のポケモンを選んでください`, candidates);
            if (slot != null) {
              if (slot.k === "a") {
                damage += n;
              } else {
                const target = this.pokemon(oppIndex, slot);
                if (target != null) this.dealDirectDamage(target, n);
              }
            }
            break;
          }
          case "bonusDamageIfSelfRemainingHPAtMost": {
            const [hp, bonus] = effect.a;
            if (attacker.remainingHP <= hp) damage += bonus;
            break;
          }
          case "bonusDamageIfYourPokemonKnockedOutLastOpponentTurn": {
            const bonus = effect.a[0];
            if (me.lastKnockedOutTurn === this.turnNumber - 1) damage += bonus;
            break;
          }
          case "damagePerYourPokemonWithAttackNamed": {
            const [name, per] = effect.a;
            damage += me.allPokemon.filter((pk) => pk.data.attacks.some((x) => x.name === name)).length * per;
            break;
          }
          case "damagePerYourToolInPlay": {
            const per = effect.a[0];
            let tools = 0;
            for (const pk of me.allPokemon) { if (pk.tool != null) tools += 1; if (pk.extraTool != null) tools += 1; }
            damage += tools * per;
            break;
          }
          case "bonusDamagePerToolInPlay": {
            const per = effect.a[0];
            let tools = 0;
            for (const pk of me.allPokemon) { if (pk.tool != null) tools += 1; if (pk.extraTool != null) tools += 1; }
            for (const pk of this.players[oppIndex].allPokemon) { if (pk.tool != null) tools += 1; if (pk.extraTool != null) tools += 1; }
            damage += tools * per;
            break;
          }
          case "bonusDamageIfSelfHealedThisTurn": {
            const bonus = effect.a[0];
            if (attacker.healedTurn === this.turnNumber) damage += bonus;
            break;
          }
          case "bonusDamageIfStadiumInPlayThenDiscardIt": {
            const bonus = effect.a[0];
            if (this.stadiumCard != null) damage += bonus;
            break;
          }
          case "bonusDamageIfDefenderIsPokemonEx": {
            const bonus = effect.a[0];
            if (defender.data.prizeValue >= 2) damage += bonus;
            break;
          }
          case "damagePerYourDamagedPokemonNameContaining": {
            const [word, per] = effect.a;
            damage += me.allPokemon.filter((pk) => pk.damage > 0 && pk.name.includes(word)).length * per;
            break;
          }
          case "damageAnyOpponentPokemonPerAttachedEnergy": {
            const [type, per] = effect.a;
            const n = attacker.attachedEnergy.filter((x) => x.energyType === type).length * per;
            const slot = await this.chooseSlot(p, oppIndex, `${n}ダメージを与える相手のポケモンを選んでください`, this.slots(oppIndex));
            if (slot != null) {
              if (slot.k === "a") {
                damage += n;
              } else {
                const target = this.pokemon(oppIndex, slot);
                if (target != null) this.dealDirectDamage(target, n);
              }
            }
            break;
          }
          case "bonusDamageIfOpponentPrizesRemainingAtMost": {
            const [c, b] = effect.a;
            if (this.players[oppIndex].prizes.length <= c) damage += b;
            break;
          }
          case "damageTwoOpponentPokemon": {
            const n = effect.a[0];
            const chosen = [];
            const pool = this.slots(oppIndex);
            let k = 0;
            while (k < 2 && pool.length > 0) {
              const slot = await this.chooseSlot(p, oppIndex, `${n}ダメージを与える相手のポケモンを選んでください（${k + 1}/2）`, pool);
              if (slot == null) break;
              chosen.push(slot);
              for (let i = pool.length - 1; i >= 0; i--) if (G.slotEq(pool[i], slot)) pool.splice(i, 1);
              k += 1;
            }
            for (const slot of chosen) {
              if (slot.k === "a") {
                damage += n;
              } else {
                const target = this.pokemon(oppIndex, slot);
                if (target != null) this.dealDirectDamage(target, n);
              }
            }
            break;
          }
          case "bonusDamageIfYourBenchHasNameContaining": {
            const [word, bonus] = effect.a;
            if (me.bench.some((x) => x.name.includes(word))) damage += bonus;
            break;
          }
          case "damagePerYourAncientPokemonInPlay": {
            const per = effect.a[0];
            damage += me.allPokemon.filter((x) => x.data.isAncient).length * per;
            break;
          }
          case "discardAnyBasicEnergyFromYourPokemonDamagePerEnergy": {
            const per = effect.a[0];
            let discarded = 0;
            while (true) {
              const labels = [];
              const refs = [];
              for (const pk of me.allPokemon) {
                for (let ei = 0; ei < pk.attachedEnergy.length; ei++) {
                  const e = pk.attachedEnergy[ei];
                  if (e.energyType != null) {
                    labels.push(`${pk.name}の${e.name}`);
                    refs.push([pk, ei]);
                  }
                }
              }
              if (labels.length === 0) break;
              const i = await this.ask(p, "card", `トラッシュする基本エネルギーを選んでください（${discarded}枚選択済み。やめるなら「選ばない」）`, labels, true);
              if (i == null) break;
              const [pk, ei] = refs[i];
              const e = pk.attachedEnergy.splice(ei, 1)[0];
              me.discard.push(e);
              discarded += 1;
            }
            this.note(`基本エネルギーを${discarded}枚トラッシュした`);
            damage += discarded * per;
            break;
          }
          case "damagePerOpponentExPokemonInPlay": {
            const per = effect.a[0];
            damage += this.players[oppIndex].allPokemon.filter((x) => x.data.prizeValue >= 2).length * per;
            break;
          }
          case "flipThreeCoinsBonusDamage": {
            const [one, two, three] = effect.a;
            let heads = 0;
            let fc = 0;
            while (fc < 3) { if (this.flipCoin()) heads += 1; fc += 1; }
            this.note(`コイン3回：オモテは${heads}回`);
            if (heads === 1) damage += one; else if (heads === 2) damage += two; else if (heads === 3) damage += three;
            break;
          }
          case "bonusDamageIfSelfPoisonedOrBurned": {
            const bonus = effect.a[0];
            if (attacker.conditions.has("poisoned") || attacker.conditions.has("burned")) damage += bonus;
            break;
          }
          case "bonusDamageIfOpponentBenchAtLeast": {
            const [count, bonus] = effect.a;
            if (this.players[oppIndex].bench.length >= count) damage += bonus;
            break;
          }
          case "bonusDamageIfSelfHasNoDamage": {
            const bonus = effect.a[0];
            if (attacker.damage === 0) damage += bonus;
            break;
          }
          case "bonusDamageIfSelfPoisoned": {
            const bonus = effect.a[0];
            if (attacker.conditions.has("poisoned")) damage += bonus;
            break;
          }
          case "bonusDamagePerBenchedStage2": {
            const per = effect.a[0];
            damage += me.bench.filter((x) => x.data.stage === "stage2").length * per;
            break;
          }
          case "bonusDamageIfDefenderIsStage2": {
            const bonus = effect.a[0];
            if (defender.data.stage === "stage2") damage += bonus;
            break;
          }
          case "bonusDamageIfDefenderIsEvolution": {
            const bonus = effect.a[0];
            if (defender.data.stage !== "basic") damage += bonus;
            break;
          }
          case "damagePerYourBasicPokemonInPlay": {
            const per = effect.a[0];
            damage += me.allPokemon.filter((x) => x.data.stage === "basic").length * per;
            break;
          }
          case "bonusDamageIfAnyYourBenchedDamaged": {
            const bonus = effect.a[0];
            if (me.bench.some((x) => x.damage > 0)) damage += bonus;
            break;
          }
          case "bonusDamageIfOpponentHasFuturePokemon": {
            const bonus = effect.a[0];
            if (this.players[oppIndex].allPokemon.some((x) => x.data.isFuture)) damage += bonus;
            break;
          }
          case "bonusDamageIfYourTotalEnergyInPlayAtLeast": {
            const [count, bonus] = effect.a;
            let totalEnergyUnits = 0;
            for (const pk of me.allPokemon) totalEnergyUnits += this.energyUnits(pk);
            if (totalEnergyUnits >= count) damage += bonus;
            break;
          }
          case "damageTwoOpponentPokemonIgnoringEffects": {
            const n = effect.a[0];
            const chosen = [];
            const pool = this.slots(oppIndex);
            let k = 0;
            while (k < 2 && pool.length > 0) {
              const slot = await this.chooseSlot(p, oppIndex, `${n}ダメージを与える相手のポケモンを選んでください（${k + 1}/2）`, pool);
              if (slot == null) break;
              chosen.push(slot);
              for (let i = pool.length - 1; i >= 0; i--) if (G.slotEq(pool[i], slot)) pool.splice(i, 1);
              k += 1;
            }
            for (const slot of chosen) {
              if (slot.k === "a") {
                damage += n;
                ignoreWeakness = true;
                ignoreResistance = true;
                ignoreDefenderEffects = true;
              } else {
                const target = this.pokemon(oppIndex, slot);
                if (target != null) this.dealDirectDamage(target, n, true);
              }
            }
            break;
          }
          case "bonusDamageIfSelfHasDamage": {
            const bonus = effect.a[0];
            if (attacker.damage > 0) damage += bonus;
            break;
          }
          case "bonusDamageEqualToDamageTakenLastOpponentTurn": {
            if (attacker.lastDamageTakenTurn === this.turnNumber - 1) damage += attacker.lastDamageTaken;
            break;
          }
          case "bonusDamageIfMovedBenchToActiveThisTurn": {
            const bonus = effect.a[0];
            if (attacker.movedToActiveTurn === this.turnNumber) damage += bonus;
            break;
          }
          case "ignoreDefenderEffects": {
            ignoreDefenderEffects = true;
            break;
          }
          case "discardAnyYourEnergyOfTypeDamagePerEnergy": {
            const [type, per] = effect.a;
            let discarded = 0;
            while (true) {
              const labels = [];
              const refs = [];
              for (const pk of me.allPokemon) {
                for (let ei = 0; ei < pk.attachedEnergy.length; ei++) {
                  const e = pk.attachedEnergy[ei];
                  if (e.energyType === type) {
                    labels.push(`${pk.name}の${e.name}`);
                    refs.push([pk, ei]);
                  }
                }
              }
              if (labels.length === 0) break;
              const i = await this.ask(p, "card", `トラッシュする${J(type)}エネルギーを選んでください（${discarded}枚選択済み。やめるなら「選ばない」）`, labels, true);
              if (i == null) break;
              const [pk, ei] = refs[i];
              const e = pk.attachedEnergy.splice(ei, 1)[0];
              me.discard.push(e);
              discarded += 1;
            }
            this.note(`${J(type)}エネルギーを${discarded}枚トラッシュした`);
            damage += discarded * per;
            break;
          }
          case "flipUntilTailsBonusDamagePerHeads": {
            const per = effect.a[0];
            let heads = 0;
            while (this.flipCoin()) heads += 1;
            damage += heads * per;
            break;
          }
          case "flipCoinsDamagePerHeads": {
            const [count, per] = effect.a;
            let heads = 0;
            let n = 0;
            while (n < count) {
              n += 1;
              if (this.flipCoin()) heads += 1;
            }
            damage += heads * per;
            break;
          }
          case "flipCoinPerAttachedEnergyDamagePerHeads": {
            const per = effect.a[0];
            let heads = 0;
            let n = 0;
            const total = attacker.attachedEnergy.length;
            while (n < total) {
              n += 1;
              if (this.flipCoin()) heads += 1;
            }
            damage += heads * per;
            break;
          }
          case "bonusDamagePerAttachedEnergy": {
            const [type, per] = effect.a;
            let count = 0;
            for (const e of attacker.attachedEnergy) if (e.energyType === type) count += 1;
            damage += count * per;
            break;
          }
          case "bonusDamageIfYourPrizesRemaining": {
            const [equals, bonus] = effect.a;
            if (me.prizes.length === equals) damage += bonus;
            break;
          }
          case "bonusDamageIfYourNamedPokemonKnockedOutLastOpponentTurn": {
            const [prefix, bonus] = effect.a;
            if (me.lastKnockedOutTurn === this.turnNumber - 1 && me.lastKnockedOutNames.some((x) => x.startsWith(prefix))) damage += bonus;
            break;
          }
          case "damagePerEnergyInOpponentHand": {
            const per = effect.a[0];
            const n = this.players[oppIndex].hand.filter((x) => x.isEnergy || x.isSpecialEnergy).length;
            this.note(`相手の手札を見た（エネルギー${n}枚）`);
            damage += n * per;
            break;
          }
          case "damagePerBasicEnergyInOpponentDiscard": {
            const per = effect.a[0];
            const n = this.players[oppIndex].discard.filter((x) => x.energyType != null).length;
            damage += n * per;
            break;
          }
          case "bonusDamagePerDefenderDamageCounter": {
            const per = effect.a[0];
            damage += Math.floor(defender.damage / 10) * per;
            break;
          }
          case "bonusDamageIfExtraEnergy": {
            const [extra, bonus] = effect.a;
            if (this.energyUnits(attacker) >= attack.cost.length + extra) damage += bonus;
            break;
          }
          case "bonusDamageIfEvolvedThisTurnFrom": {
            const [name, bonus] = effect.a;
            if (attacker.lastChangedTurn === this.turnNumber && attacker.cards.length >= 2 && attacker.cards[attacker.cards.length - 2].name === name) {
              damage += bonus;
            }
            break;
          }
          case "damagePerBasicEnergyInDiscardThenShuffleIntoDeck": {
            const [type, per] = effect.a;
            const matching = me.discard.filter((x) => x.energyType === type);
            damage += matching.length * per;
            if (matching.length > 0) {
              this.note(`トラッシュの${matching[0].name}${matching.length}枚を相手に見せた`);
              for (const c of matching) {
                this.removeCard(me.discard, c.id);
                me.deck.push(c);
              }
              this.shuffleDeck(p);
            }
            break;
          }
          case "bonusDamageIfYourEnergyInPlayAtLeast": {
            const [type, count, bonus] = effect.a;
            let total = 0;
            for (const pk of me.allPokemon) {
              for (const e of pk.attachedEnergy) if (e.energyType === type) total += 1;
            }
            if (total >= count) damage += bonus;
            break;
          }
          case "damagePerBasicEnergyAmongMilledTopCards": {
            const [type, look, per] = effect.a;
            const milled = [];
            let n = 0;
            while (n < look && me.deck.length > 0) {
              milled.push(me.deck.shift());
              n += 1;
            }
            let hit = 0;
            for (const m of milled) if (m.energyType === type) hit += 1;
            me.discard.push(...milled);
            damage += hit * per;
            this.note(`山札の上から${milled.length}枚をトラッシュ（基本${J(type)}エネルギー ${hit}枚）`);
            break;
          }
          case "optionalDiscardAllAttachedEnergyForBonusDamage": {
            const bonus = effect.a[0];
            if (attacker.attachedEnergy.length > 0) {
              const yes = await this.askYesNo(p, `エネルギーをすべてトラッシュして、${bonus}ダメージ追加しますか？`);
              if (yes) {
                me.discard.push(...attacker.attachedEnergy);
                attacker.attachedEnergy.length = 0;
                damage += bonus;
                this.note("エネルギーをすべてトラッシュした");
              }
            }
            break;
          }
          case "bonusDamagePerYourEnergyInPlay": {
            const [type, per] = effect.a;
            let total = 0;
            for (const pk of me.allPokemon) {
              for (const e of pk.attachedEnergy) if (e.energyType === type) total += 1;
            }
            damage += total * per;
            break;
          }
          case "damageAllOpponentPokemon": {
            const n = effect.a[0];
            damage += n;
            for (const b of this.players[oppIndex].bench) this.dealDirectDamage(b, n);
            break;
          }
          case "bonusDamagePerDefenderEnergy": {
            const per = effect.a[0];
            damage += this.energyUnits(defender) * per;
            break;
          }
          case "flipCoinsAllHeadsBonusDamage": {
            const [count, bonus] = effect.a;
            let allHeads = true;
            let n = 0;
            while (n < count) {
              n += 1;
              if (!this.flipCoin()) allHeads = false;
            }
            if (allHeads) damage += bonus;
            break;
          }
          case "bonusDamageIfYourStadiumInPlay": {
            const bonus = effect.a[0];
            if (this.stadiumCard != null && this.stadiumOwner === p) damage += bonus;
            break;
          }
          case "optionalShuffleAllAttachedEnergyIntoDeckForBonusDamage": {
            const bonus = effect.a[0];
            if (attacker.attachedEnergy.length > 0) {
              const yes = await this.askYesNo(p, `エネルギーをすべて山札にもどして、${bonus}ダメージ追加しますか？`);
              if (yes) {
                me.deck.push(...attacker.attachedEnergy);
                attacker.attachedEnergy.length = 0;
                this.shuffleDeck(p);
                damage += bonus;
                this.note("エネルギーをすべて山札にもどした");
              }
            }
            break;
          }
          case "bonusDamageIfDefenderHasCondition": {
            const [condition, bonus] = effect.a;
            if (defender.conditions.has(condition)) damage += bonus;
            break;
          }
          case "reduceDamagePerDefenderEnergy": {
            const per = effect.a[0];
            damage -= this.energyUnits(defender) * per;
            break;
          }
          case "damagePerPrizeAlreadyTaken": {
            const per = effect.a[0];
            damage += (this.rules.prizeCount - me.prizes.length) * per;
            break;
          }
          case "damageBecomesIfDefenderHasDamage": {
            const value = effect.a[0];
            if (defender.damage > 0) damage = value;
            break;
          }
          case "ignoreWeakness": {
            ignoreWeakness = true;
            break;
          }
          case "bonusDamageIfSelfHasTool": {
            const bonus = effect.a[0];
            if (attacker.tool != null || attacker.extraTool != null) damage += bonus;
            break;
          }
          case "bonusDamagePerPrizeOpponentTookLastTurn": {
            const per = effect.a[0];
            const o = this.players[oppIndex];
            if (o.lastPrizeTakenTurn === this.turnNumber - 1) damage += o.lastPrizeTakenCount * per;
            break;
          }
          case "damagePerBenchedNamePrefixDamageCounters": {
            const [prefix, per] = effect.a;
            let counters = 0;
            for (const b of me.bench) if (b.name.startsWith(prefix)) counters += Math.floor(b.damage / 10);
            damage += counters * per;
            break;
          }
          case "bonusDamageIfYourBenchedNamedPokemonDamaged": {
            const [name, bonus] = effect.a;
            if (me.bench.some((x) => x.name === name && x.damage > 0)) damage += bonus;
            break;
          }
          case "bonusDamagePerSelfDamageCounter": {
            const per = effect.a[0];
            damage += Math.floor(attacker.damage / 10) * per;
            break;
          }
          case "reduceDamagePerSelfDamageCounter": {
            const per = effect.a[0];
            damage -= Math.floor(attacker.damage / 10) * per;
            break;
          }
          case "flipCoinsBonusDamagePerHeads": {
            const [count, perHeads] = effect.a;
            let bonusHeads = 0;
            let flips = 0;
            while (flips < count) {
              flips += 1;
              if (this.flipCoin()) bonusHeads += 1;
            }
            damage += bonusHeads * perHeads;
            break;
          }
          case "ignoreResistance": {
            ignoreResistance = true;
            break;
          }
          case "ignoreWeaknessAndResistance": {
            ignoreWeakness = true;
            ignoreResistance = true;
            break;
          }
          case "damagePerYourNamePrefixPokemonInPlay": {
            const [prefix, per] = effect.a;
            damage += me.allPokemon.filter((x) => x.name.startsWith(prefix)).length * per;
            break;
          }
          case "discardUpToAttachedEnergyFromSelfDamagePerEnergy": {
            const [type, maxCount, per] = effect.a;
            let discarded = 0;
            while (discarded < maxCount) {
              const labels = [];
              const refs = [];
              for (let ei = 0; ei < attacker.attachedEnergy.length; ei++) {
                const e = attacker.attachedEnergy[ei];
                if (e.energyType === type) {
                  labels.push(e.name);
                  refs.push(ei);
                }
              }
              if (labels.length === 0) break;
              const i = await this.ask(p, "card", `トラッシュする${J(type)}エネルギーを選んでください（${discarded}枚選択済み。やめるなら「選ばない」）`, labels, true);
              if (i == null) break;
              const e = attacker.attachedEnergy.splice(refs[i], 1)[0];
              me.discard.push(e);
              discarded += 1;
            }
            this.note(`${J(type)}エネルギーを${discarded}枚トラッシュした`);
            damage += discarded * per;
            break;
          }
          case "discardHandSupportersWithNameContainingDamagePer": {
            const [word, per] = effect.a;
            let discarded = 0;
            while (true) {
              const cands = me.hand.filter((x) => x.trainerData && x.trainerData.trainerKind === "supporter" && x.name.includes(word));
              if (cands.length === 0) break;
              const picked = await this.pickCards(p, cands, 1, `トラッシュする「${word}」のサポート（やめるなら選ばない）`);
              if (picked.length === 0) break;
              const c = picked[0];
              this.removeCard(me.hand, c.id);
              me.discard.push(c);
              discarded += 1;
            }
            this.note(`手札のサポートを${discarded}枚トラッシュした`);
            damage += discarded * per;
            break;
          }
          case "bonusDamageIfSelfHasEnergyNamed": {
            const [name, bonus] = effect.a;
            if (attacker.attachedEnergy.some((x) => x.name === name)) damage += bonus;
            break;
          }
          case "bonusDamagePerBenchedPokemonBothPlayers": {
            const per = effect.a[0];
            damage += (me.bench.length + this.players[oppIndex].bench.length) * per;
            break;
          }
          case "optionalDiscardBenchEnergyForBonusDamage": {
            const [maxCount, per] = effect.a;
            let discarded = 0;
            while (discarded < maxCount) {
              const labels = [];
              const refs = [];
              for (const b of me.bench) {
                for (let ei = 0; ei < b.attachedEnergy.length; ei++) {
                  labels.push(`${b.name}の${b.attachedEnergy[ei].name}`);
                  refs.push([b, ei]);
                }
              }
              if (labels.length === 0) break;
              const i = await this.ask(p, "card", `トラッシュするベンチポケモンのエネルギーを選んでください（${discarded}枚選択済み。やめるなら「選ばない」）`, labels, true);
              if (i == null) break;
              const [b, ei] = refs[i];
              const e = b.attachedEnergy.splice(ei, 1)[0];
              me.discard.push(e);
              discarded += 1;
            }
            if (discarded > 0) this.note(`ベンチポケモンのエネルギーを${discarded}枚トラッシュした`);
            damage += discarded * per;
            break;
          }
          case "discardUpToAnyAttachedEnergyFromSelfDamagePerEnergy": {
            const [maxCount, per] = effect.a;
            let discarded = 0;
            while (discarded < maxCount && attacker.attachedEnergy.length > 0) {
              const labels = [];
              for (const e of attacker.attachedEnergy) labels.push(e.name);
              const i = await this.ask(p, "card", `トラッシュするエネルギーを選んでください（${discarded}枚選択済み。やめるなら「選ばない」）`, labels, true);
              if (i == null) break;
              const e = attacker.attachedEnergy.splice(i, 1)[0];
              me.discard.push(e);
              discarded += 1;
            }
            this.note(`エネルギーを${discarded}枚トラッシュした`);
            damage += discarded * per;
            break;
          }
          case "damagePerYourBenchedPokemon": {
            const per = effect.a[0];
            damage += me.bench.length * per;
            break;
          }
          case "bonusDamagePerEnergyOnBothActives": {
            const per = effect.a[0];
            damage += (this.energyUnits(attacker) + this.energyUnits(defender)) * per;
            break;
          }
          case "bonusDamagePerPrizeOpponentHasTaken": {
            const per = effect.a[0];
            damage += (this.rules.prizeCount - this.players[oppIndex].prizes.length) * per;
            break;
          }
          case "damagePerOpponentHandCard": {
            const per = effect.a[0];
            damage += this.players[oppIndex].hand.length * per;
            break;
          }
          case "bonusDamagePerEnergyInYourDiscard": {
            const per = effect.a[0];
            damage += me.discard.filter((x) => x.energyType != null || (x.trainerData && x.trainerData.trainerKind === "specialEnergy")).length * per;
            break;
          }
          case "damagePerYourPokemonOfType": {
            const [type, per] = effect.a;
            let typeCount = 0;
            for (const pk of me.allPokemon) {
              let matches = pk.data.type === type;
              const ab = pk.ability;
              if (ab && ab.trigger === "passive") {
                for (const e of ab.effects) {
                  if (e.c === "alsoTypes" && e.a[0].includes(type)) matches = true;
                }
              }
              if (matches) typeCount += 1;
            }
            damage += typeCount * per;
            break;
          }
          case "damagePerEnergyOnAllOpponentPokemon": {
            const per = effect.a[0];
            let total = 0;
            for (const pk of this.players[oppIndex].allPokemon) total += pk.attachedEnergy.length;
            damage += total * per;
            break;
          }
          case "damagePerTrainerInOpponentHand": {
            const per = effect.a[0];
            const n = this.players[oppIndex].hand.filter((x) => x.trainerData != null).length;
            this.note(`相手の手札のトレーナーズは${n}枚`);
            damage += n * per;
            break;
          }
          case "bonusDamageIfDefenderHasAnySpecialCondition": {
            const bonus = effect.a[0];
            if (defender.conditions.size > 0) damage += bonus;
            break;
          }
          case "bonusDamageIfSelfHasEnergyOfType": {
            const [type, bonus] = effect.a;
            if (attacker.attachedEnergy.some((x) => x.energyType === type)) damage += bonus;
            break;
          }
          case "bonusDamageIfYourBenchHasType": {
            const [type, bonus] = effect.a;
            if (me.bench.some((x) => x.data.type === type)) damage += bonus;
            break;
          }
          case "flipCoinHeadsBonusDamageAndHealSelf": {
            const [bonus, heal] = effect.a;
            if (this.flipCoin()) {
              damage += bonus;
              if (attacker.damage > 0) attacker.healedTurn = this.turnNumber;
              attacker.damage = Math.max(attacker.damage - heal, 0);
              this.note(`オモテ！ ${attacker.name}のHPを${heal}回復`);
            } else {
              this.note("ウラだった");
            }
            break;
          }
          case "placeCountersOnSelfUpToThenDamagePerCounter": {
            const [maxCount, per] = effect.a;
            const options = [];
            let n = 0;
            while (n <= maxCount) {
              options.push(`${n}個`);
              n += 1;
            }
            const chosen = (await this.ask(p, "card", `${attacker.name}にのせるダメカンの数を選んでください`, options)) ?? 0;
            attacker.damage += chosen * 10;
            this.note(`${attacker.name}にダメカンを${chosen}個のせた`);
            damage += chosen * per;
            break;
          }
          case "optionalBonusDamageWithSelfDamage": {
            const [bonus, selfDamage] = effect.a;
            if (await this.askYesNo(p, `${bonus}ダメージ追加しますか？（${attacker.name}にも${selfDamage}ダメージ）`)) {
              damage += bonus;
              attacker.damage += selfDamage;
              this.note(`${attacker.name}にも${selfDamage}ダメージ`);
            }
            break;
          }
          case "flipCoinsDamagePerHeadsParalyzeIfAny": {
            const [count, per] = effect.a;
            let heads = 0;
            let n = 0;
            while (n < count) {
              n += 1;
              if (this.flipCoin()) heads += 1;
            }
            damage += heads * per;
            if (heads > 0) paralyzeAfterDamage = true;
            break;
          }
          case "damagePerNamePrefixAmongMilledTopCards": {
            const [prefix, look, per] = effect.a;
            let hit = 0;
            let n = 0;
            while (n < look && me.deck.length > 0) {
              const c = me.deck.shift();
              me.discard.push(c);
              if (c.pokemonData != null && c.name.startsWith(prefix)) hit += 1;
              n += 1;
            }
            this.note(`山札を${n}枚トラッシュ（「${prefix}」のポケモン${hit}枚）`);
            damage += hit * per;
            break;
          }
          case "bonusDamageIfDefenderHasDamageCounters": {
            const bonus = effect.a[0];
            if (defender.damage > 0) damage += bonus;
            break;
          }
          case "damageAllOpponentExPokemon": {
            const n = effect.a[0];
            for (const target of this.players[oppIndex].allPokemon) {
              if (target.data.prizeValue >= 2 || target.name.endsWith("ex")) this.dealDirectDamage(target, n);
            }
            break;
          }
          case "bonusDamageIfDefenderIsStage1": {
            const bonus = effect.a[0];
            if (defender.data.stage === "stage1") damage += bonus;
            break;
          }
          case "discardTopOfBothDecksDamagePerEnergy": {
            const per = effect.a[0];
            let energyCount = 0;
            let side = 0;
            while (side < 2) {
              if (this.players[side].deck.length > 0) {
                const c = this.players[side].deck.shift();
                this.players[side].discard.push(c);
                this.note(`プレイヤー${side + 1}の山札の上の「${c.name}」をトラッシュした`);
                if (c.isEnergy || c.isSpecialEnergy) energyCount += 1;
              }
              side += 1;
            }
            damage += energyCount * per;
            break;
          }
          case "bonusDamageIfDefenderIsEvolutionThenDiscardAllEnergy": {
            const bonus = effect.a[0];
            if (defender.data.stage !== "basic") {
              damage += bonus;
              me.discard.push(...attacker.attachedEnergy);
              attacker.attachedEnergy.length = 0;
              this.note(`${attacker.name}のエネルギーをすべてトラッシュした`);
            }
            break;
          }
          case "bonusDamagePerOpponentBenchedPokemon": {
            const per = effect.a[0];
            damage += this.players[oppIndex].bench.length * per;
            break;
          }
          case "bonusDamagePerEnergyOnYourNamePrefixPokemon": {
            const [prefix, type, per] = effect.a;
            let energyTotal = 0;
            for (const pk of me.allPokemon) {
              if (!pk.name.startsWith(prefix)) continue;
              for (const e of pk.attachedEnergy) if (e.energyType === type) energyTotal += 1;
            }
            damage += energyTotal * per;
            break;
          }
          case "opponentFlipsPerBenchDamagePerTails": {
            const per = effect.a[0];
            let tails = 0;
            let flips = 0;
            const benchFlipCount = this.players[oppIndex].bench.length;
            while (flips < benchFlipCount) {
              if (!this.flipCoin()) tails += 1;
              flips += 1;
            }
            this.note(`相手がコインを${benchFlipCount}回投げ、ウラは${tails}回`);
            damage += tails * per;
            ignoreWeakness = true;
            ignoreResistance = true;
            break;
          }
          case "damagePerYourStage1Pokemon": {
            const per = effect.a[0];
            damage += me.allPokemon.filter((x) => x.data.stage === "stage1").length * per;
            break;
          }
          case "bonusDamagePerDamageCounterOnAllOpponentPokemon": {
            const per = effect.a[0];
            let counterTotal = 0;
            for (const pk of this.players[oppIndex].allPokemon) counterTotal += Math.floor(pk.damage / 10);
            damage += counterTotal * per;
            break;
          }
          case "optionalRevealOwnPrizeForBonusDamage": {
            const bonus = effect.a[0];
            const faceDownIndexes = [];
            for (let pi = 0; pi < me.prizes.length; pi++) {
              if (!me.revealedPrizeIds.has(me.prizes[pi].id)) faceDownIndexes.push(pi);
            }
            if (faceDownIndexes.length > 0) {
              const reveal = await this.askYesNo(p, `ウラになっているサイドを1枚オモテにして、${bonus}ダメージ追加しますか？`);
              if (reveal) {
                const labels = [];
                for (const pi of faceDownIndexes) labels.push(`サイド${pi + 1}枚目（ウラ）`);
                const choice = await this.ask(p, "other", "オモテにするサイドを選んでください", labels);
                if (choice != null) {
                  const revealedCard = me.prizes[faceDownIndexes[choice]];
                  me.revealedPrizeIds.add(revealedCard.id);
                  damage += bonus;
                  this.note(`サイドの「${revealedCard.name}」をオモテにした`);
                }
              }
            }
            break;
          }
          case "bonusDamageIfHandSizesEqual": {
            const bonus = effect.a[0];
            if (me.hand.length === this.players[oppIndex].hand.length) damage += bonus;
            break;
          }
          case "damagePerYourPokemonInPlay": {
            const per = effect.a[0];
            damage += me.allPokemon.length * per;
            break;
          }
          case "bonusDamagePerDefenderRetreatCost": {
            const per = effect.a[0];
            damage += defender.data.retreatCost * per;
            break;
          }
          case "bonusDamageIfSameTypeAsOpponentInPlay": {
            const bonus = effect.a[0];
            const oppTypes = [];
            for (const pk of this.players[oppIndex].allPokemon) oppTypes.push(pk.data.type);
            if (me.allPokemon.some((x) => oppTypes.includes(x.data.type))) damage += bonus;
            break;
          }
          case "damagePerSelfAttachedEnergy": {
            const per = effect.a[0];
            damage += this.energyUnits(attacker) * per;
            break;
          }
          case "bonusDamageIfYourPrizesRemainingMoreThanOpponent": {
            const bonus = effect.a[0];
            if (me.prizes.length > this.players[oppIndex].prizes.length) damage += bonus;
            break;
          }
          case "damagePerFutureAmongTopCards": {
            const [look, per] = effect.a;
            const topCards = [];
            let taken = 0;
            while (taken < look && me.deck.length > 0) {
              topCards.push(me.deck.shift());
              taken += 1;
            }
            let futureHit = 0;
            const keepCards = [];
            for (const c of topCards) {
              if (c.pokemonData != null && c.pokemonData.isFuture === true) {
                futureHit += 1;
                me.discard.push(c);
              } else {
                keepCards.push(c);
              }
            }
            me.deck.unshift(...keepCards);
            this.shuffleDeck(p);
            this.note(`山札の上${taken}枚のうち「未来」は${futureHit}枚`);
            damage += futureHit * per;
            break;
          }
          case "discardDefenderToolBeforeDamage": {
            if (!isDefenderProtected && defender.tool != null) {
              const tool = defender.tool;
              defender.tool = null;
              this.players[oppIndex].discard.push(tool);
              this.note(`${defender.name}の「${tool.name}」をトラッシュした`);
            }
            break;
          }
          default:
            break;
        }
      }
      damage = Math.max(damage, 0);

      // ダメージを与える
      if (damage > 0) {
        if (isDefenderProtected) {
          this.note(`${defender.name}はワザのダメージや効果を受けない`);
        } else {
          const dealt = this.finalDamage(damage, p, attacker, defender, oppIndex, ignoreWeakness, ignoreResistance, ignoreDefenderEffects);
          const damageBefore = defender.damage;
          defender.damage += dealt;
          this.applyAttackSurvival(defender, damageBefore);
          this.recordDamageTaken(defender, dealt);
          this.note(`${defender.name}に${dealt}ダメージ（残りHP ${defender.remainingHP}）`);
          if (!ignoreDefenderEffects) this.discardBerries(defender, oppIndex, attacker.data.type);
          if (dealt > 0 && attack.effects.some((e) => e.c === "healSelfByDamageDealt")) {
            if (attacker.damage > 0) attacker.healedTurn = this.turnNumber;
            attacker.damage = Math.max(attacker.damage - dealt, 0);
            this.note(`${attacker.name}のHPを${dealt}回復`);
          }
          if (dealt > 0) {
            this.applyRevengeVortex(oppIndex, defender, attacker);
          }
        }
      }

      if (paralyzeAfterDamage && !isDefenderProtected && !defender.isKnockedOut) {
        this.inflict("paralyzed", defender);
      }

      // ダメージのあとに起こる効果
      for (const effect of attack.effects) {
        await this.applyAfterDamageEffect(effect, p, attacker, defender, attack, isDefenderProtected || this.defenderIgnoresAttackEffects(defender));
      }
    },

  });

  if (typeof module !== "undefined") module.exports = G;
})(globalThis.PK = globalThis.PK || {});
// fx_c.js : BattleEffects.swift 1503〜2498 行の移植
// 担当範囲: applyAfterDamageEffect（Part1〜16 の呼び出し順の司令塔）と applyAfterDamageEffectPart16〜Part10
// （Part1〜9 は別担当）
(function (G) {
  "use strict";

  const J = (t) => G.energyJapaneseName(t); // EnergyType.japaneseName

  Object.assign(G.BattleGame.prototype, {

    // applyAfterDamageEffect(effect, p, attacker, defender, attack, defenderProtected)  ※async
    async applyAfterDamageEffect(effect, p, attacker, defender, attack, defenderProtected) {
      await this.applyAfterDamageEffectPart1(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart2(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart3(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart4(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart5(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart6(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart7(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart8(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart9(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart11(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart10(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart12(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart13(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart14(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart15(effect, p, attacker, defender, attack, defenderProtected);
      await this.applyAfterDamageEffectPart16(effect, p, attacker, defender, attack, defenderProtected);
    },

    // スタートデッキ100 第10弾（555〜 無色）で追加したワザの効果
    async applyAfterDamageEffectPart16(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      switch (effect.c) {
        case "flipCoinsAllTailsDamageSelf": {
          const [count, dmg] = effect.a;
          let heads = 0;
          for (let k = 0; k < count; k++) { if (this.flipCoin()) heads += 1; }
          if (heads === 0 && !attacker.isKnockedOut) {
            attacker.damage += dmg;
            this.note(`コインがすべてウラ！${attacker.name}にも${dmg}ダメージ`);
          }
          break;
        }
        case "lookAtOpponentHandCardFaceDownShuffleIntoDeck": {
          const oppIdx = this.other(p);
          const opp = this.players[oppIdx];
          if (opp.hand.length === 0) { this.note("相手の手札がない"); break; }
          const labels = [];
          for (let hi = 0; hi < opp.hand.length; hi++) labels.push(`相手の手札 ${hi + 1}枚目`);
          const i = (await this.ask(p, "other", "相手の手札からオモテを見ないで1枚選んでください", labels)) ?? 0;
          const c = opp.hand.splice(Math.max(0, Math.min(i, opp.hand.length - 1)), 1)[0];
          this.note(`選んだカードは「${c.name}」だった。相手の山札にもどして切った`);
          opp.deck.push(c);
          this.shuffleDeck(oppIdx);
          break;
        }
        case "attachAnyBasicEnergyFromHandToYourPokemon": {
          const [maxCount] = effect.a;
          const handEnergy = me.hand.filter((c) => c.energyType != null);
          if (handEnergy.length === 0) break;
          const picked = await this.pickCards(p, handEnergy, maxCount, "自分のポケモンにつける基本エネルギー（手札から）");
          for (const c of picked) {
            const slot = await this.chooseSlot(p, p, `${c.name}をつけるポケモンを選んでください`, this.slots(p));
            const target = slot != null ? this.pokemon(p, slot) : null;
            if (slot != null && target != null) {
              this.removeCard(me.hand, c.id);
              target.attachedEnergy.push(c);
              this.note(`手札から${c.name}を${target.name}につけた`);
              this.healOnAttachFromHand(p, target);
            }
          }
          break;
        }
        case "attachBasicEnergyFromHandToSelf": {
          const [maxCount] = effect.a;
          if (attacker.isKnockedOut) break;
          const handEnergy = me.hand.filter((c) => c.energyType != null);
          if (handEnergy.length === 0) break;
          const picked = await this.pickCards(p, handEnergy, maxCount, `${attacker.name}につける基本エネルギー（手札から）`);
          for (const c of picked) {
            this.removeCard(me.hand, c.id);
            attacker.attachedEnergy.push(c);
            this.note(`手札から${c.name}を${attacker.name}につけた`);
            this.healOnAttachFromHand(p, attacker);
          }
          break;
        }
        case "attachEnergyFromHandToSelfThenHeal": {
          const [amount] = effect.a;
          if (attacker.isKnockedOut) break;
          const handEnergy = me.hand.filter((c) => c.energyType != null || c.isSpecialEnergy);
          if (handEnergy.length > 0) {
            const picked = await this.pickCards(p, handEnergy, 1, `${attacker.name}につけるエネルギー（手札から）`);
            for (const c of picked) {
              this.removeCard(me.hand, c.id);
              attacker.attachedEnergy.push(c);
              this.note(`手札から${c.name}を${attacker.name}につけた`);
              this.healOnAttachFromHand(p, attacker);
            }
          }
          const healed = Math.min(amount, attacker.damage);
          attacker.damage -= healed;
          this.note(`${attacker.name}のHPを${amount}回復した`);
          break;
        }
        case "selfCannotRetreatNextTurn": {
          if (!attacker.isKnockedOut) {
            attacker.cannotRetreatUntilTurn = this.turnNumber + 2;
            this.note(`${attacker.name}は次の自分の番、にげられない`);
          }
          break;
        }
        case "flipCoinsAttachBasicEnergyFromDeckPerHeads": {
          const [count, perHeads] = effect.a;
          let heads = 0;
          for (let k = 0; k < count; k++) { if (this.flipCoin()) heads += 1; }
          this.note(`コイン${count}回：オモテは${heads}回`);
          const limit = heads * perHeads;
          if (limit > 0) {
            const cands = me.deck.filter((c) => c.energyType != null);
            const picked = await this.pickCards(p, cands, limit, "自分のポケモンにつける基本エネルギー（山札から）");
            for (const c of picked) {
              const slot = await this.chooseSlot(p, p, `${c.name}をつけるポケモンを選んでください`, this.slots(p));
              const target = slot != null ? this.pokemon(p, slot) : null;
              if (slot != null && target != null) {
                this.removeCard(me.deck, c.id);
                target.attachedEnergy.push(c);
                this.note(`山札から${c.name}を${target.name}につけた`);
              }
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "moveBasicEnergyFromSelfToBenched": {
          if (attacker.isKnockedOut || me.bench.length === 0) break;
          const labels = [];
          const refs = [];
          attacker.attachedEnergy.forEach((e, ei) => {
            if (e.energyType != null) { labels.push(e.name); refs.push(ei); }
          });
          if (labels.length === 0) break;
          const i = (await this.ask(p, "card", "ベンチポケモンにつけ替える基本エネルギーを選んでください", labels)) ?? 0;
          const benchSlots = [];
          for (let bi = 0; bi < me.bench.length; bi++) benchSlots.push(G.bench(bi));
          const slot = await this.chooseSlot(p, p, "つけ替え先のベンチポケモンを選んでください", benchSlots);
          const target = slot != null ? this.pokemon(p, slot) : null;
          if (slot != null && target != null) {
            const e = attacker.attachedEnergy.splice(refs[Math.max(0, Math.min(i, refs.length - 1))], 1)[0];
            target.attachedEnergy.push(e);
            this.note(`${e.name}を${attacker.name}から${target.name}につけ替えた`);
          }
          break;
        }
        case "attachAnyBasicEnergyFromDeckToSelf": {
          if (!attacker.isKnockedOut) {
            const cands = me.deck.filter((c) => c.energyType != null);
            const picked = await this.pickCards(p, cands, 1, `${attacker.name}につける基本エネルギー（山札から）`);
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              attacker.attachedEnergy.push(c);
              this.note(`山札から${c.name}を${attacker.name}につけた`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "defenderWeaknessBecomesColorlessUntilYourNextTurnEnd": {
          if (!defenderProtected && !defender.isKnockedOut) {
            defender.weaknessColorlessUntilTurn = this.turnNumber + 2;
            this.note(`${defender.name}の弱点は、次の自分の番の終わりまで無色タイプになる`);
          }
          break;
        }
        case "sleepSelf": {
          if (!attacker.isKnockedOut) this.inflict("asleep", attacker);
          break;
        }
        default:
          break;
      }
    },

    // スタートデッキ100 第8弾（492〜 鋼）で追加したワザの効果
    async applyAfterDamageEffectPart15(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      switch (effect.c) {
        case "discardOneHandCardThenDraw": {
          const [n] = effect.a;
          if (me.hand.length > 0) {
            const labels = [];
            for (const c of me.hand) labels.push(c.name);
            const i = (await this.ask(p, "card", "トラッシュする手札を選んでください", labels)) ?? 0;
            const c = me.hand.splice(i, 1)[0];
            me.discard.push(c);
            this.note(`手札の${c.name}をトラッシュした`);
          }
          const drawn = this.draw(p, n);
          this.note(`山札を${drawn}枚引いた`);
          break;
        }
        case "attachAnyBasicEnergiesFromHandToYourPokemon": {
          if (attacker.isKnockedOut && me.allPokemon.length === 0) break;
          const handEnergy = me.hand.filter((c) => c.energyType != null);
          if (handEnergy.length === 0) break;
          const picked = await this.pickCards(p, handEnergy, handEnergy.length, "自分のポケモンにつける基本エネルギー（手札から）");
          for (const c of picked) {
            const slot = await this.chooseSlot(p, p, `${c.name}をつけるポケモンを選んでください`, this.slots(p));
            const target = slot != null ? this.pokemon(p, slot) : null;
            if (slot != null && target != null) {
              this.removeCard(me.hand, c.id);
              target.attachedEnergy.push(c);
              this.note(`手札から${c.name}を${target.name}につけた`);
              this.healOnAttachFromHand(p, target);
            }
          }
          break;
        }
        case "flipCoinHeadsKnockOutDefenderBasicElseKnockOutOpponentBenchedBasic": {
          const opp = this.players[this.other(p)];
          if (this.flipCoin()) {
            if (!defenderProtected && !defender.isKnockedOut && defender.data.stage === "basic") {
              defender.damage = defender.hp;
              this.note(`コインがオモテ！${defender.name}をきぜつさせた`);
            } else {
              this.note("コインがオモテ！しかし相手のバトル場にきぜつさせられるたねポケモンがいない");
            }
          } else {
            const cands = [];
            opp.bench.forEach((b, i) => { if (b.data.stage === "basic") cands.push(G.bench(i)); });
            const slot = await this.chooseSlot(p, this.other(p), "きぜつさせる相手のベンチのたねポケモンを選んでください", cands);
            const target = slot != null ? this.pokemon(this.other(p), slot) : null;
            if (slot != null && target != null) {
              target.damage = target.hp;
              this.note(`コインがウラ！ベンチの${target.name}をきぜつさせた`);
            } else {
              this.note("コインがウラ！しかし相手のベンチにたねポケモンがいない");
            }
          }
          break;
        }
        case "knockOutDefenderIfHasSpecialEnergy": {
          if (!defenderProtected && !defender.isKnockedOut && defender.attachedEnergy.some((c) => c.isSpecialEnergy)) {
            defender.damage = defender.hp;
            this.note(`${defender.name}に特殊エネルギーがついているので、きぜつさせた`);
          }
          break;
        }
        case "discardOwnDeckTop": {
          const [n] = effect.a;
          let k = 0;
          while (k < n && me.deck.length > 0) {
            const c = me.deck.shift();
            me.discard.push(c);
            this.note(`自分の山札の「${c.name}」をトラッシュした`);
            k += 1;
          }
          break;
        }
        case "attachBasicEnergyFromDeckToYourFuturePokemon": {
          const [maxCount] = effect.a;
          const futureSlots = this.slots(p).filter((s) => {
            const pk = this.pokemon(p, s);
            return pk != null && pk.data.isFuture === true;
          });
          if (futureSlots.length === 0) {
            this.note("自分の場に「未来」のポケモンがいない");
          } else {
            const cands = me.deck.filter((c) => c.energyType != null);
            const picked = await this.pickCards(p, cands, maxCount, "「未来」のポケモンにつける基本エネルギー（山札から）");
            for (const c of picked) {
              const slot = await this.chooseSlot(p, p, `${c.name}をつける「未来」のポケモンを選んでください`, futureSlots);
              const target = slot != null ? this.pokemon(p, slot) : null;
              if (slot != null && target != null) {
                this.removeCard(me.deck, c.id);
                target.attachedEnergy.push(c);
                this.note(`山札から${c.name}を${target.name}につけた`);
              }
            }
            this.shuffleDeck(p);
          }
          break;
        }
        case "optionalShuffleSelfAndAttachedCardsIntoDeck": {
          if (attacker.isKnockedOut || me.bench.length === 0 || me.active !== attacker) break;
          if (await this.askYesNo(p, `${attacker.name}と、ついているすべてのカードを山札にもどして切りますか？`)) {
            me.deck.push(...attacker.cards);
            me.deck.push(...attacker.attachedEnergy);
            if (attacker.tool != null) me.deck.push(attacker.tool);
            if (attacker.extraTool != null) me.deck.push(attacker.extraTool);
            me.active = null;
            this.shuffleDeck(p);
            this.note(`${attacker.name}と、ついているカードを山札にもどした`);
          }
          break;
        }
        default:
          break;
      }
    },

    // スタートデッキ100 第7弾（430〜 悪）で追加したワザの効果
    async applyAfterDamageEffectPart14(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "flipCoinHeadsPoisonAndConfuseDefender": {
          if (this.flipCoin()) {
            if (!defenderProtected && !defender.isKnockedOut) {
              this.inflict("poisoned", defender);
              this.inflict("confused", defender);
            }
          } else {
            this.note("コインはウラだった");
          }
          break;
        }
        case "poisonDefenderWithCounters": {
          const [n] = effect.a;
          if (!defenderProtected && !defender.isKnockedOut) {
            this.inflict("poisoned", defender);
            defender.poisonCounters = n;
            this.note(`このどくでのるダメカンは${n}個になる`);
          }
          break;
        }
        case "evolveYourPokemonOfTypeFromDeck": {
          const [type, maxPokemon] = effect.a;
          let done = 0;
          const evolvedList = [];
          while (done < maxPokemon) {
            const slotsOK = [];
            for (const slot of this.slots(p)) {
              const pk = this.pokemon(p, slot);
              if (pk == null || pk.data.type !== type || evolvedList.some((x) => x === pk)) continue;
              if (me.deck.some((c) => c.pokemonData != null && c.pokemonData.evolvesFrom === pk.name)) slotsOK.push(slot);
            }
            if (slotsOK.length === 0) break;
            const slot = await this.chooseSlot(p, p, `進化させる${J(type)}ポケモンを選んでください（${done + 1}/${maxPokemon}）`, slotsOK);
            if (slot == null) break;
            const target = this.pokemon(p, slot);
            if (target == null) break;
            const cands = me.deck.filter((c) => c.pokemonData != null && c.pokemonData.evolvesFrom === target.name);
            const picked = await this.pickCards(p, cands, 1, `${target.name}から進化するカード`);
            if (picked.length === 0) break;
            const c = picked[0];
            this.removeCard(me.deck, c.id);
            const before = target.name;
            target.evolve(c, this.turnNumber, this.confusionLocked());
            this.note(`山札から${c.name}を選び、${before}を進化させた`);
            evolvedList.push(target);
            done += 1;
          }
          this.shuffleDeck(p);
          this.refreshStadiumEffects();
          break;
        }
        case "optionalMoveOneDefenderEnergyToOpponentBenched": {
          if (!defenderProtected && !defender.isKnockedOut && defender.attachedEnergy.length > 0 && opp.bench.length > 0 && opp.active === defender) {
            if (await this.askYesNo(p, "相手のバトルポケモンのエネルギーを1個、相手のベンチポケモンにつけ替えますか？")) {
              const labels = [];
              for (const e of defender.attachedEnergy) labels.push(e.name);
              const i = (await this.ask(p, "card", "つけ替えるエネルギーを選んでください", labels)) ?? 0;
              const benchSlots = [];
              for (let b = 0; b < opp.bench.length; b++) benchSlots.push(G.bench(b));
              const slot = await this.chooseSlot(p, oppIndex, "エネルギーをつける相手のベンチポケモンを選んでください", benchSlots);
              const target = slot != null ? this.pokemon(oppIndex, slot) : null;
              if (slot != null && target != null) {
                const e = defender.attachedEnergy.splice(i, 1)[0];
                target.attachedEnergy.push(e);
                this.note(`${defender.name}の${e.name}を${target.name}につけ替えた`);
              }
            }
          }
          break;
        }
        case "takeOwnPrizes": {
          const [n] = effect.a;
          this.takePrizes(p, n);
          break;
        }
        case "moveAnyDamageCountersFromOpponentBenchedToDefender": {
          if (!defenderProtected && !defender.isKnockedOut) {
            for (const b of opp.bench) {
              if (!(b.damage > 0)) continue;
              const have = Math.trunc(b.damage / 10);
              const labels = [];
              for (let k = 0; k <= have; k++) labels.push(`${k}個`);
              const chosen = (await this.ask(p, "other", `${b.name}から${defender.name}にのせ替えるダメカンの数`, labels)) ?? 0;
              if (chosen > 0) {
                b.damage -= chosen * 10;
                defender.damage += chosen * 10;
                this.note(`${b.name}のダメカンを${chosen}個、${defender.name}にのせ替えた`);
              }
            }
          }
          break;
        }
        case "lookAtOpponentHandPutOneOnDeckBottom": {
          if (opp.hand.length > 0) {
            const labels = [];
            for (const c of opp.hand) labels.push(c.name);
            const i = (await this.ask(p, "card", "相手の山札の下にもどすカードを選んでください", labels)) ?? 0;
            const c = opp.hand.splice(i, 1)[0];
            opp.deck.push(c);
            this.note(`相手の手札の「${c.name}」を山札の下にもどした`);
          }
          break;
        }
        case "discardOpponentHandCardChosenFaceDown": {
          if (opp.hand.length > 0) {
            const labels = [];
            for (let k = 0; k < opp.hand.length; k++) labels.push(`${k + 1}枚目`);
            const i = (await this.ask(p, "other", "トラッシュする相手の手札を選んでください（オモテは見られません）", labels)) ?? 0;
            const c = opp.hand.splice(i, 1)[0];
            opp.discard.push(c);
            this.note(`相手の手札の「${c.name}」をトラッシュした`);
          }
          break;
        }
        case "attachBasicEnergyFromDeckToSelfThenPoisonSelf": {
          const [type, maxCount] = effect.a;
          if (attacker.isKnockedOut) break;
          const cands = me.deck.filter((c) => c.energyType === type && !c.isSpecialEnergy);
          const picked = await this.pickCards(p, cands, maxCount, `${attacker.name}につける基本${J(type)}エネルギー`);
          for (const c of picked) {
            this.removeCard(me.deck, c.id);
            attacker.attachedEnergy.push(c);
            this.note(`山札から${c.name}を${attacker.name}につけた`);
          }
          this.shuffleDeck(p);
          if (picked.length > 0) this.inflict("poisoned", attacker);
          break;
        }
        case "placeCountersOnAllDamagedOpponentPokemon": {
          const [counters] = effect.a;
          for (const pk of opp.allPokemon) {
            if (!(pk.damage > 0)) continue;
            if (opp.bench.some((x) => x === pk) && this.benchCountersBlocked()) continue;
            pk.damage += counters * 10;
            this.note(`${pk.name}にダメカンを${counters}個のせた`);
          }
          break;
        }
        default:
          break;
      }
    },

    // スタートデッキ100 第6弾（362〜 闘）で追加したワザの効果
    async applyAfterDamageEffectPart13(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "placeCountersUntilDefenderRemainingHP": {
          const [target] = effect.a;
          if (!defenderProtected && !defender.isKnockedOut) {
            const remaining = defender.hp - defender.damage;
            if (remaining > target) {
              defender.damage = defender.hp - target;
              this.note(`${defender.name}の残りHPが${target}になるように、ダメカンをのせた`);
            }
          }
          break;
        }
        case "damageOneDamagedOpponentBenchedPokemon": {
          const [n] = effect.a;
          const candidates = [];
          for (let b = 0; b < opp.bench.length; b++) {
            if (opp.bench[b].damage > 0) candidates.push(G.bench(b));
          }
          const slot = await this.chooseSlot(p, oppIndex, `${n}ダメージを与える、ダメカンののった相手のベンチポケモンを選んでください`, candidates);
          const target = slot != null ? this.pokemon(oppIndex, slot) : null;
          if (slot != null && target != null) {
            this.dealDirectDamage(target, n);
          }
          break;
        }
        case "attachBasicEnergyFromDiscardToEachBenched": {
          const [type] = effect.a;
          for (const b of me.bench) {
            const c = me.discard.find((x) => x.energyType === type && !x.isSpecialEnergy);
            if (c != null) {
              this.removeCard(me.discard, c.id);
              b.attachedEnergy.push(c);
              this.note(`トラッシュから${c.name}を${b.name}につけた`);
            }
          }
          break;
        }
        case "switchOpponentBenchedPokemonWithActiveChosenByYou": {
          if (!defenderProtected && !defender.isKnockedOut && opp.active === defender) {
            await this.switchActive(oppIndex, p);
          }
          break;
        }
        case "placeCountersOnAttackerWhenDamagedNextTurn": {
          const [counters] = effect.a;
          attacker.retaliationUntilTurn = this.turnNumber + 1;
          attacker.retaliationCounters = counters;
          this.note(`${attacker.name}は次の相手の番、ワザのダメージを受けたとき、相手にダメカンを${counters}個のせる`);
          break;
        }
        case "attachEnergyFromDiscardToSelf": {
          const [count] = effect.a;
          if (attacker.isKnockedOut) break;
          const cands = me.discard.filter((c) => c.isEnergy);
          if (cands.length === 0) break;
          const picked = await this.pickCards(p, cands, count, `${attacker.name}につけるエネルギー（トラッシュから）`);
          for (const c of picked) {
            this.removeCard(me.discard, c.id);
            attacker.attachedEnergy.push(c);
            this.note(`トラッシュから${c.name}を${attacker.name}につけた`);
          }
          break;
        }
        default:
          break;
      }
    },

    // スタートデッキ100 第5弾（225〜 雷）で追加したワザの効果
    async applyAfterDamageEffectPart12(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "flipCoinHeadsKnockOutDefender": {
          if (this.flipCoin()) {
            if (!defenderProtected && !defender.isKnockedOut) {
              defender.damage = defender.hp;
              this.note(`コインがオモテ！${defender.name}をきぜつさせた`);
            }
          } else {
            this.note("コインはウラだった");
          }
          break;
        }
        case "discardItemsAndToolsFromOpponentHand": {
          const kept = [];
          let trashed = 0;
          for (const c of opp.hand) {
            const t = c.trainerData;
            if (t != null && (t.trainerKind === "item" || t.trainerKind === "tool")) {
              opp.discard.push(c);
              trashed += 1;
            } else {
              kept.push(c);
            }
          }
          opp.hand = kept;
          this.note(`相手の手札のグッズとポケモンのどうぐを${trashed}枚トラッシュした`);
          break;
        }
        case "switchSelfWithBenchedOfType": {
          const [type] = effect.a;
          if (attacker.isKnockedOut || me.active !== attacker) break;
          if (!me.bench.some((b) => b.data.type === type)) break;
          await this.switchActive(p, p, null, type);
          break;
        }
        case "distributeAllAttachedEnergyToBenched": {
          if (me.bench.length === 0 || attacker.attachedEnergy.length === 0 || attacker.isKnockedOut) break;
          const benchSlots = [];
          for (let bi = 0; bi < me.bench.length; bi++) benchSlots.push(G.bench(bi));
          while (attacker.attachedEnergy.length > 0) {
            const e = attacker.attachedEnergy[0];
            const slot = await this.chooseSlot(p, p, `${e.name}をつけ替えるベンチポケモンを選んでください（残り${attacker.attachedEnergy.length}個）`, benchSlots);
            if (slot == null) break;
            const target = this.pokemon(p, slot);
            if (target == null) break;
            attacker.attachedEnergy.shift();
            target.attachedEnergy.push(e);
            this.note(`${e.name}を${attacker.name}から${target.name}につけ替えた`);
          }
          break;
        }
        case "lookAtOpponentHand": {
          if (opp.hand.length > 0) {
            const labels = [];
            for (const c of opp.hand) labels.push(c.name);
            await this.ask(p, "card", `相手の手札を確認してください（${opp.hand.length}枚）`, labels, true);
          }
          this.note("相手の手札を見た");
          break;
        }
        case "devolveAllOpponentEvolved": {
          const returnedCards = [];
          for (const pk of opp.allPokemon) {
            if (pk.cards.length >= 2) {
              const c = pk.cards.pop();
              returnedCards.push(c);
              this.note(`${pk.name}の進化カード「${c.name}」をはがした`);
            }
          }
          if (returnedCards.length > 0) {
            opp.deck.push(...returnedCards);
            this.shuffleDeck(oppIndex);
          }
          break;
        }
        case "shuffleTwoOpponentBenchedPokemonIntoDeck": {
          let shuffled = 0;
          while (shuffled < 2 && opp.bench.length > 0) {
            const benchSlots = [];
            for (let bi = 0; bi < opp.bench.length; bi++) benchSlots.push(G.bench(bi));
            const slot = await this.chooseSlot(p, oppIndex, `山札にもどす相手のベンチポケモンを選んでください（${shuffled + 1}/2）`, benchSlots);
            if (slot == null || slot.k !== "b" || !(slot.i < opp.bench.length)) break;
            const idx = slot.i;
            const gone = opp.bench.splice(idx, 1)[0];
            opp.deck.push(...gone.cards);
            opp.deck.push(...gone.attachedEnergy);
            if (gone.tool != null) opp.deck.push(gone.tool);
            if (gone.extraTool != null) opp.deck.push(gone.extraTool);
            this.note(`相手の${gone.name}とついているカードを山札にもどした`);
            shuffled += 1;
          }
          this.shuffleDeck(oppIndex);
          break;
        }
        case "placeCountersOnAllOpponentPokemon": {
          const [counters] = effect.a;
          const blockedBench = this.benchCountersBlocked();
          for (const pk of opp.allPokemon) {
            if (blockedBench && opp.active !== pk) continue;
            pk.damage += counters * 10;
          }
          this.note(`相手のポケモン全員にダメカンを${counters}個ずつのせた`);
          break;
        }
        case "attachBasicEnergyFromHandToYourPokemonUpTo": {
          const [type, maxCount] = effect.a;
          const handEnergy = me.hand.filter((c) => c.energyType === type);
          if (handEnergy.length === 0) break;
          const pickedEnergy = await this.pickCards(p, handEnergy, maxCount, `自分のポケモンにつける${J(type)}エネルギー（手札から）`);
          for (const c of pickedEnergy) {
            const slot = await this.chooseSlot(p, p, `${c.name}をつけるポケモンを選んでください`, this.slots(p));
            const target = slot != null ? this.pokemon(p, slot) : null;
            if (slot != null && target != null) {
              this.removeCard(me.hand, c.id);
              target.attachedEnergy.push(c);
              this.note(`手札から${c.name}を${target.name}につけた`);
              this.healOnAttachFromHand(p, target);
            }
          }
          break;
        }
        case "placeCountersOnAllPokemonWithAbility": {
          const [counters] = effect.a;
          for (const side of this.players) {
            for (const pk of side.allPokemon) {
              if (pk.data.ability != null) pk.damage += counters * 10;
            }
          }
          this.note(`おたがいの特性を持つポケモン全員にダメカンを${counters}個ずつのせた`);
          break;
        }
        case "moveDamageCountersFromYourBenchedToOpponent": {
          const fromSlots = [];
          for (let fi = 0; fi < me.bench.length; fi++) {
            if (me.bench[fi].damage > 0) fromSlots.push(G.bench(fi));
          }
          if (fromSlots.length === 0) break;
          const fromSlot = await this.chooseSlot(p, p, "ダメカンをのせ替える元の自分のベンチポケモンを選んでください", fromSlots);
          if (fromSlot == null || fromSlot.k !== "b" || !(fromSlot.i < me.bench.length)) break;
          const fromPk = me.bench[fromSlot.i];
          const toSlot = await this.chooseSlot(p, oppIndex, "ダメカンをのせる相手のポケモンを選んでください", this.slots(oppIndex));
          if (toSlot == null) break;
          const toPk = this.pokemon(oppIndex, toSlot);
          if (toPk == null) break;
          toPk.damage += fromPk.damage;
          this.note(`${fromPk.name}のダメカンを${Math.trunc(fromPk.damage / 10)}個、相手の${toPk.name}にのせ替えた`);
          fromPk.damage = 0;
          break;
        }
        case "moveDamageCountersFromBenchedAncientToDefender": {
          const ancientSlots = [];
          for (let ai = 0; ai < me.bench.length; ai++) {
            if (this.isAncientPokemon(me.bench[ai]) && me.bench[ai].damage > 0) ancientSlots.push(G.bench(ai));
          }
          if (ancientSlots.length === 0 || defenderProtected) break;
          const aSlot = await this.chooseSlot(p, p, "ダメカンをのせ替える「古代」のベンチポケモンを選んでください", ancientSlots);
          if (aSlot == null || aSlot.k !== "b" || !(aSlot.i < me.bench.length)) break;
          const ancient = me.bench[aSlot.i];
          defender.damage += ancient.damage;
          this.note(`${ancient.name}のダメカンを${Math.trunc(ancient.damage / 10)}個、相手の${defender.name}にのせ替えた`);
          ancient.damage = 0;
          break;
        }
        case "healOneOfYourBenchedAncientPokemon": {
          const [amount] = effect.a;
          const healSlots = [];
          for (let hi = 0; hi < me.bench.length; hi++) {
            if (this.isAncientPokemon(me.bench[hi])) healSlots.push(G.bench(hi));
          }
          if (healSlots.length === 0) break;
          const hSlot = await this.chooseSlot(p, p, "HPを回復する「古代」のベンチポケモンを選んでください", healSlots);
          const target = hSlot != null ? this.pokemon(p, hSlot) : null;
          if (hSlot != null && target != null) {
            if (target.damage > 0) target.healedTurn = this.turnNumber;
            target.damage = Math.max(target.damage - amount, 0);
            this.note(`${target.name}のHPを${amount}回復した`);
          }
          break;
        }
        case "lookAtOpponentTopCardsReorder": {
          const [count] = effect.a;
          const topCards = [];
          let taken = 0;
          while (taken < count && opp.deck.length > 0) {
            topCards.push(opp.deck.shift());
            taken += 1;
          }
          const ordered = [];
          while (topCards.length > 0) {
            const labels = [];
            for (const c of topCards) labels.push(c.name);
            const i = (await this.ask(p, "card", `相手の山札の上に置く順に選んでください（${ordered.length + 1}番目＝上から${ordered.length + 1}枚目）`, labels)) ?? 0;
            ordered.push(topCards.splice(Math.max(0, Math.min(i, topCards.length - 1)), 1)[0]);
          }
          opp.deck.splice(0, 0, ...ordered);
          this.note(`相手の山札の上${taken}枚の順番を入れ替えた`);
          break;
        }
        case "putBasicNamePrefixPokemonFromDeckToBench": {
          const [prefix] = effect.a;
          const room = this.rules.maxBench - me.bench.length;
          const basics = me.deck.filter((c) => c.isBasicPokemon && c.name.startsWith(prefix));
          if (room > 0 && basics.length > 0) {
            const pickedBasics = await this.pickCards(p, basics, room, `ベンチに出す「${prefix}ポケモン」`);
            for (const c of pickedBasics) {
              this.removeCard(me.deck, c.id);
              me.bench.push(this.makePokemon(c));
              this.note(`山札から${c.name}をベンチに出した`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "returnSelfAndAttachedCardsToHand": {
          if (attacker.isKnockedOut || me.bench.length === 0 || me.active !== attacker) break;
          me.hand.push(...attacker.cards);
          me.hand.push(...attacker.attachedEnergy);
          if (attacker.tool != null) me.hand.push(attacker.tool);
          if (attacker.extraTool != null) me.hand.push(attacker.extraTool);
          me.active = null;
          this.note(`${attacker.name}とついているカードを手札にもどした`);
          break;
        }
        case "opponentCannotPlaySupportersNextTurn": {
          opp.cannotPlaySupportersUntilTurn = this.turnNumber + 1;
          this.note("次の相手の番、相手はサポートが使えない");
          break;
        }
        case "boostOwnAttacksNextTurn": {
          const [n] = effect.a;
          if (!attacker.isKnockedOut) {
            attacker.selfAttackBoostTurn = this.turnNumber + 2;
            attacker.selfAttackBoost = n;
            this.note(`${attacker.name}は次の自分の番、ワザのダメージが${n}増える`);
          }
          break;
        }
        case "damageOneOfYourBenchedPokemon": {
          const [n] = effect.a;
          if (me.bench.length === 0) break;
          const benchSlots = [];
          for (let bi = 0; bi < me.bench.length; bi++) benchSlots.push(G.bench(bi));
          const slot = await this.chooseSlot(p, p, "ダメージを受ける自分のベンチポケモンを選んでください", benchSlots);
          const target = slot != null ? this.pokemon(p, slot) : null;
          if (slot != null && target != null) {
            this.dealDirectDamage(target, n);
          }
          break;
        }
        case "attachBasicEnergyFromDeckToBenchedOfType": {
          const [type, maxCount] = effect.a;
          await this.attachEnergyToBench(p, false, type, maxCount);
          break;
        }
        case "attachBasicEnergyFromDiscardToYourPokemonUpTo": {
          const [maxCount] = effect.a;
          const cands = me.discard.filter((c) => c.energyType != null);
          if (cands.length === 0) break;
          const picked = await this.pickCards(p, cands, maxCount, "自分のポケモンにつける基本エネルギー（トラッシュから）");
          for (const c of picked) {
            const slot = await this.chooseSlot(p, p, `${c.name}をつけるポケモンを選んでください`, this.slots(p));
            const target = slot != null ? this.pokemon(p, slot) : null;
            if (slot != null && target != null) {
              this.removeCard(me.discard, c.id);
              target.attachedEnergy.push(c);
              this.note(`トラッシュから${c.name}を${target.name}につけた`);
            }
          }
          break;
        }
        default:
          break;
      }
    },

    // スタートデッキ100 第4弾（152〜224 水）で追加したワザの効果
    async applyAfterDamageEffectPart11(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "putPokemonOfTypeFromDiscardToBench": {
          const [type, maxCount] = effect.a;
          const cands = [];
          for (const c of me.discard) {
            if (c.pokemonData != null && c.pokemonData.type === type && c.isBasicPokemon) cands.push(c);
          }
          if (cands.length === 0) break;
          const room = this.rules.maxBench - me.bench.length;
          if (room <= 0) break;
          const picked = await this.pickCards(p, cands, Math.min(maxCount, room), `ベンチに出す${J(type)}ポケモン（トラッシュから）`);
          for (const c of picked) {
            this.removeCard(me.discard, c.id);
            me.bench.push(this.makePokemon(c));
            this.note(`トラッシュから${c.name}をベンチに出した`);
          }
          break;
        }
        case "knockOutOpponentPokemonWithDamageCounters": {
          const [n] = effect.a;
          const cands = [];
          for (const slot of this.slots(oppIndex)) {
            const pk = this.pokemon(oppIndex, slot);
            if (pk != null && pk.damage === n * 10) cands.push(slot);
          }
          const slot = await this.chooseSlot(p, oppIndex, "きぜつさせる相手のポケモンを選んでください", cands);
          const target = slot != null ? this.pokemon(oppIndex, slot) : null;
          if (slot != null && target != null) {
            target.damage = target.hp;
            this.note(`${target.name}をきぜつさせた`);
          }
          break;
        }
        case "paralyzeDefender": {
          if (!defenderProtected && !defender.isKnockedOut) this.inflict("paralyzed", defender);
          break;
        }
        case "paralyzeDefenderIfType": {
          const [type] = effect.a;
          if (!defenderProtected && !defender.isKnockedOut && defender.data.type === type) this.inflict("paralyzed", defender);
          break;
        }
        case "attachBasicEnergyFromDiscardToSelfUpTo": {
          const [type, maxCount] = effect.a;
          if (attacker.isKnockedOut) break;
          const cands = me.discard.filter((c) => c.energyType === type);
          if (cands.length === 0) break;
          const picked = await this.pickCards(p, cands, maxCount, `${attacker.name}につける${J(type)}エネルギー（トラッシュから）`);
          for (const c of picked) {
            this.removeCard(me.discard, c.id);
            attacker.attachedEnergy.push(c);
            this.note(`トラッシュから${c.name}を${attacker.name}につけた`);
          }
          break;
        }
        case "flipCoinsDiscardRandomOpponentHandPerHeads": {
          const [count] = effect.a;
          let heads = 0;
          let n = 0;
          while (n < count) {
            n += 1;
            if (this.flipCoin()) heads += 1;
          }
          let k = 0;
          while (k < heads && opp.hand.length > 0) {
            const i = this.randInt(opp.hand.length);
            const c = opp.hand.splice(i, 1)[0];
            opp.discard.push(c);
            this.note(`相手の手札から「${c.name}」をトラッシュした`);
            k += 1;
          }
          break;
        }
        case "flipCoinsDiscardOpponentDeckTopPerHeads": {
          const [count] = effect.a;
          let heads = 0;
          let n = 0;
          while (n < count) {
            n += 1;
            if (this.flipCoin()) heads += 1;
          }
          let k = 0;
          while (k < heads && opp.deck.length > 0) {
            const c = opp.deck.shift();
            opp.discard.push(c);
            k += 1;
          }
          this.note(`相手の山札を${k}枚トラッシュした`);
          break;
        }
        case "lockOpponentAttackersWithEnergyAtMost": {
          const [n] = effect.a;
          opp.attackLockUntilTurn = this.turnNumber + 1;
          opp.attackLockEnergyAtMost = n;
          this.note(`次の相手の番、エネルギーが${n}個以下の相手のポケモンはワザが使えない`);
          break;
        }
        case "discardDefenderEnergyOfType": {
          const [type, count] = effect.a;
          if (defenderProtected) break;
          let k = 0;
          while (k < count) {
            const i = defender.attachedEnergy.findIndex((c) => c.energyType === type);
            if (i < 0) break;
            const e = defender.attachedEnergy.splice(i, 1)[0];
            opp.discard.push(e);
            this.note(`${defender.name}の${e.name}をトラッシュした`);
            k += 1;
          }
          break;
        }
        case "damageEachOpponentBenchedPerPrizeTaken": {
          const [per] = effect.a;
          const taken = this.rules.prizeCount - opp.prizes.length;
          for (const b of [...opp.bench]) this.dealDirectDamage(b, taken * per);
          break;
        }
        case "optionalShuffleAttachedEnergyIntoDeckThenDamageOpponentBenched": {
          const [count, dmg] = effect.a;
          if (attacker.attachedEnergy.length < count || opp.bench.length === 0 || attacker.isKnockedOut) break;
          if (await this.askYesNo(p, `エネルギーを${count}個山札にもどして、相手のベンチに${dmg}ダメージを与えますか？`)) {
            let k = 0;
            while (k < count) {
              const labels = [];
              for (const e of attacker.attachedEnergy) labels.push(e.name);
              const i = (await this.ask(p, "card", `山札にもどすエネルギー（${k + 1}/${count}）`, labels)) ?? 0;
              const e = attacker.attachedEnergy.splice(i, 1)[0];
              me.deck.push(e);
              k += 1;
            }
            this.shuffleDeck(p);
            const benchSlots = [];
            for (let bi = 0; bi < opp.bench.length; bi++) benchSlots.push(G.bench(bi));
            const slot = await this.chooseSlot(p, oppIndex, `${dmg}ダメージを与える相手のベンチポケモンを選んでください`, benchSlots);
            const target = slot != null ? this.pokemon(oppIndex, slot) : null;
            if (slot != null && target != null) {
              this.dealDirectDamage(target, dmg);
            }
          }
          break;
        }
        default:
          break;
      }
    },

    // スタートデッキ100 第2弾（021〜082）で追加したワザの効果
    async applyAfterDamageEffectPart10(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "attachBasicEnergyFromHandToBenchedThenHealFully": {
          const [type] = effect.a;
          if (me.bench.length === 0) break;
          const cands = me.hand.filter((c) => c.energyType === type);
          if (cands.length === 0) break;
          const picked = await this.pickCards(p, cands, 1, `ベンチポケモンにつける${J(type)}エネルギー`);
          if (picked.length === 0) break;
          const c = picked[0];
          const benchSlots = [];
          for (let bi = 0; bi < me.bench.length; bi++) benchSlots.push(G.bench(bi));
          const slot = await this.chooseSlot(p, p, "エネルギーをつけるベンチポケモンを選んでください", benchSlots);
          if (slot == null) break;
          const target = this.pokemon(p, slot);
          if (target == null) break;
          this.removeCard(me.hand, c.id);
          target.attachedEnergy.push(c);
          this.note(`${c.name}を${target.name}につけた`);
          this.healOnAttachFromHand(p, target);
          if (target.damage > 0) target.healedTurn = this.turnNumber;
          target.damage = 0;
          this.note(`${target.name}のHPをすべて回復した`);
          break;
        }
        case "healAllYourBenchedPokemon": {
          const [amount] = effect.a;
          for (const pk of me.bench) {
            if (!(pk.damage > 0)) continue;
            pk.damage = Math.max(pk.damage - amount, 0);
            pk.healedTurn = this.turnNumber;
          }
          this.note(`自分のベンチポケモン全員のHPを${amount}回復した`);
          break;
        }
        case "attachBasicEnergyFromDeckToYourPokemon": {
          const [type, maxCount] = effect.a; // type は Optional（null なら全タイプ）
          let attached = 0;
          while (attached < maxCount) {
            const cands = [];
            for (const c of me.deck) {
              const t = c.energyType;
              if (t == null) continue;
              if (type != null && type !== t) continue;
              cands.push(c);
            }
            if (cands.length === 0) break;
            const picked = await this.pickCards(p, cands, 1, `山札からポケモンにつけるエネルギー（${attached + 1}/${maxCount}。やめるなら選ばない）`);
            if (picked.length === 0) break;
            const c = picked[0];
            const slot = await this.chooseSlot(p, p, `${c.name}をつけるポケモンを選んでください`, this.slots(p));
            if (slot == null) break;
            const target = this.pokemon(p, slot);
            if (target == null) break;
            this.removeCard(me.deck, c.id);
            target.attachedEnergy.push(c);
            this.note(`山札から${c.name}を${target.name}につけた`);
            attached += 1;
          }
          this.shuffleDeck(p);
          break;
        }
        case "healOneOfYourPokemonAttack": {
          const [amount] = effect.a;
          const cands = [];
          for (const slot of this.slots(p)) {
            const pk = this.pokemon(p, slot);
            if (pk != null && pk.damage > 0) cands.push(slot);
          }
          const slot = await this.chooseSlot(p, p, "HPを回復するポケモンを選んでください", cands);
          const pk = slot != null ? this.pokemon(p, slot) : null;
          if (slot != null && pk != null) {
            pk.healedTurn = this.turnNumber;
            pk.damage = Math.max(pk.damage - amount, 0);
            this.note(`${pk.name}のHPを${amount}回復した`);
          }
          break;
        }
        case "damageChosenOpponentPokemonRepeatedly": {
          const [times, per] = effect.a;
          const counts = new Map(); // PokemonInPlay.id -> 回数
          const order = [];
          let k = 0;
          while (k < times) {
            const slot = await this.chooseSlot(p, oppIndex, `ダメージを与える相手のポケモンを選んでください（${k + 1}/${times}回目）`, this.slots(oppIndex));
            if (slot == null) break;
            const target = this.pokemon(oppIndex, slot);
            if (target == null) break;
            if (!counts.has(target.id)) order.push(target);
            counts.set(target.id, (counts.get(target.id) || 0) + 1);
            k += 1;
          }
          for (const target of order) {
            const n = counts.get(target.id) || 0;
            this.dealDirectDamage(target, n * per);
          }
          break;
        }
        case "healAllOwnSpecialConditions": {
          attacker.conditions.clear();
          this.note(`${attacker.name}の特殊状態をすべて回復した`);
          break;
        }
        case "putBasicEnergyFromDiscardToHand": {
          const [type] = effect.a;
          const cands = me.discard.filter((c) => c.energyType === type);
          if (cands.length === 0) break;
          const picked = await this.pickCards(p, cands, 1, `手札に加える${J(type)}エネルギー`);
          if (picked.length > 0) {
            const c = picked[0];
            this.removeCard(me.discard, c.id);
            me.hand.push(c);
            this.note(`トラッシュから${c.name}を手札に加えた`);
          }
          break;
        }
        case "placeCountersPerBasicEnergyInDiscardThenShuffle": {
          const [type, per] = effect.a;
          const energies = me.discard.filter((c) => c.energyType === type);
          this.note(`トラッシュの${J(type)}エネルギーは${energies.length}枚`);
          const counters = energies.length * per;
          if (counters > 0) {
            const slot = await this.chooseSlot(p, oppIndex, `ダメカンを${counters}個のせる相手のポケモンを選んでください`, this.slots(oppIndex));
            const target = slot != null ? this.pokemon(oppIndex, slot) : null;
            if (slot != null && target != null) {
              if (slot.k !== "a" && this.benchCountersBlocked()) {
                this.note("ベンチにはダメカンをのせられない");
              } else {
                target.damage += counters * 10;
                this.note(`${target.name}にダメカンを${counters}個のせた`);
              }
            }
          }
          for (const c of energies) {
            this.removeCard(me.discard, c.id);
            me.deck.push(c);
          }
          this.shuffleDeck(p);
          break;
        }
        case "flipCoinHeadsBurnDefender": {
          if (this.flipCoin()) {
            if (!defenderProtected) this.inflict("burned", defender);
          } else {
            this.note("ウラだった");
          }
          break;
        }
        case "shuffleHandIntoDeckThenDraw": {
          const [n] = effect.a;
          me.deck.push(...me.hand);
          me.hand.length = 0; // removeAll()（同じ配列をその場で空にする）
          this.shuffleDeck(p);
          const drawn = this.draw(p, n);
          this.note(`手札を山札にもどして切り、山札を${drawn}枚引いた`);
          break;
        }
        case "discardSpecialEnergyFromDefender": {
          if (defenderProtected) break;
          const specials = defender.attachedEnergy.filter((c) => c.isSpecialEnergy);
          if (specials.length === 0) break;
          const labels = [];
          for (const c of specials) labels.push(c.name);
          const i = (await this.ask(p, "card", "トラッシュする特殊エネルギーを選んでください", labels)) ?? 0;
          const target = specials[i];
          this.removeCard(defender.attachedEnergy, target.id);
          opp.discard.push(target);
          this.note(`${defender.name}の「${target.name}」をトラッシュした`);
          break;
        }
        case "moveAllAttachedEnergyToOneBenched": {
          if (me.bench.length === 0 || attacker.attachedEnergy.length === 0 || attacker.isKnockedOut) break;
          const benchSlots = [];
          for (let bi = 0; bi < me.bench.length; bi++) benchSlots.push(G.bench(bi));
          const slot = await this.chooseSlot(p, p, "エネルギーをつけ替えるベンチポケモンを選んでください", benchSlots);
          if (slot == null) break;
          const target = this.pokemon(p, slot);
          if (target == null) break;
          const moved = attacker.attachedEnergy.length;
          target.attachedEnergy.push(...attacker.attachedEnergy);
          attacker.attachedEnergy.length = 0; // removeAll()
          this.note(`エネルギー${moved}個を${attacker.name}から${target.name}につけ替えた`);
          break;
        }
        case "opponentChoosesDiscardFromHand": {
          const [base, fromName, extra] = effect.a;
          let count = base;
          if (attacker.lastChangedTurn === this.turnNumber && attacker.cards.length >= 2 && attacker.cards[attacker.cards.length - 2].name === fromName) {
            count += extra;
          }
          let k = 0;
          while (k < count && opp.hand.length > 0) {
            const labels = [];
            for (const c of opp.hand) labels.push(c.name);
            const i = (await this.ask(oppIndex, "card", `トラッシュする手札を選んでください（${k + 1}/${count}）`, labels)) ?? 0;
            const c = opp.hand.splice(i, 1)[0];
            opp.discard.push(c);
            this.note(`相手は手札の「${c.name}」をトラッシュした`);
            k += 1;
          }
          break;
        }
        case "attachAnyBasicEnergyFromDiscardToOneBenched": {
          const [maxCount] = effect.a;
          if (me.bench.length === 0) break;
          const cands = me.discard.filter((c) => c.energyType != null);
          if (cands.length === 0) break;
          const picked = await this.pickCards(p, cands, maxCount, "ベンチポケモンにつける基本エネルギー（トラッシュから）");
          if (picked.length === 0) break;
          const benchSlots = [];
          for (let bi = 0; bi < me.bench.length; bi++) benchSlots.push(G.bench(bi));
          const slot = await this.chooseSlot(p, p, "エネルギーをつけるベンチポケモンを選んでください", benchSlots);
          if (slot == null) break;
          const target = this.pokemon(p, slot);
          if (target == null) break;
          for (const c of picked) {
            this.removeCard(me.discard, c.id);
            target.attachedEnergy.push(c);
            this.note(`トラッシュから${c.name}を${target.name}につけた`);
          }
          break;
        }
        case "discardAttachedEnergyOfTypeFromSelf": {
          const [type] = effect.a;
          if (attacker.isKnockedOut) break;
          const labels = [];
          const refs = [];
          attacker.attachedEnergy.forEach((e, ei) => {
            if (e.energyType === type) { labels.push(e.name); refs.push(ei); }
          });
          if (labels.length === 0) break;
          const i = (await this.ask(p, "card", `トラッシュする${J(type)}エネルギーを選んでください`, labels)) ?? 0;
          const e = attacker.attachedEnergy.splice(refs[i], 1)[0];
          me.discard.push(e);
          this.note(`${e.name}をトラッシュした`);
          break;
        }
        case "cannotUseThisAttackUntilLeavesActive": {
          attacker.blockedAttackNames[attack.name] = 1000000 + this.turnNumber;
          this.note(`${attacker.name}は、バトル場をはなれるまで「${attack.name}」が使えない`);
          break;
        }
        case "attachBasicEnergyFromDeckToOneOfYourPokemon": {
          const [maxCount] = effect.a;
          const cands = me.deck.filter((c) => c.energyType != null);
          if (cands.length === 0) break;
          const picked = await this.pickCards(p, cands, maxCount, "自分のポケモンにつける基本エネルギー（山札から）");
          let slot = null;
          let target = null;
          if (picked.length > 0) {
            slot = await this.chooseSlot(p, p, "エネルギーをつけるポケモンを選んでください", this.slots(p));
            if (slot != null) target = this.pokemon(p, slot);
          }
          if (picked.length > 0 && slot != null && target != null) {
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              target.attachedEnergy.push(c);
              this.note(`山札から${c.name}を${target.name}につけた`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "damageYourBenchedPokemon": {
          const [n] = effect.a;
          for (const b of [...me.bench]) this.dealDirectDamage(b, n);
          break;
        }
        default:
          break;
      }
    },

  });

  if (typeof module !== "undefined") module.exports = G;
})(globalThis.PK = globalThis.PK || {});
// fx_d.js : BattleEffects.swift 2499〜3423 行の移植
// 担当範囲: applyAfterDamageEffectPart9, 1〜8 と attachEnergyToBench, matches, cardMatchesAny, searchToHand,
// shieldedByTrainer, switchActive（canPlayTrainer の直前まで）
(function (G) {
  "use strict";

  const J = (t) => G.energyJapaneseName(t); // EnergyType.japaneseName
  const CJ = (c) => G.conditionJapaneseName(c); // SpecialCondition.japaneseName

  Object.assign(G.BattleGame.prototype, {

    async applyAfterDamageEffectPart9(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      switch (effect.c) {
        case "optionalReturnSelfToHand": {
          if (attacker.isKnockedOut || me.bench.length === 0 || me.active !== attacker) break;
          if (await this.askYesNo(p, `${attacker.name}を手札にもどしますか？（ポケモン以外のカードはトラッシュします）`)) {
            me.hand.push(...attacker.cards);
            me.discard.push(...attacker.attachedEnergy);
            if (attacker.tool) me.discard.push(attacker.tool);
            if (attacker.extraTool) me.discard.push(attacker.extraTool);
            me.active = null;
            this.note(`${attacker.name}を手札にもどした`);
          }
          break;
        }
        case "protectSelfFromNonColorlessBasicPokemonAttacksNextTurn": {
          attacker.protectedFromNonColorlessBasicUntilTurn = this.turnNumber + 1;
          this.note(`${attacker.name}は次の相手の番、無色以外のたねポケモンからワザのダメージを受けない`);
          break;
        }
        case "removeSelfWeaknessNextOpponentTurn": {
          attacker.noWeaknessUntilTurn = this.turnNumber + 1;
          this.note(`${attacker.name}は次の相手の番、弱点がなくなる`);
          break;
        }
        case "distributeCountersOnOpponentBench": {
          const [counters] = effect.a;
          const opp = this.players[this.other(p)];
          if (this.benchCountersBlocked() || opp.bench.length === 0) break;
          let k = 0;
          while (k < counters) {
            const benchSlots = [];
            let bi = 0;
            while (bi < opp.bench.length) {
              benchSlots.push(G.bench(bi));
              bi += 1;
            }
            const slot = await this.chooseSlot(p, this.other(p), `ダメカンをのせる相手のベンチポケモンを選んでください（${k + 1}/${counters}）`, benchSlots);
            if (slot == null) break;
            const target = this.pokemon(this.other(p), slot);
            if (target == null) break;
            target.damage += 10;
            this.note(`${target.name}にダメカンを1個のせた`);
            k += 1;
          }
          break;
        }
        case "healAllYourPokemon": {
          const [amount] = effect.a;
          for (const pk of me.allPokemon) {
            if (pk.damage > 0) {
              const healed = Math.min(amount, pk.damage);
              pk.damage -= healed;
              pk.healedTurn = this.turnNumber;
            }
          }
          this.note(`自分のポケモン全員のHPを${amount}回復した`);
          break;
        }
        case "moveAnyAttachedEnergyToOneBenched": {
          const [count] = effect.a;
          if (me.bench.length === 0 || attacker.attachedEnergy.length === 0 || attacker.isKnockedOut) break;
          const benchSlots = [];
          let bi = 0;
          while (bi < me.bench.length) {
            benchSlots.push(G.bench(bi));
            bi += 1;
          }
          const slot = await this.chooseSlot(p, p, "エネルギーをつけ替えるベンチポケモンを選んでください", benchSlots);
          if (slot == null) break;
          const target = this.pokemon(p, slot);
          if (target == null) break;
          let n = 0;
          while (n < count && attacker.attachedEnergy.length > 0) {
            const labels = [];
            for (const e of attacker.attachedEnergy) labels.push(e.name);
            const i = (await this.ask(p, "card", `${target.name}につけ替えるエネルギー（${n + 1}/${count}）`, labels)) ?? 0;
            const e = attacker.attachedEnergy.splice(i, 1)[0];
            target.attachedEnergy.push(e);
            this.note(`${e.name}を${attacker.name}から${target.name}につけ替えた`);
            n += 1;
          }
          break;
        }
        case "optionalDiscardAttachedEnergyThenParalyzeDefender": {
          const [type, count] = effect.a;
          if (attacker.isKnockedOut) break;
          if (attacker.attachedEnergy.filter((c) => c.energyType === type).length < count) break;
          if (await this.askYesNo(p, `${J(type)}エネルギーを${count}個トラッシュして、相手のバトルポケモンをマヒにしますか？`)) {
            let n = 0;
            while (n < count) {
              const idx = attacker.attachedEnergy.findIndex((c) => c.energyType === type);
              if (idx >= 0) {
                const e = attacker.attachedEnergy.splice(idx, 1)[0];
                me.discard.push(e);
                this.note(`${attacker.name}の${e.name}をトラッシュした`);
              }
              n += 1;
            }
            if (!defenderProtected && !defender.isKnockedOut) this.inflict("paralyzed", defender);
          }
          break;
        }
        default:
          break;
      }
    },

    async applyAfterDamageEffectPart1(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "opponentCannotPlayItemsNextTurn": {
          if (!defenderProtected) {
            opp.cannotPlayItemsUntilTurn = this.turnNumber + 1;
            this.note("次の相手の番、相手は手札からグッズを出して使えない");
          }
          break;
        }
        case "evolveSelfFromDeck": {
          if (!attacker.isKnockedOut) {
            const cands = me.deck.filter((c) => c.pokemonData != null && c.pokemonData.evolvesFrom === attacker.name);
            const picked = await this.pickCards(p, cands, 1, `${attacker.name}から進化させるカード`);
            if (picked.length > 0) {
              const c = picked[0];
              this.removeCard(me.deck, c.id);
              attacker.evolve(c, this.turnNumber, this.confusionLocked());
              this.note(`山札から${c.name}を選び、${attacker.name}に進化した`);
            }
            this.shuffleDeck(p);
          }
          break;
        }
        case "discardAllEnergyFromSelf": {
          me.discard.push(...attacker.attachedEnergy);
          this.note(`${attacker.name}についているエネルギーをすべてトラッシュした`);
          attacker.attachedEnergy.length = 0;
          break;
        }
        case "placeCountersOnDefenderPerHandCard": {
          const [per] = effect.a;
          if (!defenderProtected) {
            const counters = me.hand.length * per;
            defender.damage += counters * 10;
            this.note(`${defender.name}にダメカンを${counters}個のせた`);
          }
          break;
        }
        case "putBasicPokemonOfTypeOnBenchFromDeck": {
          const [type, maxCount] = effect.a;
          const room = this.rules.maxBench - me.bench.length;
          if (room > 0) {
            const candidates = [];
            for (const c of me.deck) { if (c.isBasicPokemon && c.pokemonData != null && c.pokemonData.type === type) candidates.push(c); }
            const picked = await this.pickCards(p, candidates, Math.min(maxCount, room), `ベンチに出す${J(type)}のたねポケモン`);
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              this.putOnBench(p, c);
              this.note(`山札から${c.name}をベンチに出した`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "attachBasicEnergyFromDeckToEachBenched": {
          const [type] = effect.a;
          for (const b of [...me.bench]) {
            const c = me.deck.find((x) => x.energyType === type);
            if (c != null) {
              this.removeCard(me.deck, c.id);
              b.attachedEnergy.push(c);
              this.note(`山札から${c.name}を${b.name}につけた`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "protectSelfFromBasicPokemonAttacksNextTurn": {
          attacker.protectedFromBasicUntilTurn = this.turnNumber + 1;
          this.note(`${attacker.name}は次の相手の番、たねポケモンからワザのダメージを受けない`);
          break;
        }
        case "optionalSwitchSelfWithBench": {
          if (me.active === attacker && !attacker.isKnockedOut && me.bench.length > 0) {
            const yes = await this.askYesNo(p, `${attacker.name}をベンチポケモンと入れ替えますか？`);
            if (yes) await this.switchActive(p, p);
          }
          break;
        }
        case "sleepDefender": {
          if (!defenderProtected) this.inflict("asleep", defender);
          break;
        }
        case "knockOutLowestRemainingHPPokemonExceptSelf": {
          await this.knockOutLowestRemainingHPPokemon(p, attacker);
          break;
        }
        case "damageOneOpponentBenchedPokemonEx": {
          const [n] = effect.a;
          const candidates = [];
          let b = 0;
          while (b < opp.bench.length) {
            if (opp.bench[b].data.prizeValue >= 2 || opp.bench[b].name.endsWith("ex")) candidates.push(G.bench(b));
            b += 1;
          }
          const slot = await this.chooseSlot(p, oppIndex, `${n}ダメージを与える相手のベンチの「ポケモンex」を選んでください`, candidates);
          if (slot != null) {
            const target = this.pokemon(oppIndex, slot);
            if (target != null) this.dealDirectDamage(target, n);
          }
          break;
        }
        case "discardHandThenDraw": {
          const [n] = effect.a;
          me.discard.push(...me.hand);
          me.hand.length = 0;
          const drawn = this.draw(p, n);
          this.note(`手札をすべてトラッシュして、山札を${drawn}枚引いた`);
          break;
        }
        case "damageOneOpponentBenchedPerDamageCounters": {
          const [per] = effect.a;
          const candidates = [];
          let b = 0;
          while (b < opp.bench.length) {
            if (opp.bench[b].damage > 0) candidates.push(G.bench(b));
            b += 1;
          }
          const slot = await this.chooseSlot(p, oppIndex, "ダメージを与える相手のベンチポケモンを選んでください", candidates);
          if (slot != null) {
            const target = this.pokemon(oppIndex, slot);
            if (target != null) this.dealDirectDamage(target, Math.floor(target.damage / 10) * per);
          }
          break;
        }
        case "returnAnyAttachedEnergyToHand": {
          const [count] = effect.a;
          const picked = await this.pickCards(p, attacker.attachedEnergy, count, "手札にもどすエネルギー");
          for (const c of picked) {
            this.removeCard(attacker.attachedEnergy, c.id);
            me.hand.push(c);
            this.note(`${c.name}を手札にもどした`);
          }
          break;
        }
        case "attachDifferentBasicEnergiesFromDeckToYourTerastal": {
          const [maxCount] = effect.a;
          if (!me.allPokemon.some((x) => x.data.isTerastal)) {
            this.note("自分の場に「テラスタル」のポケモンがいない");
          } else {
            const usedTypes = [];
            let attached = 0;
            while (attached < maxCount) {
              const cands = me.deck.filter((c) => {
                const t = c.energyType;
                if (t == null) return false;
                return !usedTypes.includes(t);
              });
              if (cands.length === 0) break;
              const picked = await this.pickCards(p, cands, 1, `つける基本エネルギー（${attached}枚選択済み。やめるなら選ばない）`);
              if (picked.length === 0) break;
              const c = picked[0];
              const energyType = c.energyType;
              if (energyType == null) break;
              const targetSlots = [];
              for (const slot of this.slots(p)) {
                const pk = this.pokemon(p, slot);
                if (pk != null && pk.data.isTerastal) targetSlots.push(slot);
              }
              const slot = await this.chooseSlot(p, p, "エネルギーをつける「テラスタル」のポケモンを選んでください", targetSlots);
              if (slot == null) break;
              const target = this.pokemon(p, slot);
              if (target == null) break;
              this.removeCard(me.deck, c.id);
              target.attachedEnergy.push(c);
              usedTypes.push(energyType);
              attached += 1;
              this.note(`山札の${c.name}を${target.name}につけた`);
            }
            this.shuffleDeck(p);
          }
          break;
        }
        default:
          break;
      }
    },

    async applyAfterDamageEffectPart2(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "discardOpponentStadiumAndBlockNextTurn": {
          const st = this.stadiumCard;
          if (st != null && this.stadiumOwner === oppIndex) {
            this.players[oppIndex].discard.push(st);
            this.stadiumCard = null;
            opp.cannotPlayStadiumUntilTurn = this.turnNumber + 1;
            this.note(`相手のスタジアム「${st.name}」をトラッシュした。次の相手の番、スタジアムを出せない`);
          }
          break;
        }
        case "flipUntilTailsReturnOpponentHandCardsToDeck": {
          let heads = 0;
          while (this.flipCoin()) heads += 1;
          if (heads > 0) this.returnRandomOpponentHandCardsToDeck(p, heads);
          break;
        }
        case "flipCoinsDiscardDefenderEnergyPerHeads": {
          const [count] = effect.a;
          let heads = 0;
          let n = 0;
          while (n < count) {
            n += 1;
            if (this.flipCoin()) heads += 1;
          }
          let k = 0;
          while (k < heads && !defenderProtected && !defender.isKnockedOut && defender.attachedEnergy.length > 0) {
            const labels = [];
            for (const e of defender.attachedEnergy) labels.push(e.name);
            const i = (await this.ask(p, "card", `トラッシュする相手のエネルギーを選んでください（${k + 1}/${heads}）`, labels)) ?? 0;
            const e = defender.attachedEnergy.splice(i, 1)[0];
            opp.discard.push(e);
            this.note(`相手の${defender.name}の${e.name}をトラッシュした`);
            k += 1;
          }
          break;
        }
        case "switchSelfWithBench": {
          if (me.active === attacker && !attacker.isKnockedOut) {
            await this.switchActive(p, p);
          }
          break;
        }
        case "searchDeckAnyCardToHand": {
          const [n] = effect.a;
          if (me.deck.length > 0) {
            const picked = await this.pickCards(p, me.deck, n, "手札に加えるカード");
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              me.hand.push(c);
            }
            this.note(`山札から${picked.length}枚を手札に加えた`);
          }
          this.shuffleDeck(p);
          break;
        }
        case "defenderDamageMinusNextTurn": {
          const [n] = effect.a;
          if (!defenderProtected) {
            defender.outgoingDamageReduction = n;
            defender.outgoingDamageReductionUntilTurn = this.turnNumber + 1;
            this.note(`${defender.name}は次の相手の番、使うワザのダメージが${n}減る`);
          }
          break;
        }
        case "defenderCannotRetreatNextTurn": {
          if (!defenderProtected) {
            defender.cannotRetreatUntilTurn = this.turnNumber + 1;
            this.note(`${defender.name}は次の相手の番、にげられない`);
          }
          break;
        }
        case "defenderMustFlipCoinToAttackNextTurn": {
          if (!defenderProtected) {
            defender.mustFlipToAttackUntilTurn = this.turnNumber + 1;
            this.note(`${defender.name}は次の相手の番、ワザを使うときコインを投げる`);
          }
          break;
        }
        case "optionalDamageSelfThenParalyzeDefender": {
          const [d] = effect.a;
          const yes = await this.askYesNo(p, `このポケモンにも${d}ダメージを与えて、相手のバトルポケモンをマヒにしますか？`);
          if (yes) {
            attacker.damage += d;
            this.note(`${attacker.name}にも${d}ダメージ`);
            if (!defenderProtected && !defender.isKnockedOut) this.inflict("paralyzed", defender);
          }
          break;
        }
        case "flipCoinHeadsParalyzeDefender": {
          const heads = this.flipCoin();
          if (heads && !defenderProtected) this.inflict("paralyzed", defender);
          break;
        }
        default:
          break;
      }
    },

    async applyAfterDamageEffectPart3(effect, p, attacker, defender, attack, defenderProtected) {
      switch (effect.c) {
        case "poisonDefender": {
          if (!defenderProtected) this.inflict("poisoned", defender);
          break;
        }
        case "burnDefender": {
          if (!defenderProtected) this.inflict("burned", defender);
          break;
        }
        case "confuseDefender": {
          if (!defenderProtected) this.inflict("confused", defender);
          break;
        }
        case "flipCoinHeadsChooseSpecialConditionOnDefender": {
          const heads = this.flipCoin();
          if (heads && !defenderProtected) {
            const all = ["poisoned", "burned", "asleep", "paralyzed", "confused"];
            const labels = [];
            for (const c of all) labels.push(CJ(c));
            const i = (await this.ask(p, "other", "相手のバトルポケモンにする特殊状態を選んでください", labels)) ?? 0;
            this.inflict(all[i], defender);
          }
          break;
        }
        case "damageSelf": {
          const [n] = effect.a;
          attacker.damage += n;
          this.note(`${attacker.name}にも${n}ダメージ`);
          break;
        }
        case "healSelf": {
          const [n] = effect.a;
          if (attacker.damage > 0) attacker.healedTurn = this.turnNumber;
          attacker.damage = Math.max(attacker.damage - n, 0);
          this.note(`${attacker.name}のHPを${n}回復`);
          break;
        }
        case "cannotUseThisAttackNextTurn": {
          attacker.blockedAttackNames[attack.name] = this.turnNumber + 2;
          break;
        }
        case "cannotUseAnyAttackNextTurn": {
          attacker.cannotAttackUntilTurn = this.turnNumber + 2;
          break;
        }
        case "reduceDamageTakenNextTurn": {
          const [n] = effect.a;
          attacker.damageReduction = n;
          attacker.damageReductionUntilTurn = this.turnNumber + 1;
          this.note(`${attacker.name}は次の相手の番、受けるダメージが${n}減る`);
          break;
        }
        case "drawCards": {
          const [n] = effect.a;
          const drawn = this.draw(p, n);
          this.note(`山札を${drawn}枚引いた`);
          break;
        }
        default:
          break;
      }
    },

    async applyAfterDamageEffectPart4(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "optionalDrawUntilHandSize": {
          const [n] = effect.a;
          if (me.hand.length < n) {
            const yes = await this.askYesNo(p, `手札が${n}枚になるまで山札を引きますか？`);
            if (yes) {
              const drawn = this.draw(p, n - me.hand.length);
              this.note(`山札を${drawn}枚引いた`);
            }
          }
          break;
        }
        case "attachBasicEnergyFromDeckToSelf": {
          const [type] = effect.a;
          const idx = me.deck.findIndex((c) => c.energyType === type);
          if (idx >= 0) {
            const e = me.deck.splice(idx, 1)[0];
            attacker.attachedEnergy.push(e);
            this.note(`山札から${e.name}を${attacker.name}につけた`);
          }
          this.shuffleDeck(p);
          break;
        }
        case "putBasicPokemonOnBenchFromDeck": {
          const [maxCount] = effect.a;
          const room = this.rules.maxBench - me.bench.length;
          if (room > 0) {
            const candidates = [];
            for (const c of me.deck) { if (c.isBasicPokemon) candidates.push(c); }
            const picked = await this.pickCards(p, candidates, Math.min(maxCount, room), "ベンチに出すたねポケモン");
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              this.putOnBench(p, c);
              this.note(`山札から${c.name}をベンチに出した`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "searchDeckToHand": {
          const [filters, maxTotal] = effect.a;
          await this.searchToHand(p, false, filters, maxTotal, "手札に加えるカード");
          break;
        }
        case "flipCoinHeadsShuffleOpponentPokemonIntoDeck": {
          const heads = this.flipCoin();
          if (heads) {
            const candidates = this.slots(oppIndex);
            const slot = await this.chooseSlot(p, oppIndex, "山札にもどす相手のポケモンを選んでください", candidates);
            const target = slot != null ? this.pokemon(oppIndex, slot) : null;
            if (slot != null && target != null) {
              opp.deck.push(...target.cards);
              opp.deck.push(...target.attachedEnergy);
              if (target.tool) opp.deck.push(target.tool);
              if (target.extraTool) opp.deck.push(target.extraTool);
              if (slot.k === "a") {
                opp.active = null;
              } else {
                for (let i = opp.bench.length - 1; i >= 0; i--) { if (opp.bench[i] === target) opp.bench.splice(i, 1); }
              }
              this.shuffleDeck(oppIndex);
              this.note(`${target.name}と、ついているカードを相手の山札にもどした`);
            }
          }
          break;
        }
        case "discardTopCardAndUseIfSupporter": {
          if (me.deck.length > 0) {
            const top = me.deck.shift();
            me.discard.push(top);
            this.note(`山札の上の「${top.name}」をトラッシュした`);
            const t = top.trainerData;
            if (t != null && t.trainerKind === "supporter") {
              this.note(`サポート「${top.name}」の効果を、このワザの効果として使う`);
              await this.applyTrainerEffects(t, p);
            }
          }
          break;
        }
        case "returnAttachedEnergyToHand": {
          const [type, count] = effect.a;
          const candidates = [];
          for (const e of attacker.attachedEnergy) { if (e.energyType === type) candidates.push(e); }
          const picked = await this.pickCards(p, candidates, count, "手札にもどすエネルギー");
          for (const c of picked) {
            this.removeCard(attacker.attachedEnergy, c.id);
            me.hand.push(c);
            this.note(`${c.name}を手札にもどした`);
          }
          break;
        }
        case "flipCoinHeadsProtectSelfNextTurn": {
          if (this.flipCoin()) {
            attacker.protectedUntilTurn = this.turnNumber + 1;
            this.note(`${attacker.name}は次の相手の番、ワザのダメージや効果を受けない`);
          }
          break;
        }
        case "placeCountersWhenDefenderGetsEnergyNextTurn": {
          const [counters] = effect.a;
          if (!defenderProtected && !defender.isKnockedOut) {
            defender.attachPunishUntilTurn = this.turnNumber + 1;
            defender.attachPunishCounters = counters;
            this.note(`${defender.name}は次の相手の番、手札からエネルギーをつけられるたびダメカンが${counters}個のる`);
          }
          break;
        }
        case "switchDefenderWithBench": {
          if (!defenderProtected && !defender.isKnockedOut && this.players[oppIndex].active === defender) {
            await this.switchActive(oppIndex, oppIndex);
          }
          break;
        }
        default:
          break;
      }
    },

    async applyAfterDamageEffectPart5(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "ifKnockOutPreventAllDamageAndEffectsNextTurn": {
          if (defender.isKnockedOut) {
            attacker.protectedUntilTurn = this.turnNumber + 1;
            this.note(`${attacker.name}は次の相手の番、ワザのダメージや効果を受けない`);
          }
          break;
        }
        case "flipCoinsAttachBasicEnergyFromDiscardToBenched": {
          const [count] = effect.a;
          let heads = 0;
          let n = 0;
          while (n < count) {
            n += 1;
            if (this.flipCoin()) heads += 1;
          }
          if (heads > 0) await this.attachEnergyToBench(p, true, null, heads);
          break;
        }
        case "discardEnergyFromDefender": {
          const [count] = effect.a;
          let k = 0;
          while (k < count && !defenderProtected && !defender.isKnockedOut && defender.attachedEnergy.length > 0) {
            const labels = [];
            for (const e of defender.attachedEnergy) labels.push(e.name);
            const i = (await this.ask(p, "card", "トラッシュする相手のエネルギーを選んでください", labels)) ?? 0;
            const e = defender.attachedEnergy.splice(i, 1)[0];
            opp.discard.push(e);
            this.note(`相手の${defender.name}の${e.name}をトラッシュした`);
            k += 1;
          }
          break;
        }
        case "returnRandomOpponentHandCardToDeck": {
          this.returnRandomOpponentHandCardsToDeck(p, 1);
          break;
        }
        case "placeCountersOnOneOpponentPokemon": {
          const [counters] = effect.a;
          let candidates = this.slots(oppIndex);
          if (this.benchCountersBlocked()) candidates = candidates.filter((s) => s.k === "a");
          const slot = await this.chooseSlot(p, oppIndex, "ダメカンをのせる相手のポケモンを選んでください", candidates);
          if (slot != null) {
            const target = this.pokemon(oppIndex, slot);
            if (target != null) {
              target.damage += counters * 10;
              this.note(`${target.name}にダメカンを${counters}個のせた`);
            }
          }
          break;
        }
        case "bonusDamageIfStadiumInPlayThenDiscardIt": {
          const st = this.stadiumCard;
          if (st != null) {
            this.players[this.stadiumOwner].discard.push(st);
            this.stadiumCard = null;
            this.note(`スタジアム「${st.name}」をトラッシュした`);
          }
          break;
        }
        case "shuffleSelfAndAttachedCardsIntoDeck": {
          me.deck.push(...attacker.cards);
          me.deck.push(...attacker.attachedEnergy);
          if (attacker.tool) me.deck.push(attacker.tool);
          if (attacker.extraTool) me.deck.push(attacker.extraTool);
          if (me.active === attacker) {
            me.active = null;
          } else {
            for (let i = me.bench.length - 1; i >= 0; i--) { if (me.bench[i] === attacker) me.bench.splice(i, 1); }
          }
          this.shuffleDeck(p);
          this.note(`${attacker.name}と、ついているカードを山札にもどした`);
          break;
        }
        case "healOneBenchedPokemonFully": {
          const cands = [];
          let bi = 0;
          while (bi < me.bench.length) {
            if (me.bench[bi].damage > 0) cands.push(G.bench(bi));
            bi += 1;
          }
          const slot = await this.chooseSlot(p, p, "HPをすべて回復するベンチポケモンを選んでください", cands);
          if (slot != null) {
            const target = this.pokemon(p, slot);
            if (target != null) {
              target.healedTurn = this.turnNumber;
              target.damage = 0;
              this.note(`${target.name}のHPをすべて回復した`);
            }
          }
          break;
        }
        case "flipUntilTailsDiscardOpponentDeckTopPerHeads": {
          let heads = 0;
          while (this.flipCoin()) heads += 1;
          if (heads > 0) this.discardTopOfOpponentDeck(p, heads);
          break;
        }
        case "placeCountersOnOpponentBenchedIfDefenderHasSpecialCondition": {
          const [counters] = effect.a;
          if (defender.conditions.size > 0 && !this.benchCountersBlocked() && opp.bench.length > 0) {
            const benchSlots = [];
            let bi = 0;
            while (bi < opp.bench.length) {
              benchSlots.push(G.bench(bi));
              bi += 1;
            }
            const slot = await this.chooseSlot(p, oppIndex, "ダメカンをのせる相手のベンチポケモンを選んでください", benchSlots);
            if (slot != null) {
              const target = this.pokemon(oppIndex, slot);
              if (target != null) {
                target.damage += counters * 10;
                this.note(`${target.name}にダメカンを${counters}個のせた`);
              }
            }
          }
          break;
        }
        default:
          break;
      }
    },

    async applyAfterDamageEffectPart6(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "putNamedPokemonFromDiscardToBench": {
          const [name, maxCount] = effect.a;
          const room = this.rules.maxBench - me.bench.length;
          if (room > 0) {
            const cands = me.discard.filter((c) => c.name === name);
            const picked = await this.pickCards(p, cands, Math.min(maxCount, room), `ベンチに出す「${name}」`);
            for (const c of picked) {
              this.removeCard(me.discard, c.id);
              this.putOnBench(p, c);
              this.note(`トラッシュから「${c.name}」をベンチに出した`);
            }
          }
          break;
        }
        case "putPokemonNameContainingFromDeckToBench": {
          const [keyword] = effect.a;
          const room = this.rules.maxBench - me.bench.length;
          if (room > 0) {
            const cands = me.deck.filter((c) => c.isPokemon && c.name.includes(keyword));
            const picked = await this.pickCards(p, cands, room, `ベンチに出す「${keyword}」ポケモン`);
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              this.putOnBench(p, c);
              this.note(`山札から「${c.name}」をベンチに出した`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "blockOneDefenderAttackNextTurn": {
          if (!defenderProtected && !defender.isKnockedOut && defender.data.attacks.length > 0) {
            const labels = [];
            for (const a of defender.data.attacks) labels.push(a.name);
            const i = (await this.ask(p, "other", "次の相手の番に使えなくするワザを選んでください", labels)) ?? 0;
            const chosen = defender.data.attacks[Math.max(0, Math.min(i, labels.length - 1))];
            defender.blockedAttackNames[chosen.name] = this.turnNumber + 1;
            this.note(`${defender.name}は次の相手の番、「${chosen.name}」が使えない`);
          }
          break;
        }
        case "discardRandomCardFromOpponentHand": {
          if (!defenderProtected && opp.hand.length > 0) {
            const idx = this.randInt(opp.hand.length);
            const c = opp.hand.splice(idx, 1)[0];
            opp.discard.push(c);
            this.note(`相手の手札から「${c.name}」をトラッシュした`);
          }
          break;
        }
        case "boostThisAttackNextTurn": {
          const [n] = effect.a;
          attacker.attackBoostByName[attack.name] = { amount: n, turn: this.turnNumber + 2 };
          this.note(`${attacker.name}の「${attack.name}」は次の自分の番、ダメージが${n}増える`);
          break;
        }
        case "defenderCannotAttackNextTurn": {
          if (!defenderProtected) {
            defender.cannotAttackUntilTurn = this.turnNumber + 1;
            this.note(`${defender.name}は次の相手の番、ワザが使えない`);
          }
          break;
        }
        case "defenderTakesExtraDamageFromYourNextTurnAttacks": {
          const [n] = effect.a;
          if (!defenderProtected) {
            defender.extraDamageTaken = n;
            defender.extraDamageTakenTurn = this.turnNumber + 2;
            this.note(`${defender.name}は次の自分の番、受けるワザのダメージが${n}増える`);
          }
          break;
        }
        case "doubleDamageCountersOnAllOpponentPokemon": {
          for (const pk of opp.allPokemon) {
            if (pk === defender && defenderProtected) continue;
            if (pk !== defender && this.benchCountersBlocked()) continue;
            if (pk.damage > 0) {
              const added = pk.damage;
              pk.damage += added;
              this.note(`${pk.name}にダメカンを${Math.floor(added / 10)}個のせた（ダメカンが2倍）`);
            }
          }
          break;
        }
        case "damageEachOpponentBenchedPokemon": {
          const [n] = effect.a;
          for (const b of [...opp.bench]) this.dealDirectDamage(b, n);
          break;
        }
        case "moveOwnAttachedEnergyToBenched": {
          const [type] = effect.a;
          const movable = attacker.attachedEnergy.filter((c) => c.energyType === type);
          if (movable.length > 0 && me.bench.length > 0) {
            let energy = movable[0];
            if (movable.length > 1) {
              const picked = await this.pickCards(p, movable, 1, "つけ替えるエネルギー");
              if (picked.length > 0) energy = picked[0];
            }
            const benchSlots = [];
            let bi = 0;
            while (bi < me.bench.length) {
              benchSlots.push(G.bench(bi));
              bi += 1;
            }
            const slot = await this.chooseSlot(p, p, `${energy.name}をつけ替えるベンチポケモンを選んでください`, benchSlots);
            if (slot != null) {
              const target = this.pokemon(p, slot);
              if (target != null) {
                this.removeCard(attacker.attachedEnergy, energy.id);
                target.attachedEnergy.push(energy);
                this.note(`${energy.name}を${attacker.name}から${target.name}につけ替えた`);
              }
            }
          }
          break;
        }
        default:
          break;
      }
    },

    async applyAfterDamageEffectPart7(effect, p, attacker, defender, attack, defenderProtected) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "flipCoinsAllHeadsKnockOutOpponentPokemon": {
          const [count] = effect.a;
          let allHeads = true;
          let n = 0;
          while (n < count) {
            n += 1;
            if (!this.flipCoin()) allHeads = false;
          }
          if (allHeads) {
            const slot = await this.chooseSlot(p, oppIndex, "きぜつさせる相手のポケモンを選んでください", this.slots(oppIndex));
            const target = slot != null ? this.pokemon(oppIndex, slot) : null;
            if (slot != null && target != null) {
              if (target.protectedUntilTurn >= this.turnNumber || (slot.k === "a" && defenderProtected)) {
                this.note(`${target.name}はワザのダメージや効果を受けない`);
              } else {
                target.damage = target.hp;
                this.note(`${target.name}をきぜつさせた`);
              }
            }
          } else {
            this.note("すべてオモテではなかった");
          }
          break;
        }
        case "damageEveryBenchedPokemon": {
          const [n] = effect.a;
          for (const b of [...opp.bench]) this.dealDirectDamage(b, n);
          for (const b of [...me.bench]) this.dealDirectDamage(b, n);
          break;
        }
        case "damageOneOpponentBenchedPokemon": {
          const [n] = effect.a;
          const candidates = [];
          let b = 0;
          while (b < opp.bench.length) {
            candidates.push(G.bench(b));
            b += 1;
          }
          const slot = await this.chooseSlot(p, oppIndex, `${n}ダメージを与える相手のベンチポケモンを選んでください`, candidates);
          if (slot != null) {
            const target = this.pokemon(oppIndex, slot);
            if (target != null) this.dealDirectDamage(target, n);
          }
          break;
        }
        case "discardOpponentDeckTop": {
          const [n] = effect.a;
          let k = 0;
          while (k < n && opp.deck.length > 0) {
            const c = opp.deck.shift();
            opp.discard.push(c);
            this.note(`相手の山札の上の「${c.name}」をトラッシュした`);
            k += 1;
          }
          break;
        }
        case "flipUntilTailsSearchAnyCardsPerHeads": {
          let heads = 0;
          while (this.flipCoin()) heads += 1;
          if (heads > 0) {
            const picked = await this.pickCards(p, me.deck, heads, "手札に加えるカード");
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              me.hand.push(c);
            }
            this.note(`山札から${picked.length}枚を手札に加えた`);
          }
          this.shuffleDeck(p);
          break;
        }
        case "attachBasicEnergyFromDeckToBenched": {
          const [maxCount] = effect.a;
          await this.attachEnergyToBench(p, false, null, maxCount);
          break;
        }
        case "attachBasicEnergyFromDiscardToBenched": {
          const [type, maxCount] = effect.a;
          await this.attachEnergyToBench(p, true, type, maxCount);
          break;
        }
        case "discardAttachedEnergyFromSelf": {
          const [count] = effect.a;
          let n = 0;
          while (n < count && attacker.attachedEnergy.length > 0) {
            const labels = [];
            for (const e of attacker.attachedEnergy) labels.push(e.name);
            const i = (await this.ask(p, "card", `トラッシュするエネルギー（${n + 1}/${count}）`, labels)) ?? 0;
            const e = attacker.attachedEnergy.splice(i, 1)[0];
            me.discard.push(e);
            this.note(`${attacker.name}の${e.name}をトラッシュした`);
            n += 1;
          }
          break;
        }
        case "knockOutDefenderIfDamageCounters": {
          const [n] = effect.a;
          if (!defenderProtected && defender.damage === n * 10) {
            defender.damage = defender.hp;
            this.note(`ダメカンが${n}個のっていたので、${defender.name}をきぜつさせた`);
          }
          break;
        }
        case "lookAtOpponentHandAndDiscardOne": {
          if (opp.hand.length > 0) {
            const labels = [];
            for (const c of opp.hand) labels.push(c.name);
            const i = (await this.ask(p, "card", "相手の手札からトラッシュするカードを選んでください", labels)) ?? 0;
            const c = opp.hand.splice(i, 1)[0];
            opp.discard.push(c);
            this.note(`相手の手札の「${c.name}」をトラッシュした`);
          }
          break;
        }
        default:
          break;
      }
    },

    async applyAfterDamageEffectPart8(effect, p, attacker, defender, attack, defenderProtected) {
      switch (effect.c) {
        case "flipCoinsAllHeadsHealOneOfYourPokemonFully": {
          const [count] = effect.a;
          let allHeads = true;
          let n = 0;
          while (n < count) {
            n += 1;
            if (!this.flipCoin()) allHeads = false;
          }
          if (allHeads) {
            const candidates = [];
            for (const slot of this.slots(p)) {
              const pk = this.pokemon(p, slot);
              if (pk != null && pk.damage > 0) candidates.push(slot);
            }
            const slot = await this.chooseSlot(p, p, "HPをすべて回復するポケモンを選んでください", candidates);
            if (slot != null) {
              const target = this.pokemon(p, slot);
              if (target != null) {
                if (target.damage > 0) target.healedTurn = this.turnNumber;
                target.damage = 0;
                this.note(`${target.name}のHPをすべて回復した`);
              }
            }
          }
          break;
        }
        default:
          break;
      }
    },

    /// 山札（またはトラッシュ）のエネルギーを、ベンチポケモンに好きなようにつける
    async attachEnergyToBench(p, fromDiscard, type, maxCount) {
      const me = this.players[p];
      if (me.bench.length === 0) {
        if (!fromDiscard) this.shuffleDeck(p);
        return;
      }
      const candidates = [];
      const pool = fromDiscard ? me.discard : me.deck;
      for (const c of pool) {
        const t = c.energyType;
        if (t == null) continue;
        if (type != null && type !== t) continue;
        candidates.push(c);
      }
      const picked = await this.pickCards(p, candidates, maxCount, "ベンチポケモンにつけるエネルギー");
      for (const c of picked) {
        const benchSlots = [];
        let b = 0;
        while (b < me.bench.length) {
          benchSlots.push(G.bench(b));
          b += 1;
        }
        const slot = await this.chooseSlot(p, p, `${c.name}をつけるポケモンを選んでください`, benchSlots);
        if (slot != null) {
          const target = this.pokemon(p, slot);
          if (target != null) {
            if (fromDiscard) {
              this.removeCard(me.discard, c.id);
            } else {
              this.removeCard(me.deck, c.id);
            }
            target.attachedEnergy.push(c);
            this.note(`${c.name}を${target.name}につけた`);
          }
        }
      }
      if (!fromDiscard) this.shuffleDeck(p);
    },

    // MARK: - カードを探して手札に加える
    matches(card, filter) {
      // 化石は「グッズ」として手札・山札にあるカード（ポケモンの探し方には当てはまらない）
      const fd = card.pokemonData;
      if (fd != null && fd.isFossil) {
        if (filter.c === "anyTrainer") return true;
        return false;
      }
      const pd = card.pokemonData;
      const td = card.trainerData;
      switch (filter.c) {
        case "pokemon": {
          const [type] = filter.a;
          return pd != null && pd.type === type;
        }
        case "stadium":
          return td != null && td.trainerKind === "stadium";
        case "basicPokemon": {
          const [type] = filter.a;
          return pd != null && pd.stage === "basic" && pd.type === type;
        }
        case "basicEnergy": {
          const [type] = filter.a;
          return card.energyType === type;
        }
        case "anyPokemon":
          return card.isPokemon;
        case "anyBasicEnergy":
          return card.isEnergy;
        case "supporter":
          return td != null && td.trainerKind === "supporter";
        case "megaEx":
          if (pd != null) return this.isMegaEx(pd);
          return false;
        case "anyTrainer":
          if (td != null) return td.trainerKind !== "specialEnergy";
          return false;
        case "basicNamePrefix": {
          const [prefix] = filter.a;
          if (pd != null) return pd.stage === "basic" && pd.name.startsWith(prefix);
          return false;
        }
        case "supporterNameContaining": {
          const [key] = filter.a;
          return td != null && td.trainerKind === "supporter" && card.name.includes(key);
        }
        case "terastal":
          return pd != null && pd.isTerastal === true;
        case "pokemonTool":
          return td != null && td.trainerKind === "tool";
        case "colorlessPokemonMaxHP": {
          const [hp] = filter.a;
          if (pd != null) return pd.type === "colorless" && pd.hp <= hp;
          return false;
        }
        case "evolutionPokemon":
          if (pd != null) return pd.stage !== "basic";
          return false;
        case "evolutionPokemonOfType": {
          const [t] = filter.a;
          if (pd != null) return pd.stage !== "basic" && pd.type === t;
          return false;
        }
        case "namePrefix": {
          const [prefix] = filter.a;
          if (pd != null) return pd.name.startsWith(prefix);
          return false;
        }
        case "stage1Pokemon":
          return pd != null && pd.stage === "stage1";
        case "pokemonWithoutRule":
          if (pd != null) return pd.prizeValue <= 1 && !pd.name.endsWith("ex");
          return false;
        default:
          // TODO(port): Swift の switch は網羅的。未知の DeckSearchFilter case
          return false;
      }
    },

    cardMatchesAny(card, filters) {
      for (const f of filters) {
        if (this.matches(card, f)) return true;
      }
      return false;
    },

    async searchToHand(p, fromDiscard, filters, maxTotal, prompt) {
      const me = this.players[p];
      const pool = fromDiscard ? me.discard : me.deck;
      const candidates = [];
      for (const c of pool) {
        if (!this.cardMatchesAny(c, filters)) continue;
        // 「ポケバイタルA」: トラッシュにあるかぎり、手札に加えられない
        const tt = c.trainerData;
        if (fromDiscard && tt != null && tt.effects.some((e) => e.c === "cannotLeaveDiscardWhileThere")) continue;
        candidates.push(c);
      }
      const picked = await this.pickCards(p, candidates, maxTotal, prompt);
      for (const c of picked) {
        if (fromDiscard) {
          this.removeCard(me.discard, c.id);
        } else {
          this.removeCard(me.deck, c.id);
        }
        me.hand.push(c);
        this.note(`「${c.name}」を手札に加えた`);
      }
      if (!fromDiscard) this.shuffleDeck(p);
    },

    // MARK: - ポケモンの入れ替え
    /// オノンド「きんちょうかん」: 相手が手札から出して使ったグッズ・サポートの効果を受けないポケモンか
    shieldedByTrainer(pk, t) {
      if (!(t.trainerKind === "item" || t.trainerKind === "supporter")) return false;
      const ab = pk.ability;
      if (ab == null || ab.trigger !== "passive") return false;
      return ab.effects.some((x) => x.c === "immuneToEffectsOfOpponentItemsAndSupporters");
    },

    /// target 側のバトルポケモンを、ベンチと入れ替える。入れ替え先は chooser が選ぶ
    async switchActive(target, chooser, maxRemainingHP = null, onlyType = null, onlyBasic = false, excludingShieldedFrom = null) {
      const t = this.players[target];
      const oldActive = t.active;
      if (t.bench.length === 0 || oldActive == null) return;
      const candidates = [];
      let b = 0;
      while (b < t.bench.length) {
        if (excludingShieldedFrom != null && this.shieldedByTrainer(t.bench[b], excludingShieldedFrom)) { b += 1; continue; }
        if (onlyBasic && t.bench[b].data.stage !== "basic") { b += 1; continue; }
        if (onlyType != null) {
          if (t.bench[b].data.type === onlyType) candidates.push(G.bench(b));
        } else if (maxRemainingHP != null) {
          if (t.bench[b].remainingHP <= maxRemainingHP) candidates.push(G.bench(b));
        } else {
          candidates.push(G.bench(b));
        }
        b += 1;
      }
      const slot = await this.chooseSlot(chooser, target, "バトル場に出すポケモンを選んでください", candidates);
      if (slot == null) return;
      if (slot.k !== "b") return;
      const i = slot.i;
      if (!(i >= 0 && i < t.bench.length)) return;
      const newActive = t.bench.splice(i, 1)[0];
      oldActive.conditions.clear();
      t.bench.push(oldActive);
      t.active = newActive;
      this.note(`プレイヤー${target + 1}の${oldActive.name}とベンチの${newActive.name}を入れ替えた`);
      await this.afterBenchToActive(target, newActive);
      await this.afterActiveToBench(target, oldActive);
    },

  });

  if (typeof module !== "undefined") module.exports = G;
})(globalThis.PK = globalThis.PK || {});
// fx_e.js : BattleEffects.swift 3424〜4306 行の移植
// 担当範囲: canPlayTrainer, applyTrainerEffects, applyTrainerEffectPart1〜4, stadiumHas ... afterBenchToActive
// （abilityCanDoSomething の直前まで）
(function (G) {
  "use strict";

  const J = (t) => G.energyJapaneseName(t); // EnergyType.japaneseName

  Object.assign(G.BattleGame.prototype, {

    canPlayTrainer(p, t) {
      const me = this.players[p];
      for (const effect of t.effects) {
        switch (effect.c) {
          case "switchOpponentActiveWithBench":
            if (this.players[this.other(p)].bench.length === 0) return false;
            break;
          case "searchDeckToHand":
            if (me.deck.length === 0) return false;
            break;
          case "protectOneOfYourPokemonFromOpponentExNextTurn": {
            const [n] = effect.a;
            if (this.players[this.other(p)].prizes.length > n) return false;
            break;
          }
          case "putBasicPokemonWithMaxHPOnBenchFromDeck": {
            const [maxHP] = effect.a;
            if (me.bench.length >= this.rules.maxBench) return false;
            if (!me.deck.some((c) => c.isBasicPokemon && ((c.pokemonData ? c.pokemonData.hp : 999) <= maxHP))) return false;
            break;
          }
          case "rareCandy":
            if (this.rareCandyOptions(p).length === 0) return false;
            break;
          case "healMegaExFullyThenReturnEnergyToHand":
            if (!me.allPokemon.some((pk) => this.isMegaEx(pk.data))) return false;
            break;
          case "devolveYourEvolvedPokemonOfType": {
            const [ty] = effect.a;
            if (!me.allPokemon.some((pk) => pk.cards.length > 1 && pk.data.type === ty)) return false;
            break;
          }
          case "notOnYourFirstTurn":
            if (me.turnsTaken <= 1) return false;
            break;
          case "switchOwnActiveWithBench":
            if (me.active == null || me.bench.length === 0) return false;
            break;
          case "lookTopCardsPutBasicOfTypeOnBenchRestToBottom":
            if (me.bench.length >= this.rules.maxBench || me.deck.length === 0) return false;
            break;
          case "searchDeckOneBasicStage1Stage2":
            if (me.deck.length === 0) return false;
            break;
          case "healActiveIfEnergyAtLeast": {
            const [count] = effect.a;
            const a = me.active;
            if (!(a != null && a.damage > 0 && this.energyUnits(a) >= count)) return false;
            break;
          }
          case "discardBasicEnergyFromHandThenDiscardOpponentToolOrStadium": {
            const [ty] = effect.a;
            if (!me.hand.some((c) => c.energyType === ty)) return false;
            if (this.stadiumCard == null && !this.players[this.other(p)].allPokemon.some((pk) => pk.tool != null)) return false;
            break;
          }
          case "requiresYourNamePrefixPokemonKnockedOutLastOpponentTurn": {
            const [prefix] = effect.a;
            if (me.lastKnockedOutTurn !== this.turnNumber - 1 || !me.lastKnockedOutNames.some((n) => n.startsWith(prefix))) return false;
            break;
          }
          case "switchActiveWithBenchedNamePrefixThenSwitchOpponentActive": {
            const [prefix] = effect.a;
            const a = me.active;
            if (!(a != null && a.data.name.startsWith(prefix))) return false;
            if (!me.bench.some((b) => b.data.name.startsWith(prefix))) return false;
            break;
          }
          case "putBasicPokemonNamePrefixFromDeckToBench": {
            const [prefix] = effect.a;
            if (me.bench.length >= this.rules.maxBench) return false;
            if (!me.deck.some((c) => c.isBasicPokemon && c.name.startsWith(prefix))) return false;
            break;
          }
          case "lookTopCardsTakePokemonOfTypeAndBasicEnergyOfType":
            if (me.deck.length === 0) return false;
            break;
          case "discardOneHandCardRequired":
            if (me.hand.length < 2) return false;
            break;
          case "discardTwoHandCardsRequired":
            if (me.hand.length < 3) return false;
            break;
          case "requiresNamedPokemonInPlay": {
            const [names] = effect.a;
            if (!me.allPokemon.some((pk) => names.includes(pk.name))) return false;
            break;
          }
          case "searchDeckOneEvolutionOneEnergy":
            if (me.deck.length === 0) return false;
            break;
          case "putPokemonFromDiscardIntoDeck":
            if (!me.discard.some((c) => c.isPokemon)) return false;
            break;
          case "putBasicEnergyFromDiscardIntoDeck":
            if (!me.discard.some((c) => c.energyType != null)) return false;
            break;
          case "attachBasicEnergyFromDiscardToBenchedColorlessIfTerastal":
            if (!me.allPokemon.some((pk) => pk.data.isTerastal)) return false;
            if (!me.bench.some((b) => b.data.type === "colorless")) return false;
            if (!me.discard.some((c) => c.energyType != null)) return false;
            break;
          case "discardPokemonToolsInPlay": {
            let any = false;
            for (let side = 0; side < 2; side++) {
              for (const pk of this.players[side].allPokemon) {
                if (pk.tool != null || pk.extraTool != null) any = true;
              }
            }
            if (!any) return false;
            break;
          }
          case "discardOpponentSpecialEnergy": {
            let any = false;
            for (const pk of this.players[this.other(p)].allPokemon) {
              if (pk.attachedEnergy.some((e) => e.isSpecialEnergy)) any = true;
            }
            if (!any) return false;
            break;
          }
          case "attachBasicEnergyFromDiscardToBenchedNamePrefix": {
            const [prefix] = effect.a;
            if (!me.bench.some((b) => b.name.startsWith(prefix))) return false;
            if (!me.discard.some((c) => c.energyType != null)) return false;
            break;
          }
          case "searchDiscardToHand": {
            const [filters] = effect.a;
            let found = false;
            for (const c of me.discard) {
              if (this.cardMatchesAny(c, filters)) found = true;
            }
            if (!found) return false;
            break;
          }
          default:
            break;
        }
      }
      if (!this.canPlayTrainerSD100(p, t)) return false;
      return true;
    },

    async applyTrainerEffects(t, p) {
      for (const effect of t.effects) {
        await this.applyTrainerEffectPart1(effect, t, p);
        await this.applyTrainerEffectPart2(effect, t, p);
        await this.applyTrainerEffectPart3(effect, t, p);
        await this.applyTrainerEffectPart4(effect, t, p);
        await this.applyTrainerEffectPart5(effect, t, p);
        await this.applyTrainerEffectPart6(effect, t, p);
      }
    },

    async applyTrainerEffectPart1(effect, t, p) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      switch (effect.c) {
        case "reduceDamageTakenByYourPokemonOfTypeNextOpponentTurn": {
          const [type, amount] = effect.a;
          me.damageReductions.push({ type: type, amount: amount, untilTurn: this.turnNumber + 1 });
          this.note(`次の相手の番、自分の${J(type)}ポケモンが受けるワザのダメージが${amount}減る`);
          break;
        }
        case "boostAttackDamageVsExThisTurn": {
          const [amount] = effect.a;
          me.exDamageBonusThisTurn += amount;
          this.note(`この番、自分のポケモンのワザの、相手のバトル場のポケモンexへのダメージが${amount}増える`);
          break;
        }
        case "discardTwoHandCardsRequired": {
          let k = 0;
          while (k < 2 && me.hand.length > 0) {
            const labels = [];
            for (const c of me.hand) labels.push(c.name);
            const i = (await this.ask(p, "card", `トラッシュする手札を選んでください（${k + 1}/2）`, labels)) ?? 0;
            const c = me.hand.splice(Math.max(0, Math.min(i, me.hand.length - 1)), 1)[0];
            me.discard.push(c);
            this.note(`手札の「${c.name}」をトラッシュした`);
            k += 1;
          }
          break;
        }
        case "boostAttackDamageThisTurn": {
          const [type, amount] = effect.a;
          me.attackBoostsThisTurn.push({ type: type, amount: amount });
          this.note(`この番、自分の${J(type)}ポケモンのワザのダメージが${amount}増える`);
          break;
        }
        case "searchDeckToHand": {
          const [filters, maxTotal] = effect.a;
          await this.searchToHand(p, false, filters, maxTotal, "手札に加えるカード");
          break;
        }
        case "searchDiscardToHand": {
          const [filters, maxTotal] = effect.a;
          await this.searchToHand(p, true, filters, maxTotal, "手札に加えるカード");
          break;
        }
        case "switchOpponentActiveWithBench": {
          const a = this.players[oppIndex].active;
          if (a != null && this.shieldedByTrainer(a, t)) {
            this.note(`${a.name}の特性で、効果を受けない`);
          } else {
            await this.switchActive(oppIndex, oppIndex);
          }
          break;
        }
        case "offerOpponentBothTakePrizeElseDraw": {
          const [drawCount] = effect.a;
          const accepted = await this.askYesNo(oppIndex, "「おたがいのプレイヤーは、それぞれサイドを1枚とる」をのぞみますか？");
          if (accepted) {
            this.takePrizes(p, 1);
            this.takePrizes(oppIndex, 1);
          } else {
            const drawn = this.draw(p, drawCount);
            this.note(`相手がのぞまなかったので、山札を${drawn}枚引いた`);
          }
          break;
        }
        case "shuffleHandIntoDeckThenDraw": {
          const [count, countIfSixPrizesRemaining] = effect.a;
          me.deck.push(...me.hand);
          me.hand.length = 0;
          this.shuffleDeck(p);
          const n = (me.prizes.length === this.rules.prizeCount) ? countIfSixPrizesRemaining : count;
          const drawn = this.draw(p, n);
          this.note(`手札を山札にもどして切り、山札を${drawn}枚引いた`);
          break;
        }
        case "lookTopCardsPutBasicOfTypeOnBenchRestToBottom": {
          const [look, type] = effect.a;
          const top = [];
          let n = 0;
          while (n < look && me.deck.length > 0) {
            top.push(me.deck.shift());
            n += 1;
          }
          const cands = top.filter((c) => c.isPokemon && (c.pokemonData ? c.pokemonData.type : null) === type);
          const picked = await this.pickCards(p, cands, 1, `ベンチに出す${J(type)}ポケモン（進化ポケモンも可）`);
          for (const c of picked) {
            this.removeCard(top, c.id);
            this.putOnBench(p, c);
            this.note(`山札から${c.name}をベンチに出した`);
          }
          this.shuffleArray(top);
          me.deck.push(...top);
          this.note("残りのカードを山札の下にもどした");
          break;
        }
        case "searchDeckOneBasicStage1Stage2": {
          for (const stage of ["basic", "stage1", "stage2"]) {
            const cands = me.deck.filter((c) => (c.pokemonData ? c.pokemonData.stage : null) === stage);
            const picked = await this.pickCards(p, cands, 1, "手札に加えるポケモン");
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              me.hand.push(c);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "healActiveIfEnergyAtLeast": {
          const [count, amount] = effect.a;
          const a = me.active;
          if (a != null && this.energyUnits(a) >= count) {
            if (a.damage > 0) a.healedTurn = this.turnNumber;
            a.damage = Math.max(a.damage - amount, 0);
            this.note(`${a.name}のHPを${amount}回復した`);
          }
          break;
        }
        default:
          break;
      }
    },

    async applyTrainerEffectPart2(effect, t, p) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      switch (effect.c) {
        case "discardBasicEnergyFromHandThenDiscardOpponentToolOrStadium": {
          const [type] = effect.a;
          const e = me.hand.find((c) => c.energyType === type);
          if (e != null) {
            this.removeCard(me.hand, e.id);
            me.discard.push(e);
            this.note(`手札の${e.name}をトラッシュした`);
          }
          const labels = [];
          const refs = [];
          for (const pk of this.players[oppIndex].allPokemon) {
            if (this.shieldedByTrainer(pk, t)) continue;
            const tool = pk.tool;
            if (tool != null) { labels.push(`${pk.name}の${tool.name}`); refs.push(pk); }
          }
          if (this.stadiumCard != null) { labels.push(`スタジアム「${this.stadiumCard.name}」`); refs.push(null); }
          if (labels.length > 0) {
            const i = (await this.ask(p, "card", "トラッシュするカードを選んでください", labels)) ?? 0;
            const pk = refs[i];
            if (pk != null && pk.tool != null) {
              const tool = pk.tool;
              pk.tool = null;
              this.players[oppIndex].discard.push(tool);
              this.note(`${pk.name}の「${tool.name}」をトラッシュした`);
            } else if (this.stadiumCard != null) {
              const st = this.stadiumCard;
              this.players[this.stadiumOwner].discard.push(st);
              this.stadiumCard = null;
              this.note(`スタジアム「${st.name}」をトラッシュした`);
            }
          }
          break;
        }
        case "devolveYourEvolvedPokemonOfType": {
          const [type] = effect.a;
          await this.devolveYourPokemon(p, type);
          break;
        }
        case "putBasicPokemonWithMaxHPOnBenchFromDeck": {
          const [maxHP, maxCount] = effect.a;
          const room = this.rules.maxBench - me.bench.length;
          if (room > 0) {
            const candidates = [];
            for (const c of me.deck) {
              if (c.isBasicPokemon && (c.pokemonData ? c.pokemonData.hp : 999) <= maxHP) candidates.push(c);
            }
            const picked = await this.pickCards(p, candidates, Math.min(maxCount, room), `ベンチに出すたねポケモン（HP${maxHP}以下）`);
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              this.putOnBench(p, c);
              this.note(`山札から${c.name}をベンチに出した`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "rareCandy":
          await this.useRareCandy(p);
          break;
        case "drawUntilHandSizeOrIfAllNamePrefix": {
          const [base, bonus, prefix] = effect.a;
          const all = me.allPokemon.length > 0 && me.allPokemon.every((pk) => pk.data.name.startsWith(prefix));
          const target = all ? bonus : base;
          if (me.hand.length < target) {
            const drawn = this.draw(p, target - me.hand.length);
            this.note(`山札を${drawn}枚引いた`);
          }
          break;
        }
        case "bothShuffleHandIntoDeckThenDraw": {
          const [own, opponent] = effect.a;
          for (const side of [p, oppIndex]) {
            this.players[side].deck.push(...this.players[side].hand);
            this.players[side].hand.length = 0;
            this.shuffleDeck(side);
          }
          const a = this.draw(p, own);
          const b = this.draw(oppIndex, opponent);
          this.note(`おたがいに手札を山札にもどして切り、自分は${a}枚、相手は${b}枚引いた`);
          break;
        }
        case "switchActiveWithBenchedNamePrefixThenSwitchOpponentActive": {
          const [prefix] = effect.a;
          const cands = [];
          me.bench.forEach((b, i) => { if (b.data.name.startsWith(prefix)) cands.push(G.bench(i)); });
          const slot = await this.chooseSlot(p, p, `バトル場に出す「${prefix}」ポケモンを選んでください`, cands);
          if (slot != null && slot.k === "b") {
            const i = slot.i;
            const old = me.active;
            if (i >= 0 && i < me.bench.length && old != null) {
              const newActive = me.bench.splice(i, 1)[0];
              old.conditions.clear();
              me.bench.push(old);
              me.active = newActive;
              this.note(`${old.name}と${newActive.name}を入れ替えた`);
              await this.afterBenchToActive(p, newActive);
              await this.afterActiveToBench(p, old);
            }
          }
          const a = this.players[oppIndex].active;
          if (a != null && this.shieldedByTrainer(a, t)) {
            this.note(`${a.name}の特性で、効果を受けない`);
          } else if (this.players[oppIndex].bench.length > 0) {
            await this.switchActive(oppIndex, p, null, null, false, t);
          }
          break;
        }
        case "putBasicPokemonNamePrefixFromDeckToBench": {
          const [prefix, maxCount] = effect.a;
          const room = this.rules.maxBench - me.bench.length;
          if (room > 0) {
            const cands = me.deck.filter((c) => c.isBasicPokemon && c.name.startsWith(prefix));
            const picked = await this.pickCards(p, cands, Math.min(maxCount, room), `ベンチに出す「${prefix}」ポケモン`);
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              this.putOnBench(p, c);
              this.note(`山札から${c.name}をベンチに出した`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "lookTopCardsTakePokemonOfTypeAndBasicEnergyOfType": {
          const [look, type, maxTotal] = effect.a;
          const top = [];
          let n = 0;
          while (n < look && me.deck.length > 0) {
            top.push(me.deck.shift());
            n += 1;
          }
          const cands = top.filter((c) => ((c.pokemonData ? c.pokemonData.type : null) === type) || (c.energyType === type));
          const picked = await this.pickCards(p, cands, maxTotal, "手札に加えるカード");
          for (const c of picked) {
            this.removeCard(top, c.id);
            me.hand.push(c);
            this.note(`「${c.name}」を手札に加えた`);
          }
          me.deck.push(...top);
          this.shuffleDeck(p);
          break;
        }
        case "discardOneHandCardRequired": {
          if (me.hand.length > 0) {
            const labels = [];
            for (const c of me.hand) labels.push(c.name);
            const i = (await this.ask(p, "card", "トラッシュする手札を選んでください", labels)) ?? 0;
            const c = me.hand.splice(Math.max(0, Math.min(i, me.hand.length - 1)), 1)[0];
            me.discard.push(c);
            this.note(`手札の「${c.name}」をトラッシュした`);
          }
          break;
        }
        default:
          break;
      }
    },

    async applyTrainerEffectPart3(effect, t, p) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      switch (effect.c) {
        case "drawUntilHandSize": {
          const [n] = effect.a;
          if (me.hand.length < n) {
            const drawn = this.draw(p, n - me.hand.length);
            this.note(`山札を${drawn}枚引いた`);
          }
          break;
        }
        case "searchDeckOneEvolutionOneEnergy": {
          const evo = me.deck.filter((c) => (c.pokemonData ? c.pokemonData.stage !== "basic" : false));
          const pe = await this.pickCards(p, evo, 1, "手札に加える進化ポケモン");
          for (const c of pe) { this.removeCard(me.deck, c.id); me.hand.push(c); this.note(`「${c.name}」を手札に加えた`); }
          const en = me.deck.filter((c) => c.isEnergy || c.isSpecialEnergy);
          const pn = await this.pickCards(p, en, 1, "手札に加えるエネルギー");
          for (const c of pn) { this.removeCard(me.deck, c.id); me.hand.push(c); this.note(`「${c.name}」を手札に加えた`); }
          this.shuffleDeck(p);
          break;
        }
        case "extraPrizesWhenNamePrefixKnocksOutThisTurn": {
          const [prefix, extra] = effect.a;
          me.extraPrizeTurn = this.turnNumber;
          me.extraPrizePrefix = prefix;
          me.extraPrizeCount = extra;
          this.note(`この番、自分の「${prefix}」のワザでバトルポケモンをきぜつさせると、サイドを${extra}枚多くとる`);
          break;
        }
        case "putPokemonFromDiscardIntoDeck": {
          const [maxCount] = effect.a;
          const cands = me.discard.filter((c) => c.isPokemon);
          const picked = await this.pickCards(p, cands, maxCount, "山札にもどすポケモン");
          for (const c of picked) {
            this.removeCard(me.discard, c.id);
            me.deck.push(c);
          }
          if (picked.length > 0) this.note(`トラッシュからポケモン${picked.length}枚を山札にもどした`);
          this.shuffleDeck(p);
          break;
        }
        case "putBasicEnergyFromDiscardIntoDeck": {
          const [maxCount] = effect.a;
          const cands = me.discard.filter((c) => c.energyType != null);
          const picked = await this.pickCards(p, cands, maxCount, "山札にもどす基本エネルギー");
          for (const c of picked) {
            this.removeCard(me.discard, c.id);
            me.deck.push(c);
          }
          if (picked.length > 0) this.note(`トラッシュから基本エネルギー${picked.length}枚を山札にもどした`);
          this.shuffleDeck(p);
          break;
        }
        case "attachBasicEnergyFromDiscardToBenchedColorlessIfTerastal": {
          const [maxPokemon] = effect.a;
          const used = [];
          let k = 0;
          while (k < maxPokemon) {
            k += 1;
            const slotsList = [];
            let bi = 0;
            while (bi < me.bench.length) {
              if (me.bench[bi].data.type === "colorless" && !used.includes(me.bench[bi].id)) slotsList.push(G.bench(bi));
              bi += 1;
            }
            const cands = me.discard.filter((c) => c.energyType != null);
            if (slotsList.length === 0 || cands.length === 0) break;
            const slot = await this.chooseSlot(p, p, "エネルギーをつけるベンチの無色ポケモンを選んでください（やめるなら選ばない）", slotsList);
            if (slot == null) break;
            const target = this.pokemon(p, slot);
            if (target == null) break;
            const picked = await this.pickCards(p, cands, 1, `${target.name}につける基本エネルギー`);
            const c = picked.length > 0 ? picked[0] : null;
            if (c == null) break;
            this.removeCard(me.discard, c.id);
            target.attachedEnergy.push(c);
            used.push(target.id);
            this.note(`トラッシュから${c.name}を${target.name}につけた`);
          }
          break;
        }
        case "discardPokemonToolsInPlay": {
          const [maxCount] = effect.a;
          const t0 = t;
          let n = 0;
          while (n < maxCount) {
            const labels = [];
            const refs = [];
            for (let side = 0; side < 2; side++) {
              for (const pk of this.players[side].allPokemon) {
                if (!(side === p || !this.shieldedByTrainer(pk, t0))) continue;
                if (pk.tool != null) { labels.push(`${side === p ? "自分" : "相手"}の${pk.name}の${pk.tool.name}`); refs.push([side, pk, false]); }
                if (pk.extraTool != null) { labels.push(`${side === p ? "自分" : "相手"}の${pk.name}の${pk.extraTool.name}`); refs.push([side, pk, true]); }
              }
            }
            if (labels.length === 0) break;
            const i = await this.ask(p, "card", "トラッシュするポケモンのどうぐを選んでください（やめるなら「選ばない」）", labels, true);
            if (i == null) break;
            const [side, pk, isExtra] = refs[i];
            if (isExtra && pk.extraTool != null) {
              const tl = pk.extraTool;
              pk.extraTool = null;
              this.players[side].discard.push(tl);
              this.note(`${pk.name}の「${tl.name}」をトラッシュした`);
            } else if (pk.tool != null) {
              const tl = pk.tool;
              pk.tool = null;
              this.players[side].discard.push(tl);
              this.note(`${pk.name}の「${tl.name}」をトラッシュした`);
            }
            n += 1;
          }
          break;
        }
        case "discardOpponentSpecialEnergy": {
          const labels = [];
          const refs = [];
          for (const pk of this.players[oppIndex].allPokemon) {
            if (this.shieldedByTrainer(pk, t)) continue;
            for (const e of pk.attachedEnergy) {
              if (e.isSpecialEnergy) { labels.push(`${pk.name}の${e.name}`); refs.push([pk, e]); }
            }
          }
          if (labels.length > 0) {
            const i = (await this.ask(p, "card", "トラッシュする特殊エネルギーを選んでください", labels)) ?? 0;
            const [pk, e] = refs[Math.max(0, Math.min(i, refs.length - 1))];
            this.removeCard(pk.attachedEnergy, e.id);
            this.players[oppIndex].discard.push(e);
            this.note(`相手の${pk.name}の${e.name}をトラッシュした`);
          }
          break;
        }
        case "attachBasicEnergyFromDiscardToBenchedNamePrefix": {
          const [prefix] = effect.a;
          const cands = me.discard.filter((c) => c.energyType != null);
          const slotsList = [];
          let bi = 0;
          while (bi < me.bench.length) {
            if (me.bench[bi].name.startsWith(prefix)) slotsList.push(G.bench(bi));
            bi += 1;
          }
          const picked = await this.pickCards(p, cands, 1, `ベンチの「${prefix}」ポケモンにつける基本エネルギー`);
          const c = picked.length > 0 ? picked[0] : null;
          if (c != null) {
            const slot = await this.chooseSlot(p, p, "エネルギーをつけるポケモンを選んでください", slotsList);
            if (slot != null) {
              const target = this.pokemon(p, slot);
              if (target != null) {
                this.removeCard(me.discard, c.id);
                target.attachedEnergy.push(c);
                this.note(`トラッシュから${c.name}を${target.name}につけた`);
              }
            }
          }
          break;
        }
        case "switchOwnActiveWithBench":
          await this.switchActive(p, p);
          break;
        default:
          break;
      }
    },

    async applyTrainerEffectPart4(effect, t, p) {
      const me = this.players[p];
      switch (effect.c) {
        case "protectOneOfYourPokemonFromOpponentExNextTurn": {
          const slot = await this.chooseSlot(p, p, "守るポケモンを選んでください", this.slots(p));
          if (slot != null) {
            const pk = this.pokemon(p, slot);
            if (pk != null) {
              pk.protectedFromExUntilTurn = this.turnNumber + 1;
              this.note(`${pk.name}は次の相手の番、相手の「ポケモンex」からワザのダメージや効果を受けない`);
            }
          }
          break;
        }
        case "healMegaExFullyThenReturnEnergyToHand": {
          const cands = [];
          for (const slot of this.slots(p)) {
            const pk = this.pokemon(p, slot);
            if (pk != null && this.isMegaEx(pk.data)) cands.push(slot);
          }
          const slot = await this.chooseSlot(p, p, "HPを回復するメガシンカexを選んでください", cands);
          if (slot != null) {
            const pk = this.pokemon(p, slot);
            if (pk != null) {
              if (pk.damage > 0) pk.healedTurn = this.turnNumber;
              pk.damage = 0;
              const n = pk.attachedEnergy.length;
              me.hand.push(...pk.attachedEnergy);
              pk.attachedEnergy.length = 0;
              this.note(`${pk.name}のHPをすべて回復し、エネルギー${n}個を手札にもどした`);
            }
          }
          break;
        }
        default:
          break;
      }
    },

    // ---------- M1Sで追加した効果の部品 ----------
    stadiumHas(test) {
      const trainer = this.stadiumCard ? this.stadiumCard.trainerData : null;
      if (trainer == null) return false;
      return trainer.effects.some(test);
    },

    confusionLocked() {
      return this.stadiumHas((e) => e.c === "confusionNotCuredByEvolution");
    },

    benchCountersBlocked() {
      return this.stadiumHas((e) => e.c === "preventDamageCountersOnBenchByOpponentEffects");
    },

    discardTopOfOpponentDeck(p, n) {
      const opp = this.players[this.other(p)];
      let k = 0;
      while (k < n && opp.deck.length > 0) {
        const c = opp.deck.shift();
        opp.discard.push(c);
        this.note(`相手の山札の上の「${c.name}」をトラッシュした`);
        k += 1;
      }
    },

    recordDamageTaken(pk, amount) {
      if (pk.lastDamageTakenTurn === this.turnNumber) {
        pk.lastDamageTaken += amount;
      } else {
        pk.lastDamageTaken = amount;
        pk.lastDamageTakenTurn = this.turnNumber;
      }
    },

    defenderIgnoresAttackEffects(pk) {
      const ab0 = pk.ability;
      if (ab0 != null && ab0.trigger === "passive" &&
          ab0.effects.some((e) => e.c === "ignoreEffectsOfOpponentAttacks")) {
        return true;
      }
      // ロケット団のフリーザー「レジストヴェール」: 自分の場のたねの「ロケット団のポケモン」は、相手のワザの効果を受けない
      if (pk.data.stage === "basic") {
        const owner = this.ownerIndex(pk);
        for (const holder of this.players[owner].allPokemon) {
          const ab = holder.ability;
          if (!(ab != null && ab.trigger === "passive")) continue;
          for (const e of ab.effects) {
            if (e.c === "protectYourBasicNamePrefixPokemonFromOpponentAttackEffects") {
              const [prefix] = e.a;
              if (pk.data.name.startsWith(prefix)) return true;
            }
          }
        }
      }
      return false;
    },

    hasRotomAdapter(p) {
      for (const pk of this.players[p].allPokemon) {
        const ab = pk.ability;
        if (!(ab != null && ab.trigger === "passive")) continue;
        if (ab.effects.some((e) => e.c === "rotomPokemonMayHaveTwoTools")) return true;
      }
      return false;
    },

    canHoldTwoTools(p, pk) {
      return pk.name.includes("ロトム") && this.hasRotomAdapter(p);
    },

    /** 「マルチアダプタ」がなくなったとき、2枚目のどうぐをトラッシュする */
    enforceToolLimits() {
      for (let p = 0; p < 2; p++) {
        if (this.hasRotomAdapter(p)) continue;
        for (const pk of this.players[p].allPokemon) {
          const t = pk.extraTool;
          if (t != null) {
            pk.extraTool = null;
            this.players[p].discard.push(t);
            this.note(`${pk.name}の2枚目のどうぐ「${t.name}」をトラッシュした`);
          }
        }
      }
    },

    hasMegaEx(p, type) {
      return this.players[p].allPokemon.some((pk) => this.isMegaEx(pk.data) && (type == null || pk.data.type === type));
    },

    isMegaEx(d) {
      return d.name.startsWith("メガ") && d.name.endsWith("ex");
    },

    /** 活力の森: 草ポケモンは出したばかりの番でも草ポケモンに進化できる */
    grassEvolveAllowed(pk, evolveCard) {
      const trainer = this.stadiumCard ? this.stadiumCard.trainerData : null;
      if (trainer == null) return false;
      let allowed = false;
      for (const e of trainer.effects) {
        if (e.c === "grassPokemonCanEvolveOnPlacedTurn") allowed = true;
      }
      return allowed && pk.cards.length === 1 && pk.data.type === "grass" && evolveCard.type === "grass";
    },

    /** インテレオン「しとめる」 */
    async knockOutLowestRemainingHPPokemon(p, attacker) {
      let minHP = Infinity;
      let found = [];
      for (let side = 0; side < 2; side++) {
        for (const pk of this.players[side].allPokemon) {
          if (pk === attacker) continue;
          if (pk.remainingHP < minHP) {
            minHP = pk.remainingHP;
            found = [];
          }
          if (pk.remainingHP === minHP) found.push({ owner: side, pk: pk });
        }
      }
      if (found.length === 0) return;
      let target = found[0];
      if (found.length > 1) {
        const labels = [];
        for (const f of found) {
          labels.push(`${f.owner === p ? "自分" : "相手"}の${f.pk.name}（残りHP ${f.pk.remainingHP}）`);
        }
        const i = (await this.ask(p, "card", "きぜつさせるポケモンを選んでください", labels)) ?? 0;
        target = found[i];
      }
      if (target.owner !== p && target.pk.protectedUntilTurn >= this.turnNumber) {
        this.note(`${target.pk.name}はワザのダメージや効果を受けない`);
        return;
      }
      target.pk.damage = target.pk.hp;
      this.note(`${target.pk.name}をきぜつさせた`);
    },

    /** ハカドッグ「ホラーバイト」: 相手の手札を見ないで選ぶ（ランダム）→山札にもどして切る */
    returnRandomOpponentHandCardsToDeck(p, count) {
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      const names = [];
      let n = 0;
      while (n < count && opp.hand.length > 0) {
        n += 1;
        const i = this.randInt(opp.hand.length);
        const c = opp.hand.splice(i, 1)[0];
        opp.deck.push(c);
        names.push(c.name);
      }
      if (names.length > 0) {
        this.shuffleDeck(oppIndex);
        this.note(`相手の手札から${names.length}枚（${names.join("、")}）を山札にもどして切った`);
      }
    },

    /** ふしぎなアメ: 使える（手札の2進化, 場のたね）の組み合わせ */
    rareCandyOptions(p) {
      const me = this.players[p];
      if (me.turnsTaken <= 1) return [];
      // TODO(port): Swift は m1l/m1s/m2/m2a/sd100 の各ポケモン配列を連結して先頭一致を取る。
      // JS ではカード全体（id昇順）から同名の最初のポケモンを探す（同名・別進化元のカードがあると順序が食い違う可能性）。
      const all = [];
      for (const id of G.allCardIds().sort((a, b) => a - b)) {
        const d = G.catalogPokemon(id);
        if (d != null) all.push(d);
      }
      const result = [];
      const seen = new Set();
      for (const card of me.hand) {
        const d = card.pokemonData;
        if (!(d != null && d.stage === "stage2" && d.evolvesFrom != null && !seen.has(card.name))) continue;
        const mid = d.evolvesFrom;
        seen.add(card.name);
        const stage1 = all.find((x) => x.name === mid);
        if (!(stage1 != null && stage1.evolvesFrom != null)) continue;
        const basicName = stage1.evolvesFrom;
        for (const slot of this.slots(p)) {
          const pk = this.pokemon(p, slot);
          if (pk != null && pk.cards.length === 1 && pk.name === basicName && pk.lastChangedTurn < this.turnNumber) {
            result.push({ handCard: card, slot: slot });
          }
        }
      }
      return result;
    },

    async useRareCandy(p) {
      const options = this.rareCandyOptions(p);
      if (options.length === 0) return;
      const names = [];
      const cards = [];
      for (const o of options) {
        if (names.includes(o.handCard.name)) continue;
        names.push(o.handCard.name);
        cards.push(o.handCard);
      }
      const ci = names.length > 1 ? ((await this.ask(p, "card", "進化させる2進化ポケモンを選んでください", names)) ?? 0) : 0;
      const card = cards[ci];
      const slotsOK = [];
      for (const o of options) {
        if (o.handCard.name === card.name) slotsOK.push(o.slot);
      }
      const slot = await this.chooseSlot(p, p, `${card.name}に進化させるポケモンを選んでください`, slotsOK);
      if (slot == null) return;
      const pk = this.pokemon(p, slot);
      if (pk == null) return;
      this.removeFromHand(p, card);
      const before = pk.name;
      pk.evolve(card, this.turnNumber, this.confusionLocked());
      this.note(`ふしぎなアメで${before}が${card.name}に進化した`);
      await this.onEvolvedFromHand(p, pk);
    },

    /** あやしい時計 */
    async devolveYourPokemon(p, type) {
      const me = this.players[p];
      const cands = [];
      for (const slot of this.slots(p)) {
        const pk = this.pokemon(p, slot);
        if (pk != null && pk.cards.length > 1 && pk.data.type === type) cands.push(slot);
      }
      const slot = await this.chooseSlot(p, p, "退化させるポケモンを選んでください", cands);
      if (slot == null) return;
      const pk = this.pokemon(p, slot);
      if (pk == null) return;
      let count = 1;
      if (pk.cards.length > 2) {
        const i = (await this.ask(p, "other", "はがす進化カードを選んでください", ["いちばん上の1枚だけ", "すべて（たねポケモンまでもどす）"])) ?? 0;
        count = (i === 0) ? 1 : pk.cards.length - 1;
      }
      let n = 0;
      while (n < count && pk.cards.length > 1) {
        const c = pk.cards.pop();
        me.hand.push(c);
        this.note(`${pk.name}の進化カード「${c.name}」を手札にもどした`);
        n += 1;
      }
      if (!(this.confusionLocked() && pk.conditions.has("confused"))) pk.conditions.clear();
      pk.lastChangedTurn = this.turnNumber; // 退化したポケモンは、その番に進化できない
    },

    // ---------- スタジアムの「番ごとに1回使える効果」（なみのりビーチ） ----------
    stadiumSwitchType() {
      const st = this.stadiumCard ? this.stadiumCard.trainerData : null;
      if (st == null) return null;
      for (const e of st.effects) {
        if (e.c === "onceEachTurnSwitchActiveOfTypeWithBench") return e.a[0];
      }
      return null;
    },

    stadiumDrawType() {
      const st = this.stadiumCard ? this.stadiumCard.trainerData : null;
      if (st == null) return null;
      for (const e of st.effects) {
        if (e.c === "onceEachTurnDiscardEnergyFromHandThenDrawToPokemonCount") return e.a[0];
      }
      return null;
    },

    stadiumEffects() {
      const td = this.stadiumCard ? this.stadiumCard.trainerData : null;
      return td ? td.effects : [];
    },

    canUseStadium(p) {
      for (const e of this.stadiumEffects()) {
        const me = this.players[p];
        if (e.c === "onceEachTurnTakeBasicEnergyFromDiscardToHand") {
          const [type] = e.a;
          return !me.stadiumUsedThisTurn && me.discard.some((c) => c.energyType === type);
        }
        if (e.c === "onceEachTurnDrawIfPlayedSupporterContaining") {
          const [key] = e.a;
          return !me.stadiumUsedThisTurn && me.deck.length > 0 && me.supporterNamesPlayedThisTurn.some((n) => n.includes(key));
        }
      }
      const dt = this.stadiumDrawType();
      if (dt != null) {
        const me = this.players[p];
        if (me.stadiumUsedThisTurn || me.deck.length === 0) return false;
        if (!me.hand.some((c) => c.isEnergy)) return false;
        let count = 0;
        for (const pk of me.allPokemon) { if (pk.data.type === dt) count += 1; }
        return me.hand.length - 1 < count;
      }
      const t = this.stadiumSwitchType();
      if (t == null) return false;
      const me = this.players[p];
      if (me.stadiumUsedThisTurn) return false;
      const a = me.active;
      if (!(a != null && a.data.type === t)) return false;
      return me.bench.some((b) => b.data.type === t);
    },

    async useStadium(p) {
      const me = this.players[p];
      for (const e of this.stadiumEffects()) {
        if (e.c === "onceEachTurnTakeBasicEnergyFromDiscardToHand") {
          const [type, count] = e.a;
          me.stadiumUsedThisTurn = true;
          const cands = me.discard.filter((c) => c.energyType === type);
          const picked = await this.pickCards(p, cands, count, `手札に加える基本${J(type)}エネルギー`);
          for (const c of picked) {
            this.removeCard(me.discard, c.id);
            me.hand.push(c);
            this.note(`スタジアムの効果で、トラッシュから${c.name}を手札に加えた`);
          }
          return;
        }
        if (e.c === "onceEachTurnDrawIfPlayedSupporterContaining") {
          const n = e.a[1];
          me.stadiumUsedThisTurn = true;
          const drawn = this.draw(p, n);
          this.note(`スタジアムの効果で、山札を${drawn}枚引いた`);
          return;
        }
      }
      const dt = this.stadiumDrawType();
      if (dt != null) {
        me.stadiumUsedThisTurn = true;
        const labels = [];
        const cards = [];
        for (const c of me.hand) { if (c.isEnergy) { labels.push(c.name); cards.push(c); } }
        const i = await this.ask(p, "card", "トラッシュするエネルギーを選んでください", labels);
        if (i == null) return;
        this.removeFromHand(p, cards[i]);
        me.discard.push(cards[i]);
        let count = 0;
        for (const pk of me.allPokemon) { if (pk.data.type === dt) count += 1; }
        const need = Math.max(count - me.hand.length, 0);
        const drawn = this.draw(p, need);
        this.note(`スタジアムの効果で${cards[i].name}をトラッシュして、山札を${drawn}枚引いた`);
        return;
      }
      const t = this.stadiumSwitchType();
      if (t == null) return;
      me.stadiumUsedThisTurn = true;
      const cands = [];
      me.bench.forEach((b, i) => { if (b.data.type === t) cands.push(G.bench(i)); });
      const slot = await this.chooseSlot(p, p, "バトル場に出すポケモンを選んでください", cands);
      if (slot == null || slot.k !== "b") return;
      const i = slot.i;
      const old = me.active;
      if (!(i >= 0 && i < me.bench.length && old != null)) return;
      const newActive = me.bench.splice(i, 1)[0];
      old.conditions.clear();
      me.bench.push(old);
      me.active = newActive;
      this.note(`スタジアムの効果で${old.name}と${newActive.name}を入れ替えた`);
      await this.afterBenchToActive(p, newActive);
      await this.afterActiveToBench(p, old);
    },

    /** 自分の番に、バトル場のポケモンがベンチにもどったとき（ブロスター「バックリロード」） */
    async afterActiveToBench(p, old) {
      // 「バトル場をはなれるまで使えない」ワザの制限をとく
      for (const [name, until] of Object.entries(old.blockedAttackNames)) {
        if (until >= 1000000) delete old.blockedAttackNames[name];
      }
      // ロケット団のダグトリオ「あなぼこ」: 相手の番に、相手のバトルポケモンがベンチにもどるたびダメカンをのせる
      if (p === this.currentPlayer && !this.benchCountersBlocked()) {
        for (const holder of this.players[this.other(p)].allPokemon) {
          const ab = holder.ability;
          if (!(ab != null && ab.trigger === "passive")) continue;
          let counters = 0;
          for (const e of ab.effects) {
            if (e.c === "placeCountersWhenOpponentActiveRetreatsToBench") counters = e.a[0];
          }
          if (counters > 0) {
            old.damage += counters * 10;
            this.note(`${holder.name}の「${ab.name}」で、${old.name}にダメカンを${counters}個のせた`);
            break;
          }
        }
      }
      const ab = old.ability;
      if (!(p === this.currentPlayer && ab != null && ab.trigger === "passive")) return;
      const me = this.players[p];
      // イルカマン「マイティチェンジ」: ベンチにもどったとき、山札のイルカマンexと入れ替える
      for (const e of ab.effects) {
        if (e.c !== "swapWithNamedPokemonFromDeckWhenMovedToBench") continue;
        const name = e.a[0];
        if (me.usedAbilityPokemonIds.has(old.id)) break;
        const exCard = me.deck.find((c) => c.name === name);
        if (!(exCard != null && old.cards.length >= 1)) break;
        if (!(await this.askYesNo(p, `${old.name}の特性「${ab.name}」を使って、山札の「${name}」と入れ替えますか？`))) break;
        me.usedAbilityPokemonIds.add(old.id);
        this.note(`${old.name}の特性「${ab.name}」を使った`);
        this.removeCard(me.deck, exCard.id);
        const oldTop = old.cards[old.cards.length - 1];
        old.cards[old.cards.length - 1] = exCard;
        me.deck.push(oldTop);
        this.shuffleDeck(p);
        this.note(`${oldTop.name}を${exCard.name}と入れ替えた`);
        this.refreshStadiumEffects();
        return;
      }
      for (const e of ab.effects) {
        if (e.c !== "attachBasicEnergyFromHandToSelfWhenMovedToBench") continue;
        const [type, maxCount] = e.a;
        if (me.usedAbilityPokemonIds.has(old.id)) return;
        const cands = [];
        for (const c of me.hand) { if (c.energyType === type) cands.push(c); }
        if (cands.length === 0) return;
        const use = await this.askYesNo(p, `${old.name}の特性「${ab.name}」を使いますか？`);
        if (!use) return;
        me.usedAbilityPokemonIds.add(old.id);
        this.note(`${old.name}の特性「${ab.name}」を使った`);
        const picked = await this.pickCards(p, cands, maxCount, `${old.name}につけるエネルギー`);
        for (const c of picked) {
          this.removeFromHand(p, c);
          old.attachedEnergy.push(c);
          this.note(`${c.name}を${old.name}につけた`);
        }
      }
    },

    /** 自分の番に、ベンチのポケモンがバトル場に出たとき（ラティオス「ラスターアシスト」など） */
    async afterBenchToActive(p, newActive) {
      newActive.movedToActiveTurn = this.turnNumber;
      if (p === this.currentPlayer) {
        const holder = this.players[this.other(p)].active;
        const hab = holder != null ? holder.ability : null;
        if (holder != null && hab != null && hab.trigger === "passive" &&
            hab.effects.some((e) => e.c === "confuseOpponentPokemonThatReplacesActiveDuringTheirTurn")) {
          this.inflict("confused", newActive);
          this.note(`${holder.name}の特性「${hab.name}」で、${newActive.name}はこんらんになった`);
        }
      }
      if (p !== this.currentPlayer) return;
      const me = this.players[p];
      // メガヤンマex「バズブースト」など: ベンチからバトル場に出たときに使える特性
      const own = newActive.ability;
      if (own != null && own.trigger === "whenMovedBenchToActive" && this.abilityCanDoSomething(p, own)) {
        if (await this.askYesNo(p, `特性「${own.name}」を使いますか？`)) {
          this.note(`${newActive.name}の特性「${own.name}」を使った`);
          await this.applyAbilityEffects(own, p, newActive);
        }
      }
      for (const holder of me.allPokemon) {
        const ab = holder.ability;
        if (!(ab != null && ab.trigger === "passive")) continue;
        let watched = null;
        for (const e of ab.effects) {
          if (e.c === "moveBenchEnergyToActiveWhenNamedMovesToActive") watched = e.a[0];
        }
        if (watched == null) continue;
        const name = watched;
        if (newActive.name !== name) continue;
        if (me.usedAbilityPokemonIds.has(holder.id)) continue;
        if (!me.bench.some((b) => b.attachedEnergy.length > 0)) continue;
        const use = await this.askYesNo(p, `${holder.name}の特性「${ab.name}」を使いますか？`);
        if (!use) continue;
        me.usedAbilityPokemonIds.add(holder.id);
        this.note(`${holder.name}の特性「${ab.name}」を使った`);
        while (true) {
          const labels = [];
          const refs = [];
          for (const b of me.bench) {
            b.attachedEnergy.forEach((e, ei) => {
              labels.push(`${b.name}の${e.name}`);
              refs.push([b, ei]);
            });
          }
          if (labels.length === 0) break;
          const i = await this.ask(p, "card", `${newActive.name}につけ替えるエネルギーを選んでください（やめるなら「選ばない」）`, labels, true);
          if (i == null) break;
          const [b, ei] = refs[i];
          const e = b.attachedEnergy.splice(ei, 1)[0];
          newActive.attachedEnergy.push(e);
          this.note(`${e.name}を${b.name}から${newActive.name}につけ替えた`);
        }
      }
    },

  });

  if (typeof module !== "undefined") module.exports = G;
})(globalThis.PK = globalThis.PK || {});
// fx_f.js : BattleEffects.swift 4307〜5324 行の移植
// 担当範囲: abilityCanDoSomething, selfKnockOutAbilitiesBlocked, canUseAbility, useAbility, onEvolvedFromHand,
//           healOnAttachFromHand, onPlayedFromHandToBench, applyAbilityEffects, applyAbilityEffectPart1〜7
(function (G) {
  "use strict";

  const J = (t) => G.energyJapaneseName(t); // EnergyType.japaneseName

  Object.assign(G.BattleGame.prototype, {

    // MARK: - 特性
    abilityCanDoSomething(p, ability) {
      const me = this.players[p];
      for (const effect of ability.effects) {
        switch (effect.c) {
          case "swapOneHandCardWithDeckTop":
            if (me.hand.length === 0 || me.deck.length === 0) return false;
            break;
          case "devolveOneOpponentEvolvedReturnToHand":
            if (!this.players[this.other(p)].allPokemon.some((x) => x.cards.length >= 2)) return false;
            break;
          case "switchYourBenchedOfTypeWithActiveThenPoison": {
            const [t, exName] = effect.a;
            if (me.active == null || !me.bench.some((x) => x.data.type === t && x.name !== exName)) return false;
            break;
          }
          case "discardBasicEnergyFromHandThenDraw": {
            const [energy, required] = effect.a;
            const hasEnergy = me.hand.some((x) => x.energyType === energy);
            const hasRequired = me.allPokemon.some((x) => x.name === required);
            if (!hasEnergy || !hasRequired || me.deck.length === 0) return false;
            break;
          }
          case "moveBasicEnergyToAnotherOfYourPokemon": {
            const [type] = effect.a;
            const hasSource = me.allPokemon.some((pk) => pk.attachedEnergy.some((x) => x.energyType === type));
            if (!hasSource || me.allPokemon.length < 2) return false;
            break;
          }
          case "switchOpponentBenchedPokemonWithActive":
            if (this.players[this.other(p)].bench.length === 0) return false;
            break;
          case "lookTopCardsAttachBasicEnergyToYourPokemon":
          case "drawCards":
            if (me.deck.length === 0) return false;
            break;
          case "lookTopCardsAttachBasicEnergyOfTypeRestToBottom":
            if (me.deck.length === 0) return false;
            break;
          case "moveAnyBasicEnergyToAnotherOfYourPokemon":
            if (me.allPokemon.length < 2 || !me.allPokemon.some((pk) => pk.attachedEnergy.some((x) => x.energyType != null))) return false;
            break;
          case "attachEnergyFromHandToActiveNamePrefixPokemon": {
            const [prefix] = effect.a;
            const act = me.active;
            if (!(act != null && act.name.startsWith(prefix))) return false;
            if (!me.hand.some((x) => x.energyType != null || x.isSpecialEnergy)) return false;
            break;
          }
          case "discardOpponentDeckTop":
            if (this.players[this.other(p)].deck.length === 0) return false;
            break;
          case "attachBasicEnergyFromHandToBenchedOfType": {
            const [t] = effect.a;
            if (!me.hand.some((x) => x.energyType === t)) return false;
            if (!me.bench.some((x) => x.data.type === t)) return false;
            break;
          }
          case "putNamedPokemonFromDeckOnBench": {
            const [name] = effect.a;
            if (me.bench.length >= this.rules.maxBench) return false;
            if (!me.deck.some((x) => x.name === name)) return false;
            break;
          }
          case "putOneOfNamedPokemonFromDeckOnBench": {
            const [names] = effect.a;
            if (me.bench.length >= this.rules.maxBench) return false;
            if (!me.deck.some((x) => names.includes(x.name))) return false;
            break;
          }
          case "flipCoinHeadsReturnDefenderEnergyToOpponentHand": {
            const d = this.players[this.other(p)].active;
            if (!(d != null && d.attachedEnergy.length > 0)) return false;
            break;
          }
          case "knockOutSelfThenAttachBasicEnergyFromDiscardToYourPokemonOfType": {
            const [type] = effect.a;
            if (this.selfKnockOutAbilitiesBlocked(p)) return false;
            if (!me.discard.some((x) => x.energyType != null)) return false;
            if (me.allPokemon.filter((x) => x.data.type === type).length < 2) return false;
            break;
          }
          case "searchDeckToHand":
            if (me.deck.length === 0) return false;
            break;
          case "knockOutSelfThenPlaceCountersOnOneOpponentPokemon":
            if (this.selfKnockOutAbilitiesBlocked(p)) return false;
            break;
          case "lookTopCardsTakeOneRestToBottom":
          case "lookTopCardsTakeSupporterRestShuffle":
            if (me.deck.length === 0) return false;
            break;
          case "bothPlayersDraw":
            if (me.deck.length === 0 && this.players[this.other(p)].deck.length === 0) return false;
            break;
          case "attachBasicEnergyFromDiscardToOneBenched": {
            const [type] = effect.a;
            if (me.bench.length === 0) return false;
            if (!me.discard.some((x) => x.energyType === type)) return false;
            break;
          }
          case "attachBasicEnergyFromDeckToSelfIfPlayedSupporter": {
            const [name, type] = effect.a;
            if (!me.supporterNamesPlayedThisTurn.includes(name)) return false;
            if (!me.deck.some((x) => x.energyType === type)) return false;
            break;
          }
          case "healOneOfYourPokemon":
            if (!me.allPokemon.some((x) => x.damage > 0)) return false;
            break;
          case "healAllYourPokemon":
            if (!me.allPokemon.some((x) => x.damage > 0)) return false;
            break;
          case "sleepOpponentActive": {
            const d = this.players[this.other(p)].active;
            if (!(d != null && !d.conditions.has("asleep"))) return false;
            break;
          }
          case "burnOpponentActive": {
            const d = this.players[this.other(p)].active;
            if (!(d != null && !d.conditions.has("burned"))) return false;
            break;
          }
          case "discardOneHandCardToDeckBottomThenDrawUntilHandSize": {
            const [size] = effect.a;
            if (me.hand.length === 0 || me.deck.length === 0) return false;
            if (me.hand.length - 1 >= size) return false;
            break;
          }
          case "discardBasicEnergyFromHandThenBurnOpponentActive": {
            const [t] = effect.a;
            if (!me.hand.some((x) => x.energyType === t)) return false;
            const d = this.players[this.other(p)].active;
            if (!(d != null && !d.conditions.has("burned"))) return false;
            break;
          }
          case "attachBasicEnergiesFromHandToYourPokemon": {
            const [types] = effect.a;
            if (!me.hand.some((c) => c.energyType != null && types.includes(c.energyType))) return false;
            break;
          }
          case "attachBasicEnergyFromHandToYourPokemonThenHeal": {
            const [t] = effect.a;
            if (!me.hand.some((x) => x.energyType === t)) return false;
            break;
          }
          case "switchSelfWithActiveThenMoveYourEnergyToSelf":
            if (me.bench.length === 0) return false;
            break;
          case "switchOpponentBenchedPokemonWithActiveHPAtMost": {
            const [maxHP] = effect.a;
            if (!this.players[this.other(p)].bench.some((x) => x.remainingHP <= maxHP)) return false;
            break;
          }
          case "attachBasicEnergyFromDeckToBenchedOfTypeThenCounters": {
            const [energy] = effect.a;
            if (!me.deck.some((x) => x.energyType === energy)) return false;
            if (!me.bench.some((x) => x.data.type === energy)) return false;
            break;
          }
          case "attachBasicEnergyFromDiscardToSelf":
            if (!me.discard.some((x) => x.energyType != null)) return false;
            break;
          case "moveDamageCountersToOpponentPokemon":
            if (!me.allPokemon.some((x) => x.damage > 0)) return false;
            break;
          case "attachBasicEnergyFromHandToYourPokemon": {
            const [t] = effect.a;
            if (!me.hand.some((x) => x.energyType === t)) return false;
            break;
          }
          case "discardStadiumInPlay":
            if (this.stadiumCard == null) return false;
            break;
          case "requiresTerastalInPlay":
            if (!me.allPokemon.some((x) => x.data.isTerastal)) return false;
            break;
          case "switchYourActiveWithBench":
            if (me.bench.length === 0) return false;
            break;
          case "attachBasicEnergyFromDiscardToYourPokemonOfType": {
            const [t] = effect.a;
            if (!me.discard.some((x) => x.energyType === t)) return false;
            if (!me.allPokemon.some((x) => x.data.type === t)) return false;
            break;
          }
          case "attachUpToBasicEnergyFromDeckToYourNamePrefixPokemon": {
            const [t, prefix] = effect.a;
            if (!me.deck.some((x) => x.energyType === t)) return false;
            if (!me.allPokemon.some((x) => x.name.startsWith(prefix))) return false;
            break;
          }
          case "attachOneEachBasicEnergyFromDeckToYourPokemonOfTypes": {
            const [types] = effect.a;
            if (!me.deck.some((c) => c.energyType != null && types.includes(c.energyType))) return false;
            break;
          }
          case "discardOneHandCardThenDraw":
            if (me.hand.length === 0 || me.deck.length === 0) return false;
            break;
          case "attachBasicEnergyFromHandToSelfThenDraw": {
            const [t] = effect.a;
            if (!me.hand.some((x) => x.energyType === t)) return false;
            break;
          }
          case "attachUpToBasicEnergyFromHandToBenchedNamePrefix": {
            const [t, prefix] = effect.a;
            if (!me.hand.some((x) => x.energyType === t)) return false;
            if (!me.bench.some((x) => x.name.startsWith(prefix))) return false;
            break;
          }
          case "attachBasicEnergyFromDeckToSelfUpTo": {
            const [t] = effect.a;
            if (!me.deck.some((x) => x.energyType === t)) return false;
            break;
          }
          case "discardNamedHandCardThenSwitchOpponentBenchedWithActive": {
            const [name] = effect.a;
            if (!me.hand.some((x) => x.name === name) || this.players[this.other(p)].bench.length === 0) return false;
            break;
          }
          case "flipCoinSwitchOpponentBenchedWithActiveThenConfuse":
            if (this.players[this.other(p)].bench.length === 0) return false;
            break;
          case "moveOneOfYourEnergyToSelf":
            if (!me.allPokemon.some((x) => x.attachedEnergy.length > 0)) return false;
            break;
          case "attachBasicEnergyFromHandToYourNamePrefixPokemon": {
            const [t, prefix] = effect.a;
            if (!me.hand.some((x) => x.energyType === t)) return false;
            if (!me.allPokemon.some((x) => x.name.startsWith(prefix))) return false;
            break;
          }
          default:
            break;
        }
      }
      return true;
    },

    /// コダック・ゴルダック「しめりけ」: 相手の場にいるかぎり、自分自身をきぜつさせる特性が使えない
    selfKnockOutAbilitiesBlocked(p) {
      for (let holderOwner = 0; holderOwner < 2; holderOwner++) {
        for (const pk of this.players[holderOwner].allPokemon) {
          const ability = pk.ability;
          if (ability == null || ability.trigger !== "passive") continue;
          for (const e of ability.effects) {
            if (e.c === "preventOpponentSelfKnockOutAbilities") return true;
          }
        }
      }
      return false;
    },

    /// 自分の番に、メニューから使える特性か
    canUseAbility(p, pk) {
      // 化石: 自分の番の中なら、場に出ているカードをトラッシュできる
      if (pk.data.isFossil) return pk.cards.length === 1;
      const ability = pk.ability;
      if (ability == null) return false;
      const me = this.players[p];
      switch (ability.trigger) {
        case "onceDuringYourTurn":
          if (me.usedAbilityPokemonIds.has(pk.id)) return false;
          break;
        case "onceDuringYourTurnPerAbilityName":
          if (me.usedAbilityNames.has(ability.name)) return false;
          if (me.usedAbilityPokemonIds.has(pk.id)) return false;
          break;
        case "anyNumberOfTimesDuringYourTurn":
          break;
        default:
          return false;
      }
      for (const effect of ability.effects) {
        if (effect.c === "requiresActive" && me.active !== pk) return false;
        if (effect.c === "requiresOnBench" && me.active === pk) return false;
        if (effect.c === "requiresSelfHasEnergy" && pk.attachedEnergy.length === 0) return false;
        if (effect.c === "requiresSelfHasEnergyOfType") {
          const [type] = effect.a;
          if (!pk.attachedEnergy.some((x) => x.energyType === type)) return false;
        }
        if (effect.c === "discardBasicEnergyFromSelfThenDrawUntilHandSize") {
          const [type, size] = effect.a;
          if (!pk.attachedEnergy.some((x) => x.energyType === type)) return false;
          if (me.hand.length >= size || me.deck.length === 0) return false;
        }
        if (effect.c === "requiresFirstOwnTurn" && me.turnsTaken !== 1) return false;
        if (effect.c === "requiresYourPokemonKnockedOutLastOpponentTurn" && me.lastKnockedOutTurn !== this.turnNumber - 1) return false;
        if (effect.c === "requiresMegaExInPlay") {
          const [type] = effect.a;
          if (!this.hasMegaEx(p, type != null ? type : null)) return false;
        }
        if (effect.c === "healOneOfYourPokemon") {
          const req = effect.a[1];
          if (req != null) {
            if (!pk.attachedEnergy.some((x) => x.energyType === req)) return false;
          }
        }
      }
      return this.abilityCanDoSomething(p, ability);
    },

    async useAbility(p, slot) {
      const fossil = this.pokemon(p, slot);
      if (fossil != null && fossil.data.isFossil) {
        this.discardFossilInPlay(p, fossil);
        return;
      }
      const pk = this.pokemon(p, slot);
      if (pk == null) return;
      const ability = pk.ability;
      if (ability == null) return;
      const me = this.players[p];
      if (ability.trigger === "onceDuringYourTurn" || ability.trigger === "onceDuringYourTurnPerAbilityName") {
        me.usedAbilityPokemonIds.add(pk.id);
      }
      if (ability.trigger === "onceDuringYourTurnPerAbilityName") {
        me.usedAbilityNames.add(ability.name);
      }
      this.note(`${pk.name}の特性「${ability.name}」を使った`);
      for (const e of ability.effects) {
        if (e.c === "switchSelfWithActive" && slot.k === "b") {
          const i = slot.i;
          const old = me.active;
          if (i >= 0 && i < me.bench.length && old != null) {
            old.conditions.clear();
            me.bench[i] = old;
            me.active = pk;
            this.note(`${pk.name}とバトル場の${old.name}を入れ替えた`);
            await this.afterBenchToActive(p, pk);
            await this.afterActiveToBench(p, old);
          }
        }
      }
      await this.applyAbilityEffects(ability, p, pk);
    },

    /// 手札から出して進化させたときに使える特性（使うかどうかをたずねる）
    async onEvolvedFromHand(p, pk) {
      const ability = pk.ability;
      if (ability == null || ability.trigger !== "whenEvolvedFromHand") return;
      if (!this.abilityCanDoSomething(p, ability)) return;
      const use = await this.askYesNo(p, `特性「${ability.name}」を使いますか？`);
      if (use) {
        this.note(`${pk.name}の特性「${ability.name}」を使った`);
        await this.applyAbilityEffects(ability, p, pk);
      }
    },

    /// マギアナ「オートヒール」: バトル場にいるかぎり、手札からエネルギーをポケモンにつけるたび、そのポケモンのHPを回復する
    healOnAttachFromHand(p, pk) {
      // ゲンガーex「むしばむのろい」: 相手は手札からエネルギーをポケモンにつけるたび、そのポケモンにダメカンをのせる
      for (const holder of this.players[this.other(p)].allPokemon) {
        const hab = holder.ability;
        if (hab == null || hab.trigger !== "passive") continue;
        for (const e of hab.effects) {
          if (e.c === "placeCountersWhenOpponentAttachesEnergyFromHand") {
            const [counters] = e.a;
            pk.damage += counters * 10;
            this.note(`「${hab.name}」の効果で${pk.name}にダメカンを${counters}個のせた`);
          }
        }
      }
      const active = this.players[p].active;
      if (active == null) return;
      const ab = active.ability;
      if (ab == null || ab.trigger !== "passive") return;
      for (const e of ab.effects) {
        if (e.c === "healWhenAttachingEnergyFromHandWhileActive" && pk.damage > 0) {
          const [amount] = e.a;
          const healed = Math.min(amount, pk.damage);
          pk.damage -= healed;
          pk.healedTurn = this.turnNumber;
          this.note(`${active.name}の「${ab.name}」で、${pk.name}のHPを${healed}回復した`);
        }
      }
    },

    /// 手札からベンチに出したときに使える特性（使うかどうかをたずねる）
    async onPlayedFromHandToBench(p, pk) {
      const ability = pk.ability;
      if (ability == null || ability.trigger !== "whenPlayedFromHandToBench") return;
      if (!this.abilityCanDoSomething(p, ability)) return;
      const use = await this.askYesNo(p, `特性「${ability.name}」を使いますか？`);
      if (use) {
        this.note(`${pk.name}の特性「${ability.name}」を使った`);
        await this.applyAbilityEffects(ability, p, pk);
      }
    },

    async applyAbilityEffects(ability, p, source = null) {
      for (const effect of ability.effects) {
        await this.applyAbilityEffectPart1(effect, p, source);
        await this.applyAbilityEffectPart2(effect, p, source);
        await this.applyAbilityEffectPart3(effect, p, source);
        await this.applyAbilityEffectPart4(effect, p, source);
        await this.applyAbilityEffectPart5(effect, p, source);
        await this.applyAbilityEffectPart6(effect, p, source);
        await this.applyAbilityEffectPart7(effect, p, source);
      }
    },

    /// スタートデッキ100 第10弾（555〜 無色）で追加した特性の効果
    async applyAbilityEffectPart7(effect, p, source) {
      const me = this.players[p];
      switch (effect.c) {
        case "moveAnyBasicEnergyToAnotherOfYourPokemon": {
          // ハピナスex「ハッピースイッチ」
          const sources = [];
          for (const slot of this.slots(p)) {
            const pk = this.pokemon(p, slot);
            if (pk != null && pk.attachedEnergy.some((x) => x.energyType != null)) sources.push(slot);
          }
          const from = await this.chooseSlot(p, p, "基本エネルギーをつけ替える元のポケモンを選んでください", sources);
          if (from == null) break;
          const fromPk = this.pokemon(p, from);
          if (fromPk == null) break;
          const labels = [];
          const refs = [];
          fromPk.attachedEnergy.forEach((e, ei) => { if (e.energyType != null) { labels.push(e.name); refs.push(ei); } });
          const i = (await this.ask(p, "card", "つけ替える基本エネルギーを選んでください", labels)) ?? 0;
          const destinations = [];
          for (const slot of this.slots(p)) { if (!G.slotEq(slot, from)) destinations.push(slot); }
          const to = await this.chooseSlot(p, p, "つけ替え先のポケモンを選んでください", destinations);
          if (to == null) break;
          const toPk = this.pokemon(p, to);
          if (toPk == null) break;
          const e = fromPk.attachedEnergy.splice(refs[Math.max(0, Math.min(i, refs.length - 1))], 1)[0];
          toPk.attachedEnergy.push(e);
          this.note(`${e.name}を${fromPk.name}から${toPk.name}につけ替えた`);
          break;
        }
        case "attachEnergyFromHandToActiveNamePrefixPokemon": {
          // アオキのネッコアラ「むきりょくチャージ」
          const [prefix] = effect.a;
          const act = me.active;
          if (!(act != null && act.name.startsWith(prefix))) break;
          const handEnergy = me.hand.filter((x) => x.energyType != null || x.isSpecialEnergy);
          if (handEnergy.length === 0) break;
          const picked = await this.pickCards(p, handEnergy, 1, `${act.name}につけるエネルギー（手札から）`);
          for (const c of picked) {
            this.removeCard(me.hand, c.id);
            act.attachedEnergy.push(c);
            this.note(`手札から${c.name}を${act.name}につけた`);
            this.healOnAttachFromHand(p, act);
          }
          break;
        }
        default:
          break;
      }
    },

    /// スタートデッキ100 第6弾（362〜 闘）で追加した特性の効果
    async applyAbilityEffectPart6(effect, p, source) {
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "lookTopCardsAttachBasicEnergyOfTypeRestToBottom": {
          // メタング「メタルメーカー」
          const [look, type] = effect.a;
          const me = this.players[p];
          const top = [];
          let n = 0;
          while (n < look && me.deck.length > 0) {
            top.push(me.deck.shift());
            n += 1;
          }
          const remaining = top.slice();
          const energies = [];
          for (const c of top) { if (c.energyType === type) energies.push(c); }
          while (energies.length > 0) {
            const labels = [];
            for (const e of energies) labels.push(e.name);
            const i = await this.ask(p, "card", "ポケモンにつけるエネルギーを選んでください（やめるなら「選ばない」）", labels, true);
            if (i == null) break;
            const e = energies[i];
            const slot = await this.chooseSlot(p, p, `${e.name}をつけるポケモンを選んでください`, this.slots(p));
            if (slot == null) break;
            const target = this.pokemon(p, slot);
            if (target == null) break;
            energies.splice(i, 1);
            this.removeCard(remaining, e.id);
            target.attachedEnergy.push(e);
            this.note(`${e.name}を${target.name}につけた`);
          }
          this.shuffleArray(remaining);
          for (const c of remaining) me.deck.push(c);
          this.note(`残りの${remaining.length}枚をウラにして切り、山札の下にもどした`);
          break;
        }
        case "switchYourBenchedOfTypeWithActiveThenPoison": {
          const [type, exceptName] = effect.a;
          const me0 = this.players[p].active;
          if (me0 == null) break;
          const cands = [];
          let bi = 0;
          while (bi < this.players[p].bench.length) {
            const b = this.players[p].bench[bi];
            if (b.data.type === type && b.name !== exceptName) cands.push(G.bench(bi));
            bi += 1;
          }
          const slot = await this.chooseSlot(p, p, `バトルポケモンと入れ替える${J(type)}ポケモンを選んでください`, cands);
          if (slot == null || slot.k !== "b" || !(slot.i < this.players[p].bench.length)) break;
          const idx = slot.i;
          const newActive = this.players[p].bench[idx];
          me0.conditions.clear();
          this.players[p].bench[idx] = me0;
          this.players[p].active = newActive;
          this.note(`${newActive.name}とバトル場の${me0.name}を入れ替えた`);
          await this.afterBenchToActive(p, newActive);
          await this.afterActiveToBench(p, me0);
          this.inflict("poisoned", newActive);
          break;
        }
        case "devolveOneOpponentEvolvedReturnToHand": {
          const cands = [];
          for (const slot of this.slots(oppIndex)) {
            const t = this.pokemon(oppIndex, slot);
            if (t != null && t.cards.length >= 2) cands.push(slot);
          }
          const slot = await this.chooseSlot(p, oppIndex, "進化カードをはがす相手のポケモンを選んでください", cands);
          if (slot == null) break;
          const target = this.pokemon(oppIndex, slot);
          if (target == null) break;
          const evoCard = target.cards.pop();
          opp.hand.push(evoCard);
          target.conditions.clear();
          this.note(`${target.name}の進化カード「${evoCard.name}」をはがして、相手の手札にもどした`);
          this.refreshStadiumEffects();
          break;
        }
        default:
          break;
      }
    },

    /// スタートデッキ100（285〜 超）で追加した特性の効果
    async applyAbilityEffectPart5(effect, p, source) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "moveOneOfYourEnergyToSelf": {
          const holder = source;
          if (holder == null) break;
          const fromSlots = [];
          for (const slot of this.slots(p)) {
            const pk = this.pokemon(p, slot);
            if (pk != null && pk !== holder && pk.attachedEnergy.length > 0) fromSlots.push(slot);
          }
          if (fromSlots.length === 0) break;
          const fromSlot = await this.chooseSlot(p, p, "エネルギーを移す元のポケモンを選んでください", fromSlots);
          if (fromSlot == null) break;
          const fromPk = this.pokemon(p, fromSlot);
          if (fromPk == null) break;
          const labels = [];
          for (const e of fromPk.attachedEnergy) labels.push(e.name);
          const i = (await this.ask(p, "card", `${holder.name}につけ替えるエネルギーを選んでください`, labels)) ?? 0;
          const e = fromPk.attachedEnergy.splice(Math.max(0, Math.min(i, labels.length - 1)), 1)[0];
          holder.attachedEnergy.push(e);
          this.note(`${fromPk.name}の${e.name}を${holder.name}につけ替えた`);
          break;
        }
        case "flipCoinSwitchOpponentBenchedWithActiveThenConfuse": {
          if (opp.bench.length === 0) break;
          if (this.flipCoin()) {
            await this.switchActive(oppIndex, p);
            const a = this.players[oppIndex].active;
            if (a != null) this.inflict("confused", a);
          } else {
            this.note("コインはウラだった");
          }
          break;
        }
        case "discardNamedHandCardThenSwitchOpponentBenchedWithActive": {
          const [name] = effect.a;
          const idx = me.hand.findIndex((x) => x.name === name);
          if (idx < 0 || opp.bench.length === 0) break;
          const c = me.hand.splice(idx, 1)[0];
          me.discard.push(c);
          this.note(`手札の「${c.name}」をトラッシュした`);
          await this.switchActive(oppIndex, p);
          break;
        }
        case "lookOpponentHandPutBasicsOnTheirBench": {
          const room = this.rules.maxBench - opp.bench.length;
          const basics = opp.hand.filter((x) => x.isBasicPokemon);
          if (room <= 0 || basics.length === 0) break;
          const picked = await this.pickCards(p, basics, room, "相手のベンチに出すたねポケモン（相手の手札から）");
          for (const c of picked) {
            this.removeCard(opp.hand, c.id);
            opp.bench.push(this.makePokemon(c));
            this.note(`相手の手札の${c.name}を相手のベンチに出した`);
          }
          break;
        }
        case "healAllYourEvolvedThenDiscardTheirEnergy": {
          for (const pk of me.allPokemon) {
            if (pk.data.stage !== "basic" && pk.damage > 0) {
              pk.damage = 0;
              pk.healedTurn = this.turnNumber;
              for (const x of pk.attachedEnergy) me.discard.push(x);
              pk.attachedEnergy.length = 0;
              this.note(`${pk.name}のHPをすべて回復し、エネルギーをトラッシュした`);
            }
          }
          break;
        }
        case "opponentChoosesReturnHandToDeck": {
          const [count] = effect.a;
          let k = 0;
          while (k < count && opp.hand.length > 0) {
            const labels = [];
            for (const c of opp.hand) labels.push(c.name);
            const i = (await this.ask(oppIndex, "card", `山札にもどす手札を選んでください（${k + 1}/${count}）`, labels)) ?? 0;
            const c = opp.hand.splice(i, 1)[0];
            opp.deck.push(c);
            this.note(`相手は手札の「${c.name}」を山札にもどした`);
            k += 1;
          }
          if (k > 0) this.shuffleDeck(oppIndex);
          break;
        }
        case "opponentShuffleHandIntoDeckThenDraw": {
          const [n] = effect.a;
          for (const x of opp.hand) opp.deck.push(x);
          opp.hand.length = 0;
          this.shuffleDeck(oppIndex);
          let d = 0;
          while (d < n && opp.deck.length > 0) {
            opp.hand.push(opp.deck.shift());
            d += 1;
          }
          this.note(`相手は手札を山札にもどして切り、${d}枚引いた`);
          break;
        }
        default:
          break;
      }
    },

    async applyAbilityEffectPart4(effect, p, source) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      switch (effect.c) {
        case "discardOneHandCardThenDraw": {
          const [n] = effect.a;
          const picked = await this.pickCards(p, me.hand, 1, "トラッシュする手札を1枚選んでください");
          if (picked.length > 0) {
            const c = picked[0];
            this.removeCard(me.hand, c.id);
            me.discard.push(c);
            const drawn = this.draw(p, n);
            this.note(`手札の${c.name}をトラッシュして、山札を${drawn}枚引いた`);
          }
          break;
        }
        case "attachUpToBasicEnergyFromDeckToYourNamePrefixPokemon": {
          const [type, prefix, maxCount] = effect.a;
          const cands = me.deck.filter((x) => x.energyType === type);
          const picked = await this.pickCards(p, cands, maxCount, `つける${J(type)}エネルギー`);
          for (const c of picked) {
            const targets = [];
            for (const slot of this.slots(p)) {
              const pk = this.pokemon(p, slot);
              if (pk != null && pk.name.startsWith(prefix)) targets.push(slot);
            }
            const slot = await this.chooseSlot(p, p, `${c.name}をつける「${prefix}ポケモン」を選んでください`, targets);
            if (slot == null) break;
            const target = this.pokemon(p, slot);
            if (target == null) break;
            this.removeCard(me.deck, c.id);
            target.attachedEnergy.push(c);
            this.note(`山札から${c.name}を${target.name}につけた`);
          }
          this.shuffleDeck(p);
          break;
        }
        case "attachOneEachBasicEnergyFromDeckToYourPokemonOfTypes": {
          const [types] = effect.a;
          for (const type of types) {
            const cands = me.deck.filter((x) => x.energyType === type);
            if (cands.length === 0) continue;
            const picked = await this.pickCards(p, cands, 1, `つける${J(type)}エネルギー`);
            if (picked.length === 0) continue;
            const c = picked[0];
            const targets = [];
            for (const slot of this.slots(p)) {
              const pk = this.pokemon(p, slot);
              if (pk != null && types.includes(pk.data.type)) targets.push(slot);
            }
            const slot = await this.chooseSlot(p, p, `${c.name}をつけるポケモンを選んでください`, targets);
            if (slot == null) continue;
            const target = this.pokemon(p, slot);
            if (target == null) continue;
            this.removeCard(me.deck, c.id);
            target.attachedEnergy.push(c);
            this.note(`山札から${c.name}を${target.name}につけた`);
          }
          this.shuffleDeck(p);
          break;
        }
        case "switchYourActiveWithBench":
          await this.switchActive(p, p);
          break;
        case "attachBasicEnergyFromDiscardToYourPokemonOfType": {
          const [type, maxCount] = effect.a;
          const cands = me.discard.filter((x) => x.energyType === type);
          const picked = await this.pickCards(p, cands, maxCount, `つける${J(type)}エネルギー`);
          for (const c of picked) {
            const targets = [];
            for (const slot of this.slots(p)) {
              const pk = this.pokemon(p, slot);
              if (pk != null && pk.data.type === type) targets.push(slot);
            }
            const slot = await this.chooseSlot(p, p, `${c.name}をつけるポケモンを選んでください`, targets);
            if (slot == null) break;
            const target = this.pokemon(p, slot);
            if (target == null) break;
            this.removeCard(me.discard, c.id);
            target.attachedEnergy.push(c);
            this.note(`トラッシュから${c.name}を${target.name}につけた`);
          }
          break;
        }
        case "placeCountersOnTwoOpponentPokemon": {
          const [counters] = effect.a;
          let pool = this.slots(oppIndex);
          if (this.benchCountersBlocked()) pool = pool.filter((s) => G.slotEq(s, G.ACTIVE));
          let chosen = 0;
          while (chosen < 2 && pool.length > 0) {
            const slot = await this.chooseSlot(p, oppIndex, `ダメカンをのせる相手のポケモンを選んでください（${chosen + 1}/2）`, pool);
            if (slot == null) break;
            const target = this.pokemon(oppIndex, slot);
            if (target != null) {
              target.damage += counters * 10;
              this.note(`${target.name}にダメカンを${counters}個のせた`);
            }
            for (let i = pool.length - 1; i >= 0; i--) if (G.slotEq(pool[i], slot)) pool.splice(i, 1);
            chosen += 1;
          }
          break;
        }
        case "attachBasicEnergyFromHandToSelfThenDraw": {
          const [type, drawCount] = effect.a;
          const pk = source;
          if (pk == null) break;
          const cands = me.hand.filter((x) => x.energyType === type);
          const picked = await this.pickCards(p, cands, 1, `${pk.name}につける${J(type)}エネルギー`);
          if (picked.length > 0) {
            const c = picked[0];
            this.removeCard(me.hand, c.id);
            pk.attachedEnergy.push(c);
            this.note(`${c.name}を${pk.name}につけた`);
            this.healOnAttachFromHand(p, pk);
            const drawn = this.draw(p, drawCount);
            this.note(`山札を${drawn}枚引いた`);
          }
          break;
        }
        case "attachUpToBasicEnergyFromHandToBenchedNamePrefix": {
          const [type, prefix, maxCount] = effect.a;
          const targets = [];
          let bi = 0;
          while (bi < me.bench.length) {
            if (me.bench[bi].name.startsWith(prefix)) targets.push(G.bench(bi));
            bi += 1;
          }
          const slot = await this.chooseSlot(p, p, `エネルギーをつけるベンチの「${prefix}ポケモン」を選んでください`, targets);
          if (slot == null) break;
          const target = this.pokemon(p, slot);
          if (target == null) break;
          const cands = me.hand.filter((x) => x.energyType === type);
          const picked = await this.pickCards(p, cands, maxCount, `${target.name}につける${J(type)}エネルギー`);
          for (const c of picked) {
            this.removeCard(me.hand, c.id);
            target.attachedEnergy.push(c);
            this.note(`${c.name}を${target.name}につけた`);
            this.healOnAttachFromHand(p, target);
          }
          break;
        }
        case "attachBasicEnergyFromDeckToSelfUpTo": {
          const [type, maxCount] = effect.a;
          const pk = source;
          if (pk == null) break;
          const cands = me.deck.filter((x) => x.energyType === type);
          const picked = await this.pickCards(p, cands, maxCount, `${pk.name}につける${J(type)}エネルギー`);
          for (const c of picked) {
            this.removeCard(me.deck, c.id);
            pk.attachedEnergy.push(c);
            this.note(`山札から${c.name}を${pk.name}につけた`);
          }
          this.shuffleDeck(p);
          break;
        }
        case "attachBasicEnergyFromHandToYourNamePrefixPokemon": {
          const [type, prefix] = effect.a;
          const targets = [];
          for (const slot of this.slots(p)) {
            const pk = this.pokemon(p, slot);
            if (pk != null && pk.name.startsWith(prefix)) targets.push(slot);
          }
          const cands = me.hand.filter((x) => x.energyType === type);
          const picked = await this.pickCards(p, cands, 1, `つける${J(type)}エネルギー`);
          if (picked.length > 0) {
            const c = picked[0];
            const slot = await this.chooseSlot(p, p, `エネルギーをつける「${prefix}ポケモン」を選んでください`, targets);
            const target = slot != null ? this.pokemon(p, slot) : null;
            if (target != null) {
              this.removeCard(me.hand, c.id);
              target.attachedEnergy.push(c);
              this.note(`${c.name}を${target.name}につけた`);
              this.healOnAttachFromHand(p, target);
            }
          }
          break;
        }
        default:
          break;
      }
    },

    async applyAbilityEffectPart1(effect, p, source) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      switch (effect.c) {
        case "flipCoinHeadsDiscardDefenderEnergy": {
          const [count] = effect.a;
          const heads = this.flipCoin();
          const defender = this.players[oppIndex].active;
          if (heads && defender != null) {
            let n = 0;
            while (n < count && defender.attachedEnergy.length > 0) {
              const labels = [];
              for (const e of defender.attachedEnergy) labels.push(e.name);
              const i = (await this.ask(p, "card", "トラッシュする相手のエネルギーを選んでください", labels)) ?? 0;
              const e = defender.attachedEnergy.splice(i, 1)[0];
              this.players[oppIndex].discard.push(e);
              this.note(`相手の${defender.name}の${e.name}をトラッシュした`);
              n += 1;
            }
          }
          break;
        }
        case "putOneOfNamedPokemonFromDeckOnBench": {
          const [names] = effect.a;
          if (me.bench.length < this.rules.maxBench) {
            const cands = me.deck.filter((x) => names.includes(x.name));
            const picked = await this.pickCards(p, cands, 1, "ベンチに出すポケモン");
            if (picked.length > 0) {
              const c = picked[0];
              this.removeCard(me.deck, c.id);
              this.putOnBench(p, c);
              this.note(`山札から「${c.name}」をベンチに出した`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "flipCoinHeadsReturnDefenderEnergyToOpponentHand": {
          const [count] = effect.a;
          const heads = this.flipCoin();
          const defender = this.players[oppIndex].active;
          if (heads && defender != null) {
            let n = 0;
            while (n < count && defender.attachedEnergy.length > 0) {
              const labels = [];
              for (const e of defender.attachedEnergy) labels.push(e.name);
              const i = (await this.ask(p, "card", "相手の手札にもどすエネルギーを選んでください", labels)) ?? 0;
              const e = defender.attachedEnergy.splice(i, 1)[0];
              this.players[oppIndex].hand.push(e);
              this.note(`相手の${defender.name}の${e.name}を相手の手札にもどした`);
              n += 1;
            }
          }
          break;
        }
        case "drawCards": {
          const [n] = effect.a;
          const drawn = this.draw(p, n);
          this.note(`山札を${drawn}枚引いた`);
          break;
        }
        case "searchDeckToHand": {
          const [filters, maxTotal] = effect.a;
          await this.searchToHand(p, false, filters, maxTotal, "手札に加えるカード");
          break;
        }
        case "knockOutSelfThenPlaceCountersOnOneOpponentPokemon": {
          const [counters] = effect.a;
          const me0 = source;
          if (me0 == null) break;
          me0.damage = me0.hp;
          this.note(`${me0.name}はきぜつした`);
          let cands = this.slots(oppIndex);
          if (this.benchCountersBlocked()) cands = cands.filter((s) => G.slotEq(s, G.ACTIVE));
          const slot = await this.chooseSlot(p, oppIndex, "ダメカンをのせる相手のポケモンを選んでください", cands);
          const target = slot != null ? this.pokemon(oppIndex, slot) : null;
          if (target != null) {
            target.damage += counters * 10;
            this.note(`${target.name}にダメカンを${counters}個のせた`);
          }
          break;
        }
        case "placeCountersOnOneOpponentPokemon": {
          const [counters] = effect.a;
          let cands = this.slots(oppIndex);
          if (this.benchCountersBlocked()) cands = cands.filter((s) => G.slotEq(s, G.ACTIVE));
          const slot = await this.chooseSlot(p, oppIndex, "ダメカンをのせる相手のポケモンを選んでください", cands);
          const target = slot != null ? this.pokemon(oppIndex, slot) : null;
          if (target != null) {
            target.damage += counters * 10;
            this.note(`${target.name}にダメカンを${counters}個のせた`);
          }
          break;
        }
        case "lookTopCardsTakeOneRestToBottom": {
          const [look] = effect.a;
          const top = [];
          let n = 0;
          while (n < look && me.deck.length > 0) {
            top.push(me.deck.shift());
            n += 1;
          }
          const picked = await this.pickCards(p, top, 1, "手札に加えるカード");
          for (const c of picked) {
            this.removeCard(top, c.id);
            me.hand.push(c);
            this.note(`山札の上から「${c.name}」を手札に加えた`);
          }
          for (const c of top) me.deck.push(c);
          break;
        }
        case "lookTopCardsTakeSupporterRestShuffle": {
          const [look] = effect.a;
          const top = [];
          let n = 0;
          while (n < look && me.deck.length > 0) {
            top.push(me.deck.shift());
            n += 1;
          }
          const sups = top.filter((x) => x.trainerData != null && x.trainerData.trainerKind === "supporter");
          const picked = await this.pickCards(p, sups, 1, "手札に加えるサポート");
          for (const c of picked) {
            this.removeCard(top, c.id);
            me.hand.push(c);
            this.note(`山札の上から「${c.name}」を手札に加えた`);
          }
          for (const c of top) me.deck.push(c);
          this.shuffleDeck(p);
          break;
        }
        case "bothPlayersDraw": {
          const [n] = effect.a;
          const mine = this.draw(p, n);
          const theirs = this.draw(oppIndex, n);
          this.note(`おたがいに山札を引いた（自分${mine}枚・相手${theirs}枚）`);
          break;
        }
        case "attachBasicEnergyFromDiscardToSelf": {
          const target = source;
          if (target != null) {
            const cands = me.discard.filter((x) => x.energyType != null);
            const picked = await this.pickCards(p, cands, 1, `${target.name}につけるトラッシュの基本エネルギー`);
            if (picked.length > 0) {
              const c = picked[0];
              this.removeCard(me.discard, c.id);
              target.attachedEnergy.push(c);
              this.note(`トラッシュの${c.name}を${target.name}につけた`);
            }
          }
          break;
        }
        case "moveDamageCountersToOpponentPokemon": {
          const [maxCounters] = effect.a;
          const sources = [];
          for (const slot of this.slots(p)) {
            const pk = this.pokemon(p, slot);
            if (pk != null && pk.damage > 0) sources.push(slot);
          }
          const from = await this.chooseSlot(p, p, "ダメカンをのせ替える元の自分のポケモンを選んでください", sources);
          if (from == null) break;
          const fromPk = this.pokemon(p, from);
          if (fromPk == null) break;
          const available = Math.min(maxCounters, Math.trunc(fromPk.damage / 10));
          const labels = [];
          let k = 1;
          while (k <= available) {
            labels.push(`${k}個`);
            k += 1;
          }
          const ci = (await this.ask(p, "card", "のせ替えるダメカンの数を選んでください", labels)) ?? (available - 1);
          const moveCount = Math.max(1, Math.min(available, ci + 1));
          const to = await this.chooseSlot(p, oppIndex, "ダメカンをのせる相手のポケモンを選んでください", this.slots(oppIndex));
          if (to == null) break;
          const toPk = this.pokemon(oppIndex, to);
          if (toPk == null) break;
          fromPk.damage -= moveCount * 10;
          toPk.damage += moveCount * 10;
          this.note(`${fromPk.name}のダメカンを${moveCount}個、相手の${toPk.name}にのせ替えた`);
          break;
        }
        case "attachBasicEnergyFromHandToYourPokemon": {
          const [t] = effect.a;
          const cands = me.hand.filter((x) => x.energyType === t);
          const picked = await this.pickCards(p, cands, 1, `つける${J(t)}エネルギー`);
          if (picked.length > 0) {
            const c = picked[0];
            const slot = await this.chooseSlot(p, p, "エネルギーをつけるポケモンを選んでください", this.slots(p));
            const target = slot != null ? this.pokemon(p, slot) : null;
            if (target != null) {
              this.removeCard(me.hand, c.id);
              target.attachedEnergy.push(c);
              this.note(`${c.name}を${target.name}につけた`);
              this.healOnAttachFromHand(p, target);
            }
          }
          break;
        }
        case "discardStadiumInPlay": {
          const st = this.stadiumCard;
          if (st != null) {
            this.players[this.stadiumOwner].discard.push(st);
            this.stadiumCard = null;
            this.refreshStadiumEffects();
            this.note(`スタジアム「${st.name}」をトラッシュした`);
          }
          break;
        }
        case "discardBasicEnergyFromSelfThenDrawUntilHandSize": {
          const [type, size] = effect.a;
          const pk = source;
          const idx = pk != null ? pk.attachedEnergy.findIndex((x) => x.energyType === type) : -1;
          if (pk != null && idx >= 0) {
            const e = pk.attachedEnergy.splice(idx, 1)[0];
            me.discard.push(e);
            let drawn = 0;
            while (me.hand.length < size && me.deck.length > 0) {
              drawn += this.draw(p, 1);
            }
            this.note(`${pk.name}の${e.name}をトラッシュして、手札が${me.hand.length}枚になるまで山札を引いた（${drawn}枚）`);
          }
          break;
        }
        default:
          break;
      }
    },

    async applyAbilityEffectPart2(effect, p, source) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      switch (effect.c) {
        case "attachBasicEnergyFromDiscardToOneBenched": {
          const [type] = effect.a;
          await this.attachEnergyToBench(p, true, type, 1);
          break;
        }
        case "attachBasicEnergyFromDeckToSelfIfPlayedSupporter": {
          const [name, type, maxCount] = effect.a;
          const target = source;
          if (me.supporterNamesPlayedThisTurn.includes(name) && target != null) {
            const cands = me.deck.filter((x) => x.energyType === type);
            const picked = await this.pickCards(p, cands, maxCount, `${target.name}につける${J(type)}エネルギー`);
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              target.attachedEnergy.push(c);
              this.note(`山札から${c.name}を${target.name}につけた`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "knockOutSelfThenAttachBasicEnergyFromDiscardToYourPokemonOfType": {
          const [type, maxCount] = effect.a;
          const me0 = source;
          if (me0 == null) break;
          me0.damage = me0.hp;
          this.note(`${me0.name}はきぜつした`);
          const cands = me.discard.filter((x) => x.energyType != null);
          const picked = await this.pickCards(p, cands, maxCount, `${J(type)}ポケモンにつける基本エネルギー`);
          for (const c of picked) {
            const targets = [];
            for (const slot of this.slots(p)) {
              const pk = this.pokemon(p, slot);
              if (pk != null && pk !== me0 && pk.data.type === type) targets.push(slot);
            }
            const slot = await this.chooseSlot(p, p, `${c.name}をつける${J(type)}ポケモンを選んでください`, targets);
            const target = slot != null ? this.pokemon(p, slot) : null;
            if (target != null) {
              this.removeCard(me.discard, c.id);
              target.attachedEnergy.push(c);
              this.note(`トラッシュから${c.name}を${target.name}につけた`);
            }
          }
          break;
        }
        case "putNamedPokemonFromDeckOnBench": {
          const [name] = effect.a;
          const c = me.deck.find((x) => x.name === name);
          if (me.bench.length < this.rules.maxBench && c != null) {
            this.removeCard(me.deck, c.id);
            this.putOnBench(p, c);
            this.note(`山札から「${c.name}」をベンチに出した`);
          }
          this.shuffleDeck(p);
          break;
        }
        case "discardOpponentDeckTop": {
          const [n] = effect.a;
          this.discardTopOfOpponentDeck(p, n);
          break;
        }
        case "attachBasicEnergyFromDeckToBenchedOfTypeThenCounters": {
          const [energy, counters] = effect.a;
          const cands = me.deck.filter((x) => x.energyType === energy);
          const picked = await this.pickCards(p, cands, 1, `ベンチのポケモンにつける${J(energy)}エネルギー`);
          if (picked.length > 0) {
            const c = picked[0];
            const bs = [];
            let bi = 0;
            while (bi < me.bench.length) {
              if (me.bench[bi].data.type === energy) bs.push(G.bench(bi));
              bi += 1;
            }
            const slot = await this.chooseSlot(p, p, `エネルギーをつけるベンチの${J(energy)}ポケモンを選んでください`, bs);
            const target = slot != null ? this.pokemon(p, slot) : null;
            if (target != null) {
              this.removeCard(me.deck, c.id);
              target.attachedEnergy.push(c);
              this.shuffleDeck(p);
              target.damage += counters * 10;
              this.note(`${c.name}を${target.name}につけ、ダメカンを${counters}個のせた`);
            }
          }
          break;
        }
        case "attachBasicEnergyFromHandToBenchedOfType": {
          const [t] = effect.a;
          const cands = me.hand.filter((x) => x.energyType === t);
          const picked = await this.pickCards(p, cands, 1, `ベンチのポケモンにつける${J(t)}エネルギー`);
          if (picked.length > 0) {
            const c = picked[0];
            const bs = [];
            let bi = 0;
            while (bi < me.bench.length) {
              if (me.bench[bi].data.type === t) bs.push(G.bench(bi));
              bi += 1;
            }
            const slot = await this.chooseSlot(p, p, `エネルギーをつけるベンチの${J(t)}ポケモンを選んでください`, bs);
            const target = slot != null ? this.pokemon(p, slot) : null;
            if (target != null) {
              this.removeCard(me.hand, c.id);
              target.attachedEnergy.push(c);
              this.note(`${c.name}を${target.name}につけた`);
              this.healOnAttachFromHand(p, target);
            }
          }
          break;
        }
        case "confuseOpponentActive": {
          const target = this.players[oppIndex].active;
          if (target != null) this.inflict("confused", target);
          break;
        }
        case "healOneOfYourPokemon": {
          const [amount] = effect.a;
          const cands = [];
          for (const slot of this.slots(p)) {
            const pk = this.pokemon(p, slot);
            if (pk != null && pk.damage > 0) cands.push(slot);
          }
          const slot = await this.chooseSlot(p, p, "HPを回復するポケモンを選んでください", cands);
          const pk = slot != null ? this.pokemon(p, slot) : null;
          if (pk != null) {
            if (pk.damage > 0) pk.healedTurn = this.turnNumber;
            pk.damage = Math.max(pk.damage - amount, 0);
            this.note(`${pk.name}のHPを${amount}回復した`);
          }
          break;
        }
        case "lookTopCardsAttachBasicEnergyToYourPokemon": {
          const [look] = effect.a;
          const top = [];
          let n = 0;
          while (n < look && me.deck.length > 0) {
            top.push(me.deck.shift());
            n += 1;
          }
          const remaining = top.slice();
          const energies = [];
          for (const c of top) { if (c.isEnergy) energies.push(c); }
          while (energies.length > 0) {
            const labels = [];
            for (const e of energies) labels.push(e.name);
            const i = await this.ask(p, "card", "ポケモンにつけるエネルギーを選んでください（やめるなら「選ばない」）", labels, true);
            if (i == null) break;
            const e = energies[i];
            const slot = await this.chooseSlot(p, p, `${e.name}をつけるポケモンを選んでください`, this.slots(p));
            if (slot == null) break;
            const target = this.pokemon(p, slot);
            if (target == null) break;
            energies.splice(i, 1);
            this.removeCard(remaining, e.id);
            target.attachedEnergy.push(e);
            this.note(`${e.name}を${target.name}につけた`);
          }
          for (const c of remaining) me.deck.push(c);
          this.shuffleDeck(p);
          break;
        }
        default:
          break;
      }
    },

    async applyAbilityEffectPart3(effect, p, source) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      switch (effect.c) {
        case "lookTopCardMayDiscard": {
          if (me.deck.length > 0) {
            const top = me.deck[0];
            if (await this.askYesNo(p, `山札の上は「${top.name}」です。トラッシュしますか？`)) {
              me.deck.shift();
              me.discard.push(top);
              this.note(`山札の上の「${top.name}」をトラッシュした`);
            } else {
              this.note("山札の上のカードを見て、もとにもどした");
            }
          }
          break;
        }
        case "swapOneHandCardWithDeckTop": {
          if (me.hand.length > 0 && me.deck.length > 0) {
            const labels = [];
            for (const c of me.hand) labels.push(c.name);
            const i = (await this.ask(p, "card", "山札の上のカードと入れ替える手札を選んでください", labels)) ?? 0;
            const handCard = me.hand.splice(i, 1)[0];
            const top = me.deck.shift();
            me.deck.unshift(handCard);
            me.hand.push(top);
            this.note(`手札の「${handCard.name}」と山札の上のカードを入れ替えた`);
          }
          break;
        }
        case "switchOpponentBenchedPokemonWithActive":
          await this.switchActive(oppIndex, p);
          break;
        case "healAllYourPokemon": {
          const [amount] = effect.a;
          for (const pk of me.allPokemon) {
            if (pk.damage > 0) {
              pk.damage = Math.max(pk.damage - amount, 0);
              pk.healedTurn = this.turnNumber;
            }
          }
          this.note(`自分のポケモン全員のHPを${amount}回復した`);
          break;
        }
        case "switchOpponentBenchedPokemonWithActiveHPAtMost": {
          const [maxHP] = effect.a;
          await this.switchActive(oppIndex, p, maxHP);
          break;
        }
        case "sleepOpponentActive": {
          const target = this.players[oppIndex].active;
          if (target != null) this.inflict("asleep", target);
          break;
        }
        case "burnOpponentActive": {
          const target = this.players[oppIndex].active;
          if (target != null) this.inflict("burned", target);
          break;
        }
        case "placeCountersOnSelfThenBoostOwnAttacks": {
          const [counters, bonus] = effect.a;
          const pk = source;
          if (pk == null) break;
          pk.damage += counters * 10;
          pk.selfAttackBoostTurn = this.turnNumber;
          pk.selfAttackBoost = bonus;
          this.note(`${pk.name}にダメカンを${counters}個のせた。この番、ワザのダメージが${bonus}増える`);
          break;
        }
        case "discardOneHandCardToDeckBottomThenDrawUntilHandSize": {
          const [size] = effect.a;
          if (me.hand.length === 0) break;
          const labels = [];
          for (const c of me.hand) labels.push(c.name);
          const i = (await this.ask(p, "card", "山札の下にもどす手札を選んでください", labels)) ?? 0;
          const c = me.hand.splice(i, 1)[0];
          me.deck.push(c);
          this.note(`手札の「${c.name}」を山札の下にもどした`);
          let drawn = 0;
          while (me.hand.length < size && me.deck.length > 0) {
            me.hand.push(me.deck.shift());
            drawn += 1;
          }
          this.note(`山札を${drawn}枚引いた`);
          break;
        }
        case "discardBasicEnergyFromHandThenBurnOpponentActive": {
          const [type] = effect.a;
          const c = me.hand.find((x) => x.energyType === type);
          if (c != null) {
            this.removeFromHand(p, c);
            me.discard.push(c);
            this.note(`手札の${c.name}をトラッシュした`);
            const target = this.players[oppIndex].active;
            if (target != null) this.inflict("burned", target);
          }
          break;
        }
        case "attachBasicEnergiesFromHandToYourPokemon": {
          const [types] = effect.a;
          for (const t of types) {
            const cands = me.hand.filter((x) => x.energyType === t);
            if (cands.length === 0) continue;
            const picked = await this.pickCards(p, cands, 1, `自分のポケモンにつける${J(t)}エネルギー（つけないなら選ばない）`);
            if (picked.length === 0) continue;
            const c = picked[0];
            const slot = await this.chooseSlot(p, p, `${c.name}をつけるポケモンを選んでください`, this.slots(p));
            if (slot == null) continue;
            const target = this.pokemon(p, slot);
            if (target == null) continue;
            this.removeCard(me.hand, c.id);
            target.attachedEnergy.push(c);
            this.note(`${c.name}を${target.name}につけた`);
            this.healOnAttachFromHand(p, target);
          }
          break;
        }
        case "attachBasicEnergyFromHandToYourPokemonThenHeal": {
          const [type, amount] = effect.a;
          const cands = me.hand.filter((x) => x.energyType === type);
          const picked = await this.pickCards(p, cands, 1, `ポケモンにつける${J(type)}エネルギー`);
          if (picked.length > 0) {
            const c = picked[0];
            const slot = await this.chooseSlot(p, p, "エネルギーをつけるポケモンを選んでください", this.slots(p));
            const target = slot != null ? this.pokemon(p, slot) : null;
            if (target != null) {
              this.removeCard(me.hand, c.id);
              target.attachedEnergy.push(c);
              this.note(`${c.name}を${target.name}につけた`);
              this.healOnAttachFromHand(p, target);
              if (target.damage > 0) target.healedTurn = this.turnNumber;
              target.damage = Math.max(target.damage - amount, 0);
              this.note(`${target.name}のHPを${amount}回復した`);
            }
          }
          break;
        }
        case "switchSelfWithActiveThenMoveYourEnergyToSelf": {
          const pk = source;
          const old = me.active;
          if (pk == null || old == null || old === pk) break;
          const i = me.bench.findIndex((x) => x === pk);
          if (i < 0) break;
          old.conditions.clear();
          me.bench[i] = old;
          me.active = pk;
          this.note(`${pk.name}とバトル場の${old.name}を入れ替えた`);
          await this.afterBenchToActive(p, pk);
          await this.afterActiveToBench(p, old);
          let moved = 0;
          while (moved < 40) {
            const labels = [];
            const refs = [];
            for (const holder of me.allPokemon) {
              if (holder === pk) continue;
              holder.attachedEnergy.forEach((e, ei) => {
                labels.push(`${holder.name}の${e.name}`);
                refs.push([holder, ei]);
              });
            }
            if (labels.length === 0) break;
            const choice = await this.ask(p, "card", `${pk.name}につけ替えるエネルギーを選んでください（やめるなら「選ばない」）`, labels, true);
            if (choice == null) break;
            const [from, ei] = refs[choice];
            const e = from.attachedEnergy.splice(ei, 1)[0];
            pk.attachedEnergy.push(e);
            this.note(`${e.name}を${from.name}から${pk.name}につけ替えた`);
            moved += 1;
          }
          break;
        }
        case "discardBasicEnergyFromHandThenDraw": {
          const [energy, , drawCount] = effect.a;
          const candidates = [];
          for (const c of me.hand) { if (c.energyType === energy) candidates.push(c); }
          if (candidates.length > 0) {
            const first = candidates[0];
            this.removeFromHand(p, first);
            me.discard.push(first);
            const drawn = this.draw(p, drawCount);
            this.note(`手札の${first.name}をトラッシュして、山札を${drawn}枚引いた`);
          }
          break;
        }
        case "moveBasicEnergyToAnotherOfYourPokemon": {
          const [type] = effect.a;
          const sources = [];
          for (const slot of this.slots(p)) {
            const pk = this.pokemon(p, slot);
            if (pk != null && pk.attachedEnergy.some((x) => x.energyType === type)) {
              sources.push(slot);
            }
          }
          const from = await this.chooseSlot(p, p, "エネルギーをつけ替える元のポケモンを選んでください", sources);
          if (from == null) break;
          const fromPk = this.pokemon(p, from);
          if (fromPk == null) break;
          const destinations = [];
          for (const slot of this.slots(p)) { if (!G.slotEq(slot, from)) destinations.push(slot); }
          const to = await this.chooseSlot(p, p, "つけ替え先のポケモンを選んでください", destinations);
          if (to == null) break;
          const toPk = this.pokemon(p, to);
          if (toPk == null) break;
          const idx = fromPk.attachedEnergy.findIndex((x) => x.energyType === type);
          if (idx >= 0) {
            const e = fromPk.attachedEnergy.splice(idx, 1)[0];
            toPk.attachedEnergy.push(e);
            this.note(`${e.name}を${fromPk.name}から${toPk.name}につけ替えた`);
          }
          break;
        }
        default:
          break;
      }
    },

  });

  if (typeof module !== "undefined") module.exports = G;
})(globalThis.PK = globalThis.PK || {});
// fx_g.js : BattleEffectsSD100.swift（全814行）の移植
// 担当範囲: healPokemon, takeDeckTop, pickCardsExactly, orderCards, discardHandDownTo, chooseSlotOptional,
//           attachCardToYourPokemon, isRulePokemonData, chooseOpponentEnergy, canPlayTrainerSD100,
//           evolutionFromDeckOptions, applyTrainerEffectPart5, applyTrainerEffectPart6, attachedEnergyEffects,
//           berryReduction, discardBerries, applySD100RetaliationItems, applyEndOfTurnTools, discardFossilInPlay
(function (G) {
  "use strict";

  const J = (t) => G.energyJapaneseName(t); // EnergyType.japaneseName

  // Swiftの max(0, min(i, n - 1))
  const clampIdx = (i, n) => Math.max(0, Math.min(i, n - 1));

  Object.assign(G.BattleGame.prototype, {

    // MARK: - 共通の小さな道具
    healPokemon(pk, amount) {
      if (pk.damage > 0) pk.healedTurn = this.turnNumber;
      pk.damage = Math.max(pk.damage - amount, 0);
      this.note(`${pk.name}のHPを${amount}回復した`);
    },

    /// 山札の上から n 枚を取り出す（山札から抜く）
    takeDeckTop(p, n) {
      const top = [];
      let k = 0;
      while (k < n && this.players[p].deck.length > 0) {
        top.push(this.players[p].deck.shift());
        k += 1;
      }
      return top;
    },

    /// 候補から、ちょうど count 枚（足りなければ全部）選ぶ。途中でやめられない
    async pickCardsExactly(p, candidates, count, prompt) {
      const remaining = candidates.slice();
      const picked = [];
      while (picked.length < count && remaining.length > 0) {
        const labels = [];
        for (const c of remaining) labels.push(c.name);
        const gallery = this.makeGallery(p, remaining);
        const need = Math.min(count - picked.length, remaining.length);
        const multi = count > 1 ? { cards: remaining.slice(), max: need, min: need, first: picked.length === 0, cont: picked.length > 0, total: count } : null;
        let i = await this.ask(p, "card", `${prompt}（${picked.length + 1}/${count}枚）`, labels, false, null, null, gallery, multi);
        if (i == null) i = 0;
        picked.push(remaining.splice(clampIdx(i, remaining.length), 1)[0]);
      }
      return picked;
    },

    /// カードを好きな順番に並べる（先頭が1番目）
    async orderCards(p, cards, prompt) {
      const remaining = cards.slice();
      const ordered = [];
      while (remaining.length > 1) {
        const labels = [];
        for (const c of remaining) labels.push(c.name);
        let i = await this.ask(p, "card", `${prompt}（${ordered.length + 1}番目）`, labels);
        if (i == null) i = 0;
        ordered.push(remaining.splice(clampIdx(i, remaining.length), 1)[0]);
      }
      for (const c of remaining) ordered.push(c);
      return ordered;
    },

    /// 手札が n 枚になるまで、持ち主が選んでトラッシュする
    async discardHandDownTo(side, n) {
      const st = this.players[side];
      while (st.hand.length > n) {
        const labels = [];
        for (const c of st.hand) labels.push(c.name);
        let i = await this.ask(side, "card", `トラッシュする手札を選んでください（あと${st.hand.length - n}枚）`, labels);
        if (i == null) i = 0;
        const c = st.hand.splice(clampIdx(i, st.hand.length), 1)[0];
        st.discard.push(c);
        this.note(`プレイヤー${side + 1}は手札の「${c.name}」をトラッシュした`);
      }
    },

    /// 場のポケモンを選ぶ（選ばなくてもよい）
    async chooseSlotOptional(chooser, owner, prompt, candidates) {
      if (candidates.length === 0) return null;
      const labels = [];
      for (const slot of candidates) labels.push(this.slotLabel(owner, slot));
      const i = await this.ask(chooser, "target", prompt, labels, true, candidates, owner);
      if (i == null) return null;
      return candidates[i];
    },

    /// 取り出したエネルギーを、自分のポケモン1匹につける
    async attachCardToYourPokemon(p, card, prompt) {
      const cands = [];
      for (const slot of this.slots(p)) {
        const prefix = card.attachOnlyPrefix;
        if (prefix != null) {
          const pk0 = this.pokemon(p, slot);
          if (pk0 != null && !pk0.data.name.startsWith(prefix)) continue;
        }
        cands.push(slot);
      }
      const slot = await this.chooseSlot(p, p, prompt, cands);
      const pk = slot != null ? this.pokemon(p, slot) : null;
      if (slot != null && pk != null) {
        pk.attachedEnergy.push(card);
        this.note(`${card.name}を${pk.name}につけた`);
      } else {
        this.players[p].discard.push(card);
      }
    },

    isRulePokemonData(d) {
      return d.prizeValue > 1 || d.name.endsWith("ex");
    },

    /// 相手のポケモンについているエネルギーを1個選ぶ（グッズの効果を受けないポケモンはのぞく）。返すのは持ち主側のポケモンとカード（{pk, card} または null）
    async chooseOpponentEnergy(p, t) {
      const opp = this.other(p);
      const cands = [];
      for (const slot of this.slots(opp)) {
        const pk = this.pokemon(opp, slot);
        if (pk != null && pk.attachedEnergy.length > 0 && !this.shieldedByTrainer(pk, t)) cands.push(slot);
      }
      const slot = await this.chooseSlot(p, opp, "エネルギーを選ぶ相手のポケモンを選んでください", cands);
      if (slot == null) return null;
      const pk = this.pokemon(opp, slot);
      if (pk == null || pk.attachedEnergy.length === 0) return null;
      const labels = [];
      for (const c of pk.attachedEnergy) labels.push(c.name);
      let i = await this.ask(p, "card", `${pk.name}についているエネルギーを選んでください`, labels);
      if (i == null) i = 0;
      return { pk: pk, card: pk.attachedEnergy[clampIdx(i, pk.attachedEnergy.length)] };
    },

    // MARK: - 使えるかどうか（第11弾ぶん）
    canPlayTrainerSD100(p, t) {
      const me = this.players[p];
      const opp = this.players[this.other(p)];
      const isFirstTurn = me.turnsTaken <= 1;
      for (const effect of t.effects) {
        switch (effect.c) {
          case "requiresYourPokemonKnockedOutLastOpponentTurn":
            if (me.lastKnockedOutTurn !== this.turnNumber - 1) return false;
            break;
          case "healOneOfYourPokemon":
          case "healOneOfYourPokemonFullyIfRemainingHPAtMost": {
            let limit = 9999;
            if (effect.c === "healOneOfYourPokemonFullyIfRemainingHPAtMost") limit = effect.a[0];
            if (!me.allPokemon.some((pk) => pk.damage > 0 && pk.remainingHP <= limit)) return false;
            break;
          }
          case "flipCoinsAllHeadsAttachBasicEnergyFromDeck":
            if (me.deck.length === 0) return false;
            break;
          case "moveBasicEnergyBetweenYourPokemon":
            if (me.allPokemon.length < 2) return false;
            if (!me.allPokemon.some((pk) => pk.attachedEnergy.some((c) => c.isEnergy))) return false;
            break;
          case "swapOgerponExFromDiscard": {
            const inDiscard = me.discard.some((c) => {
              const d = c.pokemonData;
              if (d == null) return false;
              return !d.isFossil && d.name.includes("オーガポン") && this.isRulePokemonData(d);
            });
            const inPlay = me.allPokemon.some((pk) => pk.cards.length === 1 && pk.data.name.includes("オーガポン") && this.isRulePokemonData(pk.data));
            if (!inDiscard || !inPlay) return false;
            break;
          }
          case "flipCoinHeadsDiscardOpponentEnergy":
          case "returnOpponentEnergyToHand":
            if (!opp.allPokemon.some((pk) => pk.attachedEnergy.length > 0 && !this.shieldedByTrainer(pk, t))) return false;
            break;
          case "lookTopCardsArrangeOnTopOrBottom":
          case "lookTopCardsTakeSupporterRestShuffle":
          case "lookTopCardsAttachBasicEnergyToYourPokemonRestShuffle":
          case "lookTopCardsTakeAny":
          case "lookTopCardsTakePokemonAndTrainer":
          case "searchDeckAnyCardsPutOnTop":
          case "discardHandThenSearchPokemonSupporterBasicEnergy":
          case "flipCoinHeadsSearchDeckToHand":
          case "flipCoinSearchEvolutionHeadsBasicTailsNamePrefix":
          case "searchTwoDifferentBasicEnergyOneToHandOtherAttach":
            if (me.deck.length === 0) return false;
            break;
          case "switchOwnActiveWithBenchThenMoveEnergyToNewActive":
            if (me.active == null || me.bench.length === 0) return false;
            break;
          case "burnAndConfuseOpponentActive": {
            const a = opp.active;
            if (!(a != null && !this.shieldedByTrainer(a, t))) return false;
            break;
          }
          case "usableOnlyOnSecondPlayerFirstTurn":
            if (p === this.firstPlayer || !isFirstTurn) return false;
            break;
          case "switchOpponentBenchToActiveChosenByYou":
            if (opp.bench.length === 0) return false;
            break;
          case "healActiveWithBonusForNamePrefix": {
            const a = me.active;
            if (!(a != null && a.damage > 0)) return false;
            break;
          }
          case "returnOneOfYourPokemonWithAllCardsToHand":
            if (me.allPokemon.length < 2) return false;
            break;
          case "attachBasicEnergyFromDiscardToEachYourFuturePokemon":
            if (!me.allPokemon.some((pk) => pk.data.isFuture)) return false;
            if (!me.discard.some((c) => c.isEnergy)) return false;
            break;
          case "healYourActivePokemon": {
            const type = effect.a[1];
            const a = me.active;
            if (!(a != null && a.damage > 0)) return false;
            if (type != null && a.data.type !== type) return false;
            break;
          }
          case "healAllYourPokemon": {
            const type = effect.a[1];
            if (!me.allPokemon.some((pk) => {
              if (pk.damage <= 0) return false;
              if (type != null) return pk.data.type === type;
              return true;
            })) return false;
            break;
          }
          case "attachBasicEnergyFromDeckToYourTypePokemon": {
            const type = effect.a[0];
            if (!me.allPokemon.some((pk) => pk.data.type === type)) return false;
            if (!me.deck.some((c) => c.energyType === type)) return false;
            break;
          }
          case "moveEnergyFromBenchToActive":
            if (me.active == null) return false;
            if (!me.bench.some((pk) => pk.attachedEnergy.length > 0)) return false;
            break;
          case "returnPokemonFromHandToDeckThenSearchSameCount":
            if (!me.hand.some((c) => c.isPokemon)) return false;
            break;
          case "evolveOneFromDeckWithoutAbility":
            if (this.rules.noEvolutionOnFirstTurn && isFirstTurn) return false;
            if (this.evolutionFromDeckOptions(p).length === 0) return false;
            break;
          case "requiresOpponentPrizesExactly": {
            const n = effect.a[0];
            if (opp.prizes.length !== n) return false;
            break;
          }
          case "putTwoHandCardsOnDeckBottomThenDraw":
            if (me.hand.length < 3) return false;
            break;
          case "switchOpponentBenchedBasicToActiveThenConfuse": {
            if (!opp.bench.some((pk) => pk.data.stage === "basic")) return false;
            const a = opp.active;
            if (a != null && this.shieldedByTrainer(a, t)) return false;
            break;
          }
          default:
            break;
        }
      }
      return true;
    },

    /// セイジ: 場のポケモンから進化するカード（特性を持つポケモンをのぞく）が山札にあるか。返すのは [{slot, card}]
    evolutionFromDeckOptions(p) {
      const result = [];
      for (const slot of this.slots(p)) {
        const pk = this.pokemon(p, slot);
        if (pk == null) continue;
        if (!(pk.cards.length === 1 || pk.lastChangedTurn < this.turnNumber)) continue;
        for (const c of this.players[p].deck) {
          const d = c.pokemonData;
          if (d == null || d.isFossil || d.stage === "basic" || d.evolvesFrom !== pk.name || d.ability != null) continue;
          result.push({ slot: slot, card: c });
        }
      }
      return result;
    },

    // MARK: - 効果の処理（その1）
    async applyTrainerEffectPart5(effect, t, p) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "healOneOfYourPokemon": {
          const [amount, thenDiscardEnergy] = effect.a;
          const cands = [];
          for (const slot of this.slots(p)) { const pk = this.pokemon(p, slot); if (pk != null && pk.damage > 0) cands.push(slot); }
          const slot = await this.chooseSlot(p, p, "HPを回復するポケモンを選んでください", cands);
          const pk = slot != null ? this.pokemon(p, slot) : null;
          if (slot != null && pk != null) {
            this.healPokemon(pk, amount);
            if (thenDiscardEnergy && pk.attachedEnergy.length > 0) {
              const labels = [];
              for (const c of pk.attachedEnergy) labels.push(c.name);
              let i = await this.ask(p, "card", "トラッシュするエネルギーを選んでください", labels);
              if (i == null) i = 0;
              const c = pk.attachedEnergy.splice(clampIdx(i, pk.attachedEnergy.length), 1)[0];
              me.discard.push(c);
              this.note(`${pk.name}の${c.name}をトラッシュした`);
            }
          }
          break;
        }
        case "flipCoinsAllHeadsAttachBasicEnergyFromDeck": {
          const [count] = effect.a;
          let allHeads = true;
          let k = 0;
          while (k < count) {
            if (!this.flipCoin()) allHeads = false;
            k += 1;
          }
          if (allHeads) {
            const cands = [];
            for (const c of me.deck) if (c.isEnergy) cands.push(c);
            const picked = await this.pickCards(p, cands, 1, "つける基本エネルギー");
            for (const c of picked) {
              this.removeCard(me.deck, c.id);
              await this.attachCardToYourPokemon(p, c, "エネルギーをつけるポケモンを選んでください");
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "moveBasicEnergyBetweenYourPokemon": {
          const fromCands = [];
          for (const slot of this.slots(p)) {
            const pk = this.pokemon(p, slot);
            if (pk != null && pk.attachedEnergy.some((c) => c.isEnergy)) fromCands.push(slot);
          }
          const fromSlot = await this.chooseSlot(p, p, "エネルギーをつけ替え元のポケモンを選んでください", fromCands);
          const from = fromSlot != null ? this.pokemon(p, fromSlot) : null;
          if (fromSlot != null && from != null) {
            const energyCards = [];
            for (const c of from.attachedEnergy) if (c.isEnergy) energyCards.push(c);
            const labels = [];
            for (const c of energyCards) labels.push(c.name);
            let i = await this.ask(p, "card", "つけ替える基本エネルギーを選んでください", labels);
            if (i == null) i = 0;
            const card = energyCards[clampIdx(i, energyCards.length)];
            const toCands = [];
            for (const slot of this.slots(p)) { const pk = this.pokemon(p, slot); if (pk != null && pk !== from) toCands.push(slot); }
            const toSlot = await this.chooseSlot(p, p, "つけ替え先のポケモンを選んでください", toCands);
            const to = toSlot != null ? this.pokemon(p, toSlot) : null;
            if (toSlot != null && to != null) {
              this.removeCard(from.attachedEnergy, card.id);
              to.attachedEnergy.push(card);
              this.note(`${from.name}の${card.name}を${to.name}につけ替えた`);
            }
          }
          break;
        }
        case "swapOgerponExFromDiscard": {
          const discardCands = [];
          for (const c of me.discard) {
            const d = c.pokemonData;
            if (d != null && !d.isFossil && d.name.includes("オーガポン") && this.isRulePokemonData(d)) discardCands.push(c);
          }
          const picked = await this.pickCardsExactly(p, discardCands, 1, "場と入れ替えるカード");
          const newCard = picked.length > 0 ? picked[0] : null;
          if (newCard != null) {
            const cands = [];
            for (const slot of this.slots(p)) {
              const pk = this.pokemon(p, slot);
              if (pk != null && pk.cards.length === 1 && pk.data.name.includes("オーガポン") && this.isRulePokemonData(pk.data)) cands.push(slot);
            }
            const slot = await this.chooseSlot(p, p, "入れ替えるポケモンを選んでください", cands);
            const pk = slot != null ? this.pokemon(p, slot) : null;
            if (slot != null && pk != null) {
              const old = pk.cards[0];
              this.removeCard(me.discard, newCard.id);
              pk.cards[0] = newCard;
              me.discard.push(old);
              this.note(`${old.name}を${newCard.name}と入れ替え、${old.name}をトラッシュした`);
              this.refreshStadiumEffects();
            }
          }
          break;
        }
        case "drawPerYourAncientPokemon": {
          const n = me.allPokemon.filter((pk) => pk.data.isAncient).length;
          const drawn = this.draw(p, n);
          this.note(`「古代」のポケモン${n}匹ぶん、山札を${drawn}枚引いた`);
          break;
        }
        case "flipCoinHeadsDiscardOpponentEnergy": {
          if (this.flipCoin()) {
            const r = await this.chooseOpponentEnergy(p, t);
            if (r != null) {
              const { pk, card } = r;
              this.removeCard(pk.attachedEnergy, card.id);
              opp.discard.push(card);
              this.note(`相手の${pk.name}の${card.name}をトラッシュした`);
            }
          }
          break;
        }
        case "returnOpponentEnergyToHand": {
          const r = await this.chooseOpponentEnergy(p, t);
          if (r != null) {
            const { pk, card } = r;
            this.removeCard(pk.attachedEnergy, card.id);
            opp.hand.push(card);
            this.note(`相手の${pk.name}の${card.name}を相手の手札にもどした`);
          }
          break;
        }
        case "lookTopCardsArrangeOnTopOrBottom": {
          const [look] = effect.a;
          const top = this.takeDeckTop(p, look);
          if (top.length > 0) {
            const names = [];
            for (const c of top) names.push(c.name);
            this.note(`山札の上から${top.length}枚を見た：${names.join("、")}`);
            let i = await this.ask(p, "other", `山札の上から${top.length}枚：${names.join("、")}`, ["好きな順番で山札の上にもどす", "ウラにして切り、山札の下にもどす"]);
            if (i == null) i = 0;
            if (i === 0) {
              const ordered = await this.orderCards(p, top, "山札の上にもどす順番（1番目が一番上）");
              me.deck.splice(0, 0, ...ordered);
              this.note("見たカードを山札の上にもどした");
            } else {
              const shuffled = top.slice();
              this.shuffleArray(shuffled);
              for (const c of shuffled) me.deck.push(c);
              this.note("見たカードを山札の下にもどした");
            }
          }
          break;
        }
        case "switchOwnActiveWithBenchThenMoveEnergyToNewActive": {
          const old = me.active;
          await this.switchActive(p, p);
          const nw = me.active;
          if (old != null && nw != null && nw !== old) {
            const o = old;
            const cands = [];
            for (const c of o.attachedEnergy) {
              const prefix = c.attachOnlyPrefix;
              if (prefix != null && !nw.data.name.startsWith(prefix)) continue;
              cands.push(c);
            }
            const picked = await this.pickCards(p, cands, cands.length, "新しいバトルポケモンにつけ替えるエネルギー");
            for (const c of picked) {
              this.removeCard(o.attachedEnergy, c.id);
              nw.attachedEnergy.push(c);
              this.note(`${o.name}の${c.name}を${nw.name}につけ替えた`);
            }
          }
          break;
        }
        case "burnAndConfuseOpponentActive": {
          const a = opp.active;
          if (a != null && !this.shieldedByTrainer(a, t)) {
            this.inflict("burned", a);
            this.inflict("confused", a);
          }
          break;
        }
        case "bothDiscardHandDownTo": {
          const [n] = effect.a;
          await this.discardHandDownTo(oppIndex, n);
          await this.discardHandDownTo(p, n);
          break;
        }
        case "switchOpponentBenchToActiveChosenByYou": {
          const [requireHeads] = effect.a;
          const a = opp.active;
          if (a != null && this.shieldedByTrainer(a, t)) {
            this.note(`${a.name}の特性で、効果を受けない`);
          } else if (opp.bench.length > 0) {
            if (!requireHeads || this.flipCoin()) {
              await this.switchActive(oppIndex, p, null, null, false, t);
            }
          }
          break;
        }
        case "healActiveWithBonusForNamePrefix": {
          const [amount, prefix, bonus] = effect.a;
          const a = me.active;
          if (a != null) {
            this.healPokemon(a, a.data.name.startsWith(prefix) ? bonus : amount);
          }
          break;
        }
        case "lookTopCardsTakeSupporterRestShuffle": {
          const [look] = effect.a;
          const top = this.takeDeckTop(p, look);
          const cands = [];
          for (const c of top) if (c.trainerData != null && c.trainerData.trainerKind === "supporter") cands.push(c);
          const picked = await this.pickCards(p, cands, 1, "手札に加えるサポート");
          for (const c of picked) {
            this.removeCard(top, c.id);
            me.hand.push(c);
            this.note(`「${c.name}」を手札に加えた`);
          }
          for (const c of top) me.deck.push(c);
          this.shuffleDeck(p);
          break;
        }
        case "returnOneOfYourPokemonWithAllCardsToHand": {
          const slot = await this.chooseSlot(p, p, "手札にもどすポケモンを選んでください", this.slots(p));
          const pk = slot != null ? this.pokemon(p, slot) : null;
          if (slot != null && pk != null) {
            for (const c of pk.cards) me.hand.push(c);
            for (const c of pk.attachedEnergy) me.hand.push(c);
            if (pk.tool != null) me.hand.push(pk.tool);
            if (pk.extraTool != null) me.hand.push(pk.extraTool);
            this.note(`${pk.name}と、ついているすべてのカードを手札にもどした`);
            if (me.active === pk) me.active = null;
            for (let i = me.bench.length - 1; i >= 0; i--) if (me.bench[i] === pk) me.bench.splice(i, 1);
            this.refreshStadiumEffects();
          }
          break;
        }
        case "flipCoinHeadsSearchDeckToHand": {
          const [filters, maxTotal] = effect.a;
          if (this.flipCoin()) {
            await this.searchToHand(p, false, filters, maxTotal, "手札に加えるカード");
          } else {
            this.shuffleDeck(p);
          }
          break;
        }
        case "attachBasicEnergyFromDiscardToEachYourFuturePokemon": {
          for (const pk of me.allPokemon) {
            if (!pk.data.isFuture) continue;
            const cands = [];
            for (const c of me.discard) if (c.isEnergy) cands.push(c);
            if (cands.length === 0) break;
            const picked = await this.pickCardsExactly(p, cands, 1, `${pk.name}につける基本エネルギー`);
            if (picked.length > 0) {
              const c = picked[0];
              this.removeCard(me.discard, c.id);
              pk.attachedEnergy.push(c);
              this.note(`トラッシュの${c.name}を${pk.name}につけた`);
            }
          }
          break;
        }
        case "healYourActivePokemon": {
          const [amount, type] = effect.a;
          const a = me.active;
          if (a != null && (type == null || a.data.type === type)) this.healPokemon(a, amount);
          break;
        }
        case "flipCoinSearchEvolutionHeadsBasicTailsNamePrefix": {
          const [prefix] = effect.a;
          const heads = this.flipCoin();
          const cands = [];
          for (const c of me.deck) {
            const d = c.pokemonData;
            if (d == null || d.isFossil || !d.name.startsWith(prefix)) continue;
            if (heads ? (d.stage !== "basic") : (d.stage === "basic")) cands.push(c);
          }
          const picked = await this.pickCards(p, cands, 1, `手札に加える「${prefix}」ポケモン`);
          for (const c of picked) {
            this.removeCard(me.deck, c.id);
            me.hand.push(c);
            this.note(`「${c.name}」を手札に加えた`);
          }
          this.shuffleDeck(p);
          break;
        }
        case "flipCoinHeadsCountersOnOpponentPokemonTailsOnYourActive": {
          const [counters] = effect.a;
          if (this.flipCoin()) {
            const cands = [];
            for (const slot of this.slots(oppIndex)) {
              const pk = this.pokemon(oppIndex, slot);
              if (pk != null && !this.shieldedByTrainer(pk, t)) cands.push(slot);
            }
            const slot = await this.chooseSlot(p, oppIndex, "ダメカンをのせる相手のポケモンを選んでください", cands);
            const pk = slot != null ? this.pokemon(oppIndex, slot) : null;
            if (slot != null && pk != null) {
              pk.damage += counters * 10;
              this.note(`相手の${pk.name}にダメカンを${counters}個のせた`);
            }
          } else if (me.active != null) {
            const a = me.active;
            a.damage += counters * 10;
            this.note(`自分の${a.name}にダメカンを${counters}個のせた`);
          }
          break;
        }
        case "healAllYourPokemon": {
          const [amount, type] = effect.a;
          for (const pk of me.allPokemon) {
            if (!(pk.damage > 0)) continue;
            if (type != null && pk.data.type !== type) continue;
            this.healPokemon(pk, amount);
          }
          break;
        }
        case "healOneOfYourPokemonFullyIfRemainingHPAtMost": {
          const [limit] = effect.a;
          const cands = [];
          for (const slot of this.slots(p)) {
            const pk = this.pokemon(p, slot);
            if (pk != null && pk.damage > 0 && pk.remainingHP <= limit) cands.push(slot);
          }
          const slot = await this.chooseSlot(p, p, "HPをすべて回復するポケモンを選んでください", cands);
          const pk = slot != null ? this.pokemon(p, slot) : null;
          if (slot != null && pk != null) {
            this.healPokemon(pk, pk.damage);
          }
          break;
        }
        case "discardHandThenSearchPokemonSupporterBasicEnergy": {
          const n = me.hand.length;
          for (const c of me.hand) me.discard.push(c);
          me.hand.length = 0;
          this.note(`手札${n}枚をすべてトラッシュした`);
          const pokemonCands = [];
          for (const c of me.deck) if (c.isPokemon) pokemonCands.push(c);
          const a = await this.pickCards(p, pokemonCands, 1, "手札に加えるポケモン");
          for (const c of a) { this.removeCard(me.deck, c.id); me.hand.push(c); this.note(`「${c.name}」を手札に加えた`); }
          const supCands = [];
          for (const c of me.deck) if (c.trainerData != null && c.trainerData.trainerKind === "supporter") supCands.push(c);
          const b = await this.pickCards(p, supCands, 1, "手札に加えるサポート");
          for (const c of b) { this.removeCard(me.deck, c.id); me.hand.push(c); this.note(`「${c.name}」を手札に加えた`); }
          const enCands = [];
          for (const c of me.deck) if (c.isEnergy) enCands.push(c);
          const e = await this.pickCards(p, enCands, 1, "手札に加える基本エネルギー");
          for (const c of e) { this.removeCard(me.deck, c.id); me.hand.push(c); this.note(`「${c.name}」を手札に加えた`); }
          this.shuffleDeck(p);
          break;
        }
        case "searchTwoDifferentBasicEnergyOneToHandOtherAttach": {
          const firstCands = [];
          for (const c of me.deck) if (c.isEnergy) firstCands.push(c);
          const chosen = [];
          const first = await this.pickCards(p, firstCands, 1, "1枚目の基本エネルギー");
          if (first.length > 0) {
            const f = first[0];
            chosen.push(f);
            const secondCands = [];
            for (const c of firstCands) if (c.energyType !== f.energyType) secondCands.push(c);
            const second = await this.pickCards(p, secondCands, 1, "2枚目の基本エネルギー（ちがうタイプ）");
            if (second.length > 0) chosen.push(second[0]);
          }
          for (const c of chosen) this.removeCard(me.deck, c.id);
          if (chosen.length === 2) {
            const labels = [chosen[0].name, chosen[1].name];
            let i = await this.ask(p, "card", "手札に加えるエネルギーを選んでください（残りはポケモンにつけます）", labels);
            if (i == null) i = 0;
            const toHand = chosen[Math.max(0, Math.min(i, 1))];
            const toAttach = chosen[i === 0 ? 1 : 0];
            me.hand.push(toHand);
            this.note(`「${toHand.name}」を手札に加えた`);
            await this.attachCardToYourPokemon(p, toAttach, `${toAttach.name}をつけるポケモンを選んでください`);
          } else if (chosen.length > 0) {
            const only = chosen[0];
            me.hand.push(only);
            this.note(`「${only.name}」を手札に加えた`);
          }
          this.shuffleDeck(p);
          break;
        }
        default:
          break;
      }
    },

    // MARK: - 効果の処理（その2）
    async applyTrainerEffectPart6(effect, t, p) {
      const me = this.players[p];
      const oppIndex = this.other(p);
      const opp = this.players[oppIndex];
      switch (effect.c) {
        case "searchDeckAnyCardsPutOnTop": {
          const [count] = effect.a;
          const picked = await this.pickCardsExactly(p, me.deck, count, "山札の上にもどすカード");
          for (const c of picked) this.removeCard(me.deck, c.id);
          this.shuffleDeck(p);
          const ordered = await this.orderCards(p, picked, "山札の上にもどす順番（1番目が一番上）");
          me.deck.splice(0, 0, ...ordered);
          this.note("選んだカードを山札の上にもどした");
          break;
        }
        case "attachBasicEnergyFromDeckToYourTypePokemon": {
          const [type, maxPokemon, poisonIfActive] = effect.a;
          const done = [];
          let k = 0;
          while (k < maxPokemon) {
            k += 1;
            const cands = [];
            for (const slot of this.slots(p)) {
              const pk0 = this.pokemon(p, slot);
              if (pk0 != null && pk0.data.type === type && !done.some((x) => x === pk0)) cands.push(slot);
            }
            const energyCands = [];
            for (const c of me.deck) if (c.energyType === type) energyCands.push(c);
            if (cands.length === 0 || energyCands.length === 0) break;
            const slot = await this.chooseSlotOptional(p, p, `エネルギーをつける${J(type)}ポケモンを選んでください（${k}/${maxPokemon}匹）`, cands);
            if (slot == null) break;
            const pk = this.pokemon(p, slot);
            if (pk == null) break;
            const card = energyCands[0];
            this.removeCard(me.deck, card.id);
            pk.attachedEnergy.push(card);
            this.note(`山札の${card.name}を${pk.name}につけた`);
            done.push(pk);
            if (poisonIfActive && me.active === pk) this.inflict("poisoned", pk);
          }
          this.shuffleDeck(p);
          break;
        }
        case "lookTopCardsAttachBasicEnergyToYourPokemonRestShuffle": {
          const [look] = effect.a;
          const top = this.takeDeckTop(p, look);
          const cands = [];
          for (const c of top) if (c.isEnergy) cands.push(c);
          const picked = await this.pickCards(p, cands, 1, "ポケモンにつける基本エネルギー");
          for (const c of picked) {
            this.removeCard(top, c.id);
            await this.attachCardToYourPokemon(p, c, "エネルギーをつけるポケモンを選んでください");
          }
          for (const c of top) me.deck.push(c);
          this.shuffleDeck(p);
          break;
        }
        case "moveEnergyFromBenchToActive": {
          const [maxCount] = effect.a;
          const active = me.active;
          if (active == null) break;
          let moved = 0;
          while (moved < maxCount) {
            const labels = [];
            const refs = [];
            for (const b of me.bench) {
              for (const c of b.attachedEnergy) {
                const prefix = c.attachOnlyPrefix;
                if (prefix != null && !active.data.name.startsWith(prefix)) continue;
                labels.push(`${b.name}の${c.name}`);
                refs.push([b, c]);
              }
            }
            if (refs.length === 0) break;
            const i = await this.ask(p, "card", `バトルポケモンにつけ替えるエネルギー（${moved + 1}/${maxCount}個）`, labels, true);
            if (i == null) break;
            const [src, card] = refs[i];
            this.removeCard(src.attachedEnergy, card.id);
            active.attachedEnergy.push(card);
            this.note(`${src.name}の${card.name}を${active.name}につけ替えた`);
            moved += 1;
          }
          break;
        }
        case "drawCards": {
          const [n] = effect.a;
          const drawn = this.draw(p, n);
          this.note(`山札を${drawn}枚引いた`);
          break;
        }
        case "lookTopCardsTakeAny": {
          const [look, take, restDiscard] = effect.a;
          const top = this.takeDeckTop(p, look);
          // 「2枚選び」のように、ちょうどの枚数を選ぶカード（残りをトラッシュするもの）と、「3枚まで」のカードがある
          let picked = [];
          if (restDiscard) {
            picked = await this.pickCardsExactly(p, top, take, "手札に加えるカード");
          } else {
            picked = await this.pickCards(p, top, take, "手札に加えるカード");
          }
          for (const c of picked) {
            this.removeCard(top, c.id);
            me.hand.push(c);
            this.note(`「${c.name}」を手札に加えた`);
          }
          if (restDiscard) {
            for (const c of top) me.discard.push(c);
            this.note(`残りの${top.length}枚をトラッシュした`);
          } else {
            for (const c of top) me.deck.push(c);
            this.shuffleDeck(p);
          }
          break;
        }
        case "lookTopCardsTakePokemonAndTrainer": {
          const [look] = effect.a;
          const top = this.takeDeckTop(p, look);
          const pokemonCands = [];
          for (const c of top) if (c.isPokemon) pokemonCands.push(c);
          const a = await this.pickCards(p, pokemonCands, 1, "手札に加えるポケモン");
          for (const c of a) { this.removeCard(top, c.id); me.hand.push(c); this.note(`「${c.name}」を手札に加えた`); }
          const trainerCands = [];
          for (const c of top) if (this.matches(c, { c: "anyTrainer", a: [] })) trainerCands.push(c);
          const b = await this.pickCards(p, trainerCands, 1, "手札に加えるトレーナーズ");
          for (const c of b) { this.removeCard(top, c.id); me.hand.push(c); this.note(`「${c.name}」を手札に加えた`); }
          for (const c of top) me.deck.push(c);
          this.shuffleDeck(p);
          break;
        }
        case "opponentDiscardHandDownTo": {
          const [n] = effect.a;
          await this.discardHandDownTo(oppIndex, n);
          break;
        }
        case "bothPutHandOnDeckBottomThenFlipDraw": {
          const [heads, tails] = effect.a;
          for (const side of [p, oppIndex]) {
            const h = this.players[side].hand.slice();
            this.shuffleArray(h);
            for (const c of h) this.players[side].deck.push(c);
            this.players[side].hand.length = 0;
          }
          this.note("おたがいに手札を山札の下にもどした");
          for (const side of [p, oppIndex]) {
            const n = this.flipCoin() ? heads : tails;
            const drawn = this.draw(side, n);
            this.note(`プレイヤー${side + 1}は山札を${drawn}枚引いた`);
          }
          break;
        }
        case "returnPokemonFromHandToDeckThenSearchSameCount": {
          const [maxCount] = effect.a;
          const cands = [];
          for (const c of me.hand) if (c.isPokemon) cands.push(c);
          const returned = await this.pickCards(p, cands, maxCount, "山札にもどすポケモン");
          for (const c of returned) {
            this.removeCard(me.hand, c.id);
            me.deck.push(c);
            this.note(`手札の「${c.name}」を山札にもどした`);
          }
          if (returned.length > 0) {
            const deckCands = [];
            for (const c of me.deck) if (c.isPokemon) deckCands.push(c);
            const got = await this.pickCards(p, deckCands, returned.length, "手札に加えるポケモン");
            for (const c of got) { this.removeCard(me.deck, c.id); me.hand.push(c); this.note(`「${c.name}」を手札に加えた`); }
          }
          this.shuffleDeck(p);
          break;
        }
        case "chooseSwitchOwnActiveOrBoostVsExThisTurn": {
          const [amount] = effect.a;
          const labels = [];
          let canSwitch = false;
          if (me.active != null && me.bench.length > 0) { canSwitch = true; labels.push("バトルポケモンをベンチポケモンと入れ替える"); }
          labels.push(`この番、ポケモンex・Vへのワザのダメージ+${amount}`);
          let i = await this.ask(p, "other", "使う効果を選んでください", labels);
          if (i == null) i = 0;
          if (canSwitch && i === 0) {
            await this.switchActive(p, p);
          } else {
            me.exDamageBonusThisTurn += amount;
            this.note(`この番、自分のポケモンのワザの、相手のバトル場の「ポケモンex・V」へのダメージが${amount}増える`);
          }
          break;
        }
        case "evolveOneFromDeckWithoutAbility": {
          const options = this.evolutionFromDeckOptions(p);
          if (options.length > 0) {
            const names = [];
            const cards = [];
            for (const o of options) {
              if (!cards.some((c) => c.id === o.card.id)) { names.push(o.card.name); cards.push(o.card); }
            }
            let ci = await this.ask(p, "card", "進化させるカードを選んでください", names, false, null, null, this.makeGallery(p, cards));
            if (ci == null) ci = 0;
            const card = cards[clampIdx(ci, cards.length)];
            const cands = [];
            for (const o of options) if (o.card.id === card.id) cands.push(o.slot);
            const slot = await this.chooseSlot(p, p, `${card.name}に進化させるポケモンを選んでください`, cands);
            const pk = slot != null ? this.pokemon(p, slot) : null;
            if (slot != null && pk != null) {
              this.removeCard(me.deck, card.id);
              const before = pk.name;
              pk.evolve(card, this.turnNumber, this.confusionLocked());
              this.refreshStadiumEffects();
              this.note(`${before}が${card.name}に進化した`);
            }
          }
          this.shuffleDeck(p);
          break;
        }
        case "discardHandThenDraw": {
          const [n] = effect.a;
          const c = me.hand.length;
          for (const x of me.hand) me.discard.push(x);
          me.hand.length = 0;
          const drawn = this.draw(p, n);
          this.note(`手札${c}枚をすべてトラッシュし、山札を${drawn}枚引いた`);
          break;
        }
        case "shuffleHandIntoDeckThenDrawIfOpponentPrizesAtMost": {
          const [base, bonus, prizes] = effect.a;
          for (const c of me.hand) me.deck.push(c);
          me.hand.length = 0;
          this.shuffleDeck(p);
          const n = opp.prizes.length <= prizes ? bonus : base;
          const drawn = this.draw(p, n);
          this.note(`手札を山札にもどして切り、山札を${drawn}枚引いた`);
          break;
        }
        case "shuffleHandIntoDeckThenFlipDraw": {
          const [heads, tails] = effect.a;
          for (const c of me.hand) me.deck.push(c);
          me.hand.length = 0;
          this.shuffleDeck(p);
          const n = this.flipCoin() ? heads : tails;
          const drawn = this.draw(p, n);
          this.note(`手札を山札にもどして切り、山札を${drawn}枚引いた`);
          break;
        }
        case "putTwoHandCardsOnDeckBottomThenDraw": {
          const [n] = effect.a;
          const picked = await this.pickCardsExactly(p, me.hand, 2, "山札の下にもどす手札");
          for (const c of picked) this.removeCard(me.hand, c.id);
          const ordered = await this.orderCards(p, picked, "山札の下にもどす順番");
          for (const c of ordered) me.deck.push(c);
          this.note("手札2枚を山札の下にもどした");
          const drawn = this.draw(p, n);
          this.note(`山札を${drawn}枚引いた`);
          break;
        }
        case "extraPrizeWhenTerastalKnocksOutThisTurn": {
          const [n] = effect.a;
          me.extraPrizeTeraTurn = this.turnNumber;
          me.extraPrizeTeraCount = n;
          this.note(`この番、自分の「テラスタル」のワザのダメージで相手のバトルポケモンがきぜつしたなら、サイドを${n}枚多くとる`);
          break;
        }
        case "drawPerOpponentBenchedPokemon": {
          const drawn = this.draw(p, opp.bench.length);
          this.note(`相手のベンチポケモン${opp.bench.length}匹ぶん、山札を${drawn}枚引いた`);
          break;
        }
        case "reduceDamageTakenByAllYourPokemonNextOpponentTurn": {
          const [n] = effect.a;
          me.damageReductions.push({ type: "colorless", amount: n, untilTurn: this.turnNumber + 1, allTypes: true });
          this.note(`次の相手の番、自分のポケモン全員が受けるワザのダメージが${n}減る`);
          break;
        }
        case "switchOpponentBenchedBasicToActiveThenConfuse": {
          const a0 = opp.active;
          if (a0 != null && this.shieldedByTrainer(a0, t)) {
            this.note(`${a0.name}の特性で、効果を受けない`);
          } else {
            const before = opp.active;
            await this.switchActive(oppIndex, p, null, null, true, t);
            const now = opp.active;
            if (now != null && now !== before) this.inflict("confused", now);
          }
          break;
        }
        default:
          break;
      }
    },

    // MARK: - ポケモンのどうぐ・特殊エネルギーの補助
    /// ポケモンについている特殊エネルギーの効果の一覧
    attachedEnergyEffects(pk) {
      const list = [];
      for (const c of pk.attachedEnergy) {
        const t = c.trainerData;
        if (t == null || t.trainerKind !== "specialEnergy") continue;
        for (const e of t.effects) list.push(e);
      }
      return list;
    },

    /// 「きのみ」：相手の指定タイプのポケモンのワザを受けるとき、ダメージが減る量（トラッシュはワザの処理のあとに行う）
    berryReduction(defender, attackerType) {
      let total = 0;
      for (const toolCard of this.toolCards(defender)) {
        const t = toolCard != null ? toolCard.trainerData : null;
        if (t == null) continue;
        for (const e of t.effects) {
          if (e.c === "toolBerry") {
            const [ty, n] = e.a;
            if (ty === attackerType) total += n;
          }
        }
      }
      return total;
    },

    /// 「きのみ」をトラッシュする（ダメージを受けたあと）
    discardBerries(defender, owner, attackerType) {
      const side = this.players[owner];
      const isBerry = (d) => d.effects.some((e) => e.c === "toolBerry" && e.a[0] === attackerType);
      {
        const t = defender.tool;
        const d = t != null ? t.trainerData : null;
        if (t != null && d != null && isBerry(d)) {
          defender.tool = null;
          side.discard.push(t);
          this.note(`${defender.name}の「${t.name}」をトラッシュした`);
        }
      }
      {
        const t = defender.extraTool;
        const d = t != null ? t.trainerData : null;
        if (t != null && d != null && isBerry(d)) {
          defender.extraTool = null;
          side.discard.push(t);
          this.note(`${defender.name}の「${t.name}」をトラッシュした`);
        }
      }
    },

    /// 「デラックスボム」：バトル場でワザのダメージを受けたとき、使ったポケモンにダメカンをのせてトラッシュ。「スパイクエネルギー」も同じく、ダメカンをのせる
    applySD100RetaliationItems(defenderOwner, defender, attacker) {
      if (this.players[defenderOwner].active !== defender) return;
      const side = this.players[defenderOwner];
      for (const toolCard of this.toolCards(defender)) {
        const tool = toolCard;
        const t = tool != null ? tool.trainerData : null;
        if (tool == null || t == null) continue;
        for (const e of t.effects) {
          if (e.c === "toolCountersOnAttackerWhenDamagedInActiveThenDiscard") {
            const [counters] = e.a;
            attacker.damage += counters * 10;
            this.note(`「${t.name}」の効果で${attacker.name}にダメカンを${counters}個のせた`);
            if (defender.tool != null && defender.tool.id === tool.id) defender.tool = null;
            if (defender.extraTool != null && defender.extraTool.id === tool.id) defender.extraTool = null;
            side.discard.push(tool);
            this.note(`${defender.name}の「${t.name}」をトラッシュした`);
          }
        }
      }
      for (const e of this.attachedEnergyEffects(defender)) {
        if (e.c === "energyCountersOnAttackerWhenDamaged") {
          const [counters] = e.a;
          attacker.damage += counters * 10;
          this.note(`スパイクエネルギーの効果で${attacker.name}にダメカンを${counters}個のせた`);
        }
      }
    },

    /// 「力の砂時計」: 自分の番の終わりに、バトル場のポケモンにトラッシュから基本エネルギーをつけてよい
    async applyEndOfTurnTools(p) {
      const me = this.players[p];
      const active = me.active;
      if (active == null) return;
      let has = false;
      for (const toolCard of this.toolCards(active)) {
        const t = toolCard != null ? toolCard.trainerData : null;
        if (t == null) continue;
        if (t.effects.some((e) => e.c === "toolAttachBasicEnergyFromDiscardAtEndOfYourTurnIfActive")) has = true;
      }
      if (!has) return;
      const cands = [];
      for (const c of me.discard) if (c.isEnergy) cands.push(c);
      if (cands.length === 0) return;
      if (!(await this.askYesNo(p, `「力の砂時計」で、トラッシュから基本エネルギーを${active.name}につけますか？`))) return;
      const picked = await this.pickCards(p, cands, 1, "つける基本エネルギー");
      for (const c of picked) {
        this.removeCard(me.discard, c.id);
        active.attachedEnergy.push(c);
        this.note(`トラッシュの${c.name}を${active.name}につけた`);
      }
    },

    /// 古びたはねの化石をトラッシュする（場に出ているとき、自分の番の中なら）
    discardFossilInPlay(p, pk) {
      const side = this.players[p];
      for (const c of pk.cards) side.discard.push(c);
      for (const c of pk.attachedEnergy) side.discard.push(c);
      if (pk.tool != null) side.discard.push(pk.tool);
      if (pk.extraTool != null) side.discard.push(pk.extraTool);
      this.note(`${pk.name}をトラッシュした`);
      if (side.active === pk) side.active = null;
      for (let i = side.bench.length - 1; i >= 0; i--) if (side.bench[i] === pk) side.bench.splice(i, 1);
      this.refreshStadiumEffects();
    },

  });

  if (typeof module !== "undefined") module.exports = G;
})(globalThis.PK = globalThis.PK || {});
// BattleAI.swift / StrongCPUAgent.swift / CPUDecks.swift の移植（CPU・試験用デッキ・自動対戦・CPUデッキ生成）
(function (G) {
  "use strict";

  const INT_MIN = -Infinity;   // Swift の Int.min の代わり（比較にだけ使う）

  // ---------- カード一覧（Swift の allBattlePokemonCards / allBattleTrainerCards 相当） ----------
  // cards_rt.json のカードIDの昇順（= 弾の順・番号順）。カードの読み込み後に最初に使うときに作る
  let _allPokemon = null, _allTrainer = null;
  function allPokemonCards() {
    if (_allPokemon === null) {
      _allPokemon = G.allCardIds().sort((a, b) => a - b).map(id => G.catalogPokemon(id)).filter(c => c != null);
    }
    return _allPokemon;
  }
  function allTrainerCards() {
    if (_allTrainer === null) {
      _allTrainer = G.allCardIds().sort((a, b) => a - b).map(id => G.catalogTrainer(id)).filter(c => c != null);
    }
    return _allTrainer;
  }
  // カードを読み直したとき（G.loadCards の後）に呼ぶと、CPUが持つ表を作り直す
  G.resetAICaches = function () {
    _allPokemon = null; _allTrainer = null; _valueByName = null; _pool = null; _monByName = null;
    _evolvedFromNames = null; _allLines = null;
  };

  // =====================================================================
  // MARK: - 簡単なCPUプレイヤー（SimpleCPUAgent）
  // ねらい: 対戦エンジンが最後まで動くかの確認用。強さは二の次で、「やれることを一通りやって、最後にワザを使う」だけ。
  // =====================================================================
  class SimpleCPUAgent {

    async chooseAction(game, player, actions) {
      let canAttack = false;
      for (const a of actions) {
        if (a.t === "attack") canAttack = true;
      }
      let bestIndex = actions.length - 1;
      let bestScore = INT_MIN;
      for (let i = 0; i < actions.length; i++) {
        const s = this.score(actions[i], game, player, canAttack) * 10 + game.randInt(10);
        if (s > bestScore) {
          bestScore = s;
          bestIndex = i;
        }
      }
      return bestIndex;
    }

    // 点数が高いものから実行する。ワザは「ターンが終わる行動」なので、準備の行動より低くしてある
    score(action, game, player, canAttack) {
      const me = game.players[player];
      switch (action.t) {
        case "evolve":
          return 80;
        case "playBasic":
          return me.bench.length < 3 ? 70 : 45;
        case "playTrainer": {
          const handIndex = action.handIndex;
          const t = handIndex < me.hand.length ? me.hand[handIndex].trainerData : null;
          if (t == null) return 0;
          switch (t.trainerKind) {
            case "supporter": return 58;
            case "item": return 48;
            case "stadium": return 38;
            case "tool": return 31;
            case "specialEnergy": return 30;
          }
          return 0;
        }
        case "attachEnergy":
          if (action.target.k === "a") return 55;
          return 50;
        case "attachTool":
          return 31;
        case "useAbility": {
          const pk = game.pokemon(player, action.target);
          if (pk != null && pk.data.isFossil === true) return -20;   // 化石のトラッシュは、CPUは使わない
          const ab = pk != null ? pk.ability : null;
          const trigger = ab != null ? ab.trigger : null;
          if (trigger === "anyNumberOfTimesDuringYourTurn") return -20;   // 何度でも使える特性は、CPUは使わない（無限ループ防止）
          return 42;
        }
        case "useStadium":
          return 40;
        case "retreat":
          return canAttack ? -1 : 5;
        case "attack": {
          const index = action.index;
          const active = me.active;
          if (active == null || !(index < active.data.attacks.length)) return 0;
          const attack = active.data.attacks[index];
          return 10 + Math.min(Math.floor(attack.damage / 10), 20);
        }
        case "endTurn":
          return 0;
      }
      return 0;
    }

    async choose(game, player, request) {
      switch (request.kind) {
        case "goFirst": case "yesNo": case "setupActive": case "setupBench": case "card":
          return 0;
        default:
          return game.randInt(request.options.length);
      }
    }
  }
  G.SimpleCPUAgent = SimpleCPUAgent;

  // =====================================================================
  // MARK: - 試験用のデッキ（どちらも60枚）
  // =====================================================================
  G.PresetDecks = {
    /** 闘タイプ（メガルカリオex） */
    fighting: {
      cards: [
        { cardNumber: 28, count: 4 },  // リオル
        { cardNumber: 29, count: 3 },  // メガルカリオex
        { cardNumber: 24, count: 3 },  // マクノシタ
        { cardNumber: 25, count: 2 },  // ハリテヤマ
        { cardNumber: 26, count: 2 },  // ルナトーン
        { cardNumber: 27, count: 2 },  // ソルロック
        { cardNumber: 20, count: 2 },  // サンド
        { cardNumber: 21, count: 2 },  // サンドパン
        { cardNumber: 59, count: 4 },  // ファイトゴング
        { cardNumber: 58, count: 3 },  // パワープロテイン
        { cardNumber: 62, count: 3 },  // リーリエの決心
        { cardNumber: 61, count: 2 },  // マチスの取引
        { cardNumber: 83, count: 2 }   // 夜のタンカ
      ],
      energy: [{ type: "fighting", count: 26 }],
      arts: {}
    },

    /** 悪タイプ（メガアブソルex） */
    darkness: {
      cards: [
        { cardNumber: 41, count: 4 },  // クスネ
        { cardNumber: 42, count: 3 },  // フォクスライ
        { cardNumber: 38, count: 3 },  // メガアブソルex
        { cardNumber: 43, count: 3 },  // シルシュルー
        { cardNumber: 44, count: 3 },  // タギングル
        { cardNumber: 39, count: 2 },  // ミカルゲ
        { cardNumber: 40, count: 2 },  // イベルタル
        { cardNumber: 62, count: 3 },  // リーリエの決心
        { cardNumber: 61, count: 2 },  // マチスの取引
        { cardNumber: 60, count: 3 },  // むしよけスプレー
        { cardNumber: 63, count: 2 },  // 危ない廃墟
        { cardNumber: 84, count: 2 },  // ふうせん
        { cardNumber: 83, count: 2 }   // 夜のタンカ
      ],
      energy: [{ type: "darkness", count: 26 }],
      arts: {}
    }
  };

  // =====================================================================
  // MARK: - 強化版CPU（StrongCPUAgent）
  // SimpleCPUAgent との違い:
  //  ・ワザは「相手を倒せるか」「ダメージ（弱点込み）」で選ぶ
  //  ・エネルギーは「それでワザが打てるようになるポケモン」へつける（打てないポケモンに無駄づけしない）
  //  ・バトルポケモンがワザを打てないときは、打てるベンチポケモンとにげて入れ替える
  //  ・カードの効果（ふしぎなアメ・いれかえ・ダメージ増加など）は、役に立つときだけ使う
  //  ・きぜつ後に出すポケモン、相手のポケモンを選ぶ場面、カードを選ぶ場面も、状況を見て選ぶ
  // =====================================================================

  // MARK: カードの名前から価値を引くための表（探す・捨てるカードの選択に使う）
  let _valueByName = null;
  function valueByName() {
    if (_valueByName === null) {
      const d = new Map();
      for (const p of allPokemonCards()) {
        if (d.has(p.name)) continue;
        let v = 40 + p.prizeValue * 18 + Math.floor(p.hp / 10);
        if (p.stage === "stage2") v += 8;
        if (p.stage === "basic") v += 4;
        d.set(p.name, v);
      }
      for (const t of allTrainerCards()) {
        if (d.has(t.name)) continue;
        switch (t.trainerKind) {
          case "supporter": d.set(t.name, 46); break;
          case "item": d.set(t.name, 36); break;
          case "stadium": d.set(t.name, 26); break;
          case "tool": d.set(t.name, 26); break;
          case "specialEnergy": d.set(t.name, 30); break;
        }
      }
      _valueByName = d;
    }
    return _valueByName;
  }

  class StrongCPUAgent {

    valueOfLabel(label) {
      const table = valueByName();
      if (table.has(label)) return table.get(label);
      if (label.includes("エネルギー")) return 30;
      let best = 20;
      for (const [name, v] of table) { if (label.includes(name)) best = Math.max(best, v); }
      return best;
    }

    // MARK: ポケモンの状態を調べる道具
    canAttackNow(game, pk) {
      if (pk.conditions.has("asleep") || pk.conditions.has("paralyzed")) return false;
      for (const a of pk.data.attacks) { if (game.canUseAttack(pk, a)) return true; }
      return false;
    }

    maxCost(pk) {
      let m = 0;
      for (const a of pk.data.attacks) m = Math.max(m, a.cost.length);
      return m;
    }

    /** そのワザで相手のバトルポケモンに与えるダメージの見込み（弱点・抵抗力・各種の効果こみ） */
    estimatedDamage(game, player, attacker, attack) {
      const defender = game.players[1 - player].active;
      if (defender == null) return 0;
      if (attack.damage === 0) return 0;
      return game.finalDamage(attack.damage, player, attacker, defender, 1 - player, false, false);
    }

    /** ワザの価値（倒せるなら大きく、そうでなければダメージ） */
    attackValue(game, player, attacker, attack) {
      const dmg = this.estimatedDamage(game, player, attacker, attack);
      const defender = game.players[1 - player].active;
      if (defender == null) return dmg;
      let v = dmg;
      if (dmg >= defender.remainingHP) {
        v += 1000 + defender.data.prizeValue * 300;
        const prizesLeft = game.players[player].prizes.length;
        if (defender.data.prizeValue >= prizesLeft) v += 100000;   // これで勝てる
      } else if (dmg === 0) {
        v = 12;   // ダメージ以外の効果をねらうワザ
      }
      return v;
    }

    /** そのポケモンが今すぐ出せる最大のワザの価値（打てなければ null）。{index, value} */
    bestAttack(game, player, pk) {
      if (pk.conditions.has("asleep") || pk.conditions.has("paralyzed")) return null;
      let best = null;
      const attacks = pk.data.attacks;
      for (let i = 0; i < attacks.length; i++) {
        const a = attacks[i];
        if (!game.canUseAttack(pk, a)) continue;
        const v = this.attackValue(game, player, pk, a);
        if (best == null || v > best.value) best = { index: i, value: v };
      }
      return best;
    }

    // MARK: 自分の番の行動
    async chooseAction(game, player, actions) {
      const activeCanAttack = (() => {
        const a = game.players[player].active;
        if (a != null) return this.canAttackNow(game, a);
        return false;
      })();
      let bestIndex = actions.length - 1;
      let bestScore = INT_MIN;
      for (let i = 0; i < actions.length; i++) {
        const s = this.score(actions[i], game, player, activeCanAttack) * 10 + game.randInt(10);
        if (s > bestScore) {
          bestScore = s;
          bestIndex = i;
        }
      }
      return bestIndex;
    }

    score(action, game, player, activeCanAttack) {
      const me = game.players[player];
      switch (action.t) {
        case "evolve":
          if (action.target.k === "a") return 90;
          return 84;

        case "playBasic":
          if (me.bench.length < 3) return 76;
          if (me.bench.length < 4) return 60;
          return 36;

        case "playTrainer": {
          const handIndex = action.handIndex;
          const t = handIndex < me.hand.length ? me.hand[handIndex].trainerData : null;
          if (t == null) return 0;
          return this.trainerScore(t, game, player, activeCanAttack);
        }

        case "attachEnergy":
          return this.attachScore(game, player, action.handIndex, action.target);

        case "attachTool":
          if (action.target.k === "a") return 36;
          return 33;

        case "useAbility": {
          const pk = game.pokemon(player, action.target);
          if (pk != null && pk.data.isFossil === true) return -20;   // 化石のトラッシュは使わない
          const ab = pk != null ? pk.ability : null;
          const trigger = ab != null ? ab.trigger : null;
          if (trigger === "anyNumberOfTimesDuringYourTurn") return -20;   // 何度でも使える特性は、無限ループ防止のため使わない
          return 62;
        }

        case "useStadium":
          return 40;

        case "retreat":
          return this.retreatScore(game, player, action.benchIndex, activeCanAttack);

        case "attack": {
          const index = action.index;
          const active = me.active;
          if (active == null || !(index < active.data.attacks.length)) return 0;
          const v = this.attackValue(game, player, active, active.data.attacks[index]);
          // ワザは「ターンが終わる行動」なので、準備の行動（30点以上）よりは低くする。その中で強いワザほど高く
          if (v >= 100000) return 29;
          if (v >= 1000) return 28;
          return 10 + Math.min(Math.floor(v / 10), 17);
        }

        case "endTurn":
          return 0;
      }
      return 0;
    }

    // MARK: エネルギーをどこにつけるか
    attachScore(game, player, handIndex, target) {
      const me = game.players[player];
      const pk = game.pokemon(player, target);
      if (!(handIndex < me.hand.length) || pk == null) return 0;
      const card = me.hand[handIndex];
      const doubled = game.doubledEnergyType(player);
      const evolved = pk.data.stage !== "basic";
      const after = pk.attachedEnergy.concat([card]);
      let newlyEnabled = false;
      let typeUseful = false;
      for (const a of pk.data.attacks) {
        const cost = game.effectiveCost(pk, a);
        const before = game.canPayCost(cost, pk.attachedEnergy, doubled, evolved);
        const now = game.canPayCost(cost, after, doubled, evolved);
        if (!before && now) newlyEnabled = true;
        const t = card.energyType;
        if (t != null && cost.includes(t)) typeUseful = true;
      }
      const isActive = target.k === "a";
      const saturated = pk.attachedEnergy.length >= this.maxCost(pk);
      // 今ワザが打てないバトルポケモンがいて、ベンチのほうが先に打てそうなら、ベンチを優先しない（まず今の番に打てるようにする）
      if (newlyEnabled) return isActive ? 98 : 70;
      if (saturated) return isActive ? 8 : 6;
      if (typeUseful) return isActive ? 58 : 54;
      return isActive ? 14 : 12;
    }

    // MARK: にげる
    retreatScore(game, player, benchIndex, activeCanAttack) {
      const me = game.players[player];
      if (!(benchIndex < me.bench.length)) return -1;
      if (activeCanAttack) return -5;
      const target = me.bench[benchIndex];
      const b = this.bestAttack(game, player, target);
      if (b != null) {
        return 78 + Math.min(Math.floor(b.value / 100), 8);
      }
      return -1;
    }

    // MARK: トレーナーズ（グッズ・サポート・スタジアム）
    trainerScore(t, game, player, activeCanAttack) {
      const me = game.players[player];
      const opp = game.players[1 - player];
      const benchCanAttack = me.bench.some(b => this.canAttackNow(game, b));
      for (const e of t.effects) {
        switch (e.c) {
          case "rareCandy":
            return 92;
          case "switchOwnActiveWithBench":
            if (activeCanAttack) return 4;
            return benchCanAttack ? 80 : 6;
          case "switchOpponentActiveWithBench":
            return 10;
          case "boostAttackDamageThisTurn": {
            const type = e.a[0];
            if (activeCanAttack && me.active != null && me.active.data.type === type) return 55;
            return 5;
          }
          case "boostAttackDamageVsExThisTurn": {
            const d = opp.active;
            if (activeCanAttack && d != null && (d.data.prizeValue > 1 || d.name.endsWith("ex"))) return 56;
            return 6;
          }
          case "healActiveIfEnergyAtLeast":
            if (me.active != null && me.active.damage >= 60) return 56;
            return 4;
          case "discardTwoHandCardsRequired":
            return me.hand.length >= 5 ? 52 : 6;
          case "shuffleHandIntoDeckThenDraw":
            return me.hand.length >= 8 ? 40 : 64;
          default:
            break;
        }
      }
      switch (t.trainerKind) {
        case "supporter": return 62;
        case "item": return 48;
        case "stadium": return 38;
        case "tool": return 31;
        case "specialEnergy": return 30;
      }
      return 0;
    }

    // MARK: 途中の選択（きぜつ後・対象選び・カード選びなど）
    async choose(game, player, request) {
      const n = request.options.length;
      if (n === 0) return null;
      switch (request.kind) {
        case "goFirst":
          return 0;

        case "setupActive": {
          // バトル場に出す: HPが高く、ポケモンexではない（きぜつで2枚取られない）、ワザが軽いたねを選ぶ
          let best = 0;
          let bestScore = INT_MIN;
          for (let i = 0; i < request.options.length; i++) {
            const label = request.options[i];
            const p = allPokemonCards().find(c => c.name === label);
            if (p == null) continue;
            let cheapest = 9;
            for (const a of p.attacks) cheapest = Math.min(cheapest, a.cost.length);
            const s = Math.floor(p.hp / 10) - (p.prizeValue - 1) * 12 - cheapest * 3;
            if (s > bestScore) { bestScore = s; best = i; }
          }
          return best;
        }

        case "setupBench":
          return 0;

        case "promoteActive": {
          const slots = request.targetSlots;
          if (slots == null) return 0;
          let best = 0;
          let bestScore = INT_MIN;
          for (let i = 0; i < slots.length; i++) {
            const pk = game.pokemon(player, slots[i]);
            if (pk == null) continue;
            let s = pk.attachedEnergy.length * 6 + Math.floor(pk.remainingHP / 10) - (pk.data.prizeValue - 1) * 4;
            const b = this.bestAttack(game, player, pk);
            if (b != null) s += 100 + Math.floor(Math.min(b.value, 2000) / 10);
            if (s > bestScore) { bestScore = s; best = i; }
          }
          return best;
        }

        case "target":
          return this.chooseTarget(game, player, request);

        case "card":
          return this.chooseCard(request);

        case "yesNo":
          return 0;

        default:
          return game.randInt(n);
      }
    }

    chooseTarget(game, player, request) {
      const n = request.options.length;
      const slots = request.targetSlots;
      const owner = request.targetOwner;
      if (slots == null || owner == null || slots.length !== n) return 0;
      let best = 0;
      let bestScore = INT_MIN;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const pk = game.pokemon(owner, slot);
        if (pk == null) continue;
        let s = 0;
        if (owner !== player) {
          // 相手のポケモン: 倒せそうなもの・サイドを多く取れるものを優先
          s = (200 - Math.min(pk.remainingHP, 200)) + (pk.data.prizeValue - 1) * 60;
        } else if (request.prompt.includes("回復") || request.prompt.includes("ダメカン")) {
          s = pk.damage;
        } else {
          // 自分のポケモン: エネルギーが足りないものを優先（バトル場を少し優先）
          const deficiency = Math.max(0, this.maxCost(pk) - pk.attachedEnergy.length);
          s = deficiency > 0 ? 50 - deficiency : 0;
          if (slot.k === "a") s += 10;
        }
        if (s > bestScore) { bestScore = s; best = i; }
      }
      return best;
    }

    chooseCard(request) {
      const n = request.options.length;
      const prompt = request.prompt;
      const discardOwn = (prompt.includes("トラッシュ") || prompt.includes("すて")) && !prompt.includes("相手");
      let best = 0;
      let bestScore = discardOwn ? Infinity : INT_MIN;
      for (let i = 0; i < request.options.length; i++) {
        const v = this.valueOfLabel(request.options[i]);
        if (discardOwn) {
          if (v < bestScore) { bestScore = v; best = i; }      // 自分の捨てるカードは、いちばん価値の低いもの
        } else {
          if (v > bestScore) { bestScore = v; best = i; }      // 探す・相手から取るカードは、いちばん価値の高いもの
        }
      }
      if (best >= n) return 0;
      return best;
    }
  }
  G.StrongCPUAgent = StrongCPUAgent;

  // =====================================================================
  // MARK: - CPU同士の自動対戦（BattleSimulation）
  // =====================================================================
  G.BattleSimulation = {

    /** プレイヤー1が使うデッキ。useSavedDeck が true で保存済みのデッキがあれば、それを使う */
    player1Deck: function (useSavedDeck) {
      if (useSavedDeck) {
        const saved = loadSavedDeck();
        if (saved != null) return saved;
      }
      return G.PresetDecks.fighting;
    },

    makeGame: function (useSavedDeck, seed) {
      const deck0 = G.DeckList.makeBattleCards(G.BattleSimulation.player1Deck(!!useSavedDeck), 0, !!useSavedDeck);
      const deck1 = G.DeckList.makeBattleCards(G.PresetDecks.darkness, 1000, false);
      const agents = [new SimpleCPUAgent(), new StrongCPUAgent()];   // 1: 簡単なCPU / 2: 強化版CPU
      return new G.BattleGame(deck0, deck1, agents, null, seed);
    },

    resultText: function (result) {
      if (result.draw) return "引き分け";
      return "プレイヤー" + (result.win + 1) + "の勝ち";
    },

    deckProblems: function (useSavedDeck) {
      useSavedDeck = !!useSavedDeck;
      const problems = [];
      if (useSavedDeck && loadSavedDeck() == null) {
        return ["保存されたデッキがありません。「デッキ」タブでデッキを組んでください"];
      }
      const label = useSavedDeck ? "あなたのデッキ" : "闘デッキ";
      for (const message of G.DeckList.validate(G.BattleSimulation.player1Deck(useSavedDeck))) problems.push(label + ": " + message);
      for (const message of G.DeckList.validate(G.PresetDecks.darkness)) problems.push("悪デッキ: " + message);
      return problems;
    },

    /** 1戦して、結果とログを返す */
    playOneGame: async function (useSavedDeck, seed) {
      useSavedDeck = !!useSavedDeck;
      const problems = G.BattleSimulation.deckProblems(useSavedDeck);
      if (problems.length > 0) {
        return { summary: "デッキに問題があります", log: problems };
      }
      const game = G.BattleSimulation.makeGame(useSavedDeck, seed);
      const result = await game.run();
      return { summary: "結果: " + G.BattleSimulation.resultText(result) + "（" + game.turnNumber + "ターン）", log: game.logLines };
    },

    /** 何戦もして、勝敗と平均ターン数をまとめる */
    playMany: async function (count, useSavedDeck) {
      useSavedDeck = !!useSavedDeck;
      const problems = G.BattleSimulation.deckProblems(useSavedDeck);
      if (problems.length > 0) return problems.join("\n");
      const wins = [0, 0];
      let draws = 0;
      let totalTurns = 0;
      let i = 0;
      while (i < count) {
        i += 1;
        const game = G.BattleSimulation.makeGame(useSavedDeck);
        const result = await game.run();
        totalTurns += game.turnNumber;
        if (result.draw) draws += 1;
        else wins[result.win] += 1;
      }
      const average = count > 0 ? Math.trunc(totalTurns / count) : 0;
      return count + "戦: 闘デッキ・簡単CPU(プレイヤー1) " + wins[0] + "勝 / 悪デッキ・強化CPU(プレイヤー2) " + wins[1] + "勝 / 引き分け " + draws + "（平均 " + average + "ターン）";
    }
  };

  // DeckStore.loadDeckList() 相当。ページ側が G.DeckStore = { loadDeckList(){ ... DeckList or null } } を用意する
  function loadSavedDeck() {
    // TODO(port): Swift の DeckStore（保存済みデッキ）は別担当/ページ側。G.DeckStore.loadDeckList が無ければ「保存なし」として扱う
    if (G.DeckStore && typeof G.DeckStore.loadDeckList === "function") {
      const d = G.DeckStore.loadDeckList();
      return d == null ? null : d;
    }
    return null;
  }

  // =====================================================================
  // MARK: - CPUのデッキを自動で大量に作る（CPUDeckGenerator）
  // seed（整数）を決めると、同じseedなら必ず同じデッキができる（0, 1, 2, ... と何個でも作れる）。
  // 登録されている全カード（M1L・M1S・M2・M2a・SD100）から、進化ライン・トレーナーズ・エネルギーを選んで60枚にする。
  // 作ったデッキは validate() を通す。通らなかったときは、見つかった問題を捨てて次のseedで作り直す。
  // =====================================================================

  // MARK: 乱数（seedから同じ結果を出す）: SplitMix64。Swift の UInt64 の &* &+ と同じ結果になるよう BigInt で計算する
  const M64 = (1n << 64n) - 1n;
  const GOLDEN = 0x9E3779B97F4A7C15n;
  class Rng {
    constructor(seed) {
      this.state = BigInt.asUintN(64, BigInt.asUintN(64, BigInt(seed)) * GOLDEN + 0x1234567n);
    }
    next() {
      this.state = (this.state + GOLDEN) & M64;
      let z = this.state;
      z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & M64;
      z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & M64;
      return z ^ (z >> 31n);
    }
    int(n) { return n <= 0 ? 0 : Number(this.next() % BigInt(n)); }
    chance(percent) { return this.int(100) < percent; }
    shuffled(a) {
      const r = a.slice();
      let i = r.length - 1;
      while (i > 0) {
        const j = this.int(i + 1);
        const t = r[i]; r[i] = r[j]; r[j] = t;   // swapAt
        i -= 1;
      }
      return r;
    }
  }

  // MARK: 全ポケモン（レギュレーションで使えないものは除く。同名は最初の1種だけ）
  // Mon = { id: デッキで使うカードID, data: ポケモンのカードデータ }
  let _pool = null, _monByName = null, _evolvedFromNames = null, _allLines = null;

  function pool() {
    if (_pool === null) {
      const result = [];
      const seen = new Set();
      for (const d of allPokemonCards()) {
        const id = d.id;   // カードID = 弾オフセット + 番号
        if (G.BattleRegulation.isBanned(id)) continue;
        if (seen.has(d.name)) continue;
        seen.add(d.name);
        result.push({ id: id, data: d });
      }
      _pool = result;
    }
    return _pool;
  }

  function monByName() {
    if (_monByName === null) {
      const d = new Map();
      for (const m of pool()) d.set(m.data.name, m);
      _monByName = d;
    }
    return _monByName;
  }

  /** 「進化先がいる」たねポケモン・1進化の名前（進化しないたねと区別するため） */
  function evolvedFromNames() {
    if (_evolvedFromNames === null) {
      const s = new Set();
      for (const m of pool()) { if (m.data.evolvesFrom != null) s.add(m.data.evolvesFrom); }
      _evolvedFromNames = s;
    }
    return _evolvedFromNames;
  }

  // MARK: 進化ライン（たね → ... → いちばん上）
  // Line = { chain: [Mon]（chain[0] がたね）, top, isEx }
  function makeLine(chain) {
    const top = chain[chain.length - 1];
    return { chain: chain, top: top, isEx: top.data.prizeValue > 1 || top.data.name.endsWith("ex") };
  }

  function allLines() {
    if (_allLines === null) {
      const lines = [];
      for (const m of pool()) {
        const isEnd = !evolvedFromNames().has(m.data.name);
        if (!isEnd) continue;   // いちばん上の進化形だけを出発点にする
        const chain = [m];
        let cur = m;
        let ok = true;
        while (cur.data.evolvesFrom != null) {
          const prev = monByName().get(cur.data.evolvesFrom);
          if (prev == null) { ok = false; break; }
          chain.unshift(prev);
          cur = prev;
          if (chain.length > 3) { ok = false; break; }
        }
        if (!ok) continue;
        if (chain[0].data.stage !== "basic") continue;
        lines.push(makeLine(chain));
      }
      _allLines = lines;
    }
    return _allLines;
  }

  // MARK: トレーナーズの候補（使い勝手のよいものだけ。カードID）
  function pick(id, maxCount, only, needsEvolution, needsRareCandy) {
    return { id: id, maxCount: maxCount, only: only, needsEvolution: needsEvolution, needsRareCandy: needsRareCandy };
  }

  const trainerPicks = [
    // サポート
    pick(62, 4, null, false, false),    // リーリエの決心
    pick(3171, 3, null, false, false),  // サーファー
    pick(3168, 3, null, false, false),  // アイリスの闘志
    pick(3172, 3, null, true, false),   // トウコ
    pick(2077, 3, null, true, false),   // ヒカリ
    pick(3179, 2, null, false, false),  // ロケット団のラムダ
    pick(3220, 3, "fighting", false, false), // からておうの稽古
    pick(2078, 3, "fire", false, false),     // ひふきやろう
    // グッズ
    pick(1081, 4, null, false, false),  // なかよしポフィン
    pick(3216, 4, null, false, false),  // ハイパーボール
    pick(2102, 3, null, false, false),  // ポケモンいれかえ
    pick(83, 3, null, false, false),    // 夜のタンカ
    pick(3147, 2, null, false, false),  // エネルギーリサイクル
    pick(3150, 2, null, false, false),  // せいなるはい
    pick(2073, 2, null, false, false),  // ジャンボアイス
    pick(60, 2, null, false, false),    // むしよけスプレー
    pick(1082, 4, null, false, true),   // ふしぎなアメ
    pick(59, 4, "fighting", false, false), // ファイトゴング
    pick(58, 3, "fighting", false, false), // パワープロテイン
    // どうぐ
    pick(84, 2, null, false, false),    // ふうせん
    pick(3166, 2, null, false, false),  // ブレイブバングル
    pick(2075, 2, null, false, false),  // せいなるおまもり
    // スタジアム
    pick(1061, 2, "grass", false, false),     // 活力の森
    pick(1062, 2, "water", false, false),     // なみのりビーチ
    pick(1063, 2, "psychic", false, false),   // ミステリーガーデン
    pick(3183, 1, null, false, false)         // グラビティーマウンテン
  ];

  const mainTypes = ["grass", "fire", "water", "lightning", "psychic", "fighting", "darkness", "metal", "dragon"];

  function sumArr(a) { let s = 0; for (const x of a) s += x; return s; }
  function bump(obj, key, n) { obj[key] = (obj[key] || 0) + n; }   // Swift の d[key, default: 0] += n

  const CPUDeckGenerator = {

    // MARK: デッキを1つ作る
    /** 同じ seed なら同じデッキ。type を指定するとそのタイプ中心のデッキにする。作れなければ null */
    generate: function (seed, type) {
      if (type === undefined) type = null;
      const rng = new Rng(seed);
      const want = type != null ? type : mainTypes[rng.int(mainTypes.length)];

      // 1. このタイプの進化ライン（無色のラインは脇役として使える）
      const typed = allLines().filter(l => l.top.data.type === want);
      const neutral = allLines().filter(l => l.top.data.type === "colorless");
      if (typed.length === 0) return null;

      // 主力: ex・メガのラインを優先して1〜2本、残りは同タイプ中心に
      const mains = rng.shuffled(typed.filter(l => l.isEx));
      const others = rng.shuffled(typed.filter(l => !l.isEx));
      const order = [];
      const mainCount = Math.min(mains.length, 1 + rng.int(2));
      for (const l of mains.slice(0, mainCount)) order.push(l);
      let rest = mains.slice(mainCount).concat(others);
      rest = rng.shuffled(rest);
      for (const l of rest) order.push(l);
      for (const l of rng.shuffled(neutral).slice(0, 3)) order.push(l);

      // 2. 進化ラインを入れていく（ポケモンは合計 15〜20枚）
      const counts = {};          // カードID → 枚数
      const nameCount = {};
      const chosen = [];
      let total = 0;
      let basics = 0;
      const targetTotal = 15 + rng.int(6);

      const add = (m, n) => {
        const room = 4 - (nameCount[m.data.name] || 0);
        const k = Math.min(n, room);
        if (k <= 0) return 0;
        bump(counts, m.id, k);
        bump(nameCount, m.data.name, k);
        return k;
      };

      for (const line of order) {
        if (total >= targetTotal && basics >= 6) break;
        if (chosen.some(c => c.top.id === line.top.id)) continue;
        const len = line.chain.length;
        let plan;
        switch (len) {
          case 1: plan = line.isEx ? [2] : [3]; break;
          case 2: plan = line.isEx ? [3, 3] : [3, 2]; break;
          default: plan = line.isEx ? [3, 2, 2] : [3, 2, 2]; break;
        }
        if (total + sumArr(plan) > targetTotal + 3) continue;
        let added = 0;
        for (let i = 0; i < line.chain.length; i++) {
          const k = add(line.chain[i], plan[i]);
          added += k;
          if (i === 0) basics += k;
        }
        total += added;
        chosen.push(line);
      }
      if (chosen.length === 0) return null;
      // たねが少なすぎるときは、いちばん最初のラインのたねを足す
      if (basics < 6 && chosen.length > 0) {
        const first = chosen[0];
        const k = add(first.chain[0], 6 - basics);
        basics += k;
        total += k;
      }
      if (total < 10 || basics < 4) return null;

      // 3. エネルギーの種類: 選んだポケモンのワザのコストから決める
      const weight = new Map();   // TODO(port): Swift の Dictionary は反復順が不定。同点のときの順序は挿入順（Swift側は実行ごとに違い得る）
      let costSum = 0;
      let costN = 0;
      for (const line of chosen) {
        for (const m of line.chain) {
          const n = counts[m.id] || 0;
          if (n === 0) continue;
          for (const a of m.data.attacks) {
            for (const c of a.cost) { if (c !== "colorless") weight.set(c, (weight.get(c) || 0) + n); }
            costSum += a.cost.length * n;
            costN += n;
          }
        }
      }
      const avgCost = costN > 0 ? costSum / costN : 2;
      let energyTypes = Array.from(weight.entries()).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, v]);
      if (energyTypes.length === 0) energyTypes = [[want, 1]];
      const sumW = energyTypes.reduce((acc, x) => acc + x[1], 0);
      // 2種類まで。2種類目は全体の25%以上のときだけ
      const used = [energyTypes[0]];
      if (energyTypes.length > 1 && energyTypes[1][1] / sumW >= 0.25) used.push(energyTypes[1]);

      // 4. トレーナーズを入れる
      const hasEvolution = chosen.some(l => l.chain.length > 1);
      const hasRareCandyLine = chosen.some(l => l.chain.length === 3);
      let energyTotal = avgCost >= 3 ? 22 : (avgCost >= 2 ? 20 : 18);
      if (used.length > 1) energyTotal += 2;
      let trainerTarget = 60 - total - energyTotal;
      if (trainerTarget < 0) { trainerTarget = 0; energyTotal = 60 - total; }

      const trainerCounts = {};
      const trainerNameCount = {};
      let trainerTotal = 0;
      let candidates = trainerPicks.filter(p => {
        if (p.only != null && !used.some(u => u[0] === p.only)) return false;
        if (p.needsEvolution && !hasEvolution) return false;
        if (p.needsRareCandy && !hasRareCandyLine) return false;
        if (G.BattleRegulation.isBanned(p.id)) return false;
        return G.catalogTrainer(p.id) != null;
      });
      // リーリエの決心は最優先、そのほかはランダムな順
      const lillie = candidates.filter(p => p.id === 62);
      candidates = lillie.concat(rng.shuffled(candidates.filter(p => p.id !== 62)));
      for (const p of candidates) {
        if (trainerTotal >= trainerTarget) break;
        const t = G.catalogTrainer(p.id);
        if (t == null) continue;
        const room = 4 - (trainerNameCount[t.name] || 0);
        let n = Math.min(p.maxCount, room, trainerTarget - trainerTotal);
        if (p.id !== 62 && n > 1 && rng.chance(35)) n -= 1;   // 枚数に少しばらつきを出す
        if (n <= 0) continue;
        bump(trainerCounts, p.id, n);
        bump(trainerNameCount, t.name, n);
        trainerTotal += n;
      }
      // 足りない分はエネルギーで埋める
      energyTotal = 60 - total - trainerTotal;

      // 5. エネルギーを種類ごとに配る
      const energy = [];
      if (used.length === 1) {
        energy.push({ type: used[0][0], count: energyTotal });
      } else {
        const w0 = used[0][1];
        const w1 = used[1][1];
        let first = Math.round(energyTotal * w0 / (w0 + w1));
        first = Math.max(1, Math.min(energyTotal - 1, first));
        energy.push({ type: used[0][0], count: first });
        energy.push({ type: used[1][0], count: energyTotal - first });
      }

      // 6. デッキの形にまとめる
      const entries = [];
      for (const id of Object.keys(counts).map(Number).sort((a, b) => a - b)) entries.push({ cardNumber: id, count: counts[id] });
      for (const id of Object.keys(trainerCounts).map(Number).sort((a, b) => a - b)) entries.push({ cardNumber: id, count: trainerCounts[id] });
      const list = { cards: entries, energy: energy, arts: {} };
      if (G.DeckList.validate(list).length > 0) return null;

      const mainName = chosen[0].top.data.name;
      const typeLabel = used.length > 1 ? G.energyJapaneseName(used[0][0]) + G.energyJapaneseName(used[1][0]) : G.energyJapaneseName(used[0][0]);
      return { seed: seed, name: typeLabel + "デッキ（" + mainName + "）#" + seed, list: list };
    },

    /** seed から始めて、作れるまで順に試す（かならず1つ返す。万一ぜんぶ失敗したら悪の試験用デッキ） */
    make: function (seed, type) {
      if (type === undefined) type = null;
      let s = seed;
      let tries = 0;
      while (tries < 40) {
        const d = CPUDeckGenerator.generate(s, type);
        if (d != null) return d;
        s += 1000003;
        tries += 1;
      }
      return { seed: seed, name: "悪デッキ（メガアブソルex）", list: G.PresetDecks.darkness };
    },

    /** 毎回違うデッキ（時刻から seed を決める） */
    random: function (type) {
      if (type === undefined) type = null;
      return CPUDeckGenerator.make(Math.floor(Date.now()) % 100000000, type);
    },

    /** 動作確認用: seed 0..<count を作って、作れた数・失敗した数・タイプごとの数を文字列で返す */
    selfCheck: function (count) {
      let ok = 0;
      let failed = 0;
      const byType = {};
      const names = new Set();
      let i = 0;
      while (i < count) {
        const d = CPUDeckGenerator.generate(i);
        if (d != null) {
          ok += 1;
          names.add(d.name.split("#")[0]);
          const t = d.name.split("デッキ")[0];
          bump(byType, t, 1);
        } else {
          failed += 1;
        }
        i += 1;
      }
      const typeText = Object.keys(byType).sort().map(k => k + byType[k]).join(" ");
      return count + "個中 作成 " + ok + " / 失敗 " + failed + "（種類の違うデッキ " + names.size + "）\n" + typeText;
    }
  };
  G.CPUDeckGenerator = CPUDeckGenerator;

  if (typeof module !== "undefined") module.exports = G;
})(globalThis.PK = globalThis.PK || {});
