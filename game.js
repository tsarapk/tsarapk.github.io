/**
 * Блинчики: каждые n секунд автоматически +1 всем лицам (setInterval).
 * Клик — только переворот. Сбор — drag-and-drop. Сгорание/спавн с эффектами.
 */
const VALUE_MIN = 1;
const FLIP_ANIM_MS = 420;
const CRUMBLE_ANIM_MS = 650;
const SPAWN_ANIM_MS = 520;
const TICK_FLASH_MS = 280;
const WIN_SCORE_TARGET_BASE = 100;
const LEVEL_TARGET_MULTIPLIER = 1.5;
const DEFAULT_TURN_SEC = 6;
const DEFAULT_SCORE_RESET_EVERY = 12;
const DEFAULT_SIZE_N = 5;
const DEFAULT_FILLED_M = 8;
const DEFAULT_INIT_MIN = 1;
const DEFAULT_INIT_MAX = 5;
const DEFAULT_LOSE_STATE = 10;
const SPAWN_CHANCE = 0.28;
const BLUE_SPAWN_CHANCE = 0.05;
const RED_SPAWN_CHANCE = 0.05;
const LEVEL_SPAWN_MIN = 4;
const LEVEL_SPAWN_MAX = 5;
const LEVEL_1_TURN_SEC = 10;
const LEVEL_OTHER_TURN_SEC = 6;
const MIN_TURN_SEC = 0.5;
const CLICK_FLIP_DELAY_MS = 260;
const LEVEL_UP_ANIM_MS = 600;
const LOSE_RESTART_DELAY_MS = 1800;

let n = DEFAULT_SIZE_N;
let m = DEFAULT_FILLED_M;
let initMin = DEFAULT_INIT_MIN;
let initMax = DEFAULT_INIT_MAX;
let loseState = DEFAULT_LOSE_STATE;
let baseInitMin = DEFAULT_INIT_MIN;
let baseInitMax = DEFAULT_INIT_MAX;
let baseLoseState = DEFAULT_LOSE_STATE;
let turnIntervalSec = DEFAULT_TURN_SEC;
let scoreResetEvery = DEFAULT_SCORE_RESET_EVERY;
let grid = [];
let phase = "setup";
/** @type {{ r: number, c: number } | null} */
let flippingCell = null;
let tickProcessing = false;
let tickVisualBusy = false;
let pendingFlipTimer = null;
let baseTurnIntervalSec = DEFAULT_TURN_SEC;
let score = 0;
let level = 1;
let scoreTarget = WIN_SCORE_TARGET_BASE;
let turnCount = 0;
let draggedCell = null;
let dragJustEnded = false;
let boardDragActive = false;
let timerRafId = null;
let turnIntervalId = null;
let turnPeriodStart = 0;

/** @type {{ burns: Set<string>, spawns: Set<string>, drains: Set<string>, tick: boolean }} */
let boardEffects = { burns: new Set(), spawns: new Set(), drains: new Set(), tick: false };

const $ = (id) => document.getElementById(id);
const setupEl = $("setup");
const gameEl = $("game");
const boardEl = $("board");
const messageEl = $("message");
const statsEl = $("stats");
const setupHint = $("setupHint");
const scoreValueEl = $("scoreValue");
const scoreTargetEl = $("scoreTarget");
const levelValueEl = $("levelValue");
const scoreCounterEl = $("scoreCounter");
const dropZoneEl = $("dropZone");
const resetInEl = $("resetInValue");
const timerTrackEl = $("timerTrack");
const timerFillEl = $("timerFill");
const timerLabelEl = $("timerLabel");

function getBoardWrap() {
  return document.querySelector(".board-wrap");
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function cellKey(r, c) {
  return `${r},${c}`;
}

function faceValue(tile) {
  return tile.sides[tile.faceIndex];
}

function backValue(tile) {
  return tile.sides[1 - tile.faceIndex];
}

const ORTHO_DELTAS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function baseSideSum(tile) {
  return tile.sides[0] + tile.sides[1];
}

function faceBonus(tile) {
  return tile.bonus?.[tile.faceIndex] ?? 0;
}

function backBonus(tile) {
  return tile.bonus?.[1 - tile.faceIndex] ?? 0;
}

function bonusSideSum(tile) {
  return (tile.bonus?.[0] ?? 0) + (tile.bonus?.[1] ?? 0);
}

function sideSum(tile) {
  return baseSideSum(tile) + bonusSideSum(tile);
}

function countAdjacentPancakes(r, c) {
  let count = 0;
  for (const [dr, dc] of ORTHO_DELTAS) {
    const cell = grid[r + dr]?.[c + dc];
    if (cell?.active && cell.tile) count += 1;
  }
  return count;
}

/** Красный: соседям +N бонуса на обе стороны (N = число соседей красного) */
function recalcRedNeighborBonuses() {
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = grid[r][c];
      if (cell.active && cell.tile) {
        cell.tile.bonus = [0, 0];
      }
    }
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = grid[r][c];
      if (!cell.active || !cell.tile?.red) continue;
      const neighborCount = countAdjacentPancakes(r, c);
      if (neighborCount <= 0) continue;
      for (const [dr, dc] of ORTHO_DELTAS) {
        const neighbor = grid[r + dr]?.[c + dc];
        if (!neighbor?.active || !neighbor.tile) continue;
        neighbor.tile.bonus[0] += neighborCount;
        neighbor.tile.bonus[1] += neighborCount;
      }
    }
  }
}

