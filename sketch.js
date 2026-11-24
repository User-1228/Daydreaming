// ===================================================================
// DAYDREAM - Complete Game Loop with Welcoming Player Lobby
// ===================================================================

// --- 1. GAME CONSTANTS & CONFIGURATION ---
const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 600;

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1800;

const WORLD_PADDING = 60;

const NUM_STARS = 25;       // +1 point each
const NUM_SUNS = 12;        // +2 points each
const NUM_GREY_BALLS = 18;  // -1 point each

const RESPAWN_DELAY_MS = 1000;

// 8 Selectable Pastel Colors for Ball Customization
const PASTEL_COLORS = [
  { name: "Coral", hex: "#FF8A8A" },
  { name: "Peach", hex: "#FFB56B" },
  { name: "Butter", hex: "#F4D477" },
  { name: "Mint", hex: "#83C99A" },
  { name: "Aqua", hex: "#72C9D8" },
  { name: "Blue", hex: "#779BE8" },
  { name: "Lavender", hex: "#B394E6" },
  { name: "Pink", hex: "#E994B9" }
];

// --- 2. GAME STATE VARIABLES ---

// Tracks whether player has clicked PLAY and entered the game
let isInGame = false;

// Selected color from the lobby palette (default: Coral)
let selectedColor = PASTEL_COLORS[0].hex;

// The local player (you)
let player = {
  id: "local_player",
  name: "You",
  color: "#FF8A8A",
  x: WORLD_WIDTH / 2,
  y: WORLD_HEIGHT / 2,
  radius: 24,           // Diameter = 48px
  speed: 5,
  score: 0
};

// Camera offsets
let cameraX = 0;
let cameraY = 0;

// Collectibles array
let collectibles = [];

// ===================================================================
// PERMANENT DEMO BOTS (BOT 1 & BOT 2)
// ===================================================================
// These two simulated bots roam the map locally and will remain active
// even after Firebase multiplayer is connected. They never touch Firebase.
let bots = [
  {
    id: "bot_1",
    name: "Bot 1",
    color: "#48cae4",   // Vibrant Sky Blue
    score: 8,
    x: 400,
    y: 350,
    radius: 24,
    vx: 1.8,            // Wander velocity X
    vy: 1.2             // Wander velocity Y
  },
  {
    id: "bot_2",
    name: "Bot 2",
    color: "#80b918",   // Meadow Green
    score: 5,
    x: 2000,
    y: 1350,
    radius: 24,
    vx: -1.4,
    vy: 1.6
  }
];

// REAL NETWORK PLAYERS (Reserved for Firebase)
var networkPlayers = window.networkPlayers || {};

// Prevent arrow keys from scrolling the browser window when playing
window.addEventListener("keydown", function(e) {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
    if (document.activeElement && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
    }
  }
});

/**
 * Returns a combined list of all other characters
 * (permanent demo bots + future real network players).
 */
function getOtherCharacters() {
  let list = [...bots];
  for (let id in networkPlayers) {
    if (networkPlayers.hasOwnProperty(id)) {
      list.push(networkPlayers[id]);
    }
  }
  return list;
}

// ===================================================================
// P5.JS LIFECYCLE: SETUP & DRAW
// ===================================================================

/**
 * setup() runs ONCE when the browser finishes loading.
 */
function setup() {
  let canvas = createCanvas(VIEW_WIDTH, VIEW_HEIGHT);
  canvas.parent("game-container");

  textAlign(CENTER, CENTER);

  // Initialize shared collectibles in Firebase (one-time sync across all players)
  if (typeof initSharedCollectiblesInFirebase === "function") {
    initSharedCollectiblesInFirebase(
      WORLD_WIDTH,
      WORLD_HEIGHT,
      WORLD_PADDING,
      NUM_STARS,
      NUM_SUNS,
      NUM_GREY_BALLS
    );
  }

  // Initialize lobby DOM controls (Color picker, Live Preview, and Play Button)
  initLobbyControls();

  // Listen for real-time multiplayer updates from Firebase
  if (typeof initMultiplayerListeners === "function") {
    initMultiplayerListeners();
  }
}

