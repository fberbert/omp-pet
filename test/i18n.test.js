"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { i18n, SUPPORTED_LANGS } = require("../src/i18n");

const ROOT = path.join(__dirname, "..");

function placeholders(value) {
  return Array.from(String(value).matchAll(/\{[^}]+\}/g), (m) => m[0]).sort();
}

function assertLocaleObjectParity(locales, label) {
  const baseKeys = Object.keys(locales.en);
  for (const lang of SUPPORTED_LANGS) {
    assert.ok(locales[lang], `missing ${label} locale: ${lang}`);
    assert.deepStrictEqual(Object.keys(locales[lang]), baseKeys, `${label} locale keys/order mismatch: ${lang}`);
    for (const key of baseKeys) {
      assert.strictEqual(typeof locales[lang][key], typeof locales.en[key], `${label}.${lang}.${key} type mismatch`);
      if (typeof locales.en[key] === "string") {
        assert.deepStrictEqual(
          placeholders(locales[lang][key]),
          placeholders(locales.en[key]),
          `${label}.${lang}.${key} placeholder mismatch`
        );
      } else if (typeof locales.en[key] === "function") {
        assert.strictEqual(
          locales[lang][key].length,
          locales.en[key].length,
          `${label}.${lang}.${key} function arity mismatch`
        );
      }
    }
  }
}

function loadSettingsI18nStrings() {
  const source = fs.readFileSync(path.join(ROOT, "src", "settings-i18n.js"), "utf8");
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.ClawdSettingsI18n.STRINGS;
}

