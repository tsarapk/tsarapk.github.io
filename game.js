/**
 * Блинчики на сетке n×n (m штук).
 * Клик по блинчику: переворот выбранного, затем +1 всем лицевым (+ анимация).
 * Пропуск: +1 всем лицевым, без переворота.
 */
const VALUE_MIN = 1;
const FLIP_ANIM_MS = 420;

let n = 5;
let m = 8;
let initMin = 1;
let initMax = 5;
let winState = 9;
let loseState = 10;
let grid = [];
let phase = "setup";
let animating = false;

const $ = (id) => document.getElementById(id);
const setupEl = $("setup");
const gameEl = $("game");
const boardEl = $("board");
const messageEl = $("message");
const statsEl = $("stats");
const setupHint = $("setupHint");
const skipBtn = $("skipBtn");

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createPancake() {
  return {
    sides: [randInt(initMin, initMax), randInt(initMin, initMax)],
    faceIndex: 0,
  };
}

function faceValue(tile) {
  return tile.sides[tile.faceIndex];
}

function backValue(tile) {
  return tile.sides[1 - tile.faceIndex];
}

function getCellColors(value) {
  if (value >= loseState) {
    return { background: "#1a1a1a", color: "#888" };
  }
  const span = Math.max(loseState - VALUE_MIN - 1, 1);
  const ratio = (value - VALUE_MIN) / span;
  const hue = 120 * (1 - ratio);
  return {
    background: `hsl(${hue}, 62%, 42%)`,
    color: value >= 6 ? "#fff" : "rgba(0, 0, 0, 0.55)",
  };
}

function allSidesEqual(tile, value) {
  return tile.sides.every((v) => v === value);
}

function anySideAtLeast(tile, value) {
  return tile.sides.some((v) => v >= value);
}

function swapFace(tile) {
  tile.faceIndex = 1 - tile.faceIndex;
}

/** +1 только текущей лицевой стороне у каждого блинчика */
function incrementAllVisible() {
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = grid[r][c];
      if (cell.active && cell.tile) {
        cell.tile.sides[cell.tile.faceIndex] += 1;
      }
    }
  }
}

function removeResolvedCells() {
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = grid[r][c];
      if (cell.active && allSidesEqual(cell.tile, winState)) {
        cell.active = false;
        cell.tile = null;
      }
    }
  }
}

function countActive() {
  let count = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c].active) count++;
    }
  }
  return count;
}

function checkLose() {
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = grid[r][c];
      if (cell.active && cell.tile && anySideAtLeast(cell.tile, loseState)) {
        return true;
      }
    }
  }
  return false;
}

function pickRandomPositions(total, count) {
  const indices = Array.from({ length: total }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return new Set(indices.slice(0, count));
}

function initGrid() {
  grid = [];
  const filled = pickRandomPositions(n * n, m);
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) {
      if (filled.has(r * n + c)) {
        row.push({ active: true, tile: createPancake() });
      } else {
        row.push({ active: false, tile: null });
      }
    }
    grid.push(row);
  }
}

function createValueStack(face, back) {
  const wrap = document.createElement("div");
  wrap.className = "cell-values";

  const faceEl = document.createElement("span");
  faceEl.className = "cell-value-face";
  faceEl.textContent = String(face);

  const backEl = document.createElement("span");
  backEl.className = "cell-value-back";
  backEl.textContent = String(back);

  wrap.append(faceEl, backEl);
  return wrap;
}

function renderPancake(btn, cell) {
  const face = faceValue(cell.tile);
  const back = backValue(cell.tile);
  const { background, color } = getCellColors(face);

  btn.classList.add("pancake");
  btn.setAttribute("aria-label", `Блинчик: лицо ${face}, задняя ${back}`);

  const faceEl = document.createElement("span");
  faceEl.className = "cell-face";
  faceEl.style.background = background;
  faceEl.style.color = color;
  faceEl.appendChild(createValueStack(face, back));

  btn.appendChild(faceEl);
}

function renderSideContent(sideEl, face, back, colors) {
  sideEl.style.background = colors.background;
  sideEl.style.color = colors.color;
  sideEl.appendChild(createValueStack(face, back));
}

function renderPancakeFlipping(btn, cell, snap) {
  btn.classList.add("pancake", "cell--has-flipper");
  btn.setAttribute(
    "aria-label",
    `Блинчик: лицо ${faceValue(cell.tile)}, задняя ${backValue(cell.tile)}`
  );

  const flipper = document.createElement("div");
  flipper.className = "cell-flipper";

  const leaveSide = document.createElement("div");
  leaveSide.className = "cell-side cell-side--leave";
  renderSideContent(
    leaveSide,
    snap.leavingValue,
    snap.leavingBack,
    getCellColors(snap.leavingValue)
  );

  const arriveSide = document.createElement("div");
  arriveSide.className = "cell-side cell-side--arrive";
  renderSideContent(
    arriveSide,
    snap.arrivingValue,
    snap.arrivingBack,
    getCellColors(snap.arrivingValue)
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

function updateStats() {
  statsEl.textContent = `Блинчиков: ${countActive()} · ходов: ${window._moves ?? 0}`;
}

function setMessage(text, kind = "") {
  messageEl.textContent = text;
  messageEl.className = "message" + (kind ? ` ${kind}` : "");
}

function setControlsEnabled(enabled) {
  if (skipBtn) skipBtn.disabled = !enabled;
}

function renderBoard(flipSnap = null) {
  boardEl.style.gridTemplateColumns = `repeat(${n}, var(--cell-size))`;
  boardEl.innerHTML = "";

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = grid[r][c];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cell";
      btn.dataset.r = r;
      btn.dataset.c = c;

      if (!cell.active) {
        btn.classList.add("empty");
        btn.disabled = true;
        btn.setAttribute("aria-label", "Пусто");
      } else if (flipSnap && flipSnap.r === r && flipSnap.c === c) {
        renderPancakeFlipping(btn, cell, flipSnap);
        if (phase !== "playing") btn.disabled = true;
      } else {
        renderPancake(btn, cell);
        if (phase !== "playing") btn.disabled = true;
      }

      boardEl.appendChild(btn);
    }
  }

  if (flipSnap) startFlipAnimation();
}