/**
 * draw() runs continuously at ~60 frames per second.
 */
function draw() {
  // 1. UPDATE: Player movement & sync (ONLY active once joined)
  if (isInGame) {
    updatePlayerMovement();
    updateCollectibles();

    // Broadcast our updated position and score to other players via Firebase
    if (typeof sendPlayerUpdateToFirebase === "function") {
      sendPlayerUpdateToFirebase(player.x, player.y, player.score);
    }
  }

  // 2. UPDATE: Simulated wander movement for permanent demo bots (always active)
  updateBots();

  // 3. UPDATE: Clamped camera position to follow player
  updateCamera();

  // 4. RENDER: Dark canvas background
  background("#1e293b");

  let others = getOtherCharacters();

  // --- WORLD SPACE RENDERING ---
  push();
  // Shift everything so camera follows player
  translate(-cameraX, -cameraY);

  // Draw rectangular world ground & boundaries
  drawWorld();

  // Draw active collectibles (Stars, Suns, Grey Balls)
  drawCollectibles();

  // Draw other characters (Bot 1, Bot 2, and remote players) who are VISIBLE
  for (let i = 0; i < others.length; i++) {
    let other = others[i];
    if (isPlayerInCamera(other)) {
      drawPlayer(other);
    }
  }

  // Draw local player ball
  drawPlayer(player);

  pop();
  // --- END OF WORLD SPACE RENDERING ---

  // --- SCREEN SPACE RENDERING (Fixed UI & HUD) ---

  // 1. Draw off-screen indicators for characters outside the visible screen
  drawOffScreenIndicators(others);

  // 2. Draw fixed top toolbar across upper edge
  drawTopToolbar();
}

// ===================================================================
// LOBBY UI & COLOR PALETTE INTERACTION
// ===================================================================

/**
 * Connects HTML form elements to game state:
 * - Populates the 8 pastel color swatches
 * - Updates the ball preview dynamically on typing and color selection
 * - Handles username validation and game launch when clicking PLAY
 */
function initLobbyControls() {
  const paletteContainer = document.getElementById("color-palette");
  const usernameInput = document.getElementById("username-input");
  const previewName = document.getElementById("preview-name");
  const previewBall = document.getElementById("preview-ball");
  const errorMessage = document.getElementById("error-message");
  const playButton = document.getElementById("play-button");
  const lobbyScreen = document.getElementById("lobby-screen");

  // 1. Populate the 8 color swatches
  paletteContainer.innerHTML = "";
  PASTEL_COLORS.forEach((colorObj, index) => {
    let swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "color-swatch";
    swatch.style.backgroundColor = colorObj.hex;
    swatch.title = colorObj.name;

    // Set first color (Coral) as default selected
    if (index === 0) {
      swatch.classList.add("selected");
    }

    // When clicked: select this color and update the preview ball
    swatch.addEventListener("click", () => {
      // Remove 'selected' from all swatches
      document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("selected"));
      // Add 'selected' to clicked swatch
      swatch.classList.add("selected");

      selectedColor = colorObj.hex;
      previewBall.style.backgroundColor = selectedColor;
    });

    paletteContainer.appendChild(swatch);
  });

  // 2. Live preview of username while typing
  usernameInput.addEventListener("input", () => {
    errorMessage.textContent = ""; // Clear error warning on typing
    let trimmed = usernameInput.value.trim();
    previewName.textContent = trimmed.length > 0 ? usernameInput.value : "Daydreamer";
  });

  // 3. Play button click handler
  function handleJoinGame() {
    let username = usernameInput.value.trim();

    // VALIDATION: Ensure username is not empty or whitespace-only
    if (username.length === 0) {
      errorMessage.textContent = "Please enter a username to join!";
      usernameInput.focus();
      return;
    }

    // VALIDATION: Max 12 characters (safety guard)
    if (username.length > 12) {
      username = username.substring(0, 12);
    }

    // Apply player customizations
    player.name = username;
    player.color = selectedColor;
    player.score = 0;

    // Spawn player at a random safe position inside the rectangular world
    player.x = random(WORLD_PADDING + player.radius, WORLD_WIDTH - WORLD_PADDING - player.radius);
    player.y = random(WORLD_PADDING + player.radius, WORLD_HEIGHT - WORLD_PADDING - player.radius);

    // Smoothly hide the lobby overlay
    lobbyScreen.classList.add("hidden");

    // Enable in-game movement & collisions
    isInGame = true;

    // Register our player entry in Firebase Realtime Database
    if (typeof joinGameInFirebase === "function") {
      joinGameInFirebase(player);
    }
  }

  playButton.addEventListener("click", handleJoinGame);

  // Allow pressing Enter key in the username input to start the game
  usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleJoinGame();
    }
  });
}

