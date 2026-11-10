// Tray flash icons (#722).
//
// The completion flash blinks the tray icon between the normal icon and an
// orange completion dot. Linux trays work in raw pixels, so both frames are
// normalised to 32x32 and keep the same slot size.

const TRAY_PIXEL_SIZE = 32;

function loadTrayNormalIcon({ nativeImage, iconPath }) {
  return nativeImage
    .createFromPath(iconPath)
    .resize({ width: TRAY_PIXEL_SIZE, height: TRAY_PIXEL_SIZE });
}

function loadTrayFlashIcon({ nativeImage, flashPath, fileExists }) {
  if (!flashPath || !fileExists(flashPath)) return null;
  const src = nativeImage.createFromPath(flashPath);
  if (!src || src.isEmpty()) return null;
  return src.resize({ width: TRAY_PIXEL_SIZE, height: TRAY_PIXEL_SIZE });
}

module.exports = { loadTrayNormalIcon, loadTrayFlashIcon, TRAY_PIXEL_SIZE };
