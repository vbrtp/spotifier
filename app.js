const SCOPES = "playlist-read-private playlist-read-collaborative";
const TOKEN_STORAGE_KEY = "spotifier_token_info";
const CLIENT_ID_KEY = "spotifier_client_id";

const authStatus = document.getElementById("authStatus");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loadPlaylistsBtn = document.getElementById("loadPlaylistsBtn");
const playlistList = document.getElementById("playlistList");
const playlistNameFilterInput = document.getElementById("playlistNameFilter");
const selectAllPlaylistsCheckbox = document.getElementById("selectAllPlaylists");
const selectFilteredBtn = document.getElementById("selectFilteredBtn");
const clearFilteredBtn = document.getElementById("clearFilteredBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const playlistSortSelect = document.getElementById("playlistSort");
const playlistSelectionSummary = document.getElementById("playlistSelectionSummary");
const searchBtn = document.getElementById("searchBtn");
const searchTermInput = document.getElementById("searchTerm");
const searchInTitleCheckbox = document.getElementById("searchInTitle");
const searchInArtistCheckbox = document.getElementById("searchInArtist");
const exactMatchCheckbox = document.getElementById("exactMatch");
const maxResultsSelect = document.getElementById("maxResults");
const searchResults = document.getElementById("searchResults");
const statsBtn = document.getElementById("statsBtn");
const statsResults = document.getElementById("statsResults");
const statsTopNSelect = document.getElementById("statsTopN");
const statsShowTableCheckbox = document.getElementById("statsShowTable");
const clientIdInput = document.getElementById("clientId");
const redirectUriText = document.getElementById("redirectUriText");

redirectUriText.textContent = window.location.origin + window.location.pathname;

let allPlaylists = [];
let selectedPlaylistIds = new Set();
let playlistCache = new Map();
let filterDebounceTimer = null;

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

function getFilteredPlaylists() {
  const q = (playlistNameFilterInput.value || "").trim().toLowerCase();
  let filtered = allPlaylists;
  if (q) {
    filtered = allPlaylists.filter((p) => (p.name || "").toLowerCase().includes(q));
  }

  const sort = playlistSortSelect.value || "name-asc";
  const out = [...filtered];
  out.sort((a, b) => {
    const aName = (a.name || "").toLowerCase();
    const bName = (b.name || "").toLowerCase();
    const aTracks = a?.tracks?.total || 0;
    const bTracks = b?.tracks?.total || 0;
    if (sort === "name-desc") return bName.localeCompare(aName);
    if (sort === "tracks-desc") return bTracks - aTracks || aName.localeCompare(bName);
    if (sort === "tracks-asc") return aTracks - bTracks || aName.localeCompare(bName);
    return aName.localeCompare(bName);
  });
  return out;
}

function getSelectedPlaylists() {
  return allPlaylists.filter((p) => selectedPlaylistIds.has(p.id));
}

function updateSelectionSummary() {
  const selectedCount = selectedPlaylistIds.size;
  const totalCount = allPlaylists.length;
  const filteredCount = getFilteredPlaylists().length;
  playlistSelectionSummary.textContent = `${selectedCount} selected of ${totalCount} total (${filteredCount} shown)`;
  searchBtn.disabled = selectedCount === 0;
  statsBtn.disabled = selectedCount === 0;
}

function syncSelectAllCheckbox() {
  const filtered = getFilteredPlaylists();
  if (!filtered.length) {
    selectAllPlaylistsCheckbox.checked = false;
    selectAllPlaylistsCheckbox.indeterminate = false;
    return;
  }
  const selectedInFiltered = filtered.filter((p) => selectedPlaylistIds.has(p.id)).length;
  if (selectedInFiltered === 0) {
    selectAllPlaylistsCheckbox.checked = false;
    selectAllPlaylistsCheckbox.indeterminate = false;
  } else if (selectedInFiltered === filtered.length) {
    selectAllPlaylistsCheckbox.checked = true;
    selectAllPlaylistsCheckbox.indeterminate = false;
  } else {
    selectAllPlaylistsCheckbox.checked = false;
    selectAllPlaylistsCheckbox.indeterminate = true;
  }
}

function renderPlaylists() {
  const playlists = getFilteredPlaylists();
  if (!allPlaylists.length) {
    playlistList.innerHTML = '<p class="empty">No playlists loaded yet.</p>';
    syncSelectAllCheckbox();
    updateSelectionSummary();
    return;
  }
  if (!playlists.length) {
    playlistList.innerHTML = '<p class="empty">No playlists match this filter.</p>';
    syncSelectAllCheckbox();
    updateSelectionSummary();
    return;
  }
  const rows = playlists.map((p) => {
    const checked = selectedPlaylistIds.has(p.id) ? "checked" : "";
    const owner = p?.owner?.display_name || p?.owner?.id || "unknown";
    const tracks = p?.tracks?.total ?? 0;
    return `
      <label class="playlist-item checkbox-label">
        <span>
          <input type="checkbox" class="playlist-checkbox" data-playlist-id="${escapeHtml(p.id)}" ${checked} />
          ${escapeHtml(p.name)}
        </span>
        <span class="playlist-meta">${escapeHtml(owner)} • ${tracks} tracks</span>
      </label>
    `;
  });
  playlistList.innerHTML = `<div class="playlist-items">${rows.join("")}</div>`;
  syncSelectAllCheckbox();
  updateSelectionSummary();
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
  const inTitle = searchInTitleCheckbox.checked;
  const inArtist = searchInArtistCheckbox.checked;
  const exact = exactMatchCheckbox.checked;
  const maxResults = Number(maxResultsSelect.value || 100);
  if (!inTitle && !inArtist) throw new Error("Enable at least one search scope (title/artist).");

  const out = [];
  for (const p of playlists) {
    const items = await fetchAllTracksForPlaylist(p.id);
    for (const item of items) {
      const track = item.track;
      if (!track) continue;
      const title = track.name || "";
      const artists = (track.artists || []).map((a) => a.name).join(", ");
      const titleMatch = inTitle && (exact ? title.toLowerCase() === q : title.toLowerCase().includes(q));
      const artistMatch = inArtist && (exact ? artists.toLowerCase() === q : artists.toLowerCase().includes(q));
      if (titleMatch || artistMatch) {
        out.push({
          playlist: p.name,
          song: title,
          artists
        });
        if (out.length >= maxResults) return out;
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
    searchResults.innerHTML = '<p class="empty">No matches found with current search settings.</p>';
    return;
  }
  const body = rows
    .map((r) => `<tr><td>${escapeHtml(r.playlist)}</td><td>${escapeHtml(r.song)}</td><td>${escapeHtml(r.artists)}</td></tr>`)
    .join("");
  searchResults.innerHTML = `<p class="hint">${rows.length} result(s)</p><table><thead><tr><th>Playlist</th><th>Song</th><th>Artists</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderStats(stats) {
  const playlists = Object.keys(stats);
  if (!playlists.length) {
    statsResults.innerHTML = "<p>No stats to show.</p>";
    return;
  }

  const topN = Number(statsTopNSelect.value || 10);
  const showTable = Boolean(statsShowTableCheckbox.checked);

  const sections = playlists.map((name) => {
    const entries = Object.entries(stats[name] || {});
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const slice = entries.slice(0, topN);

    const canvasId = `chart-${escapeId(name)}`;
    const chartRows = slice
      .map(([user, count]) => `<tr><td>${escapeHtml(user)}</td><td>${count}</td></tr>`)
      .join("");

    const legendText = slice.length
      ? `Top ${slice.length} contributors (by tracks added)`
      : "No contributor data for this playlist.";

    const tableHtml = showTable
      ? `<table><thead><tr><th>User</th><th>Tracks added</th></tr></thead><tbody>${chartRows}</tbody></table>`
      : "";

    return `
      <div class="stats-chart">
        <h3>${escapeHtml(name)}</h3>
        <canvas id="${canvasId}" class="chart-canvas" aria-label="Contributor bar chart"></canvas>
        <div class="chart-legend">${escapeHtml(legendText)}</div>
        ${tableHtml}
      </div>
    `;
  });

  statsResults.innerHTML = sections.join("");

  // Render charts after DOM insertion.
  for (const name of playlists) {
    const entries = Object.entries(stats[name] || {});
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const slice = entries.slice(0, topN);
    const canvas = document.getElementById(`chart-${escapeId(name)}`);
    if (!canvas) continue;
    drawContributorBarChart(canvas, slice.map((x) => x[0]), slice.map((x) => x[1]));
  }
}

function escapeId(str) {
  // Make a safe HTML id value. This does not need to be reversible.
  return String(str).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function drawContributorBarChart(canvas, labels, values) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssHeight = 260;
  const cssWidth = canvas.parentElement ? canvas.parentElement.clientWidth : 600;
  const width = Math.max(320, Math.floor(cssWidth));
  const height = cssHeight;

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, width, height);

  const paddingLeft = 56;
  const paddingRight = 18;
  const paddingTop = 14;
  const paddingBottom = 44;

  const plotW = width - paddingLeft - paddingRight;
  const plotH = height - paddingTop - paddingBottom;
  const maxV = Math.max(1, ...values);

  // Background grid lines.
  ctx.strokeStyle = "#31424f";
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = paddingTop + (plotH * i) / gridLines;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + plotW, y);
    ctx.stroke();
  }

  // Axis labels.
  ctx.fillStyle = "#9db0c0";
  ctx.font = "12px Arial";
  for (let i = 0; i <= gridLines; i++) {
    const v = Math.round(maxV - (maxV * i) / gridLines);
    const y = paddingTop + (plotH * i) / gridLines + 4;
    ctx.fillText(String(v), 10, y);
  }

  const barGap = 10;
  const barW = values.length
    ? Math.max(10, Math.floor((plotW - barGap * (values.length - 1)) / values.length))
    : plotW;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const normalized = v / maxV;
    const barH = Math.max(0, Math.floor(plotH * normalized));
    const x = paddingLeft + i * (barW + barGap);
    const y = paddingTop + (plotH - barH);

    // Bar fill.
    const hue = (i * 47) % 360;
    ctx.fillStyle = `hsl(${hue} 70% 50%)`;
    ctx.fillRect(x, y, barW, barH);

    // Bar value label.
    ctx.fillStyle = "#0f151a";
    ctx.font = "12px Arial";
    const valText = String(v);
    ctx.fillText(valText, x + 4, y + 16);

    // X labels (truncated).
    const label = labels[i] || "";
    const maxChars = 14;
    const t = label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label;
    ctx.fillStyle = "#9db0c0";
    ctx.fillText(t, x + 4, paddingTop + plotH + 26);
  }
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
    playlistList.innerHTML = '<p class="empty">Loading playlists...</p>';
    allPlaylists = await fetchAllPlaylists();
    selectedPlaylistIds = new Set(allPlaylists.map((p) => p.id));
    playlistNameFilterInput.value = "";
    renderPlaylists();
    setStatus(`Loaded ${allPlaylists.length} playlists. Refine list, then search selected.`);
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
    const selected = getSelectedPlaylists();
    if (!selected.length) {
      searchResults.innerHTML = "<p>Select at least one playlist.</p>";
      return;
    }
    const rows = await searchSongInPlaylists(term, selected);
    renderSearchResults(rows);
  } catch (e) {
    searchResults.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
  }
}

async function runStatsFlow() {
  statsResults.innerHTML = "<p>Computing stats...</p>";
  try {
    const selected = getSelectedPlaylists();
    if (!selected.length) {
      statsResults.innerHTML = "<p>Select at least one playlist.</p>";
      return;
    }
    const stats = await contributorStats(selected);
    renderStats(stats);
  } catch (e) {
    statsResults.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
  }
}

function initializeStoredInputs() {
  clientIdInput.value = getClientId();
}

function updateUiForAuthState() {
  const valid = isTokenValid(getTokenInfo());
  loadPlaylistsBtn.disabled = !valid;
  if (valid) setStatus("Authenticated.");
  else setStatus("Not authenticated.");
}

function logout() {
  clearTokenInfo();
  allPlaylists = [];
  selectedPlaylistIds = new Set();
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
  clientIdInput.addEventListener("change", () => saveClientId(clientIdInput.value));
  playlistNameFilterInput.addEventListener("input", () => {
    if (filterDebounceTimer) window.clearTimeout(filterDebounceTimer);
    filterDebounceTimer = window.setTimeout(() => renderPlaylists(), 120);
  });
  playlistSortSelect.addEventListener("change", () => renderPlaylists());
  selectAllPlaylistsCheckbox.addEventListener("change", () => {
    const filtered = getFilteredPlaylists();
    for (const p of filtered) {
      if (selectAllPlaylistsCheckbox.checked) selectedPlaylistIds.add(p.id);
      else selectedPlaylistIds.delete(p.id);
    }
    renderPlaylists();
  });
  selectFilteredBtn.addEventListener("click", () => {
    const filtered = getFilteredPlaylists();
    for (const p of filtered) selectedPlaylistIds.add(p.id);
    renderPlaylists();
  });
  clearFilteredBtn.addEventListener("click", () => {
    const filtered = getFilteredPlaylists();
    for (const p of filtered) selectedPlaylistIds.delete(p.id);
    renderPlaylists();
  });
  clearAllBtn.addEventListener("click", () => {
    selectedPlaylistIds = new Set();
    renderPlaylists();
  });
  searchTermInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !searchBtn.disabled) runSearchFlow();
  });
  playlistList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("playlist-checkbox")) return;
    const playlistId = target.dataset.playlistId;
    if (!playlistId) return;
    if (target.checked) selectedPlaylistIds.add(playlistId);
    else selectedPlaylistIds.delete(playlistId);
    syncSelectAllCheckbox();
    updateSelectionSummary();
  });

  initializeStoredInputs();
  await handleAuthCallback();
  updateUiForAuthState();
  renderPlaylists();
}

initializeApp().catch((e) => setStatus(e.message || "Initialization failed.", true));
