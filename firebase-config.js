// ===================================================================
// DAYDREAM - Firebase Realtime Database Configuration & Multiplayer Sync
// ===================================================================

// --- 1. FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBe0b4rd6pqkwjd31nsh3iRLOIBMIHwcYk",
  authDomain: "daydreamerisdaydreaming.firebaseapp.com",
  databaseURL: "https://daydreamerisdaydreaming-default-rtdb.firebaseio.com",
  projectId: "daydreamerisdaydreaming",
  storageBucket: "daydreamerisdaydreaming.firebasestorage.app",
  messagingSenderId: "726336994026",
  appId: "1:726336994026:web:558e0cddcd25854bfe7593",
  measurementId: "G-E2XZCK9W1E"
};

// --- 2. GLOBAL DATABASE REFERENCES & STATE ---
let firebaseApp = null;
let database = null;
let playersRef = null;
let collectiblesRef = null;
let myPlayerRef = null;
let myPlayerId = null;

// Throttling for network write operations
let lastNetworkWriteTime = 0;
const NETWORK_TICK_MS = 40; // ~25 updates per second max

// Active network players synced from Firebase (keyed by playerId)
var networkPlayers = window.networkPlayers || {};

// Shared collectibles pool synced from Firebase (keyed by itemId: item_0, item_1, etc.)
var sharedCollectibles = window.sharedCollectibles || {};

// Local lock to avoid sending duplicate transactions while one is in-flight
let pendingCollections = {};

// Initialize Firebase
try {
  if (!firebase.apps.length) {
    firebaseApp = firebase.initializeApp(firebaseConfig);
  } else {
    firebaseApp = firebase.app();
  }
  database = firebase.database();
  playersRef = database.ref("players");
  collectiblesRef = database.ref("collectibles");
  console.log("Firebase Realtime Database initialized successfully!");
} catch (error) {
  console.error("Firebase initialization error:", error);
}

// ===================================================================
// PLAYER IDENTITY & REFRESH HANDLING
// ===================================================================

function getOrCreatePlayerId() {
  let savedId = sessionStorage.getItem("daydream_playerId");
  if (!savedId) {
    savedId = "player_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
    sessionStorage.setItem("daydream_playerId", savedId);
  }
  return savedId;
}

// ===================================================================
// REGISTRATION & DISCONNECT HANDLING
// ===================================================================

function joinGameInFirebase(localPlayerData) {
  if (!database) {
    console.warn("Database not ready yet.");
    return;
  }

  myPlayerId = getOrCreatePlayerId();
  myPlayerRef = database.ref("players/" + myPlayerId);

  const initialRecord = {
    id: myPlayerId,
    name: localPlayerData.name,
    color: localPlayerData.color,
    x: Math.round(localPlayerData.x),
    y: Math.round(localPlayerData.y),
    score: localPlayerData.score || 0,
    radius: localPlayerData.radius || 24,
    joinedAt: firebase.database.ServerValue.TIMESTAMP
  };

  myPlayerRef.onDisconnect().remove().catch((err) => {
    console.error("Failed to setup onDisconnect:", err);
  });

  myPlayerRef.set(initialRecord).then(() => {
    console.log("Joined Firebase as player:", myPlayerId, localPlayerData.name);
  }).catch((err) => {
    console.error("Failed to write initial player data:", err);
  });

  const connectedRef = database.ref(".info/connected");
  connectedRef.on("value", (snap) => {
    if (snap.val() === true && myPlayerRef) {
      myPlayerRef.onDisconnect().remove();
    }
  });

  return myPlayerId;
}

function sendPlayerUpdateToFirebase(x, y, score, forceImmediate = false) {
  if (!myPlayerRef) return;

  const now = Date.now();
  if (forceImmediate || now - lastNetworkWriteTime >= NETWORK_TICK_MS) {
    lastNetworkWriteTime = now;
    myPlayerRef.update({
      x: Math.round(x),
      y: Math.round(y),
      score: score
    });
  }
}

// ===================================================================
// REAL-TIME MULTIPLAYER LISTENERS (PLAYERS)
// ===================================================================

function initMultiplayerListeners() {
  if (!playersRef) return;

  playersRef.on("child_added", (snapshot) => {
    const id = snapshot.key;
    if (id !== myPlayerId) {
      networkPlayers[id] = snapshot.val();
    }
  });

  playersRef.on("child_changed", (snapshot) => {
    const id = snapshot.key;
    if (id !== myPlayerId) {
      networkPlayers[id] = snapshot.val();
    }
  });

  playersRef.on("child_removed", (snapshot) => {
    const id = snapshot.key;
    delete networkPlayers[id];
  });
}

// Clean up player on tab close
window.addEventListener("beforeunload", () => {
  if (myPlayerRef) {
    myPlayerRef.remove();
  }
});

// ===================================================================
// SHARED COLLECTIBLES SYSTEM (FIREBASE SYNCHRONIZATION)
// ===================================================================

/**
 * Generates a random coordinate within world bounds with padding
 */
function getRandomWorldCoord(padding, max) {
  return Math.floor(padding + Math.random() * (max - padding * 2));
}

/**
 * Initializes shared collectibles in Firebase Realtime Database.
 * Uses a transaction on `/collectibles` so that whichever client connects
 * first initializes the pool, while subsequent clients (and page reloads)
 * see the existing data and do NOT re-initialize or create duplicates!
 */
