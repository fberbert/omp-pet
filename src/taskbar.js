"use strict";

// Some window managers can lose the BrowserWindow creation-time skipTaskbar
// flag after showInactive() or a shell restart. Reassert it for floating
// windows whenever they are shown without activation.
function keepOutOfTaskbar(w) {
  if (!w || w.isDestroyed()) return;
  if (typeof w.setSkipTaskbar === "function") w.setSkipTaskbar(true);
}

module.exports = { keepOutOfTaskbar };
