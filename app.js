import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  GoogleAuthProvider,
  browserSessionPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  allowedEmailDomains as configuredDomains,
  allowedEmails as configuredEmails,
  firebaseConfig
} from "./firebase-config.js";

const CARD_VALUES = ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "?"];
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REQUIRED_CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
const STALE_MS = 120000;
const HEARTBEAT_MS = 25000;
const ALLOWED_DOMAINS = Array.isArray(configuredDomains)
  ? configuredDomains.map((domain) => String(domain).toLowerCase().replace(/^@/, "").trim()).filter(Boolean)
  : [];
const ALLOWED_EMAILS = Array.isArray(configuredEmails)
  ? configuredEmails.map((email) => String(email).toLowerCase().trim()).filter(Boolean)
  : [];

const els = {
  status: document.getElementById("status"),
  entryPanel: document.getElementById("entryPanel"),
  entryTitle: document.getElementById("entryTitle"),
  entryHint: document.getElementById("entryHint"),
  entryForm: document.getElementById("entryForm"),
  entryButton: document.getElementById("entryButton"),
  googleSignInButton: document.getElementById("googleSignInButton"),
  googleSignOutButton: document.getElementById("googleSignOutButton"),
  signedInText: document.getElementById("signedInText"),

  roomPanel: document.getElementById("roomPanel"),
  roomCodeText: document.getElementById("roomCodeText"),
  roundText: document.getElementById("roundText"),
  copyInviteButton: document.getElementById("copyInviteButton"),
  leaveButton: document.getElementById("leaveButton"),

  hostControls: document.getElementById("hostControls"),
  revealButton: document.getElementById("revealButton"),
  nextRoundButton: document.getElementById("nextRoundButton"),
  controlHint: document.getElementById("controlHint"),

  cards: document.getElementById("cards"),
  participants: document.getElementById("participants"),
  participantCount: document.getElementById("participantCount"),
  summary: document.getElementById("summary")
};

const state = {
  auth: null,
  db: null,
  uid: "",
  userEmail: "",
  roomCode: "",
  displayName: "",
  isHost: false,
  hostUid: "",
  round: 1,
  revealed: false,
  selectedVote: null,
  participants: new Map(),
  roomUnsub: null,
  participantUnsub: null,
  heartbeatTimer: null,
  busy: false
};

function setStatus(message, isError = false) {
  if (!message) {
    els.status.textContent = "";
    els.status.classList.add("hidden");
    return;
  }

  els.status.textContent = message;
  els.status.classList.remove("hidden");
  els.status.style.background = isError ? "#fdecea" : "#fff7e6";
  els.status.style.borderColor = isError ? "#f5c2c0" : "#ffd6a5";
  els.status.style.color = isError ? "#8a1c17" : "#7f5539";
}

function isFirebaseConfigured() {
  return REQUIRED_CONFIG_KEYS.every((key) => {
    const value = firebaseConfig[key];
    return value && !String(value).includes("REPLACE_ME");
  });
}

function getRoomCodeFromUrl() {
  const roomCode = new URLSearchParams(window.location.search).get("room") || "";
  return roomCode.trim().toUpperCase();
}

function setRoomCodeInUrl(roomCode) {
  const url = new URL(window.location.href);
  if (roomCode) {
    url.searchParams.set("room", roomCode);
  } else {
    url.searchParams.delete("room");
  }
  history.replaceState({}, "", url);
}

function sanitizeName(rawName) {
  return String(rawName).trim().replace(/\s+/g, " ").slice(0, 30);
}

function getUserDisplayName(user) {
  const profileName = sanitizeName(user?.displayName || "");
  if (profileName) {
    return profileName;
  }

  const email = String(user?.email || "").trim();
  const localPart = email.includes("@") ? email.split("@")[0] : "";
  return sanitizeName(localPart || "Participant");
}

function getEmailDomain(email) {
  const cleaned = String(email || "").toLowerCase().trim();
  if (!cleaned.includes("@")) {
    return "";
  }
  return cleaned.split("@").pop() || "";
}

