// test/helpers/load-focus-with-mock.js — Shared helper for focus.js test mocking
// focus.js destructures { execFile } at require-time, so we must patch
// child_process BEFORE requiring focus.js.

function loadFocusWithMock(execFileMock) {
  const cpKey = require.resolve("child_process");
  const focusKey = require.resolve("../../src/focus");

  const origCp = require.cache[cpKey];
  const origFocus = require.cache[focusKey];

  const realCp = require("child_process");
  const patchedCp = { ...realCp, execFile: execFileMock };
  require.cache[cpKey] = { id: cpKey, filename: cpKey, loaded: true, exports: patchedCp };

  delete require.cache[focusKey];
  const initFocus = require("../../src/focus");

  if (origCp) require.cache[cpKey] = origCp;
  else delete require.cache[cpKey];

  const cleanup = () => {
    if (origFocus) require.cache[focusKey] = origFocus;
    else delete require.cache[focusKey];
  };

  return { initFocus, cleanup };
}

module.exports = { loadFocusWithMock };