// ===================================================================
// DEMO BOT SIMULATION & CAMERA VISIBILITY
// ===================================================================

/**
 * Gently moves permanent demo bots (Bot 1 and Bot 2) around the world.
 */
function updateBots() {
  for (let i = 0; i < bots.length; i++) {
    let b = bots[i];
    b.x += b.vx;
    b.y += b.vy;

    // Bounce off world borders
    if (b.x <= b.radius + 20 || b.x >= WORLD_WIDTH - b.radius - 20) {
      b.vx *= -1;
    }
    if (b.y <= b.radius + 20 || b.y >= WORLD_HEIGHT - b.radius - 20) {
      b.vy *= -1;
    }
  }
}

/**
 * Checks if a player's circle is within the current visible screen frame.
 */
function isPlayerInCamera(p) {
  let viewLeft = cameraX;
  let viewRight = cameraX + VIEW_WIDTH;
  let viewTop = cameraY;
  let viewBottom = cameraY + VIEW_HEIGHT;

  return (
    p.x + p.radius >= viewLeft &&
    p.x - p.radius <= viewRight &&
    p.y + p.radius >= viewTop &&
    p.y - p.radius <= viewBottom
  );
}

// ===================================================================
// OFF-SCREEN PLAYER INDICATORS
// ===================================================================

function drawOffScreenIndicators(others) {
  for (let i = 0; i < others.length; i++) {
    let other = others[i];

    // If character is already on-screen, skip
    if (isPlayerInCamera(other)) {
      continue;
    }

    let localScreenX = player.x - cameraX;
    let localScreenY = player.y - cameraY;

    let otherScreenX = other.x - cameraX;
    let otherScreenY = other.y - cameraY;

    let dx = otherScreenX - localScreenX;
    let dy = otherScreenY - localScreenY;
    let angle = atan2(dy, dx);

    const minX = 26;
    const maxX = VIEW_WIDTH - 26;
    const minY = 68;
    const maxY = VIEW_HEIGHT - 24;

    let dirX = cos(angle);
    let dirY = sin(angle);

    let tX = dirX > 0 ? (maxX - localScreenX) / dirX : (minX - localScreenX) / dirX;
    let tY = dirY > 0 ? (maxY - localScreenY) / dirY : (minY - localScreenY) / dirY;
    let t = min(tX, tY);

    let indicatorX = constrain(localScreenX + t * dirX, minX, maxX);
    let indicatorY = constrain(localScreenY + t * dirY, minY, maxY);

    renderIndicator(indicatorX, indicatorY, angle, other);
  }
}