function validateSignedInUser(user) {
  if (!user) {
    return { ok: false, message: "Not signed in." };
  }

  const email = String(user.email || "").toLowerCase().trim();
  if (!email) {
    return { ok: false, message: "Google account did not provide an email." };
  }

  if (ALLOWED_DOMAINS.length === 0 && ALLOWED_EMAILS.length === 0) {
    return { ok: true };
  }

  if (ALLOWED_EMAILS.includes(email)) {
    return { ok: true };
  }

  const domain = getEmailDomain(email);
  if (ALLOWED_DOMAINS.includes(domain)) {
    return { ok: true };
  }

  const domainPart = ALLOWED_DOMAINS.length ? `domains: ${ALLOWED_DOMAINS.join(", ")}` : "";
  const emailPart = ALLOWED_EMAILS.length ? `emails: ${ALLOWED_EMAILS.join(", ")}` : "";
  const separator = domainPart && emailPart ? " | " : "";

  return {
    ok: false,
    message: `This app is restricted to ${domainPart}${separator}${emailPart}.`
  };
}

function generateRoomCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[idx];
  }
  return code;
}

function roomRef(roomCode = state.roomCode) {
  return doc(state.db, "rooms", roomCode);
}

function participantRef(uid = state.uid, roomCode = state.roomCode) {
  return doc(state.db, "rooms", roomCode, "participants", uid);
}

function setEntryMode(roomCodeFromUrl) {
  const isSignedIn = Boolean(state.uid);

  if (!isSignedIn) {
    els.entryTitle.textContent = roomCodeFromUrl ? `Join Session ${roomCodeFromUrl}` : "Create a Session";
    els.entryHint.textContent = roomCodeFromUrl
      ? "Sign in with Google, then join this session."
      : "Sign in with Google, then create a new session.";
    els.googleSignInButton.classList.remove("hidden");
    els.googleSignOutButton.classList.add("hidden");
    els.signedInText.classList.add("hidden");
    els.entryForm.classList.add("hidden");
    return;
  }

  els.entryTitle.textContent = roomCodeFromUrl ? `Join Session ${roomCodeFromUrl}` : "Create a Session";
  els.entryHint.textContent = roomCodeFromUrl
    ? "You are signed in. Join this session now."
    : "You are signed in. Create a room and share the invite link.";
  els.entryButton.textContent = roomCodeFromUrl ? "Join Session" : "Create Session";

  els.googleSignInButton.classList.add("hidden");
  els.googleSignOutButton.classList.remove("hidden");
  els.signedInText.classList.remove("hidden");
  els.entryForm.classList.remove("hidden");

  const identity = state.userEmail ? `${state.displayName} (${state.userEmail})` : state.displayName;
  els.signedInText.textContent = `Signed in as ${identity}`;
}

function setCardsDisabled(disabled) {
  for (const btn of els.cards.querySelectorAll("button")) {
    btn.disabled = disabled;
  }
}

function renderCards() {
  els.cards.innerHTML = "";

  for (const value of CARD_VALUES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card";
    btn.textContent = value;
    btn.dataset.value = value;
    btn.addEventListener("click", async () => {
      if (!state.roomCode || state.revealed || state.busy) {
        return;
      }
      await castVote(value);
    });

    if (state.selectedVote === value) {
      btn.classList.add("active");
    }

    if (state.revealed || !state.roomCode) {
      btn.disabled = true;
    }

    els.cards.appendChild(btn);
  }
}

function renderControls() {
  els.roomCodeText.textContent = state.roomCode || "------";
  els.roundText.textContent = `Round ${state.round}`;

  els.hostControls.classList.toggle("hidden", !state.isHost);
  els.revealButton.disabled = !state.isHost || state.revealed || state.busy;
  els.nextRoundButton.disabled = !state.isHost || !state.revealed || state.busy;

  if (state.isHost) {
    els.controlHint.textContent = state.revealed
      ? "Votes are revealed. Start a new round to vote again."
      : "You are host. Reveal votes when everyone is ready.";
  } else {
    els.controlHint.textContent = state.revealed
      ? "Host revealed the cards."
      : "Waiting for host to reveal votes.";
  }

  setCardsDisabled(!state.roomCode || state.revealed || state.busy);
  renderCards();
}

function formatVote(participant) {
  const vote = participant.vote;
  const hasVote = vote !== null && vote !== undefined && vote !== "";

  if (!hasVote) {
    return "Waiting";
  }

  if (state.revealed || participant.uid === state.uid) {
    return String(vote);
  }

  return "Voted";
}

