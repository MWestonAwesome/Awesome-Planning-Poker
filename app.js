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
} from "./firebase-config.js?v=20260320a";
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { characterNamesByEmail } from "./character-config.js";

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
const TABLE_SEATS = [
  { seatX: 50, seatY: 7, cardX: 50, cardY: 29 },
  { seatX: 74, seatY: 15, cardX: 65, cardY: 34 },
  { seatX: 86, seatY: 33, cardX: 68, cardY: 43 },
  { seatX: 86, seatY: 58, cardX: 67, cardY: 52 },
  { seatX: 74, seatY: 76, cardX: 63, cardY: 57 },
  { seatX: 50, seatY: 85, cardX: 50, cardY: 56 },
  { seatX: 26, seatY: 76, cardX: 37, cardY: 57 },
  { seatX: 14, seatY: 58, cardX: 33, cardY: 52 },
  { seatX: 14, seatY: 33, cardX: 32, cardY: 43 },
  { seatX: 26, seatY: 15, cardX: 35, cardY: 34 }
];
const TABLE_SEAT_MAP = {
  1: [0],
  2: [8, 2],
  3: [9, 0, 1],
  4: [9, 1, 4, 6],
  5: [9, 1, 3, 5, 7],
  6: [9, 1, 2, 4, 6, 8],
  7: [9, 0, 1, 3, 5, 7, 8],
  8: [9, 1, 2, 3, 5, 6, 7, 8],
  9: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  10: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
};
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REQUIRED_CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
const STALE_MS = 120000;
const HEARTBEAT_MS = 25000;
const REVEAL_COUNTDOWN_MS = 4000;
const COUNTDOWN_TICK_MS = 250;
const SPEECH_LANG = "en-GB";
const SOUND_PREF_KEY = "poker:isMuted";
const SPEECH_LABELS = {
  "0": "Zero",
  "1": "One",
  "2": "Two",
  "3": "Three",
  "5": "Five",
  "8": "Eight",
  "13": "Thirteen",
  "21": "Twenty one",
  "34": "Thirty four",
  "55": "Fifty five",
  "89": "Eighty nine",
  "?": "Need context",
  THROW: "Throw paper"
};
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

function getCharacterName(email, fallbackName) {
  const normalizedEmail = normalizeEmail(email);
  const match = Object.entries(characterNamesByEmail).find(
    ([key, value]) => normalizeEmail(key) === normalizedEmail || normalizeEmail(value) === normalizedEmail
  );
  if (!match) {
    return sanitizeName(fallbackName || "Participant");
  }
  return sanitizeName(normalizeEmail(match[0]) === normalizedEmail ? match[1] : match[0]);
}

const ALLOWED_DOMAINS = Array.isArray(configuredDomains)
  ? configuredDomains.map((domain) => normalizeDomain(domain)).filter(Boolean)
  : [];
const ALLOWED_EMAILS = Array.isArray(configuredEmails)
  ? configuredEmails.map((email) => normalizeEmail(email)).filter(Boolean)
  : [];

const els = {
  status: document.getElementById("status"),
  heroSection: document.getElementById("heroSection"),
  tableStage: document.getElementById("tableStage"),
  tableScene: document.getElementById("tableScene"),
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
  muteButton: document.getElementById("muteButton"),

  hostControls: document.getElementById("hostControls"),
  takeoverControls: document.getElementById("takeoverControls"),
  revealButton: document.getElementById("revealButton"),
  nextRoundButton: document.getElementById("nextRoundButton"),
  claimHostButton: document.getElementById("claimHostButton"),
  hurryUpButton: document.getElementById("hurryUpButton"),
  controlHint: document.getElementById("controlHint"),
  countdownBadge: document.getElementById("countdownBadge"),
  countdownValue: document.getElementById("countdownValue"),
  readyBadge: document.getElementById("readyBadge"),

  cards: document.getElementById("cards"),
  participants: document.getElementById("participants"),
  participantCount: document.getElementById("participantCount"),
  summary: document.getElementById("summary"),
  celebrationLights: document.getElementById("celebrationLights"),
  confettiBurst: document.getElementById("confettiBurst")
};

const state = {
  auth: null,
  db: null,
  uid: "",
  userEmail: "",
  roomCode: "",
  displayName: "",
  characterName: "",
  isHost: false,
  hostUid: "",
  round: 1,
  revealed: false,
  hurryUpAt: 0,
  countdownEndsAt: 0,
  selectedVote: null,
  participants: new Map(),
  roomUnsub: null,
  participantUnsub: null,
  heartbeatTimer: null,
  countdownTimer: null,
  revealAnimationTimer: null,
  revealAnimationUntil: 0,
  celebrationTimer: null,
  hurryUpTimer: null,
  characterReactions: new Map(),
  characterReactionTimer: null,
  voices: [],
  lastSpokenCountdown: null,
  lastHandledHurryUpAt: 0,
  lastHandledThrowAt: 0,
  audioContext: null,
  countdownMusicTimer: null,
  countdownMusicStep: 0,
  isMuted: false,
  finalizingReveal: false,
  busy: false
};

