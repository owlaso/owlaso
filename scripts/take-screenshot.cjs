// Takes a 1280x800 screenshot of the running OwlASO dev server
// Run: npx electron scripts/take-screenshot.cjs
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  // First, inject mock data by loading a blank page and setting localStorage
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false },
  });

  // Inject the mock localStorage state before loading the app
  win.webContents.on('did-finish-load', async () => {
    try {
      // Wait a bit for app JS to run
      await new Promise(r => setTimeout(r, 1200));

      // Capture the page
      const image = await win.webContents.capturePage();
      const outPath = path.join(__dirname, '../store-landign/public/app-screenshot.png');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, image.toPNG());
      console.log('✓ Saved screenshot to', outPath);
      console.log('  Size:', image.getSize().width, 'x', image.getSize().height);
    } catch (err) {
      console.error('Screenshot failed:', err.message);
    }
    app.quit();
  });

  // Load with pre-injected localStorage via data URL trick
  const mockState = JSON.stringify({
    apps: [
      {
        id: "app_1001", name: "Spotify: Music and Podcasts",
        platform: "apple", primaryAppId: "324684580",
        stores: [
          { platform: "apple", appId: "324684580", score: 4.7 },
          { platform: "google", appId: "com.spotify.music", score: 4.5 }
        ],
        icon: "", color: "#818cf8", avgRating: 4.7, totalReviews: 32500
      },
      {
        id: "app_1002", name: "Instagram",
        platform: "apple", primaryAppId: "389801252",
        stores: [
          { platform: "apple", appId: "389801252", score: 4.4 },
          { platform: "google", appId: "com.instagram.android", score: 4.3 }
        ],
        icon: "", color: "#f472b6", avgRating: 4.4, totalReviews: 18200, adsActive: true
      },
      {
        id: "app_1003", name: "Duolingo",
        platform: "apple", primaryAppId: "570060128",
        stores: [{ platform: "apple", appId: "570060128", score: 4.8 }],
        icon: "", color: "#4ade80", avgRating: 4.8, totalReviews: 9800
      },
      {
        id: "app_1004", name: "TikTok",
        platform: "google", primaryAppId: "com.zhiliaoapp.musically",
        stores: [{ platform: "google", appId: "com.zhiliaoapp.musically", score: 4.2 }],
        icon: "", color: "#fb923c", avgRating: 4.2, totalReviews: 27300
      }
    ],
    folders: [
      { id: "folder_1", name: "Social Media", appIds: ["app_1002", "app_1004"] },
      { id: "folder_2", name: "Music", appIds: ["app_1001"] }
    ],
    country: "us",
    lang: "all"
  });

  // Use a data URL page to set localStorage then redirect
  const bootstrapHtml = `<!DOCTYPE html><html><head></head><body>
<script>
localStorage.setItem('srf_state_v2', ${JSON.stringify(mockState)});
window.location.href = 'http://localhost:52936';
<\/script></body></html>`;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(bootstrapHtml)}`);
});