function initSharedCollectiblesInFirebase(worldW, worldH, padding, numStars, numSuns, numGreys) {
  if (!collectiblesRef) return;

  // 1. Transaction to guarantee ONE-TIME initialization
  collectiblesRef.transaction((currentData) => {
    // If collectibles already exist in the database, ABORT the transaction!
    if (currentData !== null) {
      return; // Returning undefined aborts without changes
    }

    // Database is empty: populate initial collectibles pool
    const initialPool = {};
    let itemIndex = 0;

    // Stars (+1 point)
    for (let i = 0; i < numStars; i++) {
      const id = "item_" + itemIndex++;
      initialPool[id] = {
        id: id,
        type: "star",
        x: getRandomWorldCoord(padding, worldW),
        y: getRandomWorldCoord(padding, worldH),
        radius: 12,
        value: 1,
        collected: false,
        collectedBy: null,
        respawnAt: 0
      };
    }

    // Suns (+2 points)
    for (let i = 0; i < numSuns; i++) {
      const id = "item_" + itemIndex++;
      initialPool[id] = {
        id: id,
        type: "sun",
        x: getRandomWorldCoord(padding, worldW),
        y: getRandomWorldCoord(padding, worldH),
        radius: 16,
        value: 2,
        collected: false,
        collectedBy: null,
        respawnAt: 0
      };
    }

    // Grey Balls (-1 point)
    for (let i = 0; i < numGreys; i++) {
      const id = "item_" + itemIndex++;
      initialPool[id] = {
        id: id,
        type: "grey_ball",
        x: getRandomWorldCoord(padding, worldW),
        y: getRandomWorldCoord(padding, worldH),
        radius: 13,
        value: -1,
        collected: false,
        collectedBy: null,
        respawnAt: 0
      };
    }

    return initialPool;
  }, (error, committed) => {
    if (error) {
      console.error("Error during collectibles initialization transaction:", error);
    } else if (committed) {
      console.log("Shared collectibles pool initialized successfully in Firebase!");
    } else {
      console.log("Existing shared collectibles pool loaded from Firebase.");
    }
  });

  // 2. Real-time listeners to sync collectibles to our local `sharedCollectibles` store
  collectiblesRef.on("child_added", (snapshot) => {
    sharedCollectibles[snapshot.key] = snapshot.val();
  });

  collectiblesRef.on("child_changed", (snapshot) => {
    sharedCollectibles[snapshot.key] = snapshot.val();
  });

  collectiblesRef.on("child_removed", (snapshot) => {
    delete sharedCollectibles[snapshot.key];
  });

  // 3. Fallback recovery loop:
  // If a player collects an object and suddenly closes their browser before the 1-second
  // respawn fires, this background check safely recovers any stuck items via transaction.
  setInterval(() => {
    const now = Date.now();
    for (let id in sharedCollectibles) {
      let item = sharedCollectibles[id];
      if (item && item.collected && item.respawnAt && now > item.respawnAt + 2500) {
        respawnSharedCollectibleInFirebase(id, worldW, worldH, padding);
      }
    }
  }, 3000);
}

/**
 * ATOMIC COLLECTION VIA FIREBASE TRANSACTION:
 * When a player touches an object, this transaction runs on the Firebase server.
 * If two players touch the item simultaneously:
 * - The first player's transaction commits -> sets `collected = true` and `collectedBy = myPlayerId`.
 * - The second player's transaction aborts because `item.collected` is already `true`.
 * - ONLY the winning player receives points and schedules the respawn!
 */
function attemptCollectItemInFirebase(itemId, worldW, worldH, padding, onAwardPointsCallback) {
  if (!database || !myPlayerId) return;

  // Prevent multiple simultaneous clicks / touches on the same item while transaction is in flight
  if (pendingCollections[itemId]) return;
  pendingCollections[itemId] = true;

  const itemRef = database.ref("collectibles/" + itemId);

  itemRef.transaction((item) => {
    // If item does not exist or has already been collected, abort!
    if (!item || item.collected === true) {
      return; // Returning undefined aborts transaction cleanly
    }

    // Atomically claim the item
    item.collected = true;
    item.collectedBy = myPlayerId;
    item.respawnAt = Date.now() + 1000; // 1-second respawn target timestamp
    return item;
  }, (error, committed, snapshot) => {
    delete pendingCollections[itemId];

    if (error) {
      console.error("Collection transaction error:", error);
      return;
    }

    // ONLY the player whose transaction actually committed receives the points!
    if (committed && snapshot && snapshot.val() && snapshot.val().collectedBy === myPlayerId) {
      const itemData = snapshot.val();

      // 1. Award points locally and push score update
      if (typeof onAwardPointsCallback === "function") {
        onAwardPointsCallback(itemData.value);
      }

      // 2. Schedule the single authoritative respawn 1 second later
      setTimeout(() => {
        respawnSharedCollectibleInFirebase(itemId, worldW, worldH, padding);
      }, 1000);
    }
  });
}

/**
 * Atomically respawns a collected item with fresh coordinates within world bounds.
 */
function respawnSharedCollectibleInFirebase(itemId, worldW, worldH, padding) {
  if (!database) return;

  const itemRef = database.ref("collectibles/" + itemId);

  itemRef.transaction((item) => {
    // Only respawn if the item is currently in collected state
    if (item && item.collected === true) {
      item.x = getRandomWorldCoord(padding, worldW);
      item.y = getRandomWorldCoord(padding, worldH);
      item.collected = false;
      item.collectedBy = null;
      item.respawnAt = 0;
      return item;
    }
    return; // Already respawned by another process
  }, (error, committed) => {
    if (error) {
      console.error("Respawn transaction error for", itemId, error);
    }
  });
}