/** Бонусы к счёту при сборе: пара +20%, good +10%, perfect (9+9) +34% */
function getCollectPercentBonus(tile) {
  const [a, b] = tile.sides;
  if (a === 9 && b === 9) {
    return { percent: 34, tags: ["perfect"] };
  }
  let percent = 0;
  const tags = [];
  if (a === b) {
    percent += 20;
    tags.push("пара");
  }
  if (a > 6 && b > 6) {
    percent += 10;
    tags.push("good");
  }
  return { percent, tags };
}

function applyPercentBonus(amount, percent) {
  if (percent <= 0) return 0;
  return Math.round((amount * percent) / 100);
}

/** Подсказки комбо для отображения на клетке */
function getScoreComboHints(tile) {
  const [a, b] = tile.sides;
  if (a === 9 && b === 9) {
    return [{ key: "nine", label: "perfect", className: "cell--combo-nine" }];
  }
  const hints = [];
  if (a === b) {
    hints.push({ key: "pair", label: "пара", className: "cell--combo-pair" });
  }
  if (a > 6 && b > 6) {
    hints.push({ key: "high", label: "good", className: "cell--combo-high" });
  }
  return hints;
}

function applyComboVisual(btn, tile) {
  const hints = getScoreComboHints(tile);
  if (hints.length === 0) return;
  for (const combo of hints) btn.classList.add(combo.className);
  const wrap = document.createElement("span");
  wrap.className = "cell-combo-badges";
  wrap.setAttribute("aria-hidden", "true");
  for (const combo of hints) {
    const badge = document.createElement("span");
    badge.className = `cell-combo-badge cell-combo-badge--${combo.key}`;
    badge.textContent = combo.label;
    badge.title =
      combo.key === "nine"
        ? "perfect: +34% к счёту"
        : combo.key === "pair"
          ? "пара: +20% к счёту"
          : "good: +10% к счёту";
    wrap.appendChild(badge);
  }
  btn.appendChild(wrap);
}

function isCellBusy(r, c) {
  return flippingCell !== null && flippingCell.r === r && flippingCell.c === c;
}

function canInteract() {
  return phase === "playing";
}

function swapFace(tile) {
  tile.faceIndex = 1 - tile.faceIndex;
}

function getActiveCellsOn(board) {
  const list = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = board[r]?.[c];
      if (cell?.active && cell.tile) list.push({ r, c });
    }
  }
  return list;
}

function getEmptyCells() {
  const list = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!grid[r][c].active) list.push({ r, c });
    }
  }
  return list;
}

function incrementAllVisibleOn(board) {
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = board[r][c];
      if (cell.active && cell.tile) {
        cell.tile.sides[cell.tile.faceIndex] += 1;
      }
    }
  }
}

/** Ход по таймеру: только +1 всем лицевым сторонам */
function applyTimedTurnIncrement() {
  incrementAllVisibleOn(grid);
}

function rollMarkFlags() {
  const roll = Math.random();
  if (roll < BLUE_SPAWN_CHANCE) return { blue: true, red: false };
  if (roll < BLUE_SPAWN_CHANCE + RED_SPAWN_CHANCE) return { blue: false, red: true };
  return { blue: false, red: false };
}

function createRandomPancake(options = {}) {
  const withMarks = options.withMarks === true;
  const marks = withMarks ? rollMarkFlags() : { blue: false, red: false };
  return {
    sides: [randInt(initMin, initMax), randInt(initMin, initMax)],
    bonus: [0, 0],
    faceIndex: randInt(0, 1),
    blue: marks.blue,
    red: marks.red,
  };
}

function clampSide(v) {
  return Math.max(VALUE_MIN, v);
}

/** Синяя пометка: −1 обеим сторонам всем блинчикам в той же колонке */
function applyBlueMarksColumnDrain() {
  const drained = new Set();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = grid[r][c];
      if (!cell.active || !cell.tile?.blue) continue;
      for (let rr = 0; rr < n; rr++) {
        const target = grid[rr][c];
        if (!target.active || !target.tile) continue;
        const before = target.tile.sides.slice();
        target.tile.sides[0] = clampSide(target.tile.sides[0] - 1);
        target.tile.sides[1] = clampSide(target.tile.sides[1] - 1);
        if (before[0] !== target.tile.sides[0] || before[1] !== target.tile.sides[1]) {
          drained.add(cellKey(rr, c));
        }
      }
    }
  }
  return drained;
}

function spawnPancakesAt(positions) {
  const spawned = [];
  for (const { r, c } of positions) {
    if (!grid[r][c].active) {
      grid[r][c] = { active: true, tile: createRandomPancake({ withMarks: true }) };
      spawned.push({ r, c });
      boardEffects.spawns.add(cellKey(r, c));
    }
  }
  return spawned;
}

function massSpawnForLevel() {
  const empty = getEmptyCells();
  if (empty.length === 0) return [];
  const want = randInt(LEVEL_SPAWN_MIN, LEVEL_SPAWN_MAX);
  const count = Math.min(want, empty.length);
  for (let i = empty.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [empty[i], empty[j]] = [empty[j], empty[i]];
  }
  return spawnPancakesAt(empty.slice(0, count));
}

function movePancake(fromR, fromC, toR, toC) {
  if (fromR === toR && fromC === toC) return false;
  const from = grid[fromR]?.[fromC];
  const to = grid[toR]?.[toC];
  if (!from?.active || !from.tile || to?.active) return false;
  to.active = true;
  to.tile = from.tile;
  from.active = false;
  from.tile = null;
  return true;
}

