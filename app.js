const SCOPES = "playlist-read-private playlist-read-collaborative";
const TOKEN_STORAGE_KEY = "spotifier_token_info";
const CLIENT_ID_KEY = "spotifier_client_id";
const BPM_KEY_STORAGE = "spotifier_bpm_api_key";

const authStatus = document.getElementById("authStatus");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loadPlaylistsBtn = document.getElementById("loadPlaylistsBtn");
const playlistList = document.getElementById("playlistList");
const searchBtn = document.getElementById("searchBtn");
const searchTermInput = document.getElementById("searchTerm");
const searchResults = document.getElementById("searchResults");
const statsBtn = document.getElementById("statsBtn");
const statsResults = document.getElementById("statsResults");
const clientIdInput = document.getElementById("clientId");
const redirectUriText = document.getElementById("redirectUriText");
const bpmKeyInput = document.getElementById("bpmKey");
const bpmArtistInput = document.getElementById("bpmArtist");
const bpmSongInput = document.getElementById("bpmSong");
const bpmLookupBtn = document.getElementById("bpmLookupBtn");
const bpmResults = document.getElementById("bpmResults");

redirectUriText.textContent = window.location.origin + window.location.pathname;

let selectedPlaylists = [];
let playlistCache = new Map();

function setStatus(msg, isError = false) {
  authStatus.textContent = msg;
  authStatus.style.color = isError ? "#ff8e8e" : "#9ce7b5";
}

function saveClientId(value) {
  localStorage.setItem(CLIENT_ID_KEY, value.trim());
}

function getClientId() {
  return localStorage.getItem(CLIENT_ID_KEY) || "";
}

function saveTokenInfo(info) {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(info));
}

function getTokenInfo() {
  const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearTokenInfo() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function isTokenValid(tokenInfo) {
  return Boolean(tokenInfo?.access_token && tokenInfo?.expires_at > Date.now() + 10_000);
}

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

async function sha256Base64Url(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(hash));
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function currentRedirectUri() {
  return window.location.origin + window.location.pathname;
}

async function beginLogin() {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    setStatus("Please provide a Spotify Client ID first.", true);
    return;
  }
  saveClientId(clientId);

  const verifier = randomString(64);
  const challenge = await sha256Base64Url(verifier);
  sessionStorage.setItem("spotifier_pkce_verifier", verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: currentRedirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const clientId = getClientId();
  const verifier = sessionStorage.getItem("spotifier_pkce_verifier");
  if (!clientId || !verifier) throw new Error("Missing client ID or PKCE verifier.");

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: currentRedirectUri(),
    code_verifier: verifier
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}).`);

  const token = await res.json();
  saveTokenInfo({
    access_token: token.access_token,
    token_type: token.token_type,
    scope: token.scope,
    expires_at: Date.now() + token.expires_in * 1000
  });
  sessionStorage.removeItem("spotifier_pkce_verifier");
}

async function refreshTokenIfNeeded() {
  const token = getTokenInfo();
  if (!isTokenValid(token)) throw new Error("No valid token. Log in again.");
  return token.access_token;
}

async function spotifyFetch(path) {
  const accessToken = await refreshTokenIfNeeded();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Spotify API error (${res.status}) for ${path}`);
  return res.json();
}

async function fetchAllPlaylists() {
  const all = [];
  let next = "/me/playlists?limit=50";
  while (next) {
    const page = await spotifyFetch(next.replace("https://api.spotify.com/v1", ""));
    all.push(...page.items);
    next = page.next;
  }
  return all;
}

function pickNotebookLikePlaylists(playlists) {
  const hipsters = playlists.find(
    (p) => p.name.toLowerCase() === "hipsters recommended playlist"
  );
  const hrp = playlists.filter((p) => /\bhrp\b/i.test(p.name));
  const selected = hipsters ? [hipsters, ...hrp] : hrp;
  const dedup = [];
  const seen = new Set();
  for (const p of selected) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      dedup.push(p);
    }
  }
  return dedup;
}

