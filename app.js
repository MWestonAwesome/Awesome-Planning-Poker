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
} from "./firebase-config.js?v=20260319c";

const CARD_OPTIONS = [
  { value: "0", label: "0", detail: "Trivial" },
  { value: "1", label: "1", detail: "Tiny" },
  { value: "2", label: "2", detail: "Small" },
  { value: "3", label: "3", detail: "Straightforward" },
  { value: "5", label: "5", detail: "Moderate" },
  { value: "8", label: "8", detail: "Chunky" },
  { value: "13", label: "13", detail: "Large" },
  { value: "21", label: "21", detail: "Very large" },
  { value: "34", label: "34", detail: "Break it up" },
  { value: "55", label: "55", detail: "Needs slicing" },
  { value: "89", label: "89", detail: "Too big" },
  { value: "?", label: "?", detail: "Need context" },
  { value: "THROW", label: "Throw Paper", detail: "Back to refinement" }
];
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REQUIRED_CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
const STALE_MS = 120000;
const HEARTBEAT_MS = 25000;
const REVEAL_COUNTDOWN_MS = 4000;
const COUNTDOWN_TICK_MS = 250;
const SPEECH_LANG = "en-GB";
function normalizeEmail(rawEmail) {
  const email = String(rawEmail || "").toLowerCase().trim();
  if (!email.includes("@")) {
    return email;
  }
  const [local, rawDomain] = email.split("@");
  const domain = rawDomain === "googlemail.com" ? "gmail.com" : rawDomain;
  const normalizedLocal = domain === "gmail.com" ? local.split("+")[0].replace(/\./g, "") : local;
  return `${normalizedLocal}@${domain}`;
}

function normalizeDomain(rawDomain) {
  const domain = String(rawDomain || "").toLowerCase().replace(/^@/, "").trim();
  return domain === "googlemail.com" ? "gmail.com" : domain;
}

const ALLOWED_DOMAINS = Array.isArray(configuredDomains)
  ? configuredDomains.map((domain) => normalizeDomain(domain)).filter(Boolean)
  : [];
const ALLOWED_EMAILS = Array.isArray(configuredEmails)
  ? configuredEmails.map((email) => normalizeEmail(email)).filter(Boolean)
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
  takeoverControls: document.getElementById("takeoverControls"),
  revealButton: document.getElementById("revealButton"),
  nextRoundButton: document.getElementById("nextRoundButton"),
  claimHostButton: document.getElementById("claimHostButton"),
  controlHint: document.getElementById("controlHint"),
  countdownBadge: document.getElementById("countdownBadge"),
  countdownValue: document.getElementById("countdownValue"),
  readyBadge: document.getElementById("readyBadge"),

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
  countdownEndsAt: 0,
  selectedVote: null,
  participants: new Map(),
  roomUnsub: null,
  participantUnsub: null,
  heartbeatTimer: null,
  countdownTimer: null,
  revealAnimationTimer: null,
  revealAnimationUntil: 0,
  voices: [],
  lastSpokenCountdown: null,
  finalizingReveal: false,
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
  const cleaned = normalizeEmail(email);
  if (!cleaned.includes("@")) {
    return "";
  }
  return cleaned.split("@").pop() || "";
}

function getCandidateEmails(user) {
  const emails = new Set();
  const pushEmail = (value) => {
    const cleaned = normalizeEmail(value);
    if (cleaned) {
      emails.add(cleaned);
    }
  };

  pushEmail(user?.email || "");

  if (Array.isArray(user?.providerData)) {
    for (const profile of user.providerData) {
      pushEmail(profile?.email || "");
    }
  }

  return Array.from(emails);
}