function pickRandomPositions(total, count) {
  const indices = Array.from({ length: total }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return new Set(indices.slice(0, count));
}

function buildRandomGrid() {
  const filled = pickRandomPositions(n * n, m);
  const board = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) {
      if (filled.has(r * n + c)) {
        row.push({ active: true, tile: createRandomPancake({ withMarks: false }) });
      } else {
        row.push({ active: false, tile: null });
      }
    }
    board.push(row);
  }
  return board;
}

function initGrid() {
  grid = buildRandomGrid();
}

/** Доля «нагрева» 0…1 для цвета (чёрный только при value >= loseState) */
function valueHeatRatio(value) {
  const v = Math.max(VALUE_MIN, value);
  if (v >= loseState) return 1;
  const warmCap = Math.max(initMax, VALUE_MIN + 1);
  const dangerAt = Math.max(loseState - 1, warmCap + 1);
  if (v <= warmCap) {
    const span = Math.max(warmCap - VALUE_MIN, 1);
    return 0.1 + (0.5 * (v - VALUE_MIN)) / span;
  }
  if (v >= dangerAt) return 0.92;
  const span = Math.max(dangerAt - warmCap, 1);
  return 0.55 + (0.37 * (v - warmCap)) / span;
}

function getCellColors(value) {
  if (value >= loseState) {
    return { background: "#1a1a1a", color: "#888", ratio: 1 };
  }
  const ratio = valueHeatRatio(value);
  const hue = Math.round(120 * (1 - ratio));
  const lightness = Math.round(46 - ratio * 10);
  return {
    background: `hsl(${hue}, 68%, ${lightness}%)`,
    color: ratio >= 0.52 ? "#fff" : "rgba(0, 0, 0, 0.6)",
    ratio,
  };
}

function anySideAtLeast(tile, value) {
  return tile.sides.some((v) => v >= value);
}

function countActive() {
  return getActiveCellsOn(grid).length;
}

function removeCell(r, c) {
  grid[r][c].active = false;
  grid[r][c].tile = null;
}

function findBurnedCells() {
  const list = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = grid[r][c];
      if (cell.active && cell.tile && anySideAtLeast(cell.tile, loseState)) {
        list.push({ r, c });
      }
    }
  }
  return list;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function animateCounter(counterEl, text, kind = "good") {
  if (!counterEl) return;
  counterEl.classList.remove("counter--pop", "counter--good", "counter--bad", "counter--neutral");
  void counterEl.offsetWidth;
  counterEl.classList.add("counter--pop", `counter--${kind}`);
  window.setTimeout(() => {
    counterEl.classList.remove("counter--pop", `counter--${kind}`);
  }, 420);

  if (text) {
    const floatEl = document.createElement("span");
    floatEl.className = `counter-float counter-float--${kind}`;
    floatEl.textContent = text;
    counterEl.appendChild(floatEl);
    floatEl.addEventListener("animationend", () => floatEl.remove(), { once: true });
  }
}

function addScore(amount) {
  score += amount;
  animateCounter(scoreCounterEl, `+${amount}`, "good");
}

function turnsUntilDeadline() {
  if (scoreResetEvery <= 0) return 0;
  const mod = turnCount % scoreResetEvery;
  return mod === 0 ? scoreResetEvery : scoreResetEvery - mod;
}

function isScoreDeadlineTurn() {
  return turnCount > 0 && turnCount % scoreResetEvery === 0;
}

function collectPancake(r, c) {
  const cell = grid[r]?.[c];
  if (!cell?.active || !cell.tile) return false;
  const tile = cell.tile;
  const base = baseSideSum(tile);
  const bonusTotal = bonusSideSum(tile);
  const { percent, tags } = getCollectPercentBonus(tile);
  const percentBonus = applyPercentBonus(base, percent);
  const gained = base + bonusTotal + percentBonus;
  addScore(gained);
  removeCell(r, c);
  recalcRedNeighborBonuses();
  if (dropZoneEl) {
    dropZoneEl.classList.add("drop-zone--collect");
    window.setTimeout(() => dropZoneEl.classList.remove("drop-zone--collect"), 400);
  }

  const parts = [`+${base}`];
  if (bonusTotal > 0) parts.push(`+${bonusTotal} (бонус)`);
  if (percentBonus > 0) {
    const tagNote = tags.length ? `: ${tags.join(", ")}` : "";
    parts.push(`+${percentBonus} (${percent}%${tagNote})`);
  }
  setMessage(
    parts.length > 1 ? `Собрано ${parts.join(" ")} = ${gained}.` : `Собрано +${gained} к счёту.`
  );
  return true;
}

function trySpawnWithEffect() {
  const empty = getEmptyCells();
  if (empty.length === 0) return null;
  if (Math.random() >= SPAWN_CHANCE) return null;

  const picked = empty[randInt(0, empty.length - 1)];
  grid[picked.r][picked.c] = { active: true, tile: createRandomPancake({ withMarks: true }) };
  return picked;
}

function ensureBoardHasPancake() {
  if (phase === "playing" && countActive() === 0) {
    const empty = getEmptyCells();
    if (empty.length === 0) return;
    const picked = empty[randInt(0, empty.length - 1)];
    grid[picked.r][picked.c] = { active: true, tile: createRandomPancake({ withMarks: true }) };
    boardEffects.spawns.add(cellKey(picked.r, picked.c));
  }
}

