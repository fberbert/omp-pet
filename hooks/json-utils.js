// File helpers for the OMP installer. Node built-ins only.

const fs = require("fs");
const path = require("path");

/**
 * Atomically write a JS object as pretty JSON. Writes to a sibling tmp file
 * then renames into place so concurrent readers never see a half-written
 * file. Creates the parent directory if missing. Cleans up the tmp file on
 * failure before re-throwing.
 */
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

/**
 * Packaged builds keep the extension sources inside app.asar; OMP cannot read
 * inside asar, so the installer copies from the physical file under
 * app.asar.unpacked/ (see package.json "asarUnpack"). No-op for source runs.
 */
function asarUnpackedPath(p) {
  return p.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

module.exports = {
  asarUnpackedPath,
  writeJsonAtomic,
};