function validateSignedInUser(user) {
  if (!user) {
    return { ok: false, message: "Not signed in." };
  }

  const candidateEmails = getCandidateEmails(user);
  if (candidateEmails.length === 0) {
    return { ok: false, message: "Google account did not provide an email." };
  }

  if (ALLOWED_DOMAINS.length === 0 && ALLOWED_EMAILS.length === 0) {
    return { ok: true };
  }

  for (const email of candidateEmails) {
    if (ALLOWED_EMAILS.includes(email)) {
      return { ok: true };
    }
  }

  for (const email of candidateEmails) {
    const domain = getEmailDomain(email);
    if (ALLOWED_DOMAINS.includes(domain)) {
      return { ok: true };
    }
  }

  const selectedEmail = candidateEmails[0];
  return {
    ok: false,
    message: selectedEmail
      ? `Signed into Google as ${selectedEmail}. Use an approved company or tester account.`
      : "This app is restricted to approved company or tester accounts."
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

function canClaimHost() {
  if (!state.roomCode || state.isHost) {
    return false;
  }

  if (!state.hostUid) {
    return true;
  }

  const hostParticipant = state.participants.get(state.hostUid);
  return !hostParticipant || isParticipantOffline(hostParticipant);
}

function getCardOption(value) {
  return CARD_OPTIONS.find((option) => option.value === value) || null;
}

function getVoteLabel(value, compact = false) {
  const option = getCardOption(value);
  if (!option) {
    return String(value);
  }
  if (compact && option.value === "THROW") {
    return "Throw";
  }
  return option.label;
}

function getSpeech() {
  return window.speechSynthesis || null;
}

function loadVoices() {
  const speech = getSpeech();
  if (!speech) {
    return;
  }
  state.voices = speech.getVoices();
}

function pickArenaVoice() {
  const voices = Array.isArray(state.voices) ? state.voices : [];
  if (!voices.length) {
    return null;
  }

  const preferredNames = ["Daniel", "Google UK English Male", "Google US English", "Alex", "Fred"];
  for (const preferred of preferredNames) {
    const match = voices.find((voice) => voice.name.includes(preferred));
    if (match) {
      return match;
    }
  }

  return (
    voices.find((voice) => /^en[-_]/i.test(voice.lang) && /male|daniel|alex|google/i.test(voice.name)) ||
    voices.find((voice) => /^en[-_]/i.test(voice.lang)) ||
    voices[0]
  );
}

function speakLocal(text, mode = "announce") {
  const speech = getSpeech();
  if (!speech || !text) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(String(text));
  const voice = pickArenaVoice();

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || SPEECH_LANG;
  } else {
    utterance.lang = SPEECH_LANG;
  }

  if (mode === "vote") {
    utterance.rate = 0.78;
    utterance.pitch = 0.48;
  } else {
    utterance.rate = 0.9;
    utterance.pitch = 0.62;
  }

  utterance.volume = 1;
  speech.cancel();
  speech.speak(utterance);
}

function getVoteSpeech(value) {
  if (value === "?") {
    return "Need context";
  }
  if (value === "THROW") {
    return "Throw paper";
  }
  return getVoteLabel(value);
}

function syncCountdownSpeech() {
  if (!isCountdownActive()) {
    state.lastSpokenCountdown = null;
    return;
  }

  const seconds = getCountdownSecondsRemaining();
  const marker = state.finalizingReveal ? "flip" : String(seconds);
  if (state.lastSpokenCountdown === marker) {
    return;
  }

  state.lastSpokenCountdown = marker;

  if (state.finalizingReveal) {
    speakLocal("Reveal", "announce");
    return;
  }

  if (seconds >= 0 && seconds <= 3) {
    speakLocal(String(seconds), "announce");
  }
}

function getCountdownSecondsRemaining() {
  if (!state.countdownEndsAt) {
    return 0;
  }
  return Math.max(0, Math.ceil((state.countdownEndsAt - Date.now()) / 1000));
}

function isCountdownActive() {
  return Boolean(state.countdownEndsAt) && !state.revealed;
}

function hasParticipantVoted(participant) {
  return participant.vote !== null && participant.vote !== undefined && participant.vote !== "";
}

function getReadyCounts() {
  const list = Array.from(state.participants.values());
  const voted = list.filter((participant) => hasParticipantVoted(participant)).length;
  return {
    total: list.length,
    voted
  };
}

function syncCountdownTicker() {
  const countdownActive = isCountdownActive();

  if (countdownActive && !state.countdownTimer) {
    state.countdownTimer = setInterval(() => {
      if (state.isHost && state.countdownEndsAt && Date.now() >= state.countdownEndsAt) {
        finalizeRevealCountdown().catch(() => {
          // Non-fatal. Snapshot will reconcile state on the next update.
        });
      }
      renderControls();
      syncCountdownSpeech();
    }, COUNTDOWN_TICK_MS);
  }

  if (!countdownActive && state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }

  if (!countdownActive) {
    state.lastSpokenCountdown = null;
  }
}

function triggerRevealAnimation() {
  state.revealAnimationUntil = Date.now() + 1100;

  if (state.revealAnimationTimer) {
    clearTimeout(state.revealAnimationTimer);
  }

  state.revealAnimationTimer = setTimeout(() => {
    state.revealAnimationUntil = 0;
    state.revealAnimationTimer = null;
    renderParticipants();
  }, 1150);
}

function isRevealAnimationActive() {
  return state.revealAnimationUntil > Date.now();
}

function renderCards() {
  els.cards.innerHTML = "";

  for (const option of CARD_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card";
    btn.dataset.value = option.value;
    btn.addEventListener("click", async () => {
      if (!state.roomCode || state.revealed || state.busy || isCountdownActive()) {
        return;
      }
      await castVote(option.value);
    });

    const valueEl = document.createElement("span");
    valueEl.className = "card-value";
    valueEl.textContent = option.label;

    const labelEl = document.createElement("span");
    labelEl.className = "card-label";
    labelEl.textContent = option.detail;

    btn.append(valueEl, labelEl);

    if (option.value === "THROW") {
      btn.classList.add("card-throw");
    }

    if (state.selectedVote === option.value) {
      btn.classList.add("active");
    }

    if (state.revealed || !state.roomCode || isCountdownActive()) {
      btn.disabled = true;
    }

    els.cards.appendChild(btn);
  }
}

function renderControls() {
  els.roomCodeText.textContent = state.roomCode || "------";
  els.roundText.textContent = `Round ${state.round}`;
  const claimable = canClaimHost();
  const countdownActive = isCountdownActive();
  const countdownSeconds = getCountdownSecondsRemaining();
  const ready = getReadyCounts();
  const countdownDisplay = state.finalizingReveal ? "Flip" : String(Math.max(0, countdownSeconds));

  els.readyBadge.textContent = `${ready.voted} / ${ready.total} voted`;
  els.countdownBadge.classList.toggle("hidden", !countdownActive);
  els.countdownValue.textContent = countdownDisplay;
  els.hostControls.classList.toggle("hidden", !state.isHost);
  els.takeoverControls.classList.toggle("hidden", !claimable);
  els.revealButton.disabled = !state.isHost || state.revealed || countdownActive || state.finalizingReveal;
  els.nextRoundButton.disabled = !state.isHost || !state.revealed;
  els.claimHostButton.disabled = !claimable;
  els.revealButton.textContent = countdownActive ? `Countdown ${countdownDisplay}` : "Reveal";

  if (countdownActive) {
    els.controlHint.textContent = state.finalizingReveal
      ? "Cards are flipping over now."
      : `Foam dart reveal goes live in ${Math.max(0, countdownSeconds)} second${countdownSeconds === 1 ? "" : "s"}.`;
  } else if (state.isHost) {
    els.controlHint.textContent = state.revealed
      ? "Votes are revealed. Start a new round to vote again."
      : "You are host. Reveal votes when everyone is ready.";
  } else if (claimable) {
    els.controlHint.textContent = "Host is unavailable. Claim host to continue.";
  } else {
    els.controlHint.textContent = state.revealed
      ? "Host revealed the cards."
      : "Waiting for host to reveal votes.";
  }

  setCardsDisabled(!state.roomCode || state.revealed || state.busy || countdownActive);
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
    right.className = "vote-card";

    const voteInner = document.createElement("span");
    voteInner.className = "vote-card-inner";

    const voteFront = document.createElement("span");
    voteFront.className = "vote-card-face vote-card-front";

    const hasVote = hasParticipantVoted(participant);
    const showFront = !hasVote || state.revealed;
    const frontValue = document.createElement("span");
    frontValue.className = "vote-card-value";
    frontValue.textContent = hasVote ? getVoteLabel(participant.vote, true) : "Waiting";

    const frontLabel = document.createElement("span");
    frontLabel.className = "vote-card-label";
    if (!hasVote) {
      frontLabel.textContent = "No vote";
    } else if (participant.vote === "THROW") {
      frontLabel.textContent = "Refine";
    } else if (participant.vote === "?") {
      frontLabel.textContent = "Need context";
    } else {
      frontLabel.textContent = state.revealed ? "Revealed" : "Ready";
    }
    voteFront.append(frontValue, frontLabel);

    const voteBack = document.createElement("span");
    voteBack.className = "vote-card-face vote-card-back";

    const backValue = document.createElement("span");
    backValue.className = "vote-card-value";
    backValue.textContent = hasVote ? "Loaded" : "Hold";

    const backLabel = document.createElement("span");
    backLabel.className = "vote-card-label";
    backLabel.textContent = hasVote ? "Hidden vote" : "Waiting";
    voteBack.append(backValue, backLabel);

    voteInner.append(voteFront, voteBack);
    right.appendChild(voteInner);

    right.classList.toggle("is-face-up", showFront);
    right.classList.toggle("is-voted", hasVote);
    right.classList.toggle("is-throw", participant.vote === "THROW");
    right.classList.toggle("is-question", participant.vote === "?");
    right.classList.toggle("is-revealing", state.revealed && hasVote && isRevealAnimationActive());

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
  const throwPaperCount = list.filter((participant) => participant.vote === "THROW").length;
  const unknownCount = list.filter((participant) => participant.vote === "?").length;

  if (!numericVotes.length && !throwPaperCount && !unknownCount) {
    els.summary.textContent = "Votes revealed.";
    els.summary.classList.remove("hidden");
    return;
  }

  const parts = [];

  if (numericVotes.length) {
    const total = numericVotes.reduce((sum, value) => sum + value, 0);
    const average = total / numericVotes.length;
    const min = Math.min(...numericVotes);
    const max = Math.max(...numericVotes);
    parts.push(`Revealed ${numericVotes.length} numeric votes. Average ${average.toFixed(1)}, range ${min}-${max}.`);
  }

  if (unknownCount) {
    parts.push(`${unknownCount} question vote${unknownCount === 1 ? "" : "s"}.`);
  }

  if (throwPaperCount) {
    parts.push(`${throwPaperCount} throw paper vote${throwPaperCount === 1 ? "" : "s"} signalling more refinement needed.`);
  }

  els.summary.textContent = parts.join(" ");
  els.summary.classList.remove("hidden");
}

function resetLiveState() {
  state.participants.clear();
  state.selectedVote = null;
  state.revealed = false;
  state.countdownEndsAt = 0;
  state.revealAnimationUntil = 0;
  state.lastSpokenCountdown = null;
  state.round = 1;
  state.hostUid = "";
  state.isHost = false;
  state.finalizingReveal = false;

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
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  state.lastSpokenCountdown = null;
  if (state.revealAnimationTimer) {
    clearTimeout(state.revealAnimationTimer);
    state.revealAnimationTimer = null;
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
    revealed: false,
    revealCountdownEndsAt: null
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
    const wasRevealed = state.revealed;
    state.hostUid = room.hostUid || "";
    state.isHost = state.uid === state.hostUid;
    state.round = Number(room.round) || 1;
    state.revealed = Boolean(room.revealed);
    state.countdownEndsAt = Number(room.revealCountdownEndsAt) || 0;
    if (state.revealed) {
      state.countdownEndsAt = 0;
      state.finalizingReveal = false;
    }
    if (!wasRevealed && state.revealed) {
      triggerRevealAnimation();
    }
    syncCountdownTicker();
    syncCountdownSpeech();
    renderCards();
    renderControls();

    if (state.isHost && state.countdownEndsAt && Date.now() >= state.countdownEndsAt && !state.revealed) {
      finalizeRevealCountdown().catch(() => {
        // Non-fatal. Another client snapshot will reconcile state.
      });
    }

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
    renderControls();
    renderParticipants();
  });

  startPresenceHeartbeat();
}