function clearBoardEffects() {
  boardEffects = { burns: new Set(), spawns: new Set(), drains: new Set(), tick: false };
}

function clearBoardDropHints() {
  boardEl.querySelectorAll(".cell--drop-hint").forEach((el) => {
    el.classList.remove("cell--drop-hint");
  });
}

function setBoardDragMode(active) {
  boardDragActive = active;
  const wrap = getBoardWrap();
  if (wrap) wrap.classList.toggle("board-wrap--pan-drag", active);
}

function formatSideValue(base, bonus) {
  if (bonus > 0) return `${base} (+${bonus})`;
  return String(base);
}

function createValueStack(face, back, faceBonusVal = 0, backBonusVal = 0) {
  const faceColors = getCellColors(face);
  const backColors = getCellColors(back);
  const wrap = document.createElement("div");
  wrap.className = "cell-values";
  const faceEl = document.createElement("span");
  faceEl.className = "cell-value-face";
  faceEl.textContent = formatSideValue(face, faceBonusVal);
  faceEl.style.color = faceColors.color;
  const backEl = document.createElement("span");
  backEl.className = "cell-value-back";
  const backChip = document.createElement("span");
  backChip.className = "cell-value-back-chip";
  backChip.textContent = formatSideValue(back, backBonusVal);
  backChip.style.background = backColors.background;
  backChip.style.color = backColors.color;
  backEl.appendChild(backChip);
  wrap.append(faceEl, backEl);
  return wrap;
}

function appendCrumbleParticles(btn) {
  const layer = document.createElement("div");
  layer.className = "crumble-layer";
  layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 10; i++) {
    const p = document.createElement("span");
    p.className = "crumble-bit";
    p.style.setProperty("--bx", `${randInt(-28, 28)}px`);
    p.style.setProperty("--by", `${randInt(-34, 8)}px`);
    p.style.setProperty("--br", `${randInt(-180, 180)}deg`);
    p.style.animationDelay = `${i * 0.03}s`;
    layer.appendChild(p);
  }
  btn.appendChild(layer);
}

function appendMark(btn, tile, r, c) {
  if (tile.blue) {
    const mark = document.createElement("span");
    mark.className = "cell-blue-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.title = "Каждый ход −1 всем в этой колонке";
    btn.appendChild(mark);
  }
  if (tile.red) {
    const adj = countAdjacentPancakes(r, c);
    const mark = document.createElement("span");
    mark.className = "cell-red-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.title = `Соседям +${adj} бонуса на сторону`;
    if (adj > 0) mark.textContent = String(adj);
    btn.appendChild(mark);
  }
}

function renderPancake(btn, cell, r, c) {
  const face = faceValue(cell.tile);
  const back = backValue(cell.tile);
  const faceColors = getCellColors(face);
  const key = cellKey(r, c);

  btn.classList.add("pancake");
  btn.draggable = canInteract() && !isCellBusy(r, c);

  if (boardEffects.burns.has(key)) {
    btn.classList.add("cell--crumble");
    appendCrumbleParticles(btn);
  }
  if (boardEffects.spawns.has(key)) btn.classList.add("cell--spawn");
  if (boardEffects.tick) btn.classList.add("cell--tick");

  const markNote = cell.tile.blue
    ? ", синяя"
    : cell.tile.red
      ? ", красная"
      : "";
  const fBonus = faceBonus(cell.tile);
  const bBonus = backBonus(cell.tile);
  const redNote = cell.tile.red
    ? `, красный, соседям +${countAdjacentPancakes(r, c)}`
    : "";
  btn.setAttribute(
    "aria-label",
    `Блинчик: лицо ${face}${fBonus ? ` (+${fBonus})` : ""}, зад ${back}${bBonus ? ` (+${bBonus})` : ""}${markNote}${redNote}`
  );

  appendMark(btn, cell.tile, r, c);
  applyComboVisual(btn, cell.tile);

  if (boardEffects.drains.has(key)) btn.classList.add("cell--drain");

  const faceEl = document.createElement("span");
  faceEl.className = "cell-face";
  faceEl.style.background = faceColors.background;
  if (fBonus > 0 || bBonus > 0) btn.classList.add("cell--has-bonus");
  if (Math.max(face, back) >= loseState - 1) btn.classList.add("cell--hot");
  faceEl.appendChild(createValueStack(face, back, fBonus, bBonus));
  btn.appendChild(faceEl);

  if (boardEffects.burns.has(key)) {
    const tag = document.createElement("span");
    tag.className = "cell-fx-label cell-fx-label--burn";
    tag.textContent = "сгорел";
    btn.appendChild(tag);
  }
  if (boardEffects.spawns.has(key)) {
    const tag = document.createElement("span");
    tag.className = "cell-fx-label cell-fx-label--spawn";
    tag.textContent = "новый";
    btn.appendChild(tag);
  }
}

function renderSideContent(sideEl, face, back, faceBonusVal = 0, backBonusVal = 0) {
  const faceColors = getCellColors(face);
  sideEl.style.background = faceColors.background;
  sideEl.appendChild(createValueStack(face, back, faceBonusVal, backBonusVal));
}