let tableScene = null;

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

function readMutedPreference() {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) === "1";
  } catch (_error) {
    return false;
  }
}

function writeMutedPreference(value) {
  try {
    localStorage.setItem(SOUND_PREF_KEY, value ? "1" : "0");
  } catch (_error) {
    // Ignore storage failures.
  }
}

function updateMuteButton() {
  if (!els.muteButton) {
    return;
  }
  els.muteButton.textContent = state.isMuted ? "Muted" : "Sound On";
  els.muteButton.setAttribute("aria-pressed", state.isMuted ? "true" : "false");
}

function setMuted(nextMuted) {
  state.isMuted = Boolean(nextMuted);
  writeMutedPreference(state.isMuted);
  updateMuteButton();

  const speech = getSpeech();
  if (state.isMuted && speech) {
    speech.cancel();
  }

  if (state.isMuted) {
    stopCountdownMusic();
  } else {
    syncCountdownMusic();
  }
}

async function ensureAudioContext() {
  if (!window.AudioContext && !window.webkitAudioContext) {
    return null;
  }

  if (!state.audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new Ctx();
  }

  if (state.audioContext.state === "suspended") {
    try {
      await state.audioContext.resume();
    } catch (_error) {
      return state.audioContext;
    }
  }

  return state.audioContext;
}

function playSynthTone(frequency, startAt, duration, type = "triangle", volume = 0.045) {
  if (!state.audioContext || state.isMuted) {
    return;
  }

  const oscillator = state.audioContext.createOscillator();
  const gain = state.audioContext.createGain();
  const filter = state.audioContext.createBiquadFilter();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.985), startAt + duration);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400, startAt);
  filter.Q.value = 1.8;

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(state.audioContext.destination);

  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}

async function playCountdownPulse() {
  const audio = await ensureAudioContext();
  if (!audio || state.isMuted) {
    return;
  }

  const riffs = [
    [196, 246.94, 293.66],
    [220, 261.63, 329.63],
    [246.94, 293.66, 369.99],
    [261.63, 329.63, 392]
  ];
  const notes = riffs[state.countdownMusicStep % riffs.length];
  const start = audio.currentTime + 0.01;
  notes.forEach((frequency, index) => {
    playSynthTone(frequency, start + index * 0.035, 0.18, index === 0 ? "sawtooth" : "triangle", index === 0 ? 0.035 : 0.028);
  });
  state.countdownMusicStep += 1;
}

function stopCountdownMusic() {
  if (state.countdownMusicTimer) {
    clearInterval(state.countdownMusicTimer);
    state.countdownMusicTimer = null;
  }
  state.countdownMusicStep = 0;
}

function syncCountdownMusic() {
  if (state.isMuted || !isCountdownActive()) {
    stopCountdownMusic();
    return;
  }

  if (state.countdownMusicTimer) {
    return;
  }

  playCountdownPulse().catch(() => {
    // Audio can fail before first user gesture.
  });
  state.countdownMusicTimer = setInterval(() => {
    playCountdownPulse().catch(() => {
      // Ignore intermittent browser audio restrictions.
    });
  }, 320);
}

async function playRevealSting() {
  const audio = await ensureAudioContext();
  if (!audio || state.isMuted) {
    return;
  }

  const start = audio.currentTime + 0.01;
  playSynthTone(392, start, 0.16, "square", 0.05);
  playSynthTone(523.25, start + 0.08, 0.22, "square", 0.055);
  playSynthTone(659.25, start + 0.14, 0.28, "triangle", 0.06);
}