function isParticipantOffline(participant) {
  if (!participant.lastActiveMillis) {
    return false;
  }
  return Date.now() - participant.lastActiveMillis > STALE_MS;
}

function renderParticipants() {
  const list = Array.from(state.participants.values()).sort((a, b) => {
    const aJoined = a.joinedAtMillis ?? Number.MAX_SAFE_INTEGER;
    const bJoined = b.joinedAtMillis ?? Number.MAX_SAFE_INTEGER;
    if (aJoined !== bJoined) {
      return aJoined - bJoined;
    }
    return a.name.localeCompare(b.name);
  });

  els.participantCount.textContent = `${list.length} total`;
  els.participants.innerHTML = "";

  for (const participant of list) {
    const li = document.createElement("li");
    li.className = "participant";

    const left = document.createElement("div");
    left.className = "name";

    const name = document.createElement("span");
    name.textContent = participant.uid === state.uid ? `${participant.name} (you)` : participant.name;
    left.appendChild(name);

    if (participant.uid === state.hostUid) {
      const hostBadge = document.createElement("span");
      hostBadge.className = "badge host";
      hostBadge.textContent = "host";
      left.appendChild(hostBadge);
    }

    if (isParticipantOffline(participant)) {
      const staleBadge = document.createElement("span");
      staleBadge.className = "badge offline";
      staleBadge.textContent = "inactive";
      left.appendChild(staleBadge);
    }

    const right = document.createElement("span");
    const voteText = formatVote(participant);
    right.textContent = voteText;
    right.className = `vote ${voteText === "Voted" ? "voted" : ""}`;

    li.append(left, right);
    els.participants.appendChild(li);
  }

  renderSummary(list);
}

function renderSummary(list) {
  if (!state.revealed) {
    els.summary.classList.add("hidden");
    els.summary.textContent = "";
    return;
  }

  const numericVotes = list
    .map((p) => Number.parseFloat(String(p.vote)))
    .filter((n) => Number.isFinite(n));

  if (!numericVotes.length) {
    els.summary.textContent = "Votes revealed.";
    els.summary.classList.remove("hidden");
    return;
  }

  const total = numericVotes.reduce((sum, value) => sum + value, 0);
  const average = total / numericVotes.length;
  const min = Math.min(...numericVotes);
  const max = Math.max(...numericVotes);

  els.summary.textContent = `Revealed ${numericVotes.length} numeric votes. Average ${average.toFixed(1)}, range ${min}-${max}.`;
  els.summary.classList.remove("hidden");
}

function resetLiveState() {
  state.participants.clear();
  state.selectedVote = null;
  state.revealed = false;
  state.round = 1;
  state.hostUid = "";
  state.isHost = false;

  renderCards();
  renderControls();
  renderParticipants();
}

function stopLiveListeners() {
  if (state.roomUnsub) {
    state.roomUnsub();
    state.roomUnsub = null;
  }
  if (state.participantUnsub) {
    state.participantUnsub();
    state.participantUnsub = null;
  }
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

async function ensureUniqueRoomCode() {
  for (let i = 0; i < 8; i += 1) {
    const code = generateRoomCode();
    const existing = await getDoc(roomRef(code));
    if (!existing.exists()) {
      return code;
    }
  }
  throw new Error("Unable to generate a unique room code. Please retry.");
}

async function createRoom(displayName) {
  const code = await ensureUniqueRoomCode();

  await setDoc(roomRef(code), {
    hostUid: state.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    round: 1,
    revealed: false
  });

  await setDoc(participantRef(state.uid, code), {
    uid: state.uid,
    name: displayName,
    vote: null,
    joinedAt: serverTimestamp(),
    lastActive: serverTimestamp()
  });

  return code;
}

async function joinRoom(roomCode, displayName) {
  const snap = await getDoc(roomRef(roomCode));
  if (!snap.exists()) {
    throw new Error(`Session ${roomCode} was not found.`);
  }

  await setDoc(
    participantRef(state.uid, roomCode),
    {
      uid: state.uid,
      name: displayName,
      joinedAt: serverTimestamp(),
      lastActive: serverTimestamp()
    },
    { merge: true }
  );
}

async function touchPresence() {
  if (!state.roomCode || !state.uid) {
    return;
  }

  await setDoc(
    participantRef(),
    {
      uid: state.uid,
      name: state.displayName,
      lastActive: serverTimestamp()
    },
    { merge: true }
  );
}

function startPresenceHeartbeat() {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
  }

  state.heartbeatTimer = setInterval(() => {
    touchPresence().catch(() => {
      // Ignore intermittent network issues; next heartbeat will retry.
    });
  }, HEARTBEAT_MS);
}

