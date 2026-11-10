"use strict";

// "Open at login": Electron has no Linux API, so a .desktop file is written
// into ~/.config/autostart/.

const fs = require("fs");
const os = require("os");
const path = require("path");

const AUTOSTART_DIR = path.join(os.homedir(), ".config", "autostart");
const AUTOSTART_FILE = path.join(AUTOSTART_DIR, "omp-pet.desktop");

function getOpenAtLogin() {
  try {
    return fs.existsSync(AUTOSTART_FILE);
  } catch {
    return false;
  }
}

function setOpenAtLogin(enable, { execCmd } = {}) {
  if (enable) {
    if (!execCmd) {
      throw new Error("setOpenAtLogin: execCmd is required when enabling");
    }
    const desktop =
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=OMP Pet",
        `Exec=${execCmd}`,
        "Hidden=false",
        "NoDisplay=false",
        "X-GNOME-Autostart-enabled=true",
      ].join("\n") + "\n";
    fs.mkdirSync(AUTOSTART_DIR, { recursive: true });
    fs.writeFileSync(AUTOSTART_FILE, desktop);
  } else {
    try {
      fs.unlinkSync(AUTOSTART_FILE);
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err;
    }
  }
}

module.exports = {
  AUTOSTART_FILE,
  getOpenAtLogin,
  setOpenAtLogin,
};
