# Spotifier Web (GitHub Pages-safe)

This project converts the notebook workflow into a static website that can be deployed to GitHub Pages.

## What it does

- Spotify login using **Authorization Code + PKCE** (no client secret required in frontend code).
- Loads your playlists and selects:
  - `Hipsters recommended playlist` (exact name, if present)
  - any playlist containing `HRP` in its name
- Searches songs/artists across selected playlists.
- Computes contributor stats (tracks added per user) for each selected playlist.
- Optional GetSongBPM lookup using a runtime API key you provide in the UI.

## Security model (public repo safe)

- No Spotify `client_secret` is used or stored.
- No API keys are hardcoded in source files.
- Any optional key is entered at runtime and stored only in browser local storage.
- Do **not** commit notebook cells containing secrets from the original notebook.

## Local run

From this folder:

```bash
python3 -m http.server 8000
```

Open: <http://localhost:8000>

## Spotify app setup

1. In Spotify Developer Dashboard, create/select an app.
2. Copy your **Client ID**.
3. Add this Redirect URI in app settings:
   - `https://<your-github-username>.github.io/<repo-name>/`
4. Paste the Client ID into the app UI and log in.

For local testing, also add:
- `http://localhost:8000/`

## Deploy to GitHub Pages

1. Push files to a GitHub repo.
2. In GitHub, go to **Settings -> Pages**.
3. Set source to:
   - **Deploy from a branch**
   - Branch: `main` (or your default), folder: `/ (root)`
4. Save and wait for deploy.
5. Visit:
   - `https://<your-github-username>.github.io/<repo-name>/`

## Important

- If you previously committed secrets in the notebook, rotate/revoke them in Spotify/GetSongBPM dashboards.