async function enterSession(roomCode, displayName) {
  state.roomCode = roomCode;
  state.displayName = displayName;
  state.participants.clear();
  state.selectedVote = null;
  state.revealed = false;
  state.countdownEndsAt = 0;
  state.revealAnimationUntil = 0;
  state.lastSpokenCountdown = null;
  state.round = 1;
  state.hostUid = "";
  state.isHost = false;
  state.finalizingReveal = false;
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
  speakLocal(getVoteSpeech(value), "vote");

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

async function claimHost() {
  if (!canClaimHost()) {
    return;
  }

  state.busy = true;
  renderControls();

  try {
    await updateDoc(roomRef(), {
      hostUid: state.uid,
      updatedAt: serverTimestamp()
    });
    setStatus("You are now the host.");
  } finally {
    state.busy = false;
    renderControls();
  }
}

async function finalizeRevealCountdown() {
  if (!state.isHost || !state.countdownEndsAt || state.revealed || state.finalizingReveal) {
    return;
  }

  if (Date.now() < state.countdownEndsAt) {
    return;
  }

  state.finalizingReveal = true;
  renderControls();

  try {
    await updateDoc(roomRef(), {
      revealed: true,
      revealCountdownEndsAt: null,
      updatedAt: serverTimestamp()
    });
  } finally {
    state.finalizingReveal = false;
    renderControls();
  }
}

async function revealVotes() {
  if (!state.isHost || state.revealed || isCountdownActive()) {
    return;
  }

  state.busy = true;
  renderControls();

  try {
    await updateDoc(roomRef(), {
      revealed: false,
      revealCountdownEndsAt: Date.now() + REVEAL_COUNTDOWN_MS,
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
      revealCountdownEndsAt: null,
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

  els.claimHostButton.addEventListener("click", async () => {
    try {
      await claimHost();
    } catch (_error) {
      setStatus("Could not claim host yet. Ask the original host to leave first.", true);
    }
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
  loadVoices();
  if (getSpeech()) {
    getSpeech().onvoiceschanged = () => {
      loadVoices();
    };
  }

  await setPersistence(state.auth, browserSessionPersistence);

  wireEvents();
  wireAuthState();
  setEntryMode(getRoomCodeFromUrl());
  renderCards();
}

init().catch((error) => {
  setStatus(error.message || "Initialization failed.", true);
});