function syncControls() {
  setControlsEnabled(phase === "playing" && !animating);
}

function updateLegend() {
  const elInit = $("legendInit");
  const elWin = $("legendWin");
  const elLose = $("legendLose");
  if (elInit) elInit.textContent = `${initMin}–${initMax}`;
  if (elWin) elWin.textContent = String(winState);
  if (elLose) elLose.textContent = String(loseState);
}

function validateSetup() {
  const sizeN = parseInt($("sizeN").value, 10);
  const filledM = parseInt($("filledM").value, 10);
  const cfgInitMin = parseInt($("initMin").value, 10);
  const cfgInitMax = parseInt($("initMax").value, 10);
  const cfgWin = parseInt($("winState").value, 10);
  const cfgLose = parseInt($("loseState").value, 10);
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
  if (Number.isNaN(cfgWin) || cfgWin < 2) {
    setupHint.textContent = "Победа: значение ≥ 2.";
    return null;
  }
  if (Number.isNaN(cfgLose) || cfgLose <= cfgWin) {
    setupHint.textContent = "Проигрыш должен быть больше значения победы.";
    return null;
  }
  setupHint.textContent = "";
  return {
    sizeN,
    filledM,
    initMin: cfgInitMin,
    initMax: cfgInitMax,
    winState: cfgWin,
    loseState: cfgLose,
  };
}

function startGame() {
  const v = validateSetup();
  if (!v) return;

  n = v.sizeN;
  m = v.filledM;
  initMin = v.initMin;
  initMax = v.initMax;
  winState = v.winState;
  loseState = v.loseState;
  $("filledM").max = n * n;

  initGrid();
  phase = "playing";
  animating = false;
  window._moves = 0;

  setupEl.classList.add("hidden");
  gameEl.classList.remove("hidden");
  updateLegend();
  setMessage(
    `Старт ${initMin}–${initMax}. Победа: обе = ${winState}. Проигрыш: ≥ ${loseState}.`
  );
  updateStats();
  renderBoard();
  syncControls();
}

function endGame(won) {
  phase = won ? "won" : "lost";
  animating = false;
  setMessage(
    won ? "Победа! Все блинчики убраны." : `Проигрыш — сторона достигла ${loseState}.`,
    won ? "win" : "lose"
  );
  renderBoard();
  syncControls();
}

function finishTurn(flipSnap) {
  const afterAnim = () => {
    animating = false;

    if (checkLose()) {
      renderBoard();
      syncControls();
      endGame(false);
      return;
    }

    removeResolvedCells();
    updateStats();
    renderBoard();
    syncControls();

    if (countActive() === 0) {
      endGame(true);
    }
  };

  if (flipSnap) {
    setTimeout(afterAnim, FLIP_ANIM_MS);
  } else {
    afterAnim();
  }
}

function onPancakeClick(r, c) {
  if (phase !== "playing" || animating) return;
  const cell = grid[r][c];
  if (!cell.active || !cell.tile) return;

  animating = true;
  setControlsEnabled(false);

  const tile = cell.tile;
  const leavingValue = faceValue(tile);
  const leavingBack = backValue(tile);
  swapFace(tile);
  incrementAllVisible();
  const arrivingValue = faceValue(tile);
  const arrivingBack = backValue(tile);

  window._moves = (window._moves ?? 0) + 1;

  const flipSnap = {
    r,
    c,
    leavingValue,
    leavingBack,
    arrivingValue,
    arrivingBack,
  };
  renderBoard(flipSnap);
  finishTurn(flipSnap);
}

function onSkipTurn() {
  if (phase !== "playing" || animating) return;

  animating = true;
  setControlsEnabled(false);

  incrementAllVisible();
  window._moves = (window._moves ?? 0) + 1;

  finishTurn(null);
}

function bindEvents() {
  $("startBtn").addEventListener("click", startGame);
  $("restartBtn").addEventListener("click", () => {
    gameEl.classList.add("hidden");
    setupEl.classList.remove("hidden");
    phase = "setup";
    animating = false;
    setMessage("");
  });

  if (skipBtn) {
    skipBtn.addEventListener("click", onSkipTurn);
  }

  $("sizeN").addEventListener("change", () => {
    const v = validateSetup();
    if (v) $("filledM").max = v.sizeN * v.sizeN;
  });

  boardEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".cell.pancake");
    if (!btn || btn.disabled) return;
    onPancakeClick(parseInt(btn.dataset.r, 10), parseInt(btn.dataset.c, 10));
  });
}

bindEvents();
$("filledM").max = 25;