function renderIndicator(x, y, angle, other) {
  push();

  // 1. Draw Directional Arrow
  push();
  translate(x, y);
  rotate(angle);

  stroke(255);
  strokeWeight(2);
  fill(other.color);

  triangle(11, 0, -8, -7, -8, 7);
  pop();

  // 2. Draw Username Badge Beside Arrow
  let dirX = cos(angle);
  let dirY = sin(angle);

  let labelX = x;
  let labelY = y;
  let alignH = CENTER;
  let alignV = CENTER;

  if (dirX > 0.5) {
    labelX = x - 18;
    labelY = y;
    alignH = RIGHT;
    alignV = CENTER;
  } else if (dirX < -0.5) {
    labelX = x + 18;
    labelY = y;
    alignH = LEFT;
    alignV = CENTER;
  } else if (dirY > 0.5) {
    labelX = x;
    labelY = y - 18;
    alignH = CENTER;
    alignV = BOTTOM;
  } else {
    labelX = x;
    labelY = y + 18;
    alignH = CENTER;
    alignV = TOP;
  }

  textSize(12);
  textStyle(BOLD);
  let nameStr = other.name;
  let txtWidth = textWidth(nameStr);
  let padX = 6;
  let padY = 3;

  rectMode(CORNER);
  noStroke();
  fill(15, 23, 42, 210);

  let boxX = labelX;
  let boxY = labelY;

  if (alignH === RIGHT) boxX = labelX - txtWidth - padX * 2;
  else if (alignH === CENTER) boxX = labelX - txtWidth / 2 - padX;

  if (alignV === BOTTOM) boxY = labelY - 14 - padY * 2;
  else if (alignV === CENTER) boxY = labelY - 7 - padY;

  rect(boxX, boxY, txtWidth + padX * 2, 14 + padY * 2, 4);

  fill(other.color);
  textAlign(alignH, alignV);
  text(nameStr, labelX, labelY);

  pop();
}

// ===================================================================
// TOP TOOLBAR UI
// ===================================================================

function drawTopToolbar() {
  push();

  const barX = 14;
  const barY = 10;
  const barW = VIEW_WIDTH - 28;
  const barH = 40;
  const centerY = barY + barH / 2;

  fill(15, 23, 42, 220);
  stroke(255, 255, 255, 35);
  strokeWeight(1.5);
  rect(barX, barY, barW, barH, 8);

  noStroke();
  fill(255);
  textSize(12);
  textStyle(NORMAL);
  textAlign(LEFT, CENTER);
  text("🎮  Move: WASD or Arrow Keys", barX + 16, centerY);

  textAlign(RIGHT, CENTER);
  let rightEdge = barX + barW - 16;

  fill("#cbd5e1");
  text("● Grey -1", rightEdge, centerY);

  let offset1 = textWidth("● Grey -1") + 18;
  fill("#fca311");
  text("☀ Sun +2", rightEdge - offset1, centerY);

  let offset2 = offset1 + textWidth("☀ Sun +2") + 18;
  fill("#ffd166");
  text("★ Star +1", rightEdge - offset2, centerY);

  pop();
}

// ===================================================================
// COLLECTIBLES LOGIC & RENDERING (FIREBASE SHARED)
// ===================================================================

/**
 * Checks for player collisions against shared collectibles.
 * Uses atomic Firebase transactions to ensure that only the first
 * player to touch an object claims the score and triggers the respawn.
 */
function updateCollectibles() {
  if (!isInGame) return;

  for (let id in sharedCollectibles) {
    let item = sharedCollectibles[id];
    if (!item || item.collected) continue;

    let d = dist(player.x, player.y, item.x, item.y);
    if (d < player.radius + item.radius) {
      if (typeof attemptCollectItemInFirebase === "function") {
        attemptCollectItemInFirebase(
          id,
          WORLD_WIDTH,
          WORLD_HEIGHT,
          WORLD_PADDING,
          (pointsAwarded) => {
            player.score += pointsAwarded;
            if (player.score < 0) {
              player.score = 0;
            }
            if (typeof sendPlayerUpdateToFirebase === "function") {
              sendPlayerUpdateToFirebase(player.x, player.y, player.score, true);
            }
          }
        );
      }
    }
  }
}

/**
 * Draws all currently active shared collectibles from Firebase
 */
function drawCollectibles() {
  for (let id in sharedCollectibles) {
    let item = sharedCollectibles[id];
    if (!item || item.collected) continue;

    if (item.type === "star") {
      drawStarItem(item.x, item.y, item.radius);
    } else if (item.type === "sun") {
      drawSunItem(item.x, item.y, item.radius);
    } else if (item.type === "grey_ball") {
      drawGreyBallItem(item.x, item.y, item.radius);
    }
  }
}

