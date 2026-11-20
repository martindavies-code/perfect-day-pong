# Google Cloud Save Setup (`perfect-day-pong`)

Cloud save uses the **Google Identity Services token model** and Google Drive's hidden `appDataFolder` (`https://www.googleapis.com/auth/drive.appdata`). No backend or client secret is needed.

## Exact steps in Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) signed in as your Google account and select or create a project for this game.
2. Enable the **Google Drive API** (`APIs & Services -> Library -> Google Drive API -> Enable`).
3. Configure **Google Auth platform / OAuth consent screen**:
   - User Type: **External** (Testing mode is fine for personal use; add your Google email under **Test users**).
   - Add scope: `https://www.googleapis.com/auth/drive.appdata`.
4. Create an **OAuth Client ID** (`Clients -> Create Client`):
   - Application type: **Web application**
   - Authorised JavaScript origins (origins only, no path):
     - `https://martindavies-code.github.io`
     - `http://localhost:8000`
5. Copy the generated **Client ID** (`...apps.googleusercontent.com`) into `GOOGLE_CLIENT_ID` in `config.js`, then commit and push to `main`.

## Configured state
Dedicated project: perfect-day-pong. Web client: Perfect Day Pong web. External / Testing; Martin is a test user. Origins are https://martindavies-code.github.io and http://localhost:8000. The game requests drive.appdata only. Initial connection to an existing cloud save requires an explicit comparison choice. No billing enabled.