function subscribeToRoom(roomCode) {
  stopLiveListeners();

  state.roomUnsub = onSnapshot(roomRef(roomCode), (snap) => {
    if (!snap.exists()) {
      setStatus(`Session ${roomCode} ended or was deleted.`, true);
      leaveRoom(false).catch(() => {
        // No further action needed.
      });
      return;
    }

    const room = snap.data();
    state.hostUid = room.hostUid || "";
    state.isHost = state.uid === state.hostUid;
    state.round = Number(room.round) || 1;
    state.revealed = Boolean(room.revealed);

    renderControls();
    renderParticipants();
  });

  state.participantUnsub = onSnapshot(collection(state.db, "rooms", roomCode, "participants"), (snap) => {
    state.participants.clear();

    for (const participantDoc of snap.docs) {
      const participant = participantDoc.data();
      const lastActiveMillis = participant.lastActive?.toMillis ? participant.lastActive.toMillis() : null;
      const joinedAtMillis = participant.joinedAt?.toMillis ? participant.joinedAt.toMillis() : null;
      state.participants.set(participantDoc.id, {
        uid: participant.uid || participantDoc.id,
        name: participant.name || "Unnamed",
        vote: participant.vote ?? null,
        lastActiveMillis,
        joinedAtMillis
      });
    }

    const me = state.participants.get(state.uid);
    state.selectedVote = me?.vote ?? null;

    renderCards();
    renderParticipants();
  });

  startPresenceHeartbeat();
}

async function enterSession(roomCode, displayName) {
  state.roomCode = roomCode;
  state.displayName = displayName;
  sessionStorage.setItem("poker:displayName", displayName);
  sessionStorage.setItem("poker:roomCode", roomCode);

  setRoomCodeInUrl(roomCode);
  els.entryPanel.classList.add("hidden");
  els.roomPanel.classList.remove("hidden");
  setStatus("");

  renderCards();
  renderControls();
  subscribeToRoom(roomCode);

  await touchPresence();
}

async function leaveRoom(signOutAuth = false) {
  const roomCode = state.roomCode;

  stopLiveListeners();

  if (roomCode && state.uid) {
    try {
      await deleteDoc(participantRef(state.uid, roomCode));
    } catch (_error) {
      // Best effort cleanup.
    }
  }

  state.roomCode = "";
  resetLiveState();

  sessionStorage.removeItem("poker:roomCode");
  setRoomCodeInUrl("");

  els.roomPanel.classList.add("hidden");
  els.entryPanel.classList.remove("hidden");
  setEntryMode("");

  if (signOutAuth && state.auth.currentUser) {
    await signOut(state.auth);
  }
}

async function castVote(value) {
  state.selectedVote = value;
  renderCards();

  await setDoc(
    participantRef(),
    {
      uid: state.uid,
      name: state.displayName,
      vote: value,
      lastActive: serverTimestamp()
    },
    { merge: true }
  );
}

async function revealVotes() {
  if (!state.isHost || state.revealed) {
    return;
  }

  state.busy = true;
  renderControls();

  try {
    await updateDoc(roomRef(), {
      revealed: true,
      updatedAt: serverTimestamp()
    });
  } finally {
    state.busy = false;
    renderControls();
  }
}

async function startNextRound() {
  if (!state.isHost || !state.revealed) {
    return;
  }

  state.busy = true;
  renderControls();

  try {
    const participantsSnapshot = await getDocs(collection(state.db, "rooms", state.roomCode, "participants"));
    const batch = writeBatch(state.db);

    batch.update(roomRef(), {
      revealed: false,
      round: state.round + 1,
      updatedAt: serverTimestamp()
    });

    for (const participantDoc of participantsSnapshot.docs) {
      batch.set(
        participantDoc.ref,
        {
          vote: null,
          lastActive: serverTimestamp()
        },
        { merge: true }
      );
    }

    await batch.commit();
  } finally {
    state.busy = false;
    renderControls();
  }
}