function renderPancakeFlipping(btn, cell, snap) {
  btn.classList.add("pancake", "cell--has-flipper", "cell--flip-fx");
  btn.draggable = false;
  appendMark(btn, cell.tile, snap.r, snap.c);
  applyComboVisual(btn, cell.tile);
  const flipper = document.createElement("div");
  flipper.className = "cell-flipper";
  const leaveSide = document.createElement("div");
  leaveSide.className = "cell-side cell-side--leave";
  renderSideContent(
    leaveSide,
    snap.leavingValue,
    snap.leavingBack,
    snap.leavingFaceBonus,
    snap.leavingBackBonus
  );
  const arriveSide = document.createElement("div");
  arriveSide.className = "cell-side cell-side--arrive";
  renderSideContent(
    arriveSide,
    snap.arrivingValue,
    snap.arrivingBack,
    snap.arrivingFaceBonus,
    snap.arrivingBackBonus
  );
  flipper.append(leaveSide, arriveSide);
  btn.appendChild(flipper);
}

function startFlipAnimation() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      boardEl.querySelectorAll(".cell-flipper").forEach((el) => {
        el.classList.add("cell-flipper--turned");
      });
    });
  });
}

function createCellEl(r, c, isPancake) {
  const el = document.createElement("div");
  el.className = "cell";
  el.dataset.r = r;
  el.dataset.c = c;
  if (isPancake) {
    el.setAttribute("role", "button");
    el.tabIndex = phase === "playing" ? 0 : -1;
  }
  return el;
}

function renderBoard(flipSnap = null) {
  boardEl.style.gridTemplateColumns = `repeat(${n}, var(--cell-size))`;
  boardEl.innerHTML = "";

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = grid[r][c];
      const isPancake = cell.active && !!cell.tile;

      if (!isPancake) {
        const slot = createCellEl(r, c, false);
        slot.classList.add("empty");
        slot.setAttribute("aria-label", "Пустая клетка — сюда можно перетащить блинчик");
        boardEl.appendChild(slot);
        continue;
      }

      const el = createCellEl(r, c, true);
      if (flipSnap && flipSnap.r === r && flipSnap.c === c) {
        renderPancakeFlipping(el, cell, flipSnap);
      } else {
        renderPancake(el, cell, r, c);
      }
      if (phase !== "playing") {
        el.draggable = false;
        el.tabIndex = -1;
      }
      boardEl.appendChild(el);
    }
  }
  if (flipSnap) startFlipAnimation();
}

function updateStats() {
  if (scoreValueEl) scoreValueEl.textContent = String(score);
  if (scoreTargetEl) scoreTargetEl.textContent = String(scoreTarget);
  if (levelValueEl) levelValueEl.textContent = String(level);
  if (resetInEl) resetInEl.textContent = String(turnsUntilDeadline());
  statsEl.textContent =
    `Уровень ${level} · ${turnIntervalSec.toFixed(1)} с/ход · блинчиков: ${countActive()} · ходов: ${turnCount}`;
}

function updateTimerVisual(progress, secondsLeft) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  if (timerFillEl) timerFillEl.style.width = `${pct}%`;
  if (timerTrackEl) {
    timerTrackEl.classList.toggle("timer-track--busy", tickVisualBusy);
    timerTrackEl.classList.toggle("timer-track--ready", progress >= 0.92);
    timerTrackEl.setAttribute("aria-valuenow", String(pct));
  }
  if (timerLabelEl) {
    timerLabelEl.textContent = tickVisualBusy
      ? "автоход…"
      : `${Math.max(0, secondsLeft).toFixed(1)} с`;
  }
}

function setMessage(text, kind = "") {
  messageEl.textContent = text;
  messageEl.className = "message" + (kind ? ` ${kind}` : "");
}

async function advanceLevel() {
  if (pendingFlipTimer) {
    clearTimeout(pendingFlipTimer);
    pendingFlipTimer = null;
  }
  flippingCell = null;
  draggedCell = null;
  setBoardDragMode(false);
  clearBoardDropHints();
  clearBoardEffects();
  getBoardWrap()?.classList.remove("board-wrap--tick");

  level += 1;
  scoreTarget = Math.ceil(scoreTarget * LEVEL_TARGET_MULTIPLIER);
  score = 0;
  turnCount = 0;
  turnIntervalSec = turnSecForLevel(level);
  startTurnTimer();

  animateCounter(scoreCounterEl, `ур. ${level}`, "good");
  updateStats();

  const spawned = massSpawnForLevel();
  recalcRedNeighborBonuses();
  renderBoard();
  const spawnMsg =
    spawned.length > 0
      ? ` Появилось блинчиков: ${spawned.length}.`
      : "";
  setMessage(
    `Уровень ${level}! Цель ${scoreTarget}, ход ${turnIntervalSec.toFixed(1)} с.${spawnMsg}`,
    "win"
  );

  if (spawned.length > 0) {
    tickVisualBusy = true;
    await delay(LEVEL_UP_ANIM_MS);
    for (const { r, c } of spawned) {
      boardEffects.spawns.delete(cellKey(r, c));
    }
    tickVisualBusy = false;
    renderBoard();
  }
}

function resetPlayingState() {
  stopTurnTimer();
  initGrid();
  recalcRedNeighborBonuses();
  phase = "playing";
  flippingCell = null;
  tickProcessing = false;
  tickVisualBusy = false;
  draggedCell = null;
  if (pendingFlipTimer) {
    clearTimeout(pendingFlipTimer);
    pendingFlipTimer = null;
  }
  score = 0;
  level = 1;
  scoreTarget = WIN_SCORE_TARGET_BASE;
  turnCount = 0;
  turnIntervalSec = LEVEL_1_TURN_SEC;
  initMin = baseInitMin;
  initMax = baseInitMax;
  loseState = baseLoseState;
  clearBoardEffects();
}