function renderPlaylists(playlists) {
  if (!playlists.length) {
    playlistList.innerHTML = "<p>No matching playlists found.</p>";
    return;
  }
  playlistList.innerHTML = playlists
    .map((p) => `<div><strong>${escapeHtml(p.name)}</strong> <span class="hint">(${p.id})</span></div>`)
    .join("");
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchAllTracksForPlaylist(playlistId) {
  if (playlistCache.has(playlistId)) return playlistCache.get(playlistId);
  const tracks = [];
  let next = `/playlists/${playlistId}/tracks?limit=100`;
  while (next) {
    const page = await spotifyFetch(next.replace("https://api.spotify.com/v1", ""));
    tracks.push(...page.items);
    next = page.next;
  }
  playlistCache.set(playlistId, tracks);
  return tracks;
}

async function searchSongInPlaylists(term, playlists) {
  const q = term.toLowerCase().trim();
  const out = [];
  for (const p of playlists) {
    const items = await fetchAllTracksForPlaylist(p.id);
    for (const item of items) {
      const track = item.track;
      if (!track) continue;
      const title = track.name || "";
      const artists = (track.artists || []).map((a) => a.name).join(", ");
      const blob = `${title} ${artists}`.toLowerCase();
      if (blob.includes(q)) {
        out.push({
          playlist: p.name,
          song: title,
          artists
        });
      }
    }
  }
  return out;
}

async function contributorStats(playlists) {
  const all = {};
  for (const p of playlists) {
    const items = await fetchAllTracksForPlaylist(p.id);
    const counts = {};
    for (const item of items) {
      const u = item.added_by;
      if (!u) continue;
      const key = u.id || u.uri || "unknown";
      const label = u.id || "unknown";
      counts[label] = (counts[label] || 0) + 1;
      if (!counts.__idMap) counts.__idMap = {};
      counts.__idMap[key] = label;
    }
    delete counts.__idMap;
    all[p.name] = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  }
  return all;
}

function renderSearchResults(rows) {
  if (!rows.length) {
    searchResults.innerHTML = "<p>No matches found.</p>";
    return;
  }
  const body = rows
    .map((r) => `<tr><td>${escapeHtml(r.playlist)}</td><td>${escapeHtml(r.song)}</td><td>${escapeHtml(r.artists)}</td></tr>`)
    .join("");
  searchResults.innerHTML = `<table><thead><tr><th>Playlist</th><th>Song</th><th>Artists</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderStats(stats) {
  const playlists = Object.keys(stats);
  if (!playlists.length) {
    statsResults.innerHTML = "<p>No stats to show.</p>";
    return;
  }
  const sections = playlists.map((name) => {
    const rows = Object.entries(stats[name])
      .map(([user, count]) => `<tr><td>${escapeHtml(user)}</td><td>${count}</td></tr>`)
      .join("");
    return `<h3>${escapeHtml(name)}</h3><table><thead><tr><th>User</th><th>Tracks added</th></tr></thead><tbody>${rows}</tbody></table>`;
  });
  statsResults.innerHTML = sections.join("");
}

async function handleAuthCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    setStatus(`Spotify auth error: ${error}`, true);
    return;
  }
  if (!code) return;

  try {
    setStatus("Completing login...");
    await exchangeCodeForToken(code);
    url.searchParams.delete("code");
    window.history.replaceState({}, document.title, url.toString());
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function loadPlaylistsFlow() {
  try {
    setStatus("Loading playlists...");
    const all = await fetchAllPlaylists();
    selectedPlaylists = pickNotebookLikePlaylists(all);
    renderPlaylists(selectedPlaylists);
    searchBtn.disabled = selectedPlaylists.length === 0;
    statsBtn.disabled = selectedPlaylists.length === 0;
    setStatus(`Loaded ${all.length} playlists, selected ${selectedPlaylists.length}.`);
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function runSearchFlow() {
  const term = searchTermInput.value.trim();
  if (!term) {
    searchResults.innerHTML = "<p>Please enter a search term.</p>";
    return;
  }
  searchResults.innerHTML = "<p>Searching...</p>";
  try {
    const rows = await searchSongInPlaylists(term, selectedPlaylists);
    renderSearchResults(rows);
  } catch (e) {
    searchResults.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
  }
}

async function runStatsFlow() {
  statsResults.innerHTML = "<p>Computing stats...</p>";
  try {
    const stats = await contributorStats(selectedPlaylists);
    renderStats(stats);
  } catch (e) {
    statsResults.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
  }
}

async function lookupBpm() {
  const key = bpmKeyInput.value.trim();
  const artist = bpmArtistInput.value.trim();
  const song = bpmSongInput.value.trim();
  if (!key || !artist || !song) {
    bpmResults.innerHTML = "<p>Provide API key, artist, and song.</p>";
    return;
  }
  localStorage.setItem(BPM_KEY_STORAGE, key);

  const lookup = encodeURIComponent(`song:${song} artist:${artist}`);
  const url = `https://api.getsong.co/search/?api_key=${encodeURIComponent(key)}&type=both&lookup=${lookup}`;
  bpmResults.innerHTML = "<p>Looking up...</p>";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GetSongBPM error (${res.status}).`);
    const data = await res.json();
    const first = data?.search?.[0];
    if (!first) {
      bpmResults.innerHTML = "<p>No result found.</p>";
      return;
    }
    bpmResults.innerHTML = `<p><strong>${escapeHtml(first.title || song)}</strong> - BPM: ${escapeHtml(String(first.tempo || "N/A"))}, Key: ${escapeHtml(String(first.key_of || "N/A"))}</p>`;
  } catch (e) {
    bpmResults.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
  }
}

function initializeStoredInputs() {
  clientIdInput.value = getClientId();
  bpmKeyInput.value = localStorage.getItem(BPM_KEY_STORAGE) || "";
}

function updateUiForAuthState() {
  const valid = isTokenValid(getTokenInfo());
  loadPlaylistsBtn.disabled = !valid;
  if (valid) setStatus("Authenticated.");
  else setStatus("Not authenticated.");
}

function logout() {
  clearTokenInfo();
  selectedPlaylists = [];
  playlistCache = new Map();
  playlistList.innerHTML = "";
  searchResults.innerHTML = "";
  statsResults.innerHTML = "";
  searchBtn.disabled = true;
  statsBtn.disabled = true;
  updateUiForAuthState();
}

async function initializeApp() {
  loginBtn.addEventListener("click", beginLogin);
  logoutBtn.addEventListener("click", logout);
  loadPlaylistsBtn.addEventListener("click", loadPlaylistsFlow);
  searchBtn.addEventListener("click", runSearchFlow);
  statsBtn.addEventListener("click", runStatsFlow);
  bpmLookupBtn.addEventListener("click", lookupBpm);
  clientIdInput.addEventListener("change", () => saveClientId(clientIdInput.value));

  initializeStoredInputs();
  await handleAuthCallback();
  updateUiForAuthState();
}

initializeApp().catch((e) => setStatus(e.message || "Initialization failed.", true));