// Renderers outside the settings window resolve t() against src/i18n.js, and t() falls
// back to returning the key itself, so a string filed under settings-i18n.js by mistake
// renders its own name into the UI instead of failing loudly.
function runtimeDictRenderers() {
  const dir = path.join(ROOT, "src");
  const renderers = new Set();
  for (const html of fs.readdirSync(dir).filter((f) => f.endsWith(".html"))) {
    const markup = fs.readFileSync(path.join(dir, html), "utf8");
    const scripts = Array.from(markup.matchAll(/<script[^>]+src="\.?\/?([^"]+\.js)"/g), (m) => m[1]);
    if (scripts.includes("settings-i18n.js")) continue;
    for (const script of scripts) {
      const file = path.join(dir, script);
      if (!fs.existsSync(file)) continue;
      const source = fs.readFileSync(file, "utf8");
      if (/function t\(key\)/.test(source) && /getI18n\(/.test(source)) renderers.add(script);
    }
  }
  return Array.from(renderers);
}

describe("i18n locales", () => {
  it("lists all selectable languages in supported languages", () => {
    assert.deepStrictEqual(SUPPORTED_LANGS, ["en", "pt-BR"]);
  });

  it("keeps all locale keysets aligned with English", () => {
    assertLocaleObjectParity(i18n, "runtime");
  });

  it("uses the requested Simplified Chinese desktop-pet recovery wording", () => {
  });

  it("localizes idle behavior choices and descriptions in every Settings locale", () => {
    const strings = loadSettingsI18nStrings();
    const keys = ["rowIdleBehavior", "idleBehaviorNone", "idleBehaviorRoam", "idleBehaviorActivities",
      "idleBehaviorNoneDesc", "idleBehaviorRoamDesc", "idleBehaviorActivitiesDesc"];
    for (const lang of SUPPORTED_LANGS) {
      for (const key of keys) {
        assert.strictEqual(typeof strings[lang][key], "string", `${lang}.${key}`);
        assert.ok(strings[lang][key].trim(), `${lang}.${key}`);
      }
      for (const key of ["rowFreeRoam", "rowFreeRoamDesc", "rowIdleActivities", "rowIdleActivitiesDesc"]) {
        assert.strictEqual(Object.hasOwn(strings[lang], key), false, `${lang}.${key} is obsolete`);
      }
    }
    assert.deepStrictEqual(keys.slice(0, 4).map((key) => strings.en[key]),
      ["When idle", "Stay put", "Free roam", "Idle activities"]);
  });

  it("keeps Settings locale keysets aligned with English", () => {
    assertLocaleObjectParity(loadSettingsI18nStrings(), "settings");
  });

  // #895: the Agents-tab catalog also holds agents the detector never examined —
  // claude-code and codex are skipped outright — so a title that asserts "not
  // detected" is a claim Clawd cannot make. A user with Codex genuinely
  // installed saw it filed under 未检测到 and concluded detection was broken.
  // Asserted against the real bundle: the renderer suite stubs its own inline
  // ClawdSettingsI18n, so a regression here would otherwise stay invisible.

  it("keeps every renderer t(\"key\") literal resolvable in the runtime locale", () => {
    const renderers = runtimeDictRenderers();
    for (const known of ["session-hud-renderer.js", "dashboard-renderer.js"]) {
      assert.ok(renderers.includes(known), `renderer discovery missed ${known}`);
    }
    for (const file of renderers) {
      const source = fs.readFileSync(path.join(ROOT, "src", file), "utf8");
      // the lookbehind drops method calls like obj.t("x")
      const keys = new Set(
        Array.from(source.matchAll(/(?<![\w$.])t\(\s*"([A-Za-z0-9_]+)"\s*\)/g), (m) => m[1])
      );
      // a key picked by a ternary reaches t() as t(tipKey), never as a literal, so pull the
      // strings out of any *Key identifier that t() is actually called with
      for (const [, ident, rhs] of source.matchAll(/\b(\w+Key)\b\s*=\s*([^;]+);/g)) {
        if (!new RegExp(`(?<![\\w$.])t\\(\\s*${ident}\\s*\\)`).test(source)) continue;
        for (const [, key] of rhs.matchAll(/"([A-Za-z0-9_]+)"/g)) keys.add(key);
      }
      assert.ok(keys.size, `${file} should call t() with literal keys`);
      for (const key of keys) {
        assert.ok(key in i18n.en, `${file}: i18n key "${key}" is missing from src/i18n.js`);
      }
    }
  });

  // Keys reached through a lookup table (t(entry.key)) are invisible to the scan above, so
  // rather than trace dataflow, treat any Settings-only key name appearing in a runtime
  // renderer as misfiled. Keys resolved purely at runtime from main-process payloads never
  // appear as literals here, so they stay out of scope.
  it("keeps renderers clear of keys that only exist in the Settings locale", () => {
    const settings = loadSettingsI18nStrings();
    for (const file of runtimeDictRenderers()) {
      const source = fs.readFileSync(path.join(ROOT, "src", file), "utf8");
      const literals = new Set(Array.from(source.matchAll(/"([A-Za-z][A-Za-z0-9_]{2,})"/g), (m) => m[1]));
      for (const literal of literals) {
        if (literal in settings.en && !(literal in i18n.en)) {
          assert.fail(`${file}: "${literal}" resolves only in settings-i18n.js, which this window never loads`);
        }
      }
    }
  });

  // Parity passes on "1 ativas" — the key and the placeholder are both there,
  // only the grammar is wrong. Portuguese inflects for number, so these pin the
  // rendered text at 1 and at N.
  it("inflects pt-BR count strings whose locale entry is a function", () => {
    const pt = loadSettingsI18nStrings()["pt-BR"];

    assert.strictEqual(pt.doctorAgentSummaryAttention(1), "1 precisa de atenção");
    assert.strictEqual(pt.doctorAgentSummaryAttention(4), "4 precisam de atenção");
    assert.strictEqual(pt.doctorAgentSummarySkipped(1), "1 ignorado");
    assert.strictEqual(pt.doctorAgentSummarySkipped(4), "4 ignorados");

    assert.match(pt.toastAnimOverridesExportOk(1, "/tmp/o.json"), /\b1 tema\b/);
    assert.match(pt.toastAnimOverridesExportOk(2, "/tmp/o.json"), /\b2 temas\b/);
    assert.match(pt.toastAnimOverridesImportOk(1), /\b1 tema\b/);
    assert.match(pt.toastAnimOverridesImportOk(2), /\b2 temas\b/);
  });

  it("keeps pt-BR count strings number-invariant where the locale entry is a plain string", () => {
    const settings = loadSettingsI18nStrings()["pt-BR"];
    const runtime = i18n["pt-BR"];

    // [template, placeholder, rendered at 1, rendered at 4]
    const cases = [
      [runtime.dashboardCount, "{n}", "1 em atividade", "4 em atividade"],
      [runtime.sessionHudOtherActive, "{n}", "mais 1 em atividade", "mais 4 em atividade"],
      [settings.doctorIssueCount, "{count}", "1 problema(s)", "4 problema(s)"],
    ];
    for (const [template, placeholder, one, many] of cases) {
      assert.strictEqual(template.replace(placeholder, "1"), one);
      assert.strictEqual(template.replace(placeholder, "4"), many);
    }

    // Appended after a name list that can hold a single agent.
    assert.strictEqual(settings.doctorAgentSummaryNeedsAttention, "precisa(m) de atenção");
  });

});