function applySetupDefaults() {
  const set = (id, val) => {
    const el = $(id);
    if (el) el.value = String(val);
  };
  set("sizeN", DEFAULT_SIZE_N);
  set("filledM", DEFAULT_FILLED_M);
  set("initMin", DEFAULT_INIT_MIN);
  set("initMax", DEFAULT_INIT_MAX);
  set("loseState", DEFAULT_LOSE_STATE);
  set("turnInterval", DEFAULT_TURN_SEC);
  set("scoreResetEvery", DEFAULT_SCORE_RESET_EVERY);
  $("filledM").max = DEFAULT_SIZE_N * DEFAULT_SIZE_N;
}

function turnSecForLevel(lv) {
  return lv <= 1 ? LEVEL_1_TURN_SEC : LEVEL_OTHER_TURN_SEC;
}

async function loseAndRestart() {
  if (phase !== "playing") return;
  phase = "lost";
  stopTurnTimer();
  flippingCell = null;
  tickProcessing = false;
  tickVisualBusy = false;
  draggedCell = null;
  setBoardDragMode(false);
  animateCounter(scoreCounterEl, "проигрыш", "bad");
  setMessage(
    `Не набрали ${scoreTarget} за ${scoreResetEvery} ходов. Начинаем заново…`,
    "lose"
  );
  renderBoard();
  await delay(LOSE_RESTART_DELAY_MS);
  restartCurrentGame();
}

function restartCurrentGame() {
  resetPlayingState();
  setMessage(
    `Уровень 1, цель ${scoreTarget}. Ход каждые ${turnIntervalSec} с. Дедлайн: ${scoreResetEvery} ходов.`
  );
  updateStats();
  renderBoard();
  startTurnTimer();
}

function validateSetup() {
  const sizeN = parseInt($("sizeN").value, 10);
  const filledM = parseInt($("filledM").value, 10);
  const cfgInitMin = parseInt($("initMin").value, 10);
  const cfgInitMax = parseInt($("initMax").value, 10);
  const cfgLose = parseInt($("loseState").value, 10);
  const cfgTurnSec = parseFloat($("turnInterval").value);
  const cfgResetEvery = parseInt($("scoreResetEvery").value, 10);
  const maxCells = sizeN * sizeN;

  if (Number.isNaN(sizeN) || sizeN < 3 || sizeN > 12) {
    setupHint.textContent = "n должно быть от 3 до 12.";
    return null;
  }
  if (Number.isNaN(filledM) || filledM < 1 || filledM > maxCells) {
    setupHint.textContent = `m должно быть от 1 до ${maxCells}.`;
    return null;
  }
  if (Number.isNaN(cfgInitMin) || cfgInitMin < 1) {
    setupHint.textContent = "Старт «от» должен быть ≥ 1.";
    return null;
  }
  if (Number.isNaN(cfgInitMax) || cfgInitMax < cfgInitMin) {
    setupHint.textContent = "Старт «до» не меньше «от».";
    return null;
  }
  if (Number.isNaN(cfgLose) || cfgLose <= cfgInitMax) {
    setupHint.textContent = "Сгорание должно быть больше стартового «до».";
    return null;
  }
  if (cfgLose < DEFAULT_LOSE_STATE && cfgInitMax <= DEFAULT_INIT_MAX) {
    setupHint.textContent = `При старте 1–${DEFAULT_INIT_MAX} сгорание обычно ≥ ${DEFAULT_LOSE_STATE}.`;
    return null;
  }
  if (Number.isNaN(cfgTurnSec) || cfgTurnSec < 0.5 || cfgTurnSec > 30) {
    setupHint.textContent = "Интервал хода: от 0.5 до 30 сек.";
    return null;
  }
  if (Number.isNaN(cfgResetEvery) || cfgResetEvery < 1 || cfgResetEvery > 99) {
    setupHint.textContent = "Дедлайн цели: D ходов, D от 1 до 99.";
    return null;
  }

  setupHint.textContent = "";
  return {
    sizeN,
    filledM,
    initMin: cfgInitMin,
    initMax: cfgInitMax,
    loseState: cfgLose,
    turnIntervalSec: cfgTurnSec,
    scoreResetEvery: cfgResetEvery,
  };
}

function stopTurnTimer() {
  if (timerRafId !== null) {
    cancelAnimationFrame(timerRafId);
    timerRafId = null;
  }
  if (turnIntervalId !== null) {
    clearInterval(turnIntervalId);
    turnIntervalId = null;
  }
}

/** Только визуализация — ходы запускает setInterval */
function tickTimerFrame(now) {
  if (phase !== "playing") return;

  const elapsed = (now - turnPeriodStart) / 1000;
  const phaseElapsed = elapsed % turnIntervalSec;
  const progress = phaseElapsed / turnIntervalSec;
  const left = turnIntervalSec - phaseElapsed;

  updateTimerVisual(progress, left);
  timerRafId = requestAnimationFrame(tickTimerFrame);
}

function startTurnTimer() {
  stopTurnTimer();
  turnPeriodStart = performance.now();
  updateTimerVisual(0, turnIntervalSec);

  const ms = Math.max(500, Math.round(turnIntervalSec * 1000));
  turnIntervalId = window.setInterval(() => {
    void processTimedTurn();
  }, ms);

  timerRafId = requestAnimationFrame(tickTimerFrame);
}

async function checkLevelProgress() {
  if (score >= scoreTarget) {
    await advanceLevel();
    return true;
  }
  return false;
}

