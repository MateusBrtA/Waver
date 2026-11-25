const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Curated Windows game & app catalog (lowercase exe -> display metadata)
const KNOWN_APPS = {
  'league of legends.exe': { name: 'League of Legends', icon: '⚔️', category: 'game', color: '#0ac8b9' },
  'leagueclientux.exe': { name: 'League of Legends', icon: '⚔️', category: 'game', color: '#0ac8b9' },
  'valorant-win64-shipping.exe': { name: 'VALORANT', icon: '🎯', category: 'game', color: '#ff4655' },
  'cs2.exe': { name: 'Counter-Strike 2', icon: '🔫', category: 'game', color: '#de9b35' },
  'javaw.exe': { name: 'Minecraft', icon: '⛏️', category: 'game', color: '#52a535' },
  'minecraft.windows.exe': { name: 'Minecraft', icon: '⛏️', category: 'game', color: '#52a535' },
  'gta5.exe': { name: 'Grand Theft Auto V', icon: '🚗', category: 'game', color: '#4caf50' },
  'fivem_gtaProcess.exe': { name: 'FiveM (GTA RP)', icon: '🚓', category: 'game', color: '#f97316' },
  'robloxplayerbeta.exe': { name: 'Roblox', icon: '🧱', category: 'game', color: '#e11d48' },
  'skyrimse.exe': { name: 'The Elder Scrolls V: Skyrim', icon: '🐉', category: 'game', color: '#94a3b8' },
  'remnant-win64-shipping.exe': { name: 'Remnant: From the Ashes', icon: '🔥', category: 'game', color: '#dc2626' },
  'remnant2-win64-shipping.exe': { name: 'Remnant II', icon: '🔥', category: 'game', color: '#dc2626' },
  'fortniteclient-win64-shipping.exe': { name: 'Fortnite', icon: '🪂', category: 'game', color: '#38bdf8' },
  'r5apex.exe': { name: 'Apex Legends', icon: '🏆', category: 'game', color: '#ef4444' },
  'eldenring.exe': { name: 'Elden Ring', icon: '💍', category: 'game', color: '#eab308' },
  'cyberpunk2077.exe': { name: 'Cyberpunk 2077', icon: '🤖', category: 'game', color: '#facc15' },
  'rocketleague.exe': { name: 'Rocket League', icon: '⚽', category: 'game', color: '#3b82f6' },
  'rdr2.exe': { name: 'Red Dead Redemption 2', icon: '🤠', category: 'game', color: '#b91c1c' },
  'overwatch.exe': { name: 'Overwatch 2', icon: '🛡️', category: 'game', color: '#f97316' },
  'dota2.exe': { name: 'Dota 2', icon: '🗡️', category: 'game', color: '#dc2626' },
  'fc24.exe': { name: 'EA SPORTS FC 24', icon: '⚽', category: 'game', color: '#22c55e' },
  'fc25.exe': { name: 'EA SPORTS FC 25', icon: '⚽', category: 'game', color: '#22c55e' },
  'genshinimpact.exe': { name: 'Genshin Impact', icon: '✨', category: 'game', color: '#60a5fa' },
  'terraria.exe': { name: 'Terraria', icon: '🌳', category: 'game', color: '#16a34a' },
  'stardew valley.exe': { name: 'Stardew Valley', icon: '🌾', category: 'game', color: '#84cc16' },
  'rainbowsix.exe': { name: 'Rainbow Six Siege', icon: '💣', category: 'game', color: '#64748b' },
  'rustclient.exe': { name: 'Rust', icon: '🪨', category: 'game', color: '#cd412b' },
  'deadbydaylight-win64-shipping.exe': { name: 'Dead by Daylight', icon: '💀', category: 'game', color: '#991b1b' },
  'palworld-win64-shipping.exe': { name: 'Palworld', icon: '🐾', category: 'game', color: '#38bdf8' },
  'lethal company.exe': { name: 'Lethal Company', icon: '🚨', category: 'game', color: '#ea580c' },
  'bg3.exe': { name: "Baldur's Gate 3", icon: '🎲', category: 'game', color: '#a855f7' },
  'bg3_dx11.exe': { name: "Baldur's Gate 3", icon: '🎲', category: 'game', color: '#a855f7' },
  'cod.exe': { name: 'Call of Duty', icon: '🎖️', category: 'game', color: '#22c55e' },
  'bf2042.exe': { name: 'Battlefield 2042', icon: '🪖', category: 'game', color: '#06b6d4' },
  'tmodloader.exe': { name: 'tModLoader', icon: '🌳', category: 'game', color: '#22c55e' },
  'osu!.exe': { name: 'osu!', icon: '🎵', category: 'game', color: '#ec4899' },
  'hollow_knight.exe': { name: 'Hollow Knight', icon: '🪲', category: 'game', color: '#818cf8' },
  'spotify.exe': { name: 'Spotify', icon: '🎧', category: 'music', color: '#1db954' },
  'code.exe': { name: 'Visual Studio Code', icon: '💻', category: 'app', color: '#007acc' },
  'obs64.exe': { name: 'OBS Studio', icon: '🎥', category: 'app', color: '#6366f1' },
  'blender.exe': { name: 'Blender', icon: '🧊', category: 'app', color: '#f97316' },
  'photoshop.exe': { name: 'Adobe Photoshop', icon: '🎨', category: 'app', color: '#31a8ff' },
};