function drawStarItem(x, y, radius) {
  push();
  stroke("#d4a017");
  strokeWeight(2);
  fill("#ffd166");

  let angle = TWO_PI / 5;
  let halfAngle = angle / 2.0;
  let innerRadius = radius * 0.5;

  beginShape();
  for (let a = -PI / 2; a < TWO_PI - PI / 2; a += angle) {
    let sx = x + cos(a) * radius;
    let sy = y + sin(a) * radius;
    vertex(sx, sy);
    sx = x + cos(a + halfAngle) * innerRadius;
    sy = y + sin(a + halfAngle) * innerRadius;
    vertex(sx, sy);
  }
  endShape(CLOSE);
  pop();
}

function drawSunItem(x, y, radius) {
  push();
  stroke("#f77f00");
  strokeWeight(2.5);
  for (let a = 0; a < TWO_PI; a += PI / 4) {
    let x1 = x + cos(a) * (radius * 0.85);
    let y1 = y + sin(a) * (radius * 0.85);
    let x2 = x + cos(a) * (radius * 1.35);
    let y2 = y + sin(a) * (radius * 1.35);
    line(x1, y1, x2, y2);
  }

  stroke("#e06800");
  strokeWeight(2);
  fill("#fca311");
  circle(x, y, radius * 1.7);
  pop();
}

function drawGreyBallItem(x, y, radius) {
  push();
  stroke("#475569");
  strokeWeight(2);
  fill("#94a3b8");
  circle(x, y, radius * 2);

  stroke("#334155");
  strokeWeight(2.5);
  line(x - radius * 0.45, y, x + radius * 0.45, y);
  pop();
}

// ===================================================================
// BASE WORLD & PLAYER DRAWING
// ===================================================================

function drawPlayer(p) {
  let r = p.radius || 24;
  let col = p.color || "#FF8A8A";
  let sc = p.score !== undefined ? p.score : 0;
  let nm = p.name || "Player";

  stroke(255);
  strokeWeight(3);
  fill(col);
  circle(p.x, p.y, r * 2);

  noStroke();
  fill(255);
  textSize(18);
  textStyle(BOLD);
  textAlign(CENTER, CENTER);
  text(sc, p.x, p.y + 1);

  fill("#1e293b");
  textSize(14);
  textStyle(NORMAL);
  text(nm, p.x, p.y - r - 12);
}

function drawWorld() {
  noStroke();
  fill("#cde8f6"); // Comforting light pastel blue
  rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  stroke(255, 255, 255, 80);
  strokeWeight(2);
  const gridSize = 100;
  for (let x = gridSize; x < WORLD_WIDTH; x += gridSize) {
    line(x, 0, x, WORLD_HEIGHT);
  }
  for (let y = gridSize; y < WORLD_HEIGHT; y += gridSize) {
    line(0, y, WORLD_WIDTH, y);
  }

  noFill();
  stroke("#70a9cd");
  strokeWeight(12);
  rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
}

function updatePlayerMovement() {
  if (keyIsDown(65) || keyIsDown(LEFT_ARROW)) {
    player.x -= player.speed;
  }
  if (keyIsDown(68) || keyIsDown(RIGHT_ARROW)) {
    player.x += player.speed;
  }
  if (keyIsDown(87) || keyIsDown(UP_ARROW)) {
    player.y -= player.speed;
  }
  if (keyIsDown(83) || keyIsDown(DOWN_ARROW)) {
    player.y += player.speed;
  }

  player.x = constrain(player.x, player.radius, WORLD_WIDTH - player.radius);
  player.y = constrain(player.y, player.radius, WORLD_HEIGHT - player.radius);
}

function updateCamera() {
  let targetCamX = player.x - VIEW_WIDTH / 2;
  let targetCamY = player.y - VIEW_HEIGHT / 2;

  cameraX = constrain(targetCamX, 0, WORLD_WIDTH - VIEW_WIDTH);
  cameraY = constrain(targetCamY, 0, WORLD_HEIGHT - VIEW_HEIGHT);
}