async function processTimedTurn() {
  if (phase !== "playing" || tickProcessing) return;
  tickProcessing = true;
  tickVisualBusy = true;

  turnCount += 1;
  turnPeriodStart = performance.now();

  boardEffects.tick = true;
  const boardWrap = getBoardWrap();
  if (boardWrap) boardWrap.classList.add("board-wrap--tick");

  applyTimedTurnIncrement();
  const drained = applyBlueMarksColumnDrain();
  for (const key of drained) boardEffects.drains.add(key);
  const burned = findBurnedCells();

  const spawned = trySpawnWithEffect();
  if (!spawned) ensureBoardHasPancake();
  recalcRedNeighborBonuses();
  renderBoard();
  updateStats();

  if (isScoreDeadlineTurn() && score < scoreTarget) {
    tickVisualBusy = false;
    tickProcessing = false;
    await loseAndRestart();
    return;
  }

  const blueMsg = drained.size > 0 ? " Синие: −1 в колонках." : "";
  const deadlineMsg = isScoreDeadlineTurn()
    ? ` Дедлайн: цель ${scoreTarget} выполнена.`
    : "";
  setMessage(`Ход ${turnCount}: +1 всем лицам.${blueMsg}${deadlineMsg}`);

  await delay(TICK_FLASH_MS);
  boardEffects.tick = false;
  boardEffects.drains.clear();
  if (boardWrap) boardWrap.classList.remove("board-wrap--tick");
  renderBoard();

  if (burned.length > 0) {
    clearBoardEffects();
    for (const { r, c } of burned) {
      boardEffects.burns.add(cellKey(r, c));
    }
    renderBoard();
    setMessage(
      burned.length === 1
        ? "Блинчик сгорел!"
        : `Сгорело блинчиков: ${burned.length}.`
    );
    await delay(CRUMBLE_ANIM_MS);
    for (const { r, c } of burned) removeCell(r, c);
    clearBoardEffects();
    recalcRedNeighborBonuses();
    renderBoard();
  }

  if (spawned) {
    boardEffects.spawns.add(cellKey(spawned.r, spawned.c));
    renderBoard();
    setMessage("Появился новый блинчик!");
    await delay(SPAWN_ANIM_MS);
    boardEffects.spawns.delete(cellKey(spawned.r, spawned.c));
    renderBoard();
  } else if (boardEffects.spawns.size > 0) {
    renderBoard();
    await delay(SPAWN_ANIM_MS);
    clearBoardEffects();
    renderBoard();
  }

  updateStats();
  renderBoard();
  if (await checkLevelProgress()) {
    tickVisualBusy = false;
    tickProcessing = false;
    return;
  }
  tickVisualBusy = false;
  tickProcessing = false;
}

function startGame() {
  const v = validateSetup();
  if (!v) return;

  n = v.sizeN;
  m = v.filledM;
  initMin = v.initMin;
  initMax = v.initMax;
  loseState = v.loseState;
  baseInitMin = initMin;
  baseInitMax = initMax;
  baseLoseState = loseState;
  baseTurnIntervalSec = LEVEL_1_TURN_SEC;
  turnIntervalSec = turnSecForLevel(1);
  scoreResetEvery = v.scoreResetEvery;
  $("filledM").max = n * n;

  resetPlayingState();

  setupEl.classList.add("hidden");
  gameEl.classList.remove("hidden");
  setMessage(
    `Уровень 1, цель ${scoreTarget}. Ход каждые ${turnIntervalSec} с. За ${scoreResetEvery} ходов набери цель.`
  );
  updateStats();
  renderBoard();
  startTurnTimer();
}

function endGame(won) {
  phase = won ? "won" : "lost";
  stopTurnTimer();
  flippingCell = null;
  tickProcessing = false;
  tickVisualBusy = false;
  draggedCell = null;
  clearBoardEffects();
  updateTimerVisual(0, 0);
  setMessage(won ? `Победа! Счёт ${score}.` : `Игра окончена. Счёт: ${score}.`, won ? "win" : "lose");
  updateStats();
  renderBoard();
}

function doFlip(r, c) {
  if (!canInteract() || isCellBusy(r, c)) return;
  const cell = grid[r][c];
  if (!cell.active || !cell.tile) return;

  flippingCell = { r, c };
  const tile = cell.tile;
  const snap = {
    r,
    c,
    leavingValue: faceValue(tile),
    leavingBack: backValue(tile),
    leavingFaceBonus: faceBonus(tile),
    leavingBackBonus: backBonus(tile),
  };
  swapFace(tile);
  snap.arrivingValue = faceValue(tile);
  snap.arrivingBack = backValue(tile);
  snap.arrivingFaceBonus = faceBonus(tile);
  snap.arrivingBackBonus = backBonus(tile);

  renderBoard(snap);
  setTimeout(() => {
    if (flippingCell?.r === r && flippingCell?.c === c) flippingCell = null;
    renderBoard();
    void checkLevelProgress();
  }, FLIP_ANIM_MS);
}

function onPancakeClick(r, c) {
  if (dragJustEnded) return;
  if (!canInteract() || isCellBusy(r, c)) return;
  const cell = grid[r][c];
  if (!cell.active || !cell.tile) return;

  if (pendingFlipTimer) clearTimeout(pendingFlipTimer);
  pendingFlipTimer = window.setTimeout(() => {
    pendingFlipTimer = null;
    doFlip(r, c);
  }, CLICK_FLIP_DELAY_MS);
}

