"use strict";

const noop = () => {};

function isLiveWindow(win) {
  return !!(win && (typeof win.isDestroyed !== "function" || !win.isDestroyed()));
}

function getPendingList(getPendingPermissions) {
  const pending = getPendingPermissions();
  return Array.isArray(pending) ? pending : [];
}

function createFloatingWindowRuntime(options = {}) {
  const getPendingPermissions = options.getPendingPermissions || (() => []);
  const keepOutOfTaskbar = options.keepOutOfTaskbar || noop;
  const repositionPermissionBubbles = options.repositionPermissionBubbles || noop;
  const repositionSessionHud = options.repositionSessionHud || noop;
  const repositionQuotaRing = options.repositionQuotaRing || noop;
  const syncSessionHudVisibility = options.syncSessionHudVisibility || noop;
  const showPermissionSurfacesForPet = options.showPermissionSurfacesForPet || null;
  const hidePermissionSurfacesForPet = options.hidePermissionSurfacesForPet || null;
  const setPermissionSurfacesFullscreenSuppressed = options.setPermissionSurfacesFullscreenSuppressed || noop;

  function repositionFloatingBubbles() {
    if (getPendingList(getPendingPermissions).length) repositionPermissionBubbles();
    repositionQuotaRing();
  }

  function repositionAnchoredSurfaces() {
    repositionSessionHud();
    repositionFloatingBubbles();
  }

  function syncSessionHudVisibilityAndBubbles() {
    syncSessionHudVisibility();
    repositionFloatingBubbles();
  }

  function showFloatingSurfacesForPet() {
    if (typeof showPermissionSurfacesForPet === "function") {
      showPermissionSurfacesForPet();
    } else {
      for (const perm of getPendingList(getPendingPermissions)) {
        const bubble = perm && perm.bubble;
        if (isLiveWindow(bubble) && typeof bubble.showInactive === "function") {
          bubble.showInactive();
          keepOutOfTaskbar(bubble);
        }
      }
    }
  }

  function hideFloatingSurfacesForPet() {
    if (typeof hidePermissionSurfacesForPet === "function") {
      hidePermissionSurfacesForPet();
    } else {
      for (const perm of getPendingList(getPendingPermissions)) {
        const bubble = perm && perm.bubble;
        if (isLiveWindow(bubble) && typeof bubble.hide === "function") {
          bubble.hide();
        }
      }
    }
  }

  function setFullscreenSuppressedForPet(suppressed, { includePermissionSurfaces = true } = {}) {
    const target = suppressed === true;
    // #1275: lowering the Mac pet must not hide approvals in a fullscreen
    // terminal. Always clear suppression on exit, even if the pref changed.
    if (!target || includePermissionSurfaces) setPermissionSurfacesFullscreenSuppressed(target);
  }

  return {
    repositionFloatingBubbles,
    repositionAnchoredSurfaces,
    syncSessionHudVisibilityAndBubbles,
    showFloatingSurfacesForPet,
    hideFloatingSurfacesForPet,
    setFullscreenSuppressedForPet,
  };
}

module.exports = createFloatingWindowRuntime;