class ActivityDetector {
  constructor(userDataDir, onChange, scanProcessesFn = null) {
    this.historyFile = path.join(userDataDir, 'activity-history.json');
    this.onChange = onChange;
    this.scanProcessesFn = scanProcessesFn;
    this.timer = null;
    this.currentActivity = null;
    this.recentActivities = this.loadHistory();
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const arr = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
        if (Array.isArray(arr)) return arr.slice(0, 15);
      }
    } catch {
      // ignore
    }
    return [];
  }

  saveHistory() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.recentActivities.slice(0, 15), null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  getState() {
    return {
      currentActivity: this.currentActivity,
      recentActivities: this.recentActivities,
    };
  }

  start() {
    if (process.platform !== 'win32') return;
    this.poll();
    this.timer = setInterval(() => this.poll(), 20000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  applyProcessList(exeNames) {
    let detected = null;
    let fallbackApp = null;
    for (const exeRaw of exeNames) {
      const exeLower = String(exeRaw || '').trim().toLowerCase();
      if (!exeLower) continue;
      const entry = KNOWN_APPS[exeLower];
      if (!entry) continue;
      if (entry.category === 'game') {
        detected = entry;
        break;
      } else if (!fallbackApp) {
        fallbackApp = entry;
      }
    }

    const chosen = detected || fallbackApp;
    const now = Date.now();
    const prevName = this.currentActivity?.name || null;
    const nextName = chosen?.name || null;

    if (chosen) {
      const startedAt = prevName === nextName ? this.currentActivity.startedAt : now;
      this.currentActivity = {
        name: chosen.name,
        icon: chosen.icon,
        category: chosen.category,
        color: chosen.color,
        startedAt,
      };

      // Update 30-day recent activities list
      const existingIdx = this.recentActivities.findIndex((a) => a.name === chosen.name);
      if (existingIdx >= 0) {
        const item = this.recentActivities[existingIdx];
        item.lastPlayedAt = now;
        item.totalMinutes = Number(((item.totalMinutes || 0) + 0.33).toFixed(2));
        this.recentActivities.splice(existingIdx, 1);
        this.recentActivities.unshift(item);
      } else {
        this.recentActivities.unshift({
          name: chosen.name,
          icon: chosen.icon,
          category: chosen.category,
          color: chosen.color,
          lastPlayedAt: now,
          totalMinutes: 0.33,
        });
      }
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      this.recentActivities = this.recentActivities
        .filter((a) => (a.lastPlayedAt || 0) >= thirtyDaysAgo)
        .slice(0, 12);
      this.saveHistory();
    } else {
      this.currentActivity = null;
    }

    if (prevName !== nextName) {
      this.onChange?.(this.getState());
    }
  }

  async poll() {
    if (typeof this.scanProcessesFn === 'function') {
      try {
        const nativeList = await this.scanProcessesFn();
        if (Array.isArray(nativeList) && nativeList.length > 0) {
          this.applyProcessList(nativeList);
          return;
        }
      } catch {
        // Fallback to tasklist below
      }
    }

    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return;
      const lines = stdout.split(/\r?\n/);
      const names = [];
      for (const line of lines) {
        const match = /^"([^"]+)"/.exec(line.trim());
        if (match) names.push(match[1]);
      }
      this.applyProcessList(names);
    });
  }
}

module.exports = { ActivityDetector };