function onPancakeDoubleClick(r, c) {
  if (dragJustEnded || !canInteract()) return;
  if (pendingFlipTimer) {
    clearTimeout(pendingFlipTimer);
    pendingFlipTimer = null;
  }
  if (isCellBusy(r, c)) return;
  if (!collectPancake(r, c)) return;
  renderBoard();
  updateStats();
  void checkLevelProgress();
}

function onPancakeDragStart(e) {
  const el = e.target.closest(".cell.pancake");
  if (!el || !canInteract()) {
    e.preventDefault();
    return;
  }
  draggedCell = {
    r: parseInt(el.dataset.r, 10),
    c: parseInt(el.dataset.c, 10),
  };
  dragJustEnded = false;
  setBoardDragMode(true);
  el.classList.add("cell--dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", `${draggedCell.r},${draggedCell.c}`);
  if (e.dataTransfer.setDragImage) {
    const ghost = el.cloneNode(true);
    ghost.classList.add("cell--drag-ghost");
    ghost.style.position = "fixed";
    ghost.style.top = "-1000px";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 36, 36);
    requestAnimationFrame(() => ghost.remove());
  }
}

function onPancakeDragEnd() {
  dragJustEnded = true;
  window.setTimeout(() => {
    dragJustEnded = false;
  }, 200);
  setBoardDragMode(false);
  clearBoardDropHints();
  boardEl.querySelectorAll(".cell--dragging").forEach((el) => {
    el.classList.remove("cell--dragging");
  });
  dropZoneEl?.classList.remove("drop-zone--active");
  draggedCell = null;
}

function onBoardDragOver(e) {
  if (!draggedCell || !canInteract()) return;
  const empty = e.target.closest(".cell.empty");
  if (!empty) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const r = parseInt(empty.dataset.r, 10);
  const c = parseInt(empty.dataset.c, 10);
  clearBoardDropHints();
  empty.classList.add("cell--drop-hint");
  dropZoneEl?.classList.remove("drop-zone--active");
}

function onBoardDragLeave(e) {
  const related = e.relatedTarget;
  if (related && boardEl.contains(related)) return;
  clearBoardDropHints();
}

function onBoardDrop(e) {
  const empty = e.target.closest(".cell.empty");
  if (!empty || !draggedCell || !canInteract()) return;
  e.preventDefault();
  e.stopPropagation();

  const toR = parseInt(empty.dataset.r, 10);
  const toC = parseInt(empty.dataset.c, 10);
  const { r, c } = draggedCell;
  draggedCell = null;
  setBoardDragMode(false);
  clearBoardDropHints();
  dropZoneEl?.classList.remove("drop-zone--active");

  if (!movePancake(r, c, toR, toC)) return;
  recalcRedNeighborBonuses();
  renderBoard();
  updateStats();
  setMessage("Блинчик перемещён на другую клетку.");
}

function onDropZoneDragOver(e) {
  if (!draggedCell || phase !== "playing") return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  dropZoneEl?.classList.add("drop-zone--active");
}

function onDropZoneDragLeave() {
  dropZoneEl?.classList.remove("drop-zone--active");
}

function onDropZoneDrop(e) {
  e.preventDefault();
  if (!draggedCell || !canInteract()) return;

  const { r, c } = draggedCell;
  draggedCell = null;
  dropZoneEl.classList.remove("drop-zone--active");

  if (!collectPancake(r, c)) return;
  renderBoard();
  updateStats();
  void checkLevelProgress();
}

function bindEvents() {
  $("startBtn").addEventListener("click", startGame);
  $("restartBtn").addEventListener("click", () => {
    stopTurnTimer();
    gameEl.classList.add("hidden");
    setupEl.classList.remove("hidden");
    phase = "setup";
    flippingCell = null;
    tickProcessing = false;
    tickVisualBusy = false;
    draggedCell = null;
    clearBoardEffects();
    setMessage("");
  });

  $("sizeN").addEventListener("change", () => {
    const v = validateSetup();
    if (v) $("filledM").max = v.sizeN * v.sizeN;
  });

  boardEl.addEventListener("click", (e) => {
    const el = e.target.closest(".cell.pancake");
    if (!el) return;
    onPancakeClick(parseInt(el.dataset.r, 10), parseInt(el.dataset.c, 10));
  });
  boardEl.addEventListener("dblclick", (e) => {
    const el = e.target.closest(".cell.pancake");
    if (!el) return;
    e.preventDefault();
    onPancakeDoubleClick(parseInt(el.dataset.r, 10), parseInt(el.dataset.c, 10));
  });
  boardEl.addEventListener("dragstart", onPancakeDragStart);
  boardEl.addEventListener("dragend", onPancakeDragEnd);
  boardEl.addEventListener("dragover", onBoardDragOver);
  boardEl.addEventListener("dragleave", onBoardDragLeave);
  boardEl.addEventListener("drop", onBoardDrop);

  boardEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest(".cell.pancake");
    if (!el) return;
    e.preventDefault();
    onPancakeClick(parseInt(el.dataset.r, 10), parseInt(el.dataset.c, 10));
  });

  if (dropZoneEl) {
    dropZoneEl.addEventListener("dragover", onDropZoneDragOver);
    dropZoneEl.addEventListener("dragleave", onDropZoneDragLeave);
    dropZoneEl.addEventListener("drop", onDropZoneDrop);
  }
}

bindEvents();
applySetupDefaults();