function launchCelebration() {
  if (!els.confettiBurst || !els.celebrationLights) {
    return;
  }

  if (state.celebrationTimer) {
    clearTimeout(state.celebrationTimer);
  }

  els.confettiBurst.innerHTML = "";
  const colors = ["var(--coral)", "var(--orange)", "var(--sky)", "var(--mint)", "var(--gold)", "var(--violet)"];

  for (let i = 0; i < 72; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.18}s`;
    piece.style.animationDuration = `${1.7 + Math.random() * 1.2}s`;
    piece.style.setProperty("--drift-x", `${-26 + Math.random() * 52}vw`);
    piece.style.setProperty("--spin-end", `${220 + Math.random() * 520}deg`);
    els.confettiBurst.appendChild(piece);
  }

  els.confettiBurst.classList.remove("hidden");
  els.confettiBurst.classList.add("is-live");
  els.celebrationLights.classList.remove("hidden");
  els.celebrationLights.classList.add("is-live");

  state.celebrationTimer = setTimeout(() => {
    els.confettiBurst.classList.remove("is-live");
    els.celebrationLights.classList.remove("is-live");
    els.confettiBurst.classList.add("hidden");
    els.celebrationLights.classList.add("hidden");
    els.confettiBurst.innerHTML = "";
    state.celebrationTimer = null;
  }, 2600);
}

function triggerHurryUpCue(fromUid) {
  if (fromUid) {
    state.characterReactions.set(fromUid, { mood: "angry", until: Date.now() + 1500 });
  }
  els.roomPanel.classList.add("is-hurry-up");
  renderParticipants();
  speakLocal("Hey!", "announce");

  if (state.hurryUpTimer) {
    clearTimeout(state.hurryUpTimer);
  }

  state.hurryUpTimer = setTimeout(() => {
    els.roomPanel.classList.remove("is-hurry-up");
    state.hurryUpTimer = null;
    const now = Date.now();
    for (const [uid, reaction] of state.characterReactions) {
      if (reaction.until <= now) {
        state.characterReactions.delete(uid);
      }
    }
    renderParticipants();
  }, 1500);
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

function pickArenaVoice(mode = "announce") {
  const voices = Array.isArray(state.voices) ? state.voices : [];
  if (!voices.length) {
    return null;
  }

  const preferredNames = mode === "vote"
    ? ["Bad News", "Fred", "Ralph", "Alex", "Daniel", "Google UK English Male", "Google US English"]
    : ["Bad News", "Fred", "Alex", "Daniel", "Google UK English Male", "Google US English"];
  for (const preferred of preferredNames) {
    const match = voices.find((voice) => voice.name.includes(preferred));
    if (match) {
      return match;
    }
  }

  return (
    voices.find((voice) => /^en[-_]/i.test(voice.lang) && /bad news|fred|ralph|male|daniel|alex|google/i.test(voice.name)) ||
    voices.find((voice) => /^en[-_]/i.test(voice.lang)) ||
    voices[0]
  );
}

function speakLocal(text, mode = "announce") {
  const speech = getSpeech();
  if (!speech || !text || state.isMuted) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(String(text));
  const voice = pickArenaVoice(mode);

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || SPEECH_LANG;
  } else {
    utterance.lang = SPEECH_LANG;
  }

  if (mode === "vote") {
    utterance.rate = 0.62;
    utterance.pitch = 0.24;
    utterance.volume = 1;
  } else {
    utterance.rate = 0.74;
    utterance.pitch = 0.32;
    utterance.volume = 1;
  }

  speech.cancel();
  speech.speak(utterance);
}

function getVoteSpeech(value) {
  return `${SPEECH_LABELS[value] || getVoteLabel(value)}!`;
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
    speakLocal("Reveal!", "announce");
    return;
  }

  if (seconds >= 0 && seconds <= 3) {
    speakLocal(SPEECH_LABELS[String(seconds)] || String(seconds), "announce");
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

function getSeatPositions(count) {
  const map = TABLE_SEAT_MAP[count] || TABLE_SEAT_MAP[10];
  return map.map((index) => TABLE_SEATS[index]);
}

function getCharacterAssetName(characterName) {
  return sanitizeName(characterName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .split("-")
    .filter(Boolean)
    .join("-") || "participant";
}

function getMajorityVotes(list) {
  const counts = new Map();
  for (const participant of list) {
    if (hasParticipantVoted(participant)) {
      counts.set(participant.vote, (counts.get(participant.vote) || 0) + 1);
    }
  }

  const highestCount = Math.max(0, ...counts.values());
  return new Set(Array.from(counts).filter(([, count]) => count === highestCount).map(([vote]) => vote));
}

function getParticipantMood(participant, majorityVotes) {
  const reaction = state.characterReactions.get(participant.uid);
  if (reaction && reaction.until > Date.now()) {
    return reaction.mood;
  }
  if (!state.revealed || majorityVotes.size === 0) {
    return "neutral";
  }
  return majorityVotes.has(participant.vote) ? "happy" : "sad";
}

function createFallbackCharacterTexture(characterName, mood) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  const moodColors = {
    happy: "#e8b54f",
    neutral: "#61a9b5",
    angry: "#d96554",
    sad: "#7184bb"
  };

  context.fillStyle = "rgba(255, 255, 255, 0.08)";
  context.beginPath();
  context.arc(128, 150, 112, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#172b39";
  context.beginPath();
  context.moveTo(32, 320);
  context.lineTo(48, 260);
  context.quadraticCurveTo(64, 230, 103, 221);
  context.lineTo(153, 221);
  context.quadraticCurveTo(194, 230, 208, 260);
  context.lineTo(224, 320);
  context.closePath();
  context.fill();

  context.fillStyle = "#f4f1e8";
  context.beginPath();
  context.moveTo(102, 220);
  context.lineTo(128, 255);
  context.lineTo(154, 220);
  context.closePath();
  context.fill();

  context.fillStyle = "#d99b72";
  context.fillRect(112, 190, 32, 44);
  context.beginPath();
  context.ellipse(128, 143, 59, 72, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#382b2a";
  context.beginPath();
  context.ellipse(128, 93, 62, 33, 0, Math.PI, Math.PI * 2);
  context.lineTo(184, 129);
  context.quadraticCurveTo(162, 112, 143, 119);
  context.quadraticCurveTo(96, 128, 72, 114);
  context.closePath();
  context.fill();

  context.strokeStyle = "#30201e";
  context.lineWidth = 6;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(91, 137);
  context.lineTo(108, 139);
  context.moveTo(148, 139);
  context.lineTo(165, 137);
  context.stroke();
  context.fillStyle = "#30201e";
  context.beginPath();
  context.arc(101, 151, 4, 0, Math.PI * 2);
  context.arc(155, 151, 4, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = moodColors[mood];
  context.lineWidth = 7;
  context.beginPath();
  if (mood === "happy") {
    context.arc(128, 169, 23, 0.12, Math.PI - 0.12);
  } else if (mood === "sad") {
    context.arc(128, 193, 21, Math.PI + 0.2, Math.PI * 2 - 0.2);
  } else if (mood === "angry") {
    context.moveTo(108, 184);
    context.lineTo(128, 174);
    context.lineTo(148, 184);
  } else {
    context.moveTo(112, 177);
    context.lineTo(144, 177);
  }
  context.stroke();

  context.fillStyle = moodColors[mood];
  context.beginPath();
  context.arc(128, 278, 18, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "700 21px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(characterName || "?").trim().charAt(0).toUpperCase(), 128, 278);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createHeadOnlyTexture(image) {
  const cropHeight = Math.max(1, Math.round(image.height * 0.56));
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = cropHeight;
  canvas.getContext("2d").drawImage(image, 0, 0, image.width, cropHeight, 0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function resizeTableScene() {
  if (!tableScene) {
    return;
  }
  const width = Math.max(1, tableScene.host.clientWidth);
  const height = Math.max(1, tableScene.host.clientHeight);
  tableScene.renderer.setSize(width, height, false);
  tableScene.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  tableScene.camera.aspect = width / height;
  tableScene.camera.position.set(0, width < 560 ? 12 : 10, width < 560 ? 19 : 14.5);
  tableScene.camera.lookAt(0, 1.7, 0);
  tableScene.camera.updateProjectionMatrix();
}

function initializeTableScene() {
  const host = els.tableScene;
  if (!host) {
    return;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch (_error) {
    host.classList.add("table-scene-unavailable");
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const seatGroup = new THREE.Group();
  scene.add(seatGroup);
  scene.add(new THREE.HemisphereLight(0xfff1d8, 0x263e43, 2.2));

  const keyLight = new THREE.DirectionalLight(0xffe6bd, 3.2);
  keyLight.position.set(-5, 11, 8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x54b8a0, 24, 24);
  fillLight.position.set(4, 5, -4);
  scene.add(fillLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x1b2b2d, roughness: 0.94 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);

  const wood = new THREE.MeshStandardMaterial({ color: 0x765034, roughness: 0.36, metalness: 0.04 });
  const woodEdge = new THREE.MeshStandardMaterial({ color: 0x39271d, roughness: 0.48 });
  const felt = new THREE.MeshStandardMaterial({ color: 0x17634f, roughness: 0.86 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc49b59, metalness: 0.62, roughness: 0.32 });
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x25363a, roughness: 0.58 });
  const chairSeatMaterial = new THREE.MeshStandardMaterial({ color: 0x6a4835, roughness: 0.75 });

  const tableRim = new THREE.Mesh(new THREE.CylinderGeometry(3.18, 3.32, 0.34, 72), wood);
  tableRim.scale.x = 1.45;
  tableRim.position.y = 1.28;
  tableRim.castShadow = true;
  tableRim.receiveShadow = true;
  scene.add(tableRim);

  const tableEdge = new THREE.Mesh(new THREE.CylinderGeometry(3.22, 3.28, 0.4, 72), woodEdge);
  tableEdge.scale.x = 1.45;
  tableEdge.position.y = 1.12;
  tableEdge.castShadow = true;
  scene.add(tableEdge);

  const tableFelt = new THREE.Mesh(new THREE.CylinderGeometry(2.98, 2.98, 0.08, 72), felt);
  tableFelt.scale.x = 1.45;
  tableFelt.position.y = 1.49;
  tableFelt.receiveShadow = true;
  scene.add(tableFelt);

  const trim = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.035, 8, 72), brass);
  trim.rotation.x = Math.PI / 2;
  trim.scale.x = 1.45;
  trim.position.y = 1.48;
  scene.add(trim);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 1.08, 0.94, 24), woodEdge);
  pedestal.position.y = 0.55;
  pedestal.castShadow = true;
  scene.add(pedestal);

  const legGeometry = new THREE.BoxGeometry(0.38, 1.18, 0.44);
  for (const x of [-3.92, 3.92]) {
    for (const z of [-2.16, 2.16]) {
      const leg = new THREE.Mesh(legGeometry, woodEdge);
      leg.position.set(x, 0.57, z);
      leg.castShadow = true;
      scene.add(leg);
    }
  }

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("role", "presentation");
  host.replaceChildren(renderer.domElement);

  tableScene = {
    host,
    scene,
    camera,
    renderer,
    seatGroup,
    chairMaterial,
    chairSeatMaterial,
    textureLoader: new THREE.TextureLoader(),
    textures: new Map(),
    avatars: [],
    paperTexture: null,
    paperTextureLoading: false,
    paperThrows: [],
    pendingPaperThrows: [],
    resizeObserver: new ResizeObserver(resizeTableScene)
  };
  tableScene.resizeObserver.observe(host);
  resizeTableScene();

  const animate = () => {
    if (!tableScene) {
      return;
    }
    const time = performance.now() / 1000;
    for (const avatar of tableScene.avatars) {
      const poseProgress = Math.min(1, (performance.now() - avatar.poseStartedAt) / 420);
      const easedPose = poseProgress * poseProgress * (3 - 2 * poseProgress);
      avatar.poseProgress = avatar.poseFrom + (avatar.poseTarget - avatar.poseFrom) * easedPose;
      const isHeadOnly = avatar.poseProgress >= 0.5;
      if (isHeadOnly !== avatar.isHeadOnly) {
        avatar.isHeadOnly = isHeadOnly;
        avatar.sprite.material.map = isHeadOnly ? avatar.headTexture : avatar.fullTexture;
        avatar.sprite.material.needsUpdate = true;
        avatar.aspect = isHeadOnly ? avatar.headAspect : avatar.fullAspect;
      }
      const height = 2.55 - avatar.poseProgress * 1.6;
      avatar.currentX = avatar.standingX + (avatar.chairX - avatar.standingX) * avatar.poseProgress;
      avatar.sprite.position.set(
        avatar.currentX,
        1.22 + avatar.poseProgress * 0.73,
        avatar.standingZ + (avatar.chairZ - avatar.standingZ) * avatar.poseProgress + 0.12
      );
      avatar.sprite.scale.set(avatar.aspect * height, height, 1);
      if (avatar.mood === "angry") {
        avatar.sprite.position.x = avatar.currentX + Math.sin(time * 19) * 0.035;
        avatar.sprite.rotation.z = Math.sin(time * 19) * 0.025;
      } else if (avatar.mood === "happy") {
        avatar.sprite.position.y += Math.sin(time * 3.4) * 0.045;
      }
    }
    const activeThrows = [];
    for (const paperThrow of tableScene.paperThrows) {
      const progress = Math.min(1, (performance.now() - paperThrow.startedAt) / paperThrow.duration);
      paperThrow.sprite.position.lerpVectors(paperThrow.start, paperThrow.end, progress);
      paperThrow.sprite.position.y += Math.sin(Math.PI * progress) * 1.75;
      paperThrow.sprite.material.rotation += 0.28;
      const scale = 0.48 + Math.sin(Math.PI * progress) * 0.16;
      paperThrow.sprite.scale.set(scale, scale, 1);
      if (progress >= 1) {
        tableScene.scene.remove(paperThrow.sprite);
        paperThrow.sprite.material.dispose();
      } else {
        activeThrows.push(paperThrow);
      }
    }
    tableScene.paperThrows = activeThrows;
    tableScene.renderer.render(tableScene.scene, tableScene.camera);
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

function renderTableScene(list) {
  if (!tableScene) {
    return;
  }

  const previousAvatars = new Map(tableScene.avatars.map((avatar) => [avatar.uid, avatar]));
  while (tableScene.seatGroup.children.length) {
    tableScene.seatGroup.remove(tableScene.seatGroup.children[0]);
  }
  for (const avatar of tableScene.avatars) {
    tableScene.scene.remove(avatar.sprite);
    avatar.sprite.material.dispose();
  }
  tableScene.avatars = [];

  const seatPositions = getSeatPositions(Math.min(list.length, 10));
  const majorityVotes = getMajorityVotes(list);
  list.slice(0, 10).forEach((participant, index) => {
    const seat = seatPositions[index] || TABLE_SEATS[index % TABLE_SEATS.length];
    const relativeX = (seat.seatX - 50) / 36;
    const relativeZ = (seat.seatY - 46) / 39;
    const chairX = relativeX * 4.9;
    const chairZ = relativeZ * 3.45;
    const outward = new THREE.Vector3(chairX / 4.6, 0, chairZ / 3.3).normalize();
    const frontOrBackSeat = Math.abs(chairZ) > Math.abs(chairX) * 0.75;
    const standingX = frontOrBackSeat ? chairX : chairX + outward.x * 1.35;
    const standingZ = frontOrBackSeat
      ? chairZ + (chairZ < 0 ? -4.8 : 0.75)
      : chairZ + outward.z * 1.35;
    const chair = new THREE.Group();
    chair.position.set(chairX, 0, chairZ);
    chair.rotation.y = Math.atan2(-chairX, -chairZ);

    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.18, 0.82), tableScene.chairSeatMaterial);
    chairSeat.position.y = 0.72;
    chairSeat.castShadow = true;
    chair.add(chairSeat);

    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.92, 0.18), tableScene.chairMaterial);
    chairBack.position.set(0, 1.2, -0.34);
    chairBack.castShadow = true;
    chair.add(chairBack);
    tableScene.seatGroup.add(chair);

    const mood = getParticipantMood(participant, majorityVotes);
    const assetName = getCharacterAssetName(participant.characterName);
    const textureKey = `${assetName}:${mood}`;
    let textureEntry = tableScene.textures.get(textureKey);
    if (!textureEntry) {
      const fallbackTexture = createFallbackCharacterTexture(participant.characterName, mood);
      textureEntry = {
        texture: fallbackTexture,
        headTexture: createHeadOnlyTexture(fallbackTexture.image),
        loading: true
      };
      tableScene.textures.set(textureKey, textureEntry);
      tableScene.textureLoader.load(
        `./characters/${assetName}/poker_${assetName}_${mood}.png`,
        (loadedTexture) => {
          loadedTexture.colorSpace = THREE.SRGBColorSpace;
          textureEntry.texture = loadedTexture;
          textureEntry.headTexture = createHeadOnlyTexture(loadedTexture.image);
          textureEntry.loading = false;
          for (const avatar of tableScene?.avatars || []) {
            if (avatar.textureKey === textureKey) {
              avatar.fullTexture = loadedTexture;
              avatar.headTexture = textureEntry.headTexture;
              avatar.fullAspect = loadedTexture.image.width / loadedTexture.image.height;
              avatar.headAspect = loadedTexture.image.width / textureEntry.headTexture.image.height;
              avatar.isHeadOnly = avatar.poseProgress >= 0.5;
              avatar.sprite.material.map = avatar.isHeadOnly ? avatar.headTexture : avatar.fullTexture;
              avatar.sprite.material.needsUpdate = true;
              avatar.aspect = avatar.isHeadOnly ? avatar.headAspect : avatar.fullAspect;
              const height = 2.55 - avatar.poseProgress * 1.6;
              avatar.sprite.scale.set(avatar.aspect * height, height, 1);
            }
          }
        },
        undefined,
        () => {
          textureEntry.loading = false;
        }
      );
    }

    const hasVoted = hasParticipantVoted(participant);
    const previousAvatar = previousAvatars.get(participant.uid);
    const initialPose = previousAvatar?.poseProgress ?? (hasVoted ? 1 : 0);
    const targetPose = hasVoted ? 1 : 0;
    const isHeadOnly = initialPose >= 0.5;
    const fullAspect = textureEntry.texture.image.width / textureEntry.texture.image.height;
    const headAspect = textureEntry.headTexture.image.width / textureEntry.headTexture.image.height;
    const aspect = isHeadOnly ? headAspect : fullAspect;
    const height = 2.55 - initialPose * 1.6;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: isHeadOnly ? textureEntry.headTexture : textureEntry.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    }));
    sprite.renderOrder = 10;
    sprite.position.set(
      standingX + (chairX - standingX) * initialPose,
      1.22 + initialPose * 0.73,
      standingZ + (chairZ - standingZ) * initialPose + 0.12
    );
    sprite.scale.set(height * aspect, height, 1);
    tableScene.scene.add(sprite);
    tableScene.avatars.push({
      uid: participant.uid,
      sprite,
      mood,
      textureKey,
      fullTexture: textureEntry.texture,
      headTexture: textureEntry.headTexture,
      fullAspect,
      headAspect,
      aspect,
      isHeadOnly,
      standingX,
      standingZ,
      chairX,
      chairZ,
      currentX: standingX + (chairX - standingX) * initialPose,
      hasVoted,
      poseProgress: initialPose,
      poseFrom: initialPose,
      poseTarget: targetPose,
      poseStartedAt: performance.now()
    });
  });
  playPendingPaperThrows();
}

function startPaperThrowAnimation(fromUid, toUid) {
  const source = tableScene?.avatars.find((avatar) => avatar.uid === fromUid);
  const target = tableScene?.avatars.find((avatar) => avatar.uid === toUid);
  if (!tableScene?.paperTexture || !source || !target) {
    return false;
  }

  const start = source.sprite.position.clone();
  start.y = 1.65;
  start.z += 0.22;
  const end = target.sprite.position.clone();
  end.y = 1.62;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tableScene.paperTexture,
    transparent: true,
    depthWrite: false
  }));
  sprite.position.copy(start);
  sprite.scale.set(0.48, 0.48, 1);
  tableScene.scene.add(sprite);
  tableScene.paperThrows.push({ sprite, start, end, startedAt: performance.now(), duration: 1050 });
  return true;
}

function playPendingPaperThrows() {
  if (!tableScene?.paperTexture || tableScene.avatars.length === 0) {
    return;
  }
  tableScene.pendingPaperThrows = tableScene.pendingPaperThrows.filter(
    (paperThrow) => !startPaperThrowAnimation(paperThrow.fromUid, paperThrow.toUid)
  );
}

function queuePaperThrowAnimation(fromUid, toUid) {
  if (!tableScene) {
    return;
  }

  tableScene.pendingPaperThrows.push({ fromUid, toUid });
  if (tableScene.paperTexture) {
    playPendingPaperThrows();
    return;
  }
  if (tableScene.paperTextureLoading) {
    return;
  }

  tableScene.paperTextureLoading = true;
  tableScene.textureLoader.load(
    "./characters/crumpled_paper_ball.png",
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      tableScene.paperTexture = texture;
      tableScene.paperTextureLoading = false;
      playPendingPaperThrows();
    },
    undefined,
    () => {
      tableScene.paperTextureLoading = false;
      tableScene.pendingPaperThrows = [];
    }
  );
}

function triggerPaperThrow(fromUid, toUid, targetMood) {
  const until = Date.now() + 1800;
  state.characterReactions.set(fromUid, { mood: "happy", until });
  state.characterReactions.set(toUid, { mood: targetMood, until });
  queuePaperThrowAnimation(fromUid, toUid);
  speakLocal("Ow!", "announce");

  if (state.characterReactionTimer) {
    clearTimeout(state.characterReactionTimer);
  }
  state.characterReactionTimer = setTimeout(() => {
    const now = Date.now();
    for (const [uid, reaction] of state.characterReactions) {
      if (reaction.until <= now) {
        state.characterReactions.delete(uid);
      }
    }
    state.characterReactionTimer = null;
    renderParticipants();
  }, 1850);

  renderParticipants();
}

function syncCountdownTicker() {
  const countdownActive = isCountdownActive();

  if (countdownActive && !state.countdownTimer) {
    syncCountdownMusic();
    state.countdownTimer = setInterval(() => {
      if (state.isHost && state.countdownEndsAt && Date.now() >= state.countdownEndsAt) {
        finalizeRevealCountdown().catch(() => {
          // Non-fatal. Snapshot will reconcile state on the next update.
        });
      }
      renderControls();
      syncCountdownSpeech();
      syncCountdownMusic();
    }, COUNTDOWN_TICK_MS);
  }

  if (!countdownActive && state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
    stopCountdownMusic();
  }

  if (!countdownActive) {
    state.lastSpokenCountdown = null;
    stopCountdownMusic();
  }
}

function triggerRevealAnimation() {
  state.revealAnimationUntil = Date.now() + 1100;
  launchCelebration();
  playRevealSting().catch(() => {
    // Ignore local audio restrictions.
  });

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
  els.hurryUpButton.disabled = !state.roomCode || state.revealed || countdownActive;
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
    if (a.uid === state.hostUid && b.uid !== state.hostUid) {
      return -1;
    }
    if (b.uid === state.hostUid && a.uid !== state.hostUid) {
      return 1;
    }
    const aJoined = a.joinedAtMillis ?? Number.MAX_SAFE_INTEGER;
    const bJoined = b.joinedAtMillis ?? Number.MAX_SAFE_INTEGER;
    if (aJoined !== bJoined) {
      return aJoined - bJoined;
    }
    return a.name.localeCompare(b.name);
  });

  els.participantCount.textContent = `${list.length} total`;
  els.participants.innerHTML = "";
  const seatPositions = getSeatPositions(Math.min(list.length, 10));
  const majorityVotes = getMajorityVotes(list);
  els.participants.classList.toggle("participants-table", list.length > 0 && list.length <= 10);
  els.tableStage.classList.toggle("table-stage-empty", list.length === 0);

  list.forEach((participant, index) => {
    const seat = seatPositions[index] || TABLE_SEATS[index % TABLE_SEATS.length];
    const cardX = 50 + (seat.cardX - 50) * 0.72;
    const cardY = Math.min(60, Math.max(seat.cardY + 12, 48));
    const li = document.createElement("li");
    li.className = "participant participant-seat";
    li.style.setProperty("--seat-x", `${seat.seatX}%`);
    li.style.setProperty("--seat-y", `${seat.seatY}%`);
    li.style.setProperty("--card-x", `${cardX}%`);
    li.style.setProperty("--card-y", `${cardY}%`);
    li.dataset.mood = getParticipantMood(participant, majorityVotes);

    const left = document.createElement("div");
    left.className = "seat-label";

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

    right.append(voteFront, voteBack);

    right.classList.toggle("is-face-up", showFront);
    right.classList.toggle("is-voted", hasVote);
    right.classList.toggle("is-waiting", !hasVote || !state.revealed);
    right.classList.toggle("is-on-table", state.revealed && hasVote);
    right.classList.toggle("is-throw", participant.vote === "THROW");
    right.classList.toggle("is-question", participant.vote === "?");
    right.classList.toggle("is-revealing", state.revealed && hasVote && isRevealAnimationActive());

    li.append(left, right);
    els.participants.appendChild(li);
  });

  renderTableScene(list);
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
  state.hurryUpAt = 0;
  state.countdownEndsAt = 0;
  state.revealAnimationUntil = 0;
  state.lastSpokenCountdown = null;
  state.round = 1;
  state.hostUid = "";
  state.isHost = false;
  state.finalizingReveal = false;
  state.lastHandledHurryUpAt = 0;
  state.lastHandledThrowAt = 0;
  state.characterReactions.clear();
  if (state.characterReactionTimer) {
    clearTimeout(state.characterReactionTimer);
    state.characterReactionTimer = null;
  }
  stopCountdownMusic();

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
  stopCountdownMusic();
  if (state.revealAnimationTimer) {
    clearTimeout(state.revealAnimationTimer);
    state.revealAnimationTimer = null;
  }
  if (state.hurryUpTimer) {
    clearTimeout(state.hurryUpTimer);
    state.hurryUpTimer = null;
  }
  if (state.celebrationTimer) {
    clearTimeout(state.celebrationTimer);
    state.celebrationTimer = null;
  }
  if (els.confettiBurst) {
    els.confettiBurst.classList.remove("is-live");
    els.confettiBurst.classList.add("hidden");
    els.confettiBurst.innerHTML = "";
  }
  if (els.celebrationLights) {
    els.celebrationLights.classList.remove("is-live");
    els.celebrationLights.classList.add("hidden");
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
    hurryUpAt: null,
    hurryUpByUid: null,
    throwPaperAt: null,
    throwPaperFromUid: null,
    throwPaperToUid: null,
    throwPaperTargetMood: null,
    revealCountdownEndsAt: null
  });

  await setDoc(participantRef(state.uid, code), {
    uid: state.uid,
    name: displayName,
    characterName: state.characterName,
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
      characterName: state.characterName,
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
      characterName: state.characterName,
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

function handleThrowPaperRoomEvent(room) {
  const throwPaperAt = Number(room.throwPaperAt) || 0;
  if (throwPaperAt <= state.lastHandledThrowAt || Date.now() - throwPaperAt >= 10000) {
    return;
  }
  state.lastHandledThrowAt = throwPaperAt;
  if (room.throwPaperFromUid && room.throwPaperToUid) {
    const targetMood = room.throwPaperTargetMood === "sad" ? "sad" : "angry";
    triggerPaperThrow(room.throwPaperFromUid, room.throwPaperToUid, targetMood);
  }
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
    state.hurryUpAt = Number(room.hurryUpAt) || 0;
    state.countdownEndsAt = Number(room.revealCountdownEndsAt) || 0;
    if (state.revealed) {
      state.countdownEndsAt = 0;
      state.finalizingReveal = false;
    }
    if (!wasRevealed && state.revealed) {
      triggerRevealAnimation();
    }
    if (
      state.hurryUpAt &&
      state.hurryUpAt > state.lastHandledHurryUpAt &&
      Date.now() - state.hurryUpAt < 10000
    ) {
      state.lastHandledHurryUpAt = state.hurryUpAt;
      triggerHurryUpCue(room.hurryUpByUid);
    }
    handleThrowPaperRoomEvent(room);
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
        characterName: participant.characterName || participant.name || "Participant",
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
  state.hurryUpAt = 0;
  state.lastHandledHurryUpAt = Date.now();
  state.lastHandledThrowAt = Date.now();
  sessionStorage.setItem("poker:displayName", displayName);
  sessionStorage.removeItem("poker:roomCode");
  setRoomCodeInUrl("");
  els.heroSection.classList.add("hidden");
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
  els.heroSection.classList.remove("hidden");
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

  if (value === "THROW") {
    const possibleTargets = Array.from(state.participants.keys()).filter((uid) => uid !== state.uid);
    if (possibleTargets.length > 0) {
      const targetUid = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
      try {
        await updateDoc(roomRef(), {
          throwPaperAt: Date.now(),
          throwPaperFromUid: state.uid,
          throwPaperToUid: targetUid,
          throwPaperTargetMood: Math.random() < 0.5 ? "sad" : "angry",
          updatedAt: serverTimestamp()
        });
      } catch (_error) {
        setStatus("Vote saved, but the paper throw could not be shared. Update Firestore rules to enable it.", true);
      }
    }
  }
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

async function sendHurryUp() {
  if (!state.roomCode || state.revealed || isCountdownActive()) {
    return;
  }

  await updateDoc(roomRef(), {
    hurryUpAt: Date.now(),
    hurryUpByUid: state.uid,
    updatedAt: serverTimestamp()
  });
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
      hurryUpAt: null,
      hurryUpByUid: null,
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
  document.addEventListener("pointerdown", () => {
    ensureAudioContext().catch(() => {
      // Ignore browsers that still block audio before user gestures settle.
    });
  }, { once: true });

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

  els.muteButton.addEventListener("click", async () => {
    await ensureAudioContext().catch(() => {
      // Ignore audio setup failures.
    });
    setMuted(!state.isMuted);
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

  els.hurryUpButton.addEventListener("click", async () => {
    try {
      await sendHurryUp();
    } catch (_error) {
      setStatus("Could not send hurry-up cue.", true);
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
      state.characterName = "";
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
    state.characterName = getCharacterName(state.userEmail, state.displayName);
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
  state.isMuted = readMutedPreference();
  updateMuteButton();
  loadVoices();
  if (getSpeech()) {
    getSpeech().onvoiceschanged = () => {
      loadVoices();
    };
  }

  await setPersistence(state.auth, browserSessionPersistence);

  initializeTableScene();
  wireEvents();
  wireAuthState();
  setEntryMode(getRoomCodeFromUrl());
  renderCards();
}

init().catch((error) => {
  setStatus(error.message || "Initialization failed.", true);
});