async function handleEntrySubmit(event) {
  event.preventDefault();

  if (state.busy) {
    return;
  }

  if (!state.uid) {
    setStatus("Please sign in with Google first.", true);
    return;
  }

  const roomCodeFromUrl = getRoomCodeFromUrl();
  const displayName = sanitizeName(state.displayName || "Participant");

  state.busy = true;
  els.entryButton.disabled = true;
  setStatus("");

  try {
    if (roomCodeFromUrl) {
      await joinRoom(roomCodeFromUrl, displayName);
      await enterSession(roomCodeFromUrl, displayName);
    } else {
      const newRoomCode = await createRoom(displayName);
      await enterSession(newRoomCode, displayName);
    }
  } catch (error) {
    setStatus(error.message || "Unable to join session.", true);
  } finally {
    state.busy = false;
    els.entryButton.disabled = false;
  }
}

function wireEvents() {
  els.googleSignInButton.addEventListener("click", async () => {
    if (state.busy) {
      return;
    }

    state.busy = true;
    els.googleSignInButton.disabled = true;
    setStatus("");

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(state.auth, provider);
    } catch (error) {
      const message = error?.code === "auth/popup-closed-by-user" ? "Sign-in cancelled." : "Google sign-in failed.";
      setStatus(message, true);
    } finally {
      state.busy = false;
      els.googleSignInButton.disabled = false;
    }
  });

  els.googleSignOutButton.addEventListener("click", async () => {
    if (state.roomCode) {
      await leaveRoom(false);
    }
    await signOut(state.auth);
    setStatus("Signed out.");
  });

  els.entryForm.addEventListener("submit", handleEntrySubmit);

  els.copyInviteButton.addEventListener("click", async () => {
    if (!state.roomCode) {
      return;
    }

    const invite = `${window.location.origin}${window.location.pathname}?room=${state.roomCode}`;

    try {
      await navigator.clipboard.writeText(invite);
      setStatus("Invite link copied.");
    } catch (_error) {
      setStatus(`Copy failed. Share this manually: ${invite}`, true);
    }
  });

  els.leaveButton.addEventListener("click", async () => {
    await leaveRoom(false);
    setStatus("Left session.");
  });

  els.revealButton.addEventListener("click", async () => {
    try {
      await revealVotes();
    } catch (_error) {
      setStatus("Failed to reveal votes.", true);
    }
  });

  els.nextRoundButton.addEventListener("click", async () => {
    try {
      await startNextRound();
    } catch (_error) {
      setStatus("Failed to start next round.", true);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      touchPresence().catch(() => {
        // Non-fatal.
      });
    }
  });

  window.addEventListener("pagehide", () => {
    if (!state.roomCode || !state.uid) {
      return;
    }

    deleteDoc(participantRef()).catch(() => {
      // Best effort cleanup only.
    });
  });
}

function wireAuthState() {
  onAuthStateChanged(state.auth, async (user) => {
    const roomCodeFromUrl = getRoomCodeFromUrl();

    if (!user) {
      if (state.roomCode) {
        await leaveRoom(false);
      }

      state.uid = "";
      state.userEmail = "";
      state.displayName = "";
      sessionStorage.removeItem("poker:displayName");

      setEntryMode(roomCodeFromUrl);
      return;
    }

    const validation = validateSignedInUser(user);
    if (!validation.ok) {
      setStatus(validation.message, true);
      await signOut(state.auth);
      return;
    }

    state.uid = user.uid;
    state.userEmail = String(user.email || "").toLowerCase().trim();
    state.displayName = getUserDisplayName(user);
    sessionStorage.setItem("poker:displayName", state.displayName);

    setEntryMode(roomCodeFromUrl);
    setStatus("");
  });
}

async function init() {
  if (!isFirebaseConfigured()) {
    setStatus("Fill in firebase-config.js before running the app.", true);
    els.entryButton.disabled = true;
    els.googleSignInButton.disabled = true;
    return;
  }

  const app = initializeApp(firebaseConfig);
  state.auth = getAuth(app);
  state.db = getFirestore(app);

  await setPersistence(state.auth, browserSessionPersistence);

  wireEvents();
  wireAuthState();
  setEntryMode(getRoomCodeFromUrl());
  renderCards();
}

init().catch((error) => {
  setStatus(error.message || "Initialization failed.", true);
});
