"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC_DIR = path.join(__dirname, "..", "src");
const SETTINGS_HTML = path.join(SRC_DIR, "settings.html");
const SETTINGS_CSS = path.join(SRC_DIR, "settings.css");
const LANGUAGE_PICKER_JS = path.join(SRC_DIR, "language-picker.js");
const LANGUAGE_PICKER_CSS = path.join(SRC_DIR, "language-picker.css");
const SETTINGS_TAB_GENERAL = path.join(SRC_DIR, "settings-tab-general.js");
const SETTINGS_TAB_DISCORD_PRESENCE = path.join(SRC_DIR, "settings-tab-discord-presence.js");
const SETTINGS_UI_CORE = path.join(SRC_DIR, "settings-ui-core.js");
const SETTINGS_ANIM_OVERRIDES_MERGE = path.join(SRC_DIR, "settings-anim-overrides-merge.js");
const SETTINGS_I18N = path.join(SRC_DIR, "settings-i18n.js");
const SETTINGS_DOCTOR_MODAL = path.join(SRC_DIR, "settings-doctor-modal.js");
const MAIN_PROCESS = path.join(SRC_DIR, "main.js");
const { SUPPORTED_LANGS } = require("../src/i18n");

function createDeferred() {
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
}

function loadSettingsI18nBundleForTest() {
  const context = { globalThis: null };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SETTINGS_I18N, "utf8"), context);
  return context.ClawdSettingsI18n;
}

function loadSettingsI18nForTest() {
  return loadSettingsI18nBundleForTest().STRINGS;
}

function loadSettingsCoreForTest(settingsAPI, {
  document: documentOverride = null,
  localStorage: localStorageOverride = null,
  matchMedia = null,
  requestAnimationFrame = (cb) => {
    cb();
    return 1;
  },
} = {}) {
  const document = documentOverride || {
    body: { contains: () => false },
    getElementById: () => null,
  };
  const context = {
    console,
    navigator: { platform: "Win32" },
    localStorage: localStorageOverride || {
      getItem: () => null,
      setItem: () => {},
    },
    document,
    matchMedia,
    requestAnimationFrame,
    window: null,
    globalThis: null,
    settingsAPI,
    ClawdSettingsSizeSlider: {
      SIZE_UI_MIN: 1,
      SIZE_UI_MAX: 100,
      SIZE_TICK_VALUES: [25, 50, 75, 100],
      SIZE_SLIDER_THUMB_DIAMETER: 18,
      prefsSizeToUi: (value) => value,
      clampSizeUi: (value) => value,
      sizeUiToPct: (value) => value,
      getSizeSliderAnchorPx: () => 0,
      createSizeSliderController: () => ({}),
    },
    ClawdSettingsI18n: {
      STRINGS: { en: {} },
      CONTRIBUTORS: [],
      MAINTAINERS: [],
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SETTINGS_ANIM_OVERRIDES_MERGE, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_UI_CORE, "utf8"), context);
  return context.ClawdSettingsCore;
}

function createQueuedRaf() {
  const queue = [];
  return {
    requestAnimationFrame(cb) {
      queue.push(cb);
      return queue.length;
    },
    flush() {
      while (queue.length) {
        const cb = queue.shift();
        cb();
      }
    },
    flushFrame() {
      const callbacks = queue.splice(0);
      for (const cb of callbacks) cb();
    },
  };
}

function attachDisclosureForHarness({
  root,
  trigger,
  body,
  expanded = false,
  onExpandedChange = null,
}) {
  let isExpanded = !!expanded;
  const sync = () => {
    root.classList.toggle("expanded", isExpanded);
    root.classList.toggle("collapsed", !isExpanded);
    trigger.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    body.setAttribute("aria-hidden", isExpanded ? "false" : "true");
    body.inert = !isExpanded;
  };
  const onClick = () => {
    isExpanded = !isExpanded;
    sync();
    if (typeof onExpandedChange === "function") onExpandedChange(isExpanded, { persist: true });
  };
  trigger.addEventListener("click", onClick);
  sync();
  return {
    get expanded() { return isExpanded; },
    dispose() { trigger.removeEventListener("click", onClick); },
  };
}

function createMountedDisposableHarness() {
  const scopes = new Map();
  const getScope = (scope = "content") => {
    if (!scopes.has(scope)) scopes.set(scope, new Set());
    return scopes.get(scope);
  };
  return {
    scopes,
    register(disposable, { scope = "content" } = {}) {
      if (disposable && typeof disposable.dispose === "function") getScope(scope).add(disposable);
      return disposable;
    },
    dispose(disposable) {
      if (!disposable || typeof disposable.dispose !== "function") return;
      for (const [scope, controls] of scopes) {
        controls.delete(disposable);
        if (controls.size === 0) scopes.delete(scope);
      }
      disposable.dispose();
    },
    disposeScope(scope = null) {
      const scopeNames = scope === null ? Array.from(scopes.keys()) : [scope];
      for (const scopeName of scopeNames) {
        const controls = scopes.get(scopeName);
        if (!controls) continue;
        scopes.delete(scopeName);
        for (const disposable of Array.from(controls)) disposable.dispose();
      }
    },
  };
}

describe("recap metadata refresh", () => {
  it("rerenders an open recap page when delayed agent metadata arrives", () => {
    let rawScrollTop = 620;
    let maxScrollTop = 2000;
    const raf = createQueuedRaf();
    const content = {
      children: [],
      get scrollTop() {
        return Math.min(rawScrollTop, maxScrollTop);
      },
      set scrollTop(value) {
        rawScrollTop = Math.max(0, Math.min(Number(value) || 0, maxScrollTop));
      },
    };
    const document = {
      body: { contains: () => false },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, {
      document,
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    core.state.activeTab = "recap";
    let renders = 0;
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {
        renders += 1;
        maxScrollTop = 0;
        content.scrollTop = content.scrollTop;
        maxScrollTop = 2000;
      },
      modal: () => {},
    });

    core.ops.applyAgentMetadata([{ id: "codex", name: "Codex" }]);

    assert.strictEqual(renders, 1);
    assert.strictEqual(core.runtime.agentMetadata[0].name, "Codex");
    assert.strictEqual(content.scrollTop, 620);
    content.scrollTop = 0;
    raf.flush();
    assert.strictEqual(content.scrollTop, 620);
  });

  it("does not enable recap scroll preservation for delayed metadata on Agents", () => {
    let rawScrollTop = 620;
    let maxScrollTop = 2000;
    const raf = createQueuedRaf();
    const content = {
      children: [],
      get scrollTop() {
        return Math.min(rawScrollTop, maxScrollTop);
      },
      set scrollTop(value) {
        rawScrollTop = Math.max(0, Math.min(Number(value) || 0, maxScrollTop));
      },
    };
    const document = {
      body: { contains: () => false },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, {
      document,
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    core.state.activeTab = "agents";
    core.ops.installRenderHooks({
      content: () => {
        maxScrollTop = 0;
        content.scrollTop = content.scrollTop;
        maxScrollTop = 2000;
      },
    });

    core.ops.applyAgentMetadata([{ id: "codex", name: "Codex" }]);

    assert.strictEqual(content.scrollTop, 0);
    raf.flush();
    assert.strictEqual(content.scrollTop, 0);
  });

  it("preserves recap scroll for generic settings changes without changing Agents", () => {
    for (const tabId of ["recap", "agents"]) {
      let rawScrollTop = 620;
      let maxScrollTop = 2000;
      const raf = createQueuedRaf();
      const content = {
        children: [],
        get scrollTop() {
          return Math.min(rawScrollTop, maxScrollTop);
        },
        set scrollTop(value) {
          rawScrollTop = Math.max(0, Math.min(Number(value) || 0, maxScrollTop));
        },
      };
      const document = {
        body: { contains: () => false },
        getElementById: (id) => (id === "content" ? content : null),
      };
      const core = loadSettingsCoreForTest({}, {
        document,
        requestAnimationFrame: raf.requestAnimationFrame,
      });
      core.state.activeTab = tabId;
      core.state.snapshot = { soundMuted: false };
      core.tabs[tabId] = {};
      core.ops.installRenderHooks({
        sidebar: () => {},
        content: () => {
          maxScrollTop = 0;
          content.scrollTop = content.scrollTop;
          maxScrollTop = 2000;
        },
      });

      core.ops.applyChanges({ changes: { soundMuted: true } });

      const expected = tabId === "recap" ? 620 : 0;
      assert.strictEqual(content.scrollTop, expected, `${tabId} immediate scroll`);
      content.scrollTop = 0;
      raf.flush();
      assert.strictEqual(content.scrollTop, expected, `${tabId} deferred scroll`);
    }
  });
});

class FakeClassList {
  constructor(el) {
    this.el = el;
  }

  _set(values) {
    this.el.className = [...values].join(" ");
  }

  _values() {
    return new Set(String(this.el.className || "").split(/\s+/).filter(Boolean));
  }

  add(...names) {
    const values = this._values();
    for (const name of names) values.add(name);
    this._set(values);
  }

  remove(...names) {
    const values = this._values();
    for (const name of names) values.delete(name);
    this._set(values);
  }

  contains(name) {
    return this._values().has(name);
  }

  toggle(name, force) {
    const values = this._values();
    const shouldAdd = force === undefined ? !values.has(name) : !!force;
    if (shouldAdd) values.add(name);
    else values.delete(name);
    this._set(values);
    return shouldAdd;
  }
}

// Walk the tree using each node's own text so checks can include innerHTML
// without double-counting the aggregating textContent getter below.
function collectText(el) {
  if (!el) return "";
  const parts = [];
  if (el._textContent) parts.push(String(el._textContent));
  if (el.innerHTML) parts.push(String(el.innerHTML));
  for (const child of el.children || []) parts.push(collectText(child));
  return parts.join(" ");
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.eventListeners = {};
    this.className = "";
    this._textContent = "";
    this.title = "";
    this.type = "";
    this.disabled = false;
    this.focused = false;
    this.open = false;
    this.inert = false;
    this._innerHTML = "";
    this.parentNode = null;
    this.scrollTop = 0;
    this.style = {
      _values: {},
      setProperty(name, value) {
        this._values[name] = String(value);
      },
      removeProperty(name) {
        delete this._values[name];
      },
      getPropertyValue(name) {
        return this._values[name] || "";
      },
    };
    this.classList = new FakeClassList(this);
  }

  get parentElement() {
    return this.parentNode;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  set textContent(value) {
    this._textContent = value == null ? "" : String(value);
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._innerHTML = "";
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  insertBefore(child, reference) {
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index !== -1) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name === "href") this.href = String(value);
    if (name === "id") this.id = String(value);
    if (name === "type") this.type = String(value);
    if (name === "tabindex") this.tabIndex = Number(value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_m, ch) => ch.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === "class") this.className = "";
    if (name === "id") delete this.id;
  }

  addEventListener(type, cb) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(cb);
  }

  removeEventListener(type, cb) {
    const listeners = this.eventListeners[type];
    if (!listeners) return;
    const index = listeners.indexOf(cb);
    if (index !== -1) listeners.splice(index, 1);
  }

  focus() {
    this.focused = true;
  }

  scrollIntoView(options) {
    this.scrollOptions = options;
  }

  dispatchEvent(event) {
    const ev = event || {};
    if (!ev.type) throw new Error("FakeElement.dispatchEvent requires an event type");
    if (!ev.target) ev.target = this;
    ev.currentTarget = this;
    if (typeof ev.preventDefault !== "function") {
      ev.preventDefault = function preventDefault() {
        this.defaultPrevented = true;
      };
    }
    if (typeof ev.stopPropagation !== "function") {
      ev.stopPropagation = function stopPropagation() {
        this.cancelBubble = true;
      };
    }
    const listeners = this.eventListeners[ev.type] || [];
    for (const listener of [...listeners]) listener(ev);
    if (ev.bubbles !== false && !ev.cancelBubble && this.parentNode) {
      return this.parentNode.dispatchEvent(ev);
    }
    return !ev.defaultPrevented;
  }

  click() {
    return this.dispatchEvent({ type: "click", bubbles: false });
  }

  set innerHTML(_value) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._textContent = "";
    const html = String(_value || "");
    this._innerHTML = html;
    const stack = [this];
    const tagRe = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
    let match;
    while ((match = tagRe.exec(html)) !== null) {
      const full = match[0];
      const tagName = match[1];
      const attrSource = match[2] || "";
      if (full.startsWith("</")) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const child = new FakeElement(tagName);
      const attrRe = /([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      let attrMatch;
      while ((attrMatch = attrRe.exec(attrSource)) !== null) {
        const attrName = attrMatch[1];
        if (attrName === "/") continue;
        const attrValue = (attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        child.setAttribute(attrName, attrValue);
      }
      stack[stack.length - 1].appendChild(child);
      const voidTag = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tagName);
      if (!full.endsWith("/>") && !voidTag) stack.push(child);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  _matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    const tagAttribute = /^([a-zA-Z][\w-]*)\[([:\w-]+)\]$/.exec(selector);
    if (tagAttribute) {
      return this.tagName.toLowerCase() === tagAttribute[1].toLowerCase()
        && Object.prototype.hasOwnProperty.call(this.attributes, tagAttribute[2]);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const parts = String(selector || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return [];
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (!child || typeof child._matchesSelectorParts !== "function") continue;
        if (child._matchesSelectorParts(parts)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  contains(target) {
    if (target === this) return true;
    return this.children.some((child) => child && typeof child.contains === "function" && child.contains(target));
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }

  _matchesSelectorParts(parts) {
    if (!this._matches(parts[parts.length - 1])) return false;
    let current = this.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (current && !current._matches(parts[i])) current = current.parentNode;
      if (!current) return false;
      current = current.parentNode;
    }
    return true;
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current.tagName === "BODY") return true;
      current = current.parentNode;
    }
    return false;
  }

  get scrollHeight() {
    if (!this.isConnected) return 0;
    return Math.max(40, this.children.length * 40);
  }
}

let nextFakeSettingRowId = 1;
function buildFakeSettingRow(document, config = {}) {
  const element = document.createElement("div");
  element.className = ["row", config.className || ""].filter(Boolean).join(" ");
  const textElement = document.createElement("div");
  textElement.className = "row-text";
  const labelElement = document.createElement("span");
  labelElement.className = "row-label";
  labelElement.id = `fake-row-label-${nextFakeSettingRowId++}`;
  labelElement.textContent = config.label != null ? String(config.label) : (config.labelKey || "");
  textElement.appendChild(labelElement);
  let descriptionElement = null;
  const description = config.description != null ? String(config.description) : (config.descriptionKey || "");
  if (description) {
    descriptionElement = document.createElement("span");
    descriptionElement.className = "row-desc";
    descriptionElement.id = `fake-row-description-${nextFakeSettingRowId++}`;
    descriptionElement.textContent = description;
    textElement.appendChild(descriptionElement);
  }
  const controlElement = document.createElement("div");
  controlElement.className = ["row-control", config.controlClassName || ""].filter(Boolean).join(" ");
  element.appendChild(textElement);
  element.appendChild(controlElement);
  return { element, textElement, labelElement, descriptionElement, controlElement };
}

function loadSharedButtonHelpersForTest(document, settingsAPI = {}, getTranslate = null) {
  const shared = loadSettingsCoreForTest(settingsAPI, { document }).helpers;
  const translateConfig = (config = {}) => {
    if (!Object.prototype.hasOwnProperty.call(config, "labelKey")) return config;
    const translate = typeof getTranslate === "function" ? getTranslate() : null;
    return {
      ...config,
      label: typeof translate === "function" ? translate(config.labelKey) : config.labelKey,
    };
  };
  return {
    buildButton: (config) => shared.buildButton(translateConfig(config)),
    setButtonState: (button, patch) => shared.setButtonState(button, translateConfig(patch)),
    buildSwitch: (config) => shared.buildSwitch(config),
  };
}

function loadSharedChoiceHelpersForTest(document) {
  const core = loadSettingsCoreForTest({}, { document });
  return {
    buildTabs: core.helpers.buildTabs,
    createSubpageHost: core.helpers.createSubpageHost,
    clearMountedControls: core.ops.clearMountedControls,
    buildSegmentedRadio: core.helpers.buildSegmentedRadio,
    registerMountedDisposable: core.helpers.registerMountedDisposable,
  };
}

function loadRecapTabForTest({ data, agentMetadata = [], queryRecap } = {}) {
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  body.appendChild(content);
  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: () => null,
  };
  const strings = loadSettingsI18nForTest().en;
  const renderRequests = [];
  const context = {
    console,
    document,
    Intl,
    setTimeout,
    clearTimeout,
    window: null,
    globalThis: null,
    settingsAPI: {
      queryRecap: queryRecap || (async () => data),
      update: async () => ({ status: "ok" }),
      clearRecap: async () => ({ status: "ok" }),
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-recap.js"), "utf8"), context);
  const sharedControls = loadSharedButtonHelpersForTest(document, context.settingsAPI);
  const core = {
    state: { activeTab: "recap", snapshot: { lang: "en", recapEnabled: true } },
    runtime: { agentMetadata },
    helpers: {
      ...loadSharedChoiceHelpersForTest(document),
      t: (key) => strings[key] || key,
      buildSwitch: sharedControls.buildSwitch,
      buildSection: (title, rows) => {
        const section = document.createElement("section");
        section.setAttribute("aria-label", title);
        for (const row of rows) section.appendChild(row);
        return section;
      },
      showSettingsConfirmModal: async () => "cancel",
    },
    ops: {
      requestRender: (payload = {}) => {
        renderRequests.push(payload);
        const { content: shouldRender } = payload;
        if (shouldRender) render();
      },
      showToast: () => {},
    },
    tabs: {},
  };
  context.ClawdSettingsTabRecap.init(core);
  function render() {
    content.innerHTML = "";
    core.tabs.recap.render(content, core);
  }
  render();
  return {
    content,
    core,
    document,
    renderRequests,
    async settle() {
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    },
  };
}

function sampleRecapView() {
  const coverageMinutes = Array(24).fill(0);
  coverageMinutes[8] = 30;
  coverageMinutes[9] = 60;
  const codexHours = Array(24).fill(0);
  codexHours[9] = 9;
  const claudeHours = Array(24).fill(0);
  claudeHours[9] = 3;
  const hourCapacities = Array(24).fill(60);
  return {
    schemaVersion: 1,
    status: "ready",
    period: "today",
    anchorDate: "2026-08-29",
    startDate: "2026-08-29",
    endDate: "2026-08-29",
    currentLocalHour: 10,
    recordingStartedDate: "2026-08-29",
    recordingStartedLocalHour: 8,
    recordingEnabled: true,
    days: [{
      localDate: "2026-08-29",
      coverage: { coverageMinutes, hourCapacities },
      hourCapacities,
      rows: [
        {
          agentId: "codex",
          scope: "local",
          scopeInstance: "local-1",
          metrics: { sessionsStarted: null, turnsCompleted: 2, toolCalls: 4, activityEvents: 9 },
          sessionsStartedPartial: true,
          hours: codexHours,
        },
        {
          agentId: "claude-code",
          scope: "remote",
          scopeInstance: "remote-1",
          metrics: { sessionsStarted: 1, turnsCompleted: 1, toolCalls: 2, activityEvents: 3 },
          sessionsStartedPartial: false,
          hours: claudeHours,
        },
      ],
    }],
  };
}

function setFakeTextInputState(input, nextState = {}) {
  const state = { disabled: false, pending: false, invalid: false, lockWhilePending: true,
    ...(input._settingsTextInputState || {}) };
  for (const key of ["disabled", "pending", "invalid"]) {
    if (Object.prototype.hasOwnProperty.call(nextState, key)) state[key] = nextState[key] === true;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "lockWhilePending")) {
    state.lockWhilePending = nextState.lockWhilePending !== false;
  }
  input._settingsTextInputState = state;
  input.disabled = state.disabled || (state.pending && state.lockWhilePending);
  input.classList.toggle("pending", state.pending);
  input.classList.toggle("invalid", state.invalid);
  input.setAttribute("aria-busy", state.pending ? "true" : "false");
  input.setAttribute("aria-invalid", state.invalid ? "true" : "false");
  if (Object.prototype.hasOwnProperty.call(nextState, "describedBy")) {
    if (nextState.describedBy) input.setAttribute("aria-describedby", nextState.describedBy);
    else input.removeAttribute("aria-describedby");
  }
  return input;
}

function buildFakeTextInput(document, config = {}) {
  const input = document.createElement("input");
  const size = config.size === "compact" ? "compact" : "regular";
  input.type = config.type || "text";
  input.className = [
    "settings-text-input",
    `settings-text-input-${size}`,
    config.className || "",
  ].filter(Boolean).join(" ");
  if (config.value != null) input.value = String(config.value);
  if (config.placeholder != null) input.placeholder = String(config.placeholder);
  if (config.autocomplete != null) input.autocomplete = String(config.autocomplete);
  if (config.spellcheck != null) input.spellcheck = config.spellcheck === true;
  if (config.inputMode != null) input.inputMode = String(config.inputMode);
  if (config.maxLength != null) input.maxLength = Number(config.maxLength);
  if (config.pattern != null) input.pattern = String(config.pattern);
  if (config.ariaLabel) input.setAttribute("aria-label", config.ariaLabel);
  if (config.describedBy) input.setAttribute("aria-describedby", config.describedBy);
  if (typeof config.onInput === "function") input.addEventListener("input", config.onInput);
  if (config.stopPropagation === true) input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (config.stopPropagation === true) event.stopPropagation();
    if (event.key !== "Enter" || typeof config.onEnter !== "function"
      || event.isComposing === true || event.keyCode === 229) return;
    event.preventDefault();
    config.onEnter(event, input);
  });
  return setFakeTextInputState(input, config);
}

function loadSharedLanguagePickerForTest({
  value = "en",
  options = ["en", "zh", "ja"],
  onChange = () => Promise.resolve(true),
  innerHeight = 600,
  transitionDuration = "0.14s",
  transitionDelay = "0s",
  lockWhilePending = false,
  viewportPlacement = null,
  revealWhenClosed,
  innerWidth = 1000,
  textZoom = 1,
} = {}) {
  const body = new FakeElement("body");
  const boundary = new FakeElement("div");
  boundary.setAttribute("data-language-picker-boundary", "");
  body.appendChild(boundary);
  const documentListeners = new Map();
  const windowListeners = new Map();
  const animationFrames = new Map();
  const timers = new Map();
  const timerDelays = new Map();
  let nextAnimationFrameId = 1;
  let nextTimerId = 1;
  const document = {
    body,
    activeElement: body,
    documentElement: { clientHeight: innerHeight, clientWidth: innerWidth },
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.focus = (options = {}) => {
        element.focused = true;
        document.activeElement = element;
        if (options.preventScroll !== true) boundary.scrollTop = 0;
      };
      return element;
    },
    addEventListener(type, cb) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(cb);
    },
    removeEventListener(type, cb) {
      const listeners = documentListeners.get(type);
      if (!listeners) return;
      const index = listeners.indexOf(cb);
      if (index !== -1) listeners.splice(index, 1);
    },
  };
  const context = {
    console,
    document,
    innerHeight,
    innerWidth,
    addEventListener(type, cb) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(cb);
    },
    removeEventListener(type, cb) {
      const listeners = windowListeners.get(type);
      if (!listeners) return;
      const index = listeners.indexOf(cb);
      if (index !== -1) listeners.splice(index, 1);
    },
    requestAnimationFrame(cb) {
      const id = nextAnimationFrameId++;
      animationFrames.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    setTimeout(cb, delay) {
      const id = nextTimerId++;
      timers.set(id, cb);
      timerDelays.set(id, delay);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
      timerDelays.delete(id);
    },
    getComputedStyle(element) {
      if (element === document.documentElement) return { zoom: String(textZoom) };
      return { transitionDuration, transitionDelay };
    },
    matchMedia() {
      return { matches: false };
    },
    window: null,
    globalThis: null,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(LANGUAGE_PICKER_JS, "utf8"), context);

  const control = context.ClawdLanguagePicker.createLanguagePicker({
    value,
    options: options.map((option) => ({ value: option, label: option.toUpperCase() })),
    ariaLabel: "Language",
    onChange,
    lockWhilePending,
    viewportPlacement,
    revealWhenClosed,
  });
  boundary.appendChild(control.element);

  return {
    boundary,
    control,
    picker: control.element,
    trigger: control.element.querySelector(".language-picker-trigger"),
    menu: control.element.querySelector(".language-picker-menu"),
    optionElements: control.element.querySelectorAll(".language-picker-option"),
    valueElement: control.element.querySelector(".language-picker-value"),
    dispatchWindowEvent(type, event = {}) {
      for (const listener of [...(windowListeners.get(type) || [])]) {
        listener({ ...event, type });
      }
    },
    flushAnimationFrames() {
      while (animationFrames.size > 0) {
        const pending = [...animationFrames.values()];
        animationFrames.clear();
        for (const callback of pending) callback();
      }
    },
    flushTimers() {
      while (timers.size > 0) {
        const pending = [...timers.values()];
        timers.clear();
        timerDelays.clear();
        for (const callback of pending) callback();
      }
    },
    getPendingAnimationFrameCount: () => animationFrames.size,
    getPendingTimerCount: () => timers.size,
    getPendingTimerDelays: () => [...timerDelays.values()],
    getActiveElement: () => document.activeElement,
    setActiveElement: (element) => { document.activeElement = element; },
    body,
    getDocumentListenerCount: (type) => (documentListeners.get(type) || []).length,
    getWindowListenerCount: (type) => (windowListeners.get(type) || []).length,
  };
}

function loadGeneralLanguageRowForTest({
  snapshot,
  update = () => Promise.resolve({ status: "ok" }),
} = {}) {
  const raf = createQueuedRaf();
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  content.id = "content";
  body.appendChild(content);
  const toastStack = new FakeElement("div");
  toastStack.id = "toastStack";
  body.appendChild(toastStack);

  const documentListeners = new Map();
  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      if (id === "content") return content;
      if (id === "toastStack") return toastStack;
      return null;
    },
    addEventListener(type, cb) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(cb);
    },
    removeEventListener(type, cb) {
      const listeners = documentListeners.get(type);
      if (!listeners) return;
      const index = listeners.indexOf(cb);
      if (index !== -1) listeners.splice(index, 1);
    },
  };

  const updateCalls = [];
  const settingsAPI = {
    update: (key, value) => {
      updateCalls.push({ key, value });
      return update(key, value);
    },
  };
  const context = {
    console,
    navigator: { platform: "Win32" },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    document,
    requestAnimationFrame: (cb) => raf.requestAnimationFrame(cb),
    setTimeout: () => 1,
    window: null,
    globalThis: null,
    settingsAPI,
    ClawdSettingsSizeSlider: {
      SIZE_UI_MIN: 1,
      SIZE_UI_MAX: 100,
      SIZE_TICK_VALUES: [25, 50, 75, 100],
      SIZE_SLIDER_THUMB_DIAMETER: 18,
      prefsSizeToUi: (value) => value,
      clampSizeUi: (value) => value,
      sizeUiToPct: (value) => value,
      getSizeSliderAnchorPx: () => 0,
      createSizeSliderController: () => ({}),
    },
    ClawdSettingsI18n: {
      STRINGS: {
        en: {
          rowLanguage: "Language",
          rowLanguageDesc: "Language desc",
          langEnglish: "English",
          langChinese: "Chinese",
          langKorean: "Korean",
          langJapanese: "Japanese",
          toastSaveFailed: "Failed: ",
        },
        zh: {
          rowLanguage: "Language",
          rowLanguageDesc: "Language desc",
          langEnglish: "English",
          langChinese: "Chinese",
          langKorean: "Korean",
          langJapanese: "Japanese",
          toastSaveFailed: "Failed: ",
        },
      },
      CONTRIBUTORS: [],
      MAINTAINERS: [],
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(LANGUAGE_PICKER_JS, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_ANIM_OVERRIDES_MERGE, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_UI_CORE, "utf8"), context);
  const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8")
    .replace(
      "root.ClawdSettingsTabGeneral = { init };",
      "root.ClawdSettingsTabGeneral = { init, __test: { buildLanguageRow } };"
    );
  vm.runInContext(generalSource, context);

  const core = context.ClawdSettingsCore;
  core.state.snapshot = snapshot || { lang: "en" };
  core.state.activeTab = "general";
  context.ClawdSettingsTabGeneral.init(core);

  let contentRenderCount = 0;
  function renderLanguageOnly() {
    contentRenderCount++;
    core.ops.clearMountedControls();
    content.innerHTML = "";
    content.appendChild(context.ClawdSettingsTabGeneral.__test.buildLanguageRow());
  }
  core.ops.installRenderHooks({ content: renderLanguageOnly });

  return {
    core,
    content,
    raf,
    settingsAPI,
    updateCalls,
    getContentRenderCount: () => contentRenderCount,
    getLangPicker: () => content.querySelector(".language-picker"),
    getLangTrigger: () => content.querySelector(".language-picker-trigger"),
    getLangMenu: () => content.querySelector(".language-picker-menu"),
    getLangValue: () => content.querySelector(".language-picker-value"),
    getLangOptions: () => content.querySelectorAll(".language-picker-option"),
    getDocumentListenerCount: (type) => {
      const listeners = documentListeners.get(type);
      return listeners ? listeners.length : 0;
    },
    dispatchDocumentEvent: (type, event = {}) => {
      const listeners = documentListeners.get(type) || [];
      const payload = { ...event, type };
      for (const listener of [...listeners]) listener(payload);
    },
    getToastText: () => {
      const toast = toastStack.querySelector(".toast");
      return toast ? toast.textContent : "";
    },
  };
}

function createKeyboardEventForTest(key) {
  return {
    type: "keydown",
    key,
    bubbles: true,
    cancelBubble: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
  };
}

function findAncestorByClass(el, className) {
  let current = el;
  while (current) {
    if (current.classList && current.classList.contains(className)) return current;
    current = current.parentNode;
  }
  return null;
}

function choosePickerOption(picker, value) {
  picker.querySelector(".language-picker-trigger").dispatchEvent({ type: "click" });
  const option = picker.querySelectorAll(".language-picker-option")
    .find((candidate) => candidate.dataset.lang === String(value));
  assert.ok(option, `picker option ${value} should exist`);
  option.dispatchEvent({ type: "click" });
}

function getSelectedPickerValue(picker) {
  const selected = picker.querySelectorAll(".language-picker-option")
    .find((option) => option.classList.contains("selected"));
  return selected ? selected.dataset.lang : null;
}

function loadThemeTabForTest({
  themes,
  officialThemes,
  officialCatalogStatus,
  snapshot,
  petTintOptions,
  petAccessoryOptions,
  petMouthAccessoryOptions,
  settingsAPI = {},
} = {}) {
  const documentListeners = new Map();
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  content.id = "content";
  body.appendChild(content);

  const commands = [];
  const updates = [];
  let themeListState = Array.isArray(themes) ? themes : [];
  const document = {
    body,
    activeElement: body,
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.focus = (options) => {
        element.focused = true;
        element.focusOptions = options;
        document.activeElement = element;
      };
      return element;
    },
    getElementById(id) {
      if (id === "content") return content;
      return null;
    },
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      const listeners = documentListeners.get(type);
      if (listeners) listeners.delete(handler);
    },
  };

  const api = {
    command: (name, payload) => {
      commands.push({ name, payload });
      if (name === "setThemeSelection" && payload && typeof payload.themeId === "string") {
        const target = themeListState.find((theme) => theme && theme.id === payload.themeId);
        themeListState = themeListState.map((theme) => ({
          ...theme,
          active: theme.id === payload.themeId,
        }));
        return Promise.resolve({
          status: "ok",
          customizationCapabilities: target
            ? {
                petTint: target.capabilities && target.capabilities.petTint === true,
                accessories: target.capabilities && target.capabilities.accessories === true,
                mouthAccessories: target.capabilities && target.capabilities.mouthAccessories === true,
              }
            : null,
        });
      }
      return Promise.resolve({ status: "ok" });
    },
    listThemes: () => Promise.resolve(themeListState),
    update: (key, value) => {
      updates.push({ key, value });
      return Promise.resolve({ status: "ok" });
    },
    ...settingsAPI,
  };
  const context = {
    console,
    navigator: { platform: "Win32" },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    document,
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    window: null,
    globalThis: null,
    settingsAPI: api,
    ClawdSettingsSizeSlider: {
      SIZE_UI_MIN: 1,
      SIZE_UI_MAX: 100,
      SIZE_TICK_VALUES: [25, 50, 75, 100],
      SIZE_SLIDER_THUMB_DIAMETER: 18,
      prefsSizeToUi: (value) => value,
      clampSizeUi: (value) => value,
      sizeUiToPct: (value) => value,
      getSizeSliderAnchorPx: () => 0,
      createSizeSliderController: () => ({}),
    },
    ClawdSettingsI18n: {
      STRINGS: loadSettingsI18nForTest(),
      CONTRIBUTORS: [],
      MAINTAINERS: [],
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(LANGUAGE_PICKER_JS, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_ANIM_OVERRIDES_MERGE, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_UI_CORE, "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-theme.js"), "utf8"), context);

  const core = context.ClawdSettingsCore;
  core.state.snapshot = {
    lang: "en",
    petTint: {},
    petAccessory: {},
    petMouthAccessory: {},
    holidayAccessoryEnabled: {},
    ...(snapshot || {}),
  };
  core.state.activeTab = "theme";
  core.runtime.themeList = themeListState;
  core.runtime.officialThemeList = Array.isArray(officialThemes) ? officialThemes : null;
  core.runtime.officialThemeListFetched = Array.isArray(officialThemes);
  core.runtime.officialThemeCatalogStatus = officialCatalogStatus || "ok";
  core.runtime.petTintOptions = Array.isArray(petTintOptions) ? petTintOptions : [];
  core.runtime.petAccessoryOptions = Array.isArray(petAccessoryOptions)
    ? petAccessoryOptions
    : [];
  core.runtime.petMouthAccessoryOptions = Array.isArray(petMouthAccessoryOptions)
    ? petMouthAccessoryOptions
    : [];
  context.ClawdSettingsTabTheme.init(core);
  const renderContent = () => {
    content.innerHTML = "";
    core.tabs.theme.render(content, core);
  };
  core.ops.installRenderHooks({ content: renderContent });
  renderContent();

  return { content, commands, updates, core, renderContent };
}

function loadAnimMapTabForTest({
  snapshot,
  settingsAPI = {},
} = {}) {
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  body.appendChild(content);

  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      if (id === "content") return content;
      return null;
    },
  };

  const context = {
    console,
    navigator: { platform: "Win32" },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    document,
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    window: null,
    globalThis: null,
    settingsAPI: {
      command: () => Promise.resolve({ status: "ok" }),
      ...settingsAPI,
    },
    ClawdSettingsSizeSlider: {
      SIZE_UI_MIN: 1,
      SIZE_UI_MAX: 100,
      SIZE_TICK_VALUES: [25, 50, 75, 100],
      SIZE_SLIDER_THUMB_DIAMETER: 18,
      prefsSizeToUi: (value) => value,
      clampSizeUi: (value) => value,
      sizeUiToPct: (value) => value,
      getSizeSliderAnchorPx: () => 0,
      createSizeSliderController: () => ({}),
    },
    ClawdSettingsI18n: {
      STRINGS: { en: {} },
      CONTRIBUTORS: [],
      MAINTAINERS: [],
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SETTINGS_ANIM_OVERRIDES_MERGE, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_UI_CORE, "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-map.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8"), context);

  const core = context.ClawdSettingsCore;
  core.state.snapshot = snapshot || { theme: "clawd", themeOverrides: {} };
  // The Animation Map now lives as the default "on / off" subtab of the
  // Animation & Sound Overrides tab, so patching flows through that tab.
  core.state.activeTab = "animOverrides";
  context.ClawdSettingsTabAnimMap.init(core);
  context.ClawdSettingsTabAnimOverrides.init(core);

  let contentRenderCount = 0;
  core.ops.installRenderHooks({
    content: () => {
      contentRenderCount++;
    },
  });

  return {
    core,
    content,
    getContentRenderCount: () => contentRenderCount,
  };
}

function loadDiscordPresenceTabForTest({ snapshot, update } = {}) {
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  body.appendChild(content);
  const updates = [];
  const renderRequests = [];
  const toasts = [];
  const settingsAPI = {
    discordDefaultAppIdPresent: true,
    update: (key, value) => {
      updates.push({ key, value });
      return update ? update(key, value) : Promise.resolve({ status: "ok" });
    },
  };
  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: () => null,
  };
  const context = {
    console,
    document,
    window: null,
    globalThis: null,
    settingsAPI,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SETTINGS_TAB_DISCORD_PRESENCE, "utf8"), context);
  const buttonHelpers = loadSharedButtonHelpersForTest(document, settingsAPI, () => core.helpers.t);

  const core = {
    state: {
      snapshot: snapshot || {
        discordPresence: {
          enabled: true,
          applicationId: "123456789012345678",
          privacyShowProject: true,
          mirrorPetAnimation: false,
        },
      },
      activeTab: "discord-presence",
    },
    helpers: {
      ...loadSharedChoiceHelpersForTest(document),
      t: (key) => key,
      buildSettingRow: (config) => buildFakeSettingRow(document, config),
      buildTextInput: (config) => buildFakeTextInput(document, config),
      setTextInputState: setFakeTextInputState,
      buildButton: buttonHelpers.buildButton,
      setButtonState: buttonHelpers.setButtonState,
      buildSwitch: buttonHelpers.buildSwitch,
      buildSection: (_title, rows) => {
        const section = document.createElement("section");
        for (const row of rows) section.appendChild(row);
        return section;
      },
      buildCollapsibleGroup: ({ children = [] } = {}) => {
        const group = document.createElement("div");
        for (const child of children) group.appendChild(child);
        return group;
      },
      openExternalSafe: () => {},
    },
    ops: {
      requestRender: (payload) => renderRequests.push(payload || {}),
      showToast: (...args) => toasts.push(args),
    },
    tabs: {},
  };
  context.ClawdSettingsTabDiscordPresence.init(core);
  function render() {
    content.innerHTML = "";
    core.tabs["discord-presence"].render(content, core);
  }
  render();
  return { content, core, updates, renderRequests, toasts, render };
}

function loadAnimOverridesTabForTest({
  runtime,
  modalRoot,
  settingsAPI = {},
  opsOverrides = {},
  readersOverrides = {},
  helpersOverrides = {},
}) {
  const disposableHarness = createMountedDisposableHarness();
  const documentListeners = new Map();
  const content = new FakeElement("main");
  content.id = "content";
  const document = {
    body: new FakeElement("body"),
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => (id === "modalRoot" ? modalRoot : id === "content" ? content : null),
    querySelector: () => null,
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      const listeners = documentListeners.get(type);
      if (listeners) listeners.delete(handler);
    },
  };
  document.body.appendChild(content);
  const context = {
    console,
    document,
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    setInterval: () => 1,
    clearInterval: () => {},
    URL,
    window: {
      settingsAPI: {
        openThemeAssetsDir: () => Promise.resolve({ status: "ok" }),
        command: () => Promise.resolve({ status: "ok" }),
        exportAnimationOverrides: () => Promise.resolve({ status: "empty" }),
        importAnimationOverrides: () => Promise.resolve({ status: "cancel" }),
        previewAnimationOverride: () => Promise.resolve({ status: "ok" }),
        previewReaction: () => Promise.resolve({ status: "ok" }),
        ...settingsAPI,
      },
    },
    globalThis: null,
    ClawdSettingsAnimOverridesMerge: require(SETTINGS_ANIM_OVERRIDES_MERGE),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "language-picker.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8"), context);
  const core = {
    state: { activeTab: "animOverrides", mountedControls: {} },
    runtime,
    helpers: {
      ...loadSharedChoiceHelpersForTest(document),
      t: (key) => key,
      buildTextInput: (config) => buildFakeTextInput(document, config),
      setTextInputState: setFakeTextInputState,
      createDisclosureChevron: (className) => {
        const chevron = document.createElement("span");
        chevron.className = className;
        chevron.setAttribute("aria-hidden", "true");
        return chevron;
      },
      attachSettingsDisclosure: attachDisclosureForHarness,
      registerMountedDisposable: disposableHarness.register,
      disposeMountedDisposable: disposableHarness.dispose,
      attachActivation: (el, invoke) => {
        if (typeof invoke === "function") el.addEventListener("click", () => invoke());
        return el;
      },
      buildSettingsSelect: (config) => context.ClawdLanguagePicker.createSettingsSelect(config),
      ...helpersOverrides,
    },
    ops: {
      selectTab: () => {},
      requestRender: ({ modal = false } = {}) => {
        if (modal && typeof core.renderHooks.modal === "function") core.renderHooks.modal();
      },
      fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      stopAssetPickerPolling: () => {},
      closeAssetPicker: () => {},
      normalizeAssetPickerSelection: () => {},
      showToast: () => {},
      clearMountedControls: () => disposableHarness.disposeScope(),
      ...opsOverrides,
    },
    i18n: {
      STRINGS: { en: {} },
    },
    readers: {
      hasAnyThemeOverride: () => false,
      readThemeOverrideMap: () => null,
      getLang: () => "en",
      ...readersOverrides,
    },
    renderHooks: {},
    tabs: {},
  };
  context.ClawdSettingsTabAnimOverrides.init(core);
  return {
    core,
    content,
    document,
    documentListenerCount: (type) => (documentListeners.get(type) || new Set()).size,
    disposableHarness,
  };
}

function createIdleVisualRuntime(selectedFile = null) {
  const card = createAnimOverrideCard({ id: "state:idle", stateKey: "idle", triggerKind: "idle" });
  return createAnimOverridesRuntime(card, {
    animationOverridesData: {
      theme: { id: "clawd", name: "Clawd" },
      assets: [],
      sections: [{ id: "idle", cards: [card] }],
      cards: [card],
      sounds: [],
      idleDefaultVisual: {
        themeId: "clawd",
        selectedFile,
        options: [
          { file: "clawd-idle-follow.svg", isThemeDefault: true, label: "Idle Follow" },
          { file: "clawd-idle-reading.svg", isThemeDefault: false, label: "Idle Reading" },
        ],
      },
    },
  });
}

function createAnimOverrideCard(overrides = {}) {
  return {
    id: "state:thinking",
    slotType: "state",
    stateKey: "thinking",
    triggerKind: "thinking",
    currentFile: "cloudling-thinking.svg",
    currentFileUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
    currentFilePreviewUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
    bindingLabel: "states.thinking[0]",
    transition: { in: 120, out: 180 },
    supportsAutoReturn: false,
    supportsDuration: false,
    assetCycleMs: 1000,
    assetCycleStatus: "ok",
    suggestedDurationMs: null,
    suggestedDurationStatus: "unavailable",
    previewDurationMs: 1000,
    displayHintWarning: false,
    displayHintTarget: null,
    fallbackTargetState: null,
    wideHitboxEnabled: false,
    wideHitboxOverridden: false,
    wideHitboxThemeDefault: false,
    aspectRatioWarning: null,
    ...overrides,
  };
}

function createAnimOverridesRuntime(card, overrides = {}) {
  return {
    animationOverridesData: {
      theme: { id: "cloudling", name: "Cloudling" },
      assets: [],
      sections: [{ id: "work", cards: [card] }],
      cards: [card],
      sounds: [],
    },
    animOverridesSubtab: "animations",
    expandedOverrideRowIds: new Set([card.id]),
    assetPicker: {
      state: null,
      pollTimer: null,
    },
    ...overrides,
  };
}

describe("settings renderer browser environment", () => {
  it("keeps recap chrome and chart mounted while a period query is pending", async () => {
    let finish;
    const harness = loadRecapTabForTest({
      queryRecap: (period) => period === "today" ? Promise.resolve(sampleRecapView())
        : new Promise((resolve) => { finish = resolve; }),
    });
    await harness.settle();
    const header = harness.content.querySelector(".recap-page-header");
    const chart = harness.content.querySelector(".recap-card");
    const renders = harness.renderRequests.length;
    header.querySelectorAll(".recap-period-button")[1].click();
    await harness.settle();
    assert.strictEqual(harness.content.querySelector(".recap-page-header"), header,
      "switching a period must not rebuild the page header");
    assert.strictEqual(harness.content.querySelector(".recap-card"), chart,
      "retain the chart geometry until replacement data is ready");
    assert.strictEqual(harness.renderRequests.length, renders);
    finish(sampleRecapView());
    await harness.settle();
    assert.strictEqual(harness.content.querySelector(".recap-page-header"), header);
    assert.notStrictEqual(harness.content.querySelector(".recap-card"), chart);
    assert.strictEqual(harness.content.querySelector(".recap-grid").getAttribute("data-settings-focus-key"), "recap-grid-week");
  });

  it("defers recap recovery queries while the Settings document is hidden", async () => {
    let queryCount = 0;
    const harness = loadRecapTabForTest({
      queryRecap: async () => {
        queryCount += 1;
        return queryCount === 1
          ? { status: "unavailable", reason: "RECAP_PRIVATE_ACL_FAILED" }
          : sampleRecapView();
      },
    });
    await harness.settle();
    assert.strictEqual(queryCount, 1);

    harness.document.visibilityState = "hidden";
    harness.core.tabs.recap.applyDataChanged();
    await harness.settle();
    assert.strictEqual(queryCount, 1);

    harness.document.visibilityState = "visible";
    harness.core.tabs.recap.applyDataChanged();
    await harness.settle();
    assert.strictEqual(queryCount, 2);
  });

  it("keeps only the newest recap period result after rapid switches", async () => {
    const requests = new Map();
    const harness = loadRecapTabForTest({ queryRecap: (period) => {
      if (period === "today") return Promise.resolve(sampleRecapView());
      const deferred = createDeferred();
      requests.set(period, deferred);
      return deferred.promise;
    } });
    await harness.settle();
    const choices = harness.content.querySelectorAll(".recap-period-button");
    choices[1].click();
    choices[2].click();
    choices[3].click();
    await harness.settle();
    assert.deepStrictEqual([...requests.keys()], ["week", "month", "year"]);
    assert.equal(harness.content.querySelector(".recap-data-body").inert, true);
    requests.get("year").resolve(sampleRecapView());
    await harness.settle();
    const chart = harness.content.querySelector(".recap-card");
    requests.get("month").reject(new Error("late failure"));
    requests.get("week").resolve(sampleRecapView());
    await harness.settle();
    assert.strictEqual(harness.content.querySelector(".recap-card"), chart);
    assert.equal(harness.content.querySelector(".recap-grid").getAttribute("data-settings-focus-key"), "recap-grid-year");
    assert.equal(harness.content.querySelector(".recap-data-body").inert, false);
    assert.equal(harness.content.querySelector(".recap-data-body").getAttribute("aria-busy"), "false");
    assert.equal(choices[3].getAttribute("aria-checked"), "true");
  });

  it("starts each recap keyboard grid at the current date and shares empty-cell popovers", async () => {
    for (const [index, period] of ["today", "week", "month", "year"].entries()) {
      const harness = loadRecapTabForTest({ data: sampleRecapView() });
      await harness.settle();
      if (index) {
        harness.content.querySelectorAll(".recap-period-button")[index].click();
        await harness.settle();
      }
      const grid = harness.content.querySelector(".recap-grid");
      const cells = grid.querySelectorAll(".recap-cell");
      const current = cells.find((cell) => cell.id === grid.getAttribute("aria-activedescendant"));
      assert.match(current.dataset.cellKey, /2026-08-29/, period);
      assert.ok(cells.every((cell) => !cell.title), "native tooltips must not compete with the shared popover");
      const empty = cells.find((cell) => cell.getAttribute("role") === "gridcell"
        && !cell.classList.contains("recap-cell-activity"));
      empty.dispatchEvent({ type: "mouseenter" });
      await new Promise((resolve) => setTimeout(resolve, 110));
      const popover = harness.content.querySelector(".recap-cell-popover");
      assert.ok(popover, `${period} empty cells use the rounded popover`);
      assert.equal(`${popover.querySelector("strong").textContent}: ${popover.querySelector(".recap-cell-popover-note").textContent}`,
        empty.getAttribute("aria-label"), "date and status occupy separate lines without losing meaning");
      if (period === "month") {
        const today = grid.querySelectorAll(".recap-cell-current");
        assert.equal(today.length, 1);
        assert.match(today[0].dataset.cellKey, /2026-08-29/);
        assert.equal(today[0].getAttribute("aria-current"), "date");
      }
      if (period === "week") {
        assert.deepEqual(grid.querySelector(".recap-week-hours").children.map((node) => node.textContent).filter(Boolean),
          ["00", "06", "12", "18"]);
      }
      empty.dispatchEvent({ type: "mouseleave" });
      assert.equal(harness.content.querySelector(".recap-cell-popover"), null);
      grid.dispatchEvent({ type: "keydown", key: "ArrowLeft", preventDefault() {} });
      await new Promise((resolve) => setTimeout(resolve, 110));
      assert.ok(harness.content.querySelector(".recap-cell-popover"), "keyboard uses the same popover");
      grid.dispatchEvent({ type: "blur" });
      assert.equal(harness.content.querySelector(".recap-cell-popover"), null);
      harness.core.tabs.recap.onExit();
    }
  });

  it("shows a local recap query failure and retries without replacing period controls", async () => {
    let fail = true;
    const harness = loadRecapTabForTest({ queryRecap: async (period) => {
      if (period === "week" && fail) throw new Error("query failed");
      return sampleRecapView();
    } });
    await harness.settle();
    const header = harness.content.querySelector(".recap-page-header");
    header.querySelectorAll(".recap-period-button")[1].click();
    await harness.settle();
    assert.ok(harness.content.querySelector(".recap-error"));
    assert.equal(harness.content.querySelector(".recap-data-body").inert, false);
    fail = false;
    harness.content.querySelector(".recap-error button").click();
    await harness.settle();
    assert.strictEqual(harness.content.querySelector(".recap-page-header"), header);
    assert.ok(harness.content.querySelector(".recap-card"));
  });

  it("ignores a recap query that completes after leaving the page", async () => {
    const pending = createDeferred();
    const harness = loadRecapTabForTest({ queryRecap: (period) => period === "today"
      ? Promise.resolve(sampleRecapView()) : pending.promise });
    await harness.settle();
    harness.content.querySelectorAll(".recap-period-button")[1].click();
    await harness.settle();
    const chart = harness.content.querySelector(".recap-card");
    harness.core.tabs.recap.onExit();
    harness.core.state.activeTab = "general";
    pending.resolve(sampleRecapView());
    await harness.settle();
    assert.strictEqual(harness.content.querySelector(".recap-card"), chart);
    assert.equal(harness.renderRequests.length, 0);
    harness.core.state.activeTab = "recap";
    harness.content.innerHTML = "";
    harness.core.tabs.recap.render(harness.content);
    await harness.settle();
    assert.equal(harness.content.querySelector(".recap-grid").getAttribute("data-settings-focus-key"), "recap-grid-week");
  });

  it("re-queues a background recap refresh that was dropped by leaving the page", async () => {
    const queries = [];
    const harness = loadRecapTabForTest({ queryRecap: (period) => {
      const deferred = createDeferred();
      queries.push(deferred);
      if (queries.length === 1) deferred.resolve(sampleRecapView());
      return deferred.promise;
    } });
    await harness.settle();
    assert.equal(queries.length, 1);
    harness.core.tabs.recap.applyDataChanged();
    await harness.settle();
    assert.equal(queries.length, 2);
    harness.core.tabs.recap.onExit();
    harness.core.state.activeTab = "general";
    queries[1].resolve(sampleRecapView());
    await harness.settle();
    assert.equal(queries.length, 2);
    harness.core.state.activeTab = "recap";
    harness.content.innerHTML = "";
    harness.core.tabs.recap.render(harness.content);
    await harness.settle();
    assert.equal(queries.length, 3);
  });

  it("re-queries an unavailable recap page after the runtime recovery signal", async () => {
    let queryCount = 0;
    const ready = sampleRecapView();
    const harness = loadRecapTabForTest({
      queryRecap: async () => {
        queryCount += 1;
        return queryCount === 1
          ? { status: "unavailable", reason: "RECAP_PRIVATE_ACL_FAILED" }
          : ready;
      },
    });
    await harness.settle();
    assert.strictEqual(queryCount, 1);
    assert.ok(harness.content.querySelector(".recap-error"));
    const retry = harness.content.querySelector(".recap-error button");
    assert.strictEqual(retry.getAttribute("data-settings-focus-key"), "recap-retry-today");
    assert.strictEqual(
      retry.getAttribute("data-settings-focus-fallback-key"),
      "recap-period-today",
    );

    harness.core.tabs.recap.applyDataChanged();
    await harness.settle();
    assert.strictEqual(queryCount, 2);
    assert.ok(harness.content.querySelector(".recap-card"));
    assert.strictEqual(harness.content.querySelector(".recap-error"), null);
  });

  it("preserves a recovery signal queued while the initial recap query is failing", async () => {
    let queryCount = 0;
    let rejectInitial;
    const harness = loadRecapTabForTest({
      queryRecap: () => {
        queryCount += 1;
        if (queryCount === 1) {
          return new Promise((_resolve, reject) => { rejectInitial = reject; });
        }
        return Promise.resolve(sampleRecapView());
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(typeof rejectInitial, "function");
    harness.core.tabs.recap.applyDataChanged();
    rejectInitial(new Error("transient query failure"));
    await harness.settle();
    assert.strictEqual(queryCount, 2);
    assert.ok(harness.content.querySelector(".recap-card"));
  });

  it("drains a final live signal queued during a recap background query", async () => {
    const background = createDeferred();
    const initial = sampleRecapView();
    const latest = JSON.parse(JSON.stringify(initial));
    latest.days[0].rows[0].metrics.toolCalls = 5;
    let queryCount = 0;
    const harness = loadRecapTabForTest({
      queryRecap: () => {
        queryCount += 1;
        if (queryCount === 1) return Promise.resolve(initial);
        if (queryCount === 2) return background.promise;
        return Promise.resolve(latest);
      },
    });
    await harness.settle();
    assert.strictEqual(queryCount, 1);

    harness.core.tabs.recap.applyDataChanged();
    await harness.settle();
    assert.strictEqual(queryCount, 2);
    harness.core.tabs.recap.applyDataChanged();
    background.resolve(initial);
    await harness.settle();
    await harness.settle();

    assert.strictEqual(queryCount, 3);
    const codexRow = harness.content.querySelectorAll(".recap-agent-row")
      .find((row) => row.querySelector("strong").textContent === "codex");
    const codexMetrics = codexRow.querySelectorAll("dd");
    assert.strictEqual(codexMetrics[1].textContent, "5");
  });

  it("renders the recap grid as one keyboard stop with accessible agent locks", async () => {
    const harness = loadRecapTabForTest({
      data: sampleRecapView(),
      agentMetadata: [
        { id: "codex", name: "Codex" },
        { id: "claude-code", name: "Claude Code" },
      ],
    });
    await harness.settle();

    const grid = harness.content.querySelector(".recap-grid");
    const cells = harness.content.querySelectorAll(".recap-cell");
    const rows = harness.content.querySelectorAll(".recap-agent-row");
    assert.strictEqual(cells.length, 24);
    assert.strictEqual(harness.content.querySelectorAll(".recap-bar-slot").length, 24);
    assert.strictEqual(harness.content.querySelectorAll(".recap-bar-fill").length, 24);
    assert.strictEqual(harness.content.querySelector(".recap-footnote"), null);
    assert.ok(collectText(harness.content).includes("Footprints"));
    assert.ok(collectText(harness.content).includes("Look back on your work trail."));
    assert.strictEqual(grid.getAttribute("role"), "grid");
    assert.strictEqual(grid.getAttribute("data-settings-focus-key"), "recap-grid-today");
    assert.strictEqual(grid.querySelectorAll(".recap-today-band").length, 1);
    assert.strictEqual(grid.querySelector(".recap-today-band").getAttribute("role"), "row");
    assert.strictEqual(grid.querySelector(".recap-hour-labels").getAttribute("aria-hidden"), "true");
    assert.strictEqual(grid.tabIndex, 0);
    assert.ok(cells.every((cell) => cell.tabIndex === undefined));
    assert.strictEqual(rows.length, 2);
    assert.ok(rows.every((row) => row.getAttribute("role") === "button" && row.tabIndex === 0));
    assert.ok(rows.every((row) => row.getAttribute("aria-pressed") === "false"));
    assert.ok(rows.every((row) => row.getAttribute("data-settings-focus-key")
      === `recap-agent-${row.dataset.rowKey}`));
    assert.deepStrictEqual(
      harness.content.querySelectorAll(".recap-period-button")
        .map((button) => button.getAttribute("data-settings-focus-key")),
      ["recap-period-today", "recap-period-week", "recap-period-month", "recap-period-year"]
    );
    assert.strictEqual(
      harness.content.querySelector(".switch").getAttribute("data-settings-focus-key"),
      "recap-recording-toggle"
    );
    const clearButton = harness.content.querySelector(".soft-btn");
    assert.strictEqual(clearButton.getAttribute("data-settings-focus-key"), "recap-clear");
    assert.strictEqual(
      clearButton.getAttribute("data-settings-focus-fallback-key"),
      "recap-recording-toggle"
    );
    assert.match(rows[0].getAttribute("aria-label"), /Turns completed: .*Tool calls: .*Activity signals:/);
    assert.doesNotMatch(rows[0].getAttribute("aria-label"), /Sessions started/);

    const firstActiveDescendant = grid.getAttribute("aria-activedescendant");
    grid.dispatchEvent({ type: "keydown", key: "ArrowRight", bubbles: false });
    assert.notStrictEqual(grid.getAttribute("aria-activedescendant"), firstActiveDescendant);
    assert.ok(collectText(harness.content.querySelector(".recap-sr-only")).length > 0);

    grid.dispatchEvent({ type: "keydown", key: "End", bubbles: false });
    const rowEnd = grid.getAttribute("aria-activedescendant");
    assert.strictEqual(rowEnd, cells.filter((cell) => cell.getAttribute("role") === "gridcell").at(-1).id);
    grid.dispatchEvent({ type: "keydown", key: "Home", ctrlKey: true, bubbles: false });
    assert.strictEqual(grid.getAttribute("aria-activedescendant"), cells[0].id);

    harness.content.querySelectorAll(".recap-period-button")[1].click();
    await harness.settle();
    const weekGrid = harness.content.querySelector(".recap-grid");
    assert.strictEqual(weekGrid.querySelector(".recap-bar-fill"), null);
    weekGrid.dispatchEvent({ type: "keydown", key: "ArrowDown", bubbles: false });
    weekGrid.dispatchEvent({ type: "keydown", key: "End", bubbles: false });
    let active = weekGrid.querySelectorAll(".recap-cell")
      .find((cell) => cell.id === weekGrid.getAttribute("aria-activedescendant"));
    assert.strictEqual(active.getAttribute("aria-rowindex"), "2");
    assert.strictEqual(active.getAttribute("aria-colindex"), "24");
    weekGrid.dispatchEvent({ type: "keydown", key: "End", ctrlKey: true, bubbles: false });
    active = weekGrid.querySelectorAll(".recap-cell")
      .find((cell) => cell.id === weekGrid.getAttribute("aria-activedescendant"));
    assert.strictEqual(active.getAttribute("aria-rowindex"), "7");
  });

  it("issue #1142: agent rows show turns, tool calls and activity signals without a sessions column", async () => {
    const data = sampleRecapView();
    data.days[0].rows[1].sessionsStartedPartial = true;
    const harness = loadRecapTabForTest({
      data,
      agentMetadata: [
        { id: "codex", name: "Codex" },
        { id: "claude-code", name: "Claude Code" },
      ],
    });
    await harness.settle();

    const rowByName = new Map(
      harness.content.querySelectorAll(".recap-agent-row")
        .map((row) => [row.querySelector("strong").textContent, row])
    );
    const expectations = [
      ["Codex", ["2", "4", "9"]],
      ["Claude Code", ["1", "2", "3"]],
    ];
    for (const [name, values] of expectations) {
      const row = rowByName.get(name);
      assert.ok(row, name);
      assert.deepStrictEqual(
        row.querySelectorAll("dt").map((dt) => dt.textContent),
        ["Turns completed", "Tool calls", "Activity signals"]
      );
      assert.deepStrictEqual(row.querySelectorAll("dd").map((dd) => dd.textContent), values);
      const rowText = collectText(row);
      assert.doesNotMatch(rowText, /Sessions started/);
      assert.doesNotMatch(rowText, /partial/);
    }
  });

  it("issue #1142: a metric without a reliable boundary still renders a dash with its explanation", async () => {
    const data = sampleRecapView();
    data.days[0].rows[0].metrics.turnsCompleted = null;
    const harness = loadRecapTabForTest({
      data,
      agentMetadata: [
        { id: "codex", name: "Codex" },
        { id: "claude-code", name: "Claude Code" },
      ],
    });
    await harness.settle();

    const codexRow = harness.content.querySelectorAll(".recap-agent-row")
      .find((row) => row.querySelector("strong").textContent === "Codex");
    const count = codexRow.querySelectorAll("dd")[0];
    assert.strictEqual(count.textContent, "—");
    assert.strictEqual(
      count.title,
      "This agent does not provide a reliable boundary for this metric."
    );
    assert.strictEqual(
      count.getAttribute("aria-label"),
      "Turns completed: This agent does not provide a reliable boundary for this metric."
    );
    assert.ok(codexRow.getAttribute("aria-label")
      .includes("Turns completed: This agent does not provide a reliable boundary for this metric."));
  });

  it("keeps every recap keyboard focus key stable across a live data refresh", async () => {
    const data = sampleRecapView();
    const harness = loadRecapTabForTest({
      queryRecap: async () => data,
      agentMetadata: [
        { id: "codex", name: "Codex" },
        { id: "claude-code", name: "Claude Code" },
      ],
    });
    await harness.settle();

    const focusKeys = () => [
      ...harness.content.querySelectorAll(".recap-period-button"),
      ...harness.content.querySelectorAll(".recap-agent-row"),
      harness.content.querySelector(".recap-grid"),
      harness.content.querySelector(".switch"),
      harness.content.querySelector(".soft-btn"),
    ].map((element) => element.getAttribute("data-settings-focus-key"));
    const before = focusKeys();
    assert.ok(before.every(Boolean));
    assert.strictEqual(new Set(before).size, before.length);

    harness.core.tabs.recap.applyDataChanged();
    await harness.settle();
    assert.deepStrictEqual(focusKeys(), before);
    assert.strictEqual(harness.renderRequests.length, 0, "live data updates only the body");
  });

  it("keeps month and year placeholder cells out of the accessibility grid", async () => {
    const monthHarness = loadRecapTabForTest({ data: sampleRecapView() });
    await monthHarness.settle();
    monthHarness.content.querySelectorAll(".recap-period-button")[2].click();
    await monthHarness.settle();
    const monthGrid = monthHarness.content.querySelector(".recap-grid");
    const monthBlanks = monthHarness.content.querySelectorAll(".recap-cell-blank");
    assert.strictEqual(monthGrid.querySelector(".recap-month-weekdays").getAttribute("aria-hidden"), "true");
    assert.strictEqual(monthGrid.querySelector(".recap-month-grid").getAttribute("role"), "rowgroup");
    assert.strictEqual(monthGrid.querySelectorAll(".recap-month-row").length, 6);
    assert.ok(monthGrid.querySelectorAll(".recap-month-row")
      .every((row) => row.getAttribute("role") === "row"));
    assert.strictEqual(monthBlanks.length, 5);
    assert.ok(monthBlanks.every((cell) =>
      cell.getAttribute("role") === "presentation"
      && cell.getAttribute("aria-hidden") === "true"
      && cell.getAttribute("aria-label") === undefined));
    assert.strictEqual(monthHarness.content.querySelectorAll(".recap-cell")
      .filter((cell) => cell.getAttribute("role") === "gridcell").length, 31);
    const monthActive = monthHarness.content.querySelectorAll(".recap-cell")
      .find((cell) => cell.id === monthGrid.getAttribute("aria-activedescendant"));
    assert.ok(monthActive);
    assert.notStrictEqual(monthActive.getAttribute("role"), "presentation");

    const yearHarness = loadRecapTabForTest({ data: sampleRecapView() });
    await yearHarness.settle();
    yearHarness.content.querySelectorAll(".recap-period-button")[3].click();
    await yearHarness.settle();
    const yearBlanks = yearHarness.content.querySelectorAll(".recap-cell-blank");
    assert.strictEqual(yearBlanks.length, 7);
    assert.ok(yearBlanks.every((cell) =>
      cell.getAttribute("role") === "presentation"
      && cell.getAttribute("aria-hidden") === "true"
      && cell.getAttribute("aria-label") === undefined));
    assert.strictEqual(yearHarness.content.querySelectorAll(".recap-cell")
      .filter((cell) => cell.getAttribute("role") === "gridcell").length, 365);
  });

  it("renders every Today bar on one linear scale and keeps longer periods as cells", async () => {
    const data = sampleRecapView();
    data.currentLocalHour = 23;
    const codex = data.days[0].rows[0];
    codex.hours[5] = 2;
    codex.hours[13] = 7;
    codex.hours[20] = 1;
    codex.metrics.activityEvents += 10;
    for (const hour of [5, 13, 20]) data.days[0].coverage.coverageMinutes[hour] = 60;
    const harness = loadRecapTabForTest({ data });
    await harness.settle();

    const todayCells = harness.content.querySelectorAll(".recap-cell");
    const ratios = todayCells.map((cell) => cell.style.getPropertyValue("--recap-bar-ratio"));
    assert.strictEqual(todayCells.length, 24);
    assert.strictEqual(todayCells[9].dataset.barMaximum, "12");
    assert.strictEqual(ratios[5], String(2 / 12));
    assert.strictEqual(ratios[9], "1");
    assert.strictEqual(ratios[13], String(7 / 12));
    assert.strictEqual(ratios[20], String(1 / 12));
    assert.strictEqual(ratios[0], "0");

    for (const periodIndex of [1, 2, 3]) {
      harness.content.querySelectorAll(".recap-period-button")[periodIndex].click();
      await harness.settle();
      assert.strictEqual(harness.content.querySelector(".recap-bar-fill"), null);
    }
  });

  it("supports hover plus click-lock highlighting and Escape unlock", async () => {
    const harness = loadRecapTabForTest({
      data: sampleRecapView(),
      agentMetadata: [
        { id: "codex", name: "Codex" },
        { id: "claude-code", name: "Claude Code" },
      ],
    });
    await harness.settle();
    const rows = harness.content.querySelectorAll(".recap-agent-row");
    const codexRow = rows.find((row) => collectText(row).includes("Codex"));
    const grid = harness.content.querySelector(".recap-grid");
    const activeCell = grid.querySelector(".recap-cell-activity");
    assert.strictEqual(activeCell.style.getPropertyValue("--recap-bar-ratio"), "1");

    codexRow.dispatchEvent({ type: "mouseenter", bubbles: false });
    assert.strictEqual(grid.classList.contains("recap-grid-dim"), true);
    assert.strictEqual(harness.content.querySelectorAll(".recap-cell-hit").length, 1);
    assert.strictEqual(activeCell.style.getPropertyValue("--recap-bar-ratio"), "0.75");
    codexRow.dispatchEvent({ type: "mouseleave", bubbles: false });
    assert.strictEqual(grid.classList.contains("recap-grid-dim"), false);
    assert.strictEqual(activeCell.style.getPropertyValue("--recap-bar-ratio"), "1");

    codexRow.dispatchEvent({ type: "click", bubbles: false });
    assert.strictEqual(codexRow.getAttribute("aria-pressed"), "true");
    assert.strictEqual(grid.classList.contains("recap-grid-dim"), true);
    codexRow.dispatchEvent({ type: "keydown", key: "Escape", bubbles: true });
    assert.strictEqual(codexRow.getAttribute("aria-pressed"), "false");
    assert.strictEqual(grid.classList.contains("recap-grid-dim"), false);
  });

  it("reveals proportional agent segments immediately and the sorted popover after 90ms", async () => {
    const data = sampleRecapView();
    const foldKinds = Array(24).fill("normal");
    foldKinds[9] = "fold";
    data.days[0].hourCapacities[9] = 120;
    data.days[0].coverage.hourCapacities[9] = 120;
    const harness = loadRecapTabForTest({
      data,
      agentMetadata: [
        { id: "codex", name: "Codex" },
        { id: "claude-code", name: "Claude Code" },
      ],
    });
    await harness.settle();
    const activeCell = harness.content.querySelector(".recap-cell-activity");
    const codexRow = harness.content.querySelectorAll(".recap-agent-row")
      .find((row) => collectText(row).includes("Codex"));
    codexRow.dispatchEvent({ type: "click", bubbles: false });
    assert.strictEqual(activeCell.style.getPropertyValue("--recap-bar-ratio"), "0.75");
    activeCell.dispatchEvent({ type: "mouseenter", bubbles: false });
    assert.strictEqual(harness.content.querySelector(".recap-grid").classList.contains("recap-grid-dim"), true);
    assert.strictEqual(activeCell.classList.contains("recap-cell-hit"), true);
    assert.strictEqual(activeCell.classList.contains("recap-cell-peek"), true);
    assert.strictEqual(activeCell.style.getPropertyValue("--recap-bar-ratio"), "1");
    const segments = activeCell.querySelectorAll(".recap-cell-segments i");
    assert.strictEqual(segments.length, 2);
    assert.strictEqual(segments[0].style.flex, "9 1 0%");
    await new Promise((resolve) => setTimeout(resolve, 110));
    const popover = harness.content.querySelector(".recap-cell-popover");
    assert.ok(popover);
    const text = collectText(popover);
    assert.ok(text.indexOf("Codex") < text.indexOf("Claude Code"));
    assert.ok(text.includes("This local hour occurred twice because the clock changed."));
    activeCell.dispatchEvent({ type: "mouseleave", bubbles: false });
    assert.strictEqual(harness.content.querySelector(".recap-cell-popover"), null);
    assert.strictEqual(activeCell.style.getPropertyValue("--recap-bar-ratio"), "0.75");
  });

  it("labels juggling tiers as subagents in every supported locale", () => {
    const expectedByLocale = {
      en: ["SubagentStart (1 subagent)", "SubagentStart (2+ subagents)"],
      zh: ["SubagentStart (1 个子代理)", "SubagentStart (2+ 个子代理)"],
      "zh-TW": ["SubagentStart (1 個子代理)", "SubagentStart (2+ 個子代理)"],
      ko: ["SubagentStart (하위 에이전트 1개)", "SubagentStart (하위 에이전트 2개 이상)"],
      ja: ["SubagentStart (サブエージェント 1)", "SubagentStart (サブエージェント 2+)"],
      "pt-BR": ["SubagentStart (1 subagente)", "SubagentStart (2+ subagentes)"],
    };

    for (const [lang, expected] of Object.entries(expectedByLocale)) {
      for (const [index, minSessions] of [1, 2].entries()) {
        const card = createAnimOverrideCard({
          id: `tier:juggling:${minSessions}`,
          stateKey: "juggling",
          triggerKind: "juggling",
          minSessions,
          maxSessions: minSessions === 1 ? 1 : null,
        });
        const runtime = createAnimOverridesRuntime(card);
        const { core } = loadAnimOverridesTabForTest({
          runtime,
          modalRoot: new FakeElement("div"),
          readersOverrides: { getLang: () => lang },
        });
        const parent = new FakeElement("main");
        core.tabs.animOverrides.render(parent, core);
        assert.strictEqual(parent.querySelector(".anim-override-trigger").textContent, expected[index]);
      }
    }
  });

  it("keeps working tiers labeled as sessions", () => {
    const card = createAnimOverrideCard({
      id: "tier:working:2",
      stateKey: "working",
      triggerKind: "working",
      minSessions: 2,
      maxSessions: null,
    });
    const runtime = createAnimOverridesRuntime(card);
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot: new FakeElement("div"),
      readersOverrides: { getLang: () => "en" },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);
    assert.strictEqual(parent.querySelector(".anim-override-trigger").textContent, "Agent activity / tool results (2+ sessions)");
  });

  it("renders and saves the Discord animation mirror without dropping sibling privacy fields", async () => {
    const harness = loadDiscordPresenceTabForTest();
    const switches = harness.content.querySelectorAll(".switch");
    assert.strictEqual(switches.length, 3, "enabled, animation mirror, and project switches should render");
    const mirror = switches[1];
    assert.strictEqual(mirror.getAttribute("role"), "switch");
    assert.strictEqual(mirror.getAttribute("aria-checked"), "false");

    mirror.dispatchEvent({ type: "keydown", key: "Enter", bubbles: false });
    assert.strictEqual(harness.updates.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(harness.updates[0])), {
      key: "discordPresence",
      value: {
        enabled: true,
        applicationId: "123456789012345678",
        privacyShowProject: true,
        mirrorPetAnimation: true,
      },
    });
    await Promise.resolve();
    assert.ok(harness.renderRequests.length >= 2, "pending and settled saves should both request a render");
  });

  it("disables the Discord animation mirror while Presence is off or a save is pending", async () => {
    const off = loadDiscordPresenceTabForTest({
      snapshot: {
        discordPresence: {
          enabled: false,
          applicationId: "",
          privacyShowProject: false,
          mirrorPetAnimation: true,
        },
      },
    });
    const offMirror = off.content.querySelectorAll(".switch")[1];
    assert.ok(offMirror.classList.contains("disabled"));
    assert.strictEqual(offMirror.getAttribute("aria-disabled"), "true");
    assert.strictEqual(offMirror.getAttribute("tabindex"), "-1");
    assert.strictEqual((offMirror.eventListeners.click || []).length, 1);

    const deferred = createDeferred();
    const pending = loadDiscordPresenceTabForTest({ update: () => deferred.promise });
    pending.content.querySelectorAll(".switch")[1].dispatchEvent({ type: "click", bubbles: false });
    pending.render();
    const pendingMirror = pending.content.querySelectorAll(".switch")[1];
    assert.ok(!pendingMirror.classList.contains("disabled"));
    assert.ok(pendingMirror.classList.contains("pending"));
    assert.strictEqual(pendingMirror.getAttribute("aria-disabled"), "false");
    assert.strictEqual(pendingMirror.getAttribute("aria-busy"), "true");
    assert.strictEqual(pendingMirror.getAttribute("tabindex"), "0");
    deferred.resolve({ status: "ok" });
    await Promise.resolve();
  });

  it("keeps sidebar page scroll positions isolated when a shorter page clamps scrollTop", () => {
    let rawScrollTop = 1480;
    let maxScrollTop = 2000;
    const raf = createQueuedRaf();
    const content = {
      get scrollTop() {
        return Math.min(rawScrollTop, maxScrollTop);
      },
      set scrollTop(value) {
        rawScrollTop = Math.max(0, Math.min(Number(value) || 0, maxScrollTop));
      },
    };
    const document = {
      body: { contains: () => false },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, {
      document,
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    core.state.activeTab = "remote-ssh";
    core.tabs["remote-ssh"] = {};
    core.tabs.theme = {};
    core.ops.installRenderHooks({
      sidebar: () => {},
      modal: () => {},
      content: () => {
        maxScrollTop = core.state.activeTab === "theme" ? 398 : 2000;
        content.scrollTop = content.scrollTop;
      },
    });

    core.ops.selectTab("theme");
    assert.equal(content.scrollTop, 0, "a sidebar page starts at the top on first entry");
    raf.flush();

    content.scrollTop = 240;
    core.ops.selectTab("remote-ssh");
    assert.equal(content.scrollTop, 1480, "the long source page restores its saved position");

    // Switch again before the remote page's deferred restore runs. Its stale
    // callback must not overwrite the newly active Theme page.
    core.ops.selectTab("theme");
    raf.flush();
    assert.equal(content.scrollTop, 240, "the short target page keeps its own position");
  });

  it("restores the last Settings page and its scroll position after reopening", () => {
    const storageData = {};
    const localStorage = {
      getItem: (key) => Object.prototype.hasOwnProperty.call(storageData, key)
        ? storageData[key]
        : null,
      setItem: (key, value) => {
        storageData[key] = String(value);
      },
    };
    const firstContent = { scrollTop: 0 };
    const first = loadSettingsCoreForTest({}, {
      document: {
        body: { contains: () => false },
        getElementById: (id) => (id === "content" ? firstContent : null),
      },
      localStorage,
    });
    first.tabs.general = {};
    first.tabs.theme = {};
    first.ops.installRenderHooks({ sidebar: () => {}, content: () => {}, modal: () => {} });
    firstContent.scrollTop = 180;
    first.ops.selectTab("theme");
    firstContent.scrollTop = 720;
    first.ops.persistNavigationState();

    const secondContent = { scrollTop: 0 };
    const second = loadSettingsCoreForTest({}, {
      document: {
        body: { contains: () => false },
        getElementById: (id) => (id === "content" ? secondContent : null),
      },
      localStorage,
    });
    second.tabs.general = {};
    second.tabs.theme = {};
    second.ops.installRenderHooks({ sidebar: () => {}, content: () => {}, modal: () => {} });

    assert.strictEqual(second.ops.restoreNavigationState(), true);
    assert.strictEqual(second.state.activeTab, "theme");
    second.ops.applyBootstrap({ language: "zh" });
    assert.strictEqual(secondContent.scrollTop, 720);
    assert.strictEqual(second.runtime.settingsTabScrollPositions.get("general"), 180);
  });

  it("does not let a one-shot recap deep-link replace the user's last ordinary Settings tab", () => {
    const storageData = {};
    const localStorage = {
      getItem: (key) => Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : null,
      setItem: (key, value) => { storageData[key] = String(value); },
    };
    const content = { scrollTop: 0 };
    const first = loadSettingsCoreForTest({}, {
      document: {
        body: { contains: () => false },
        getElementById: (id) => (id === "content" ? content : null),
      },
      localStorage,
    });
    first.tabs.general = {};
    first.tabs.theme = {};
    first.tabs.recap = {};
    first.ops.installRenderHooks({ sidebar: () => {}, content: () => {}, modal: () => {} });
    first.ops.selectTab("theme");
    first.ops.selectTab("recap", { persist: false });
    first.ops.persistNavigationState();

    const second = loadSettingsCoreForTest({}, {
      document: {
        body: { contains: () => false },
        getElementById: (id) => (id === "content" ? { scrollTop: 0 } : null),
      },
      localStorage,
    });
    second.tabs.general = {};
    second.tabs.theme = {};
    second.tabs.recap = {};
    assert.equal(second.ops.restoreNavigationState(), true);
    assert.equal(second.state.activeTab, "theme");
  });

  it("rolls a cancelled consent switch back without a failure toast", async () => {
    const body = new FakeElement("body");
    const core = loadSettingsCoreForTest({}, { document: {
      body, getElementById: () => null,
      createElement: () => { throw new Error("cancellation must not create a toast"); },
    } });
    const sw = new FakeElement("button");
    let transient = null;
    const control = core.helpers.buildSwitch({ element: sw, ariaLabel: "Collect Claude usage" });
    core.helpers.attachOptimisticSwitch(control, {
      getCommittedVisual: () => false,
      getTransientState: () => transient,
      setTransientState: (value) => { transient = value; },
      clearTransientState: () => { transient = null; },
      invoke: () => ({ status: "error", cancelled: true }),
    });
    sw.dispatchEvent({ type: "click" });
    assert.equal(sw.classList.contains("pending"), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sw.getAttribute("aria-checked"), "false");
    assert.equal(sw.classList.contains("pending"), false);
    assert.equal(transient, null);
  });

  it("keeps every Telegram retirement gate string in all supported languages", () => {
    const strings = loadSettingsI18nForTest();
    const keys = [
      "telegramNativeMigrationEyebrow",
      "telegramLegacyRetiredTitle",
      "telegramLegacyRetiredBody",
      "telegramNativeReverifyTitle",
      "telegramNativeReverifyBody",
      "telegramNativeMigrationVerify",
      "telegramNativeMigrationWaiting",
      "telegramNativeMigrationDisable",
      "telegramNativeMigrationGuide",
      "telegramNativeMigrationFailed",
      "telegramNativeMigrationTimeout",
      "telegramNativeMigrationStartFailed",
      "telegramMigrationNudgeTitle",
      "telegramMigrationNudgeLegacyBody",
      "telegramMigrationNudgeNativeBody",
    ];
    assert.deepStrictEqual(SUPPORTED_LANGS, ["en", "zh", "zh-TW", "ko", "ja", "pt-BR", "es"]);
    for (const lang of SUPPORTED_LANGS) {
      for (const key of keys) {
        assert.equal(
          typeof strings[lang][key],
          "string",
          `${lang}.${key} must exist`,
        );
        assert.notEqual(strings[lang][key].trim(), "", `${lang}.${key} must not be empty`);
      }
    }
  });

  it("keeps the shared disclosure, status line and detail-group primitives generic", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const row = buildFakeSettingRow(document, {
      label: "Label",
      description: "Description",
    });
    const extra = document.createElement("span");
    extra.className = "row-desc row-desc-extra";
    extra.textContent = "Extra";
    row.textElement.appendChild(extra);
    core.helpers.attachDescriptionDisclosure(row.element, { includeExtra: true });
    assert.equal(row.descriptionElement.classList.contains("row-desc-collapsed"), true);
    assert.equal(extra.classList.contains("row-desc-collapsed"), true);
    assert.equal(String(row.element.querySelector(".row-desc-toggle").getAttribute("aria-controls")).split(/\s+/).length, 2);

    assert.equal(core.helpers.buildDetailGroup("Empty", []), null);
    const group = core.helpers.buildDetailGroup("Group", [row.element]);
    assert.equal(group.querySelector(".settings-detail-group-label").textContent, "Group");

    const status = core.helpers.buildStatusLine({ tone: "warn", text: "Warn" });
    assert.equal(status.element.classList.contains("warn"), true);
    status.setStatus({ tone: "bad", text: "Bad" });
    assert.equal(status.element.classList.contains("warn"), false);
    assert.equal(status.element.classList.contains("bad"), true);
    assert.equal(status.element.querySelector(".settings-status-text").textContent, "Bad");
  });

  it("replaces the native disclosure title with the shared in-page hint", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const row = buildFakeSettingRow(document, {
      label: "Label",
      description: "Folded description",
    });
    core.helpers.attachDescriptionDisclosure(row.element);
    const toggle = row.element.querySelector(".row-desc-toggle");
    assert.ok(toggle);
    assert.equal(toggle.getAttribute("title"), undefined, "native OS tooltip must not be used");
    assert.equal(toggle.getAttribute("aria-describedby"), row.descriptionElement.id);
    const svg = toggle.querySelector("svg");
    assert.ok(svg, "the disclosure renders a vector SVG icon");
    assert.equal(svg.getAttribute("viewBox"), "0 0 14 14");

    toggle.dispatchEvent({ type: "mouseenter" });
    const tooltip = document.body.children.find((child) => child.classList.contains("settings-tooltip"));
    assert.ok(tooltip, "hovering the disclosure mounts the shared tooltip");
    assert.equal(tooltip.textContent, "Folded description");
    assert.equal(tooltip.classList.contains("visible"), true);
    assert.equal(tooltip.getAttribute("aria-hidden"), "false");

    toggle.dispatchEvent({ type: "click" });
    assert.equal(tooltip.classList.contains("visible"), false);
    assert.equal(row.descriptionElement.classList.contains("row-desc-collapsed"), false);
    // Once the text is inline there is nothing left to hint.
    toggle.dispatchEvent({ type: "mouseenter" });
    assert.equal(tooltip.classList.contains("visible"), false);
    assert.equal(document.body.children.includes(tooltip), true, "a single tooltip node is reused");
  });

  it("keeps three-action confirmation button labels unsplit on a single line", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const button = core.helpers.buildButton({ label: "重置令牌并启用（推荐）", size: "large" });
    const label = button.querySelector(".settings-button-label");
    assert.equal(label.textContent, "重置令牌并启用（推荐）");
    assert.equal(label.children.length, 0, "button labels stay a single unsplit text run");

    core.helpers.setButtonState(button, { label: "保留令牌并启用" });
    assert.equal(label.textContent, "保留令牌并启用");
    assert.equal(label.children.length, 0);

    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(css, /\.settings-confirm-actions:has\(>\s*:nth-child\(3\)\)\s*\{[\s\S]*?display:\s*flex;/);
    assert.match(css, /\.settings-confirm-actions:has\(>\s*:nth-child\(3\)\)\s+\.soft-btn\s*\{[\s\S]*?white-space:\s*nowrap;/);
  });

  it("keeps collapsible focus outlines aligned with the card's rounded corners", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(
      css,
      /\.collapsible-group-header\s*\{[^}]*border-radius:\s*inherit;/,
      "the full-card disclosure trigger must inherit the card radius so its inset focus outline is not clipped into white corners",
    );
    assert.match(
      css,
      /\.collapsible-group-disclosure\s*\{[^}]*border-radius:\s*inherit;/,
      "a disclosure beside a header action must inherit the header radius for the same reason",
    );
    assert.match(
      css,
      /\.collapsible-group:not\(\.collapsed\)\s*>\s*\.collapsible-group-header\s*\{[^}]*border-bottom-left-radius:\s*0;[^}]*border-bottom-right-radius:\s*0;/,
      "an expanded trigger must keep square bottom corners where its body continues",
    );
  });

  it("unifies the size slider on the simple volume-style control (no floating bubble, no ticks)", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const tabSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-pet.js"), "utf8");
    // Old floating-bubble/tick design must be fully gone.
    assert.ok(!/\.size-bubble/.test(css));
    assert.ok(!/\.size-ticks/.test(css));
    assert.ok(!/\.size-slider-wrap/.test(css));
    assert.ok(!/size-bubble/.test(tabSource));
    assert.ok(!/size-ticks/.test(tabSource));
    // The size row reuses the volume-style classes plus its preview-session
    // drag affordances.
    assert.ok(/volume-control size-control/.test(tabSource));
    assert.ok(/volume-slider size-slider/.test(tabSource));
    assert.ok(/\.size-control\.dragging \.volume-slider::-webkit-slider-thumb/.test(css));
    assert.ok(/\.size-control\.pending \.volume-slider\s*\{[\s\S]*cursor:\s*ew-resize;/.test(css));
  });

  it("keeps the text-scale slider in sync across display moves without fighting a live drag", () => {
    const tabSource = fs.readFileSync(SETTINGS_TAB_GENERAL, "utf8");
    const uiCoreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    // The committed percent is per-display and lives main-side; a window move
    // never produces a settings-changed broadcast, so the row must subscribe
    // to the context-changed poke from the settings-window runtime…
    assert.ok(/onTextScaleContextChanged\(\(\) => \{\s*if \(!previewLive\) syncFromContext\(\);/.test(tabSource),
      "text-scale row must re-pull context on display change, gated on previewLive");
    // …and must not repaint to the committed value mid-drag (the preview
    // itself triggers pokes via applyTextScaleNow).
    assert.ok(/previewLive = true;/.test(tabSource));
    // Preview exits clear the flag: manual pointer release, commit (change),
    // and rollback (blur).
    // (Lookbehind excludes the `let previewLive = false;` declaration.)
    assert.strictEqual((tabSource.match(/(?<!let )previewLive = false;/g) || []).length, 3);
    // Full re-renders must dispose the row (unsubscribe + roll back a
    // stranded transient preview) — see clearMountedControls.
    assert.ok(/unsubscribeContextChanged\(\);/.test(tabSource));
    assert.ok(/mountedControls\.textScale && typeof state\.mountedControls\.textScale\.dispose === "function"/.test(uiCoreSource),
      "clearMountedControls must dispose the text-scale control");
    assert.ok(/state\.mountedControls\.textScale = null;/.test(uiCoreSource));
    // Renderer-side rollback rides IPC and can't be trusted during window
    // teardown — main must clear the transient preview when settings closes,
    // or a mid-drag ⌘W pins the preview scale to the display until restart.
    const mainSource = fs.readFileSync(MAIN_PROCESS, "utf8");
    assert.ok(/onBeforeClosed: \(\) => \{[^}]*endTextScalePreview\(\);/.test(mainSource),
      "settings onBeforeClosed must end a live text-scale preview");
  });

  it("makes both percent readouts clickable reset buttons", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const tabSource = fs.readFileSync(SETTINGS_TAB_GENERAL, "utf8");
    const petSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-pet.js"), "utf8");
    assert.ok(/\.text-scale-readout\s*\{[\s\S]*cursor:\s*pointer;/.test(css));
    // Size readout resets the pet to the prefs default (P:9 → 30 on the UI scale).
    assert.ok(/SIZE_UI_DEFAULT = 30/.test(petSource));
    assert.ok(/controller\.change\(SIZE_UI_DEFAULT\)/.test(petSource));
    assert.ok(/rowSizeResetTitle/.test(petSource));
    // Text-size readout resets to 100% via the per-display command.
    assert.ok(/setTextScaleForDisplay/.test(tabSource));
    assert.ok(/textScaleResetTitle/.test(tabSource));
  });

  it("uses transform-based Settings switch motion with a calmer shared timing", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const switchRule = css.match(/\.switch\s*\{([\s\S]*?)\n\}/);
    const knobRule = css.match(/\.switch::after\s*\{([\s\S]*?)\n\}/);
    const onKnobRule = css.match(/\.switch\.on::after\s*\{([\s\S]*?)\n\}/);
    assert.ok(switchRule, "settings.css should define the switch track");
    assert.ok(knobRule, "settings.css should define the switch knob");
    assert.ok(onKnobRule, "settings.css should define the on-state knob transform");
    assert.ok(/transition:\s*background 0\.26s ease,\s*box-shadow 0\.26s ease,\s*transform 0\.16s ease;/.test(switchRule[1]));
    assert.ok(/transform:\s*translateX\(0\)\s+scale\(1\);/.test(knobRule[1]));
    assert.ok(!/transition:\s*left\b/.test(knobRule[1]));
    assert.ok(/transition:\s*transform 0\.28s cubic-bezier\(0\.2,\s*0\.8,\s*0\.2,\s*1\),\s*box-shadow 0\.2s ease;/.test(knobRule[1]));
    assert.ok(/transform:\s*translateX\(16px\)\s+scale\(1\);/.test(onKnobRule[1]));
    assert.ok(!css.includes(".switch.on::after { left: 18px; }"));
    assert.ok(/\.switch:not\(\.disabled\):active::after\s*\{[\s\S]*transform:\s*translateX\(var\(--switch-knob-x,\s*0\)\)\s+scale\(0\.94\);/.test(css));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.switch,[\s\S]*\.switch::after\s*\{[\s\S]*transition:\s*none;/.test(css));
  });

  it("renders the Settings language picker as a dropdown over all supported langs", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const pickerSource = fs.readFileSync(LANGUAGE_PICKER_JS, "utf8");
    const pickerCss = fs.readFileSync(LANGUAGE_PICKER_CSS, "utf8");
    const settingsHtml = fs.readFileSync(SETTINGS_HTML, "utf8");
    const settingsCss = fs.readFileSync(SETTINGS_CSS, "utf8");

    assert.ok(new RegExp(
      String.raw`const LANGUAGE_OPTIONS = \[` +
      SUPPORTED_LANGS.map((lang) => String.raw`"${lang}"`).join(String.raw`,\s*`) +
      String.raw`\];`
    ).test(generalSource));
    assert.ok(generalSource.includes("helpers.buildSettingsSelect"));
    assert.ok(generalSource.includes('className: "settings-language-select"'));
    assert.ok(!generalSource.includes("createLanguagePicker"));
    assert.ok(pickerSource.includes("picker.className = `language-picker"));
    assert.ok(pickerSource.includes(`role", "combobox"`));
    assert.ok(pickerSource.includes(`aria-haspopup", "listbox"`));
    assert.ok(pickerSource.includes(`aria-controls", menu.id`));
    assert.ok(pickerSource.includes(`role", "listbox"`));
    assert.ok(pickerSource.includes(`aria-hidden", "true"`));
    assert.ok(pickerSource.includes(`role", "option"`));
    assert.ok(settingsHtml.includes(`href="language-picker.css"`));
    assert.ok(settingsHtml.includes(`src="language-picker.js"`));
    assert.match(settingsHtml, /<main class="content" id="content" data-language-picker-boundary><\/main>/);
    assert.match(settingsCss, /\.content\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-gutter:\s*stable;/);
    assert.match(settingsCss, /\.settings-language-select\s*\{[^}]*min-width:\s*128px;[^}]*width:\s*128px;/);
    assert.ok(!generalSource.includes("language-segmented"));
    assert.ok(!generalSource.includes("runtime.languageTransition"));
    assert.ok(!generalSource.includes("--language-active-index"));
    assert.ok(!coreSource.includes("languageTransition"));
    assert.ok(/\.language-picker-menu\s*\{[\s\S]*box-shadow:/.test(pickerCss));
    assert.ok(/\.language-picker-menu\s*\{[\s\S]*display:\s*none;/.test(pickerCss));
    assert.ok(/\.language-picker\.menu-mounted \.language-picker-menu\s*\{[\s\S]*display:\s*block;/.test(pickerCss));
    assert.ok(/\.language-picker-option:hover\s*\{[\s\S]*background:/.test(pickerCss));
    assert.ok(/\.language-picker-option:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--text-primary,\s*var\(--text\)\);[\s\S]*outline-offset:\s*-2px;[\s\S]*background:/.test(pickerCss));
    assert.ok(/\.language-picker-option\.selected\s*\{[\s\S]*color:\s*var\(--accent\);/.test(pickerCss));
    assert.ok(/@media \(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*\.language-picker-menu/.test(pickerCss));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.language-picker-trigger,[\s\S]*\.language-picker-chevron,[\s\S]*\.language-picker-menu[\s\S]*transition:\s*none;/.test(pickerCss));
    assert.ok(/@media \(forced-colors:\s*active\)\s*\{[\s\S]*\.language-picker-trigger:focus-visible,[\s\S]*\.language-picker-option:focus-visible\s*\{[\s\S]*outline-color:\s*Highlight;/.test(pickerCss));
    assert.ok(!pickerCss.includes(".language-segmented"));
  });

  it("lets a mounted language picker finish closing outside clipped settings cards", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const sectionRowsRule = css.match(/\.section-rows\s*\{([^}]*)\}/);
    const mountedSectionRule = css.match(/\.section:has\(\.language-picker\.menu-mounted\)\s*\{([^}]*)\}/);
    const mountedRowsRule = css.match(/\.section-rows:has\(\.language-picker\.menu-mounted\)\s*\{([^}]*)\}/);
    const mountedCollapsibleRule = css.match(/\.collapsible-group:not\(\.collapsed\):has\(\.language-picker\.menu-mounted\)\s*>\s*\.collapsible-group-body,\s*\.collapsible-group:not\(\.collapsed\):has\(\.language-picker\.menu-mounted\)\s*>\s*\.collapsible-group-body\s*>\s*\.collapsible-group-body-inner\s*\{([^}]*)\}/);

    assert.ok(sectionRowsRule, "settings cards should retain their base clipping rule");
    assert.match(sectionRowsRule[1], /overflow:\s*hidden;/);
    assert.ok(mountedSectionRule, "the section should stay raised through the close animation");
    assert.match(mountedSectionRule[1], /position:\s*relative;/);
    assert.match(mountedSectionRule[1], /z-index:\s*1;/);
    assert.ok(mountedRowsRule, "a mounted picker should escape the settings card");
    assert.match(mountedRowsRule[1], /overflow:\s*visible;/);
    assert.ok(mountedCollapsibleRule, "collapsible content should not clip a mounted picker");
    assert.match(mountedCollapsibleRule[1], /overflow:\s*visible;/);
  });

  it("populates the language picker with current selection and propagates click changes", () => {
    const harness = loadGeneralLanguageRowForTest({
      snapshot: { lang: "en" },
    });

    harness.core.ops.requestRender({ content: true });
    assert.strictEqual(harness.getContentRenderCount(), 1);
    const picker = harness.getLangPicker();
    const trigger = harness.getLangTrigger();
    assert.ok(picker, "language picker should be rendered");
    assert.ok(trigger, "language picker trigger should be rendered");
    assert.strictEqual(picker.classList.contains("settings-select"), true);
    assert.strictEqual(picker.classList.contains("settings-language-select"), true);
    assert.strictEqual(harness.core.state.mountedControls.settingsSelects.size, 1);
    assert.strictEqual(harness.getLangValue().textContent, "English");
    assert.strictEqual(trigger.attributes["aria-label"], "Language: English");
    assert.strictEqual(harness.getLangMenu().attributes["aria-hidden"], "true");
    const options = harness.getLangOptions();
    assert.strictEqual(options.length, SUPPORTED_LANGS.length);
    for (let i = 0; i < SUPPORTED_LANGS.length; i++) {
      assert.strictEqual(options[i].dataset.lang, SUPPORTED_LANGS[i]);
      assert.strictEqual(options[i].tabIndex, -1);
    }
    assert.strictEqual(options[0].attributes["aria-selected"], "true");

    trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(picker.classList.contains("open"), true);
    assert.strictEqual(harness.getLangMenu().attributes["aria-hidden"], "false");
    assert.strictEqual(options[0].tabIndex, 0);
    options[1].dispatchEvent({ type: "click" });

    assert.deepStrictEqual(
      harness.updateCalls,
      [{ key: "lang", value: "zh" }],
      "clicking a language option should call settingsAPI.update with the new lang"
    );
    assert.strictEqual(picker.classList.contains("open"), false);
    assert.strictEqual(trigger.focused, true);
    assert.strictEqual(harness.getLangMenu().attributes["aria-hidden"], "true");
    for (const option of options) assert.strictEqual(option.tabIndex, -1);
    assert.strictEqual(harness.getLangValue().textContent, "Chinese");
    assert.strictEqual(trigger.attributes["aria-label"], "Language: Chinese");
    assert.strictEqual(trigger.getAttribute("aria-disabled"), "true");
    trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(picker.classList.contains("open"), false);
    options[0].dispatchEvent({ type: "click" });
    assert.deepStrictEqual(
      harness.updateCalls,
      [{ key: "lang", value: "zh" }],
      "the shared Settings picker should block further changes while saving"
    );
    assert.strictEqual(harness.getLangValue().textContent, "Chinese");
    assert.strictEqual(trigger.attributes["aria-label"], "Language: Chinese");
    assert.strictEqual(options[1].attributes["aria-selected"], "true");

    harness.core.ops.applyChanges({
      changes: { lang: "zh" },
      snapshot: { lang: "zh" },
    });
    assert.strictEqual(harness.getContentRenderCount(), 2);
    assert.strictEqual(harness.getLangValue().textContent, "Chinese");
    assert.strictEqual(harness.getLangTrigger().attributes["aria-label"], "Language: Chinese");
    assert.strictEqual(harness.getLangOptions()[1].attributes["aria-selected"], "true");
  });

  it("supports keyboard language selection and reverts when saving fails", async () => {
    const harness = loadGeneralLanguageRowForTest({
      snapshot: { lang: "en" },
      update: () => Promise.resolve({ status: "error", message: "synthetic failure" }),
    });

    harness.core.ops.requestRender({ content: true });
    const trigger = harness.getLangTrigger();
    trigger.dispatchEvent(createKeyboardEventForTest("ArrowDown"));
    assert.strictEqual(harness.getLangPicker().classList.contains("open"), true);
    const options = harness.getLangOptions();
    options[1].dispatchEvent(createKeyboardEventForTest("Enter"));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepStrictEqual(harness.updateCalls, [{ key: "lang", value: "zh" }]);
    assert.strictEqual(harness.getLangValue().textContent, "English");
    assert.strictEqual(trigger.focused, true);
    assert.strictEqual(harness.getToastText(), "Failed: synthetic failure");
  });

  it("supports Home/End navigation and locks disabled or pending Settings pickers", () => {
    const harness = loadGeneralLanguageRowForTest({ snapshot: { lang: "en" } });
    harness.core.ops.requestRender({ content: true });
    const trigger = harness.getLangTrigger();
    const options = harness.getLangOptions();
    trigger.dispatchEvent(createKeyboardEventForTest("ArrowDown"));
    for (const option of options) option.focused = false;
    trigger.dispatchEvent(createKeyboardEventForTest("End"));
    assert.equal(options[options.length - 1].focused, true);
    for (const option of options) option.focused = false;
    trigger.dispatchEvent(createKeyboardEventForTest("Home"));
    assert.equal(options[0].focused, true);
    assert.equal(trigger.getAttribute("role"), "combobox");
    assert.equal(trigger.getAttribute("aria-controls"), harness.getLangMenu().id);

    const locked = harness.core.helpers.buildSettingsSelect({
      value: "a",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      lockWhilePending: true,
    });
    harness.content.appendChild(locked.element);
    const lockedTrigger = locked.element.querySelector(".language-picker-trigger");
    locked.setDisabled(true);
    lockedTrigger.dispatchEvent({ type: "click" });
    assert.equal(locked.element.classList.contains("open"), false);
    assert.equal(lockedTrigger.disabled, true);
    locked.setDisabled(false);
    locked.setPending(true);
    lockedTrigger.dispatchEvent({ type: "click" });
    assert.equal(locked.element.classList.contains("open"), false);
    assert.equal(lockedTrigger.disabled, false);
    assert.equal(lockedTrigger.getAttribute("aria-disabled"), "true");
    assert.equal(lockedTrigger.getAttribute("aria-busy"), "true");
  });

  it("restores a Settings picker trigger only when async saving leaves focus on the page", async () => {
    const save = createDeferred();
    const harness = loadSharedLanguagePickerForTest({
      onChange: () => save.promise,
      lockWhilePending: true,
    });
    harness.trigger.dispatchEvent({ type: "click" });
    harness.optionElements[1].dispatchEvent({ type: "click" });
    assert.equal(harness.trigger.disabled, false);
    assert.equal(harness.trigger.getAttribute("aria-disabled"), "true");
    assert.equal(harness.picker.classList.contains("pending"), true);

    // Native Chromium moves focus to BODY when a focused button becomes
    // disabled. The fake DOM has no native focus manager, so model that step.
    harness.trigger.focused = false;
    harness.setActiveElement(harness.body);
    save.resolve(true);
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(harness.getActiveElement(), harness.trigger);
    assert.equal(harness.trigger.focused, true);
    assert.equal(harness.picker.classList.contains("pending"), false);
  });

  it("builds accessible segmented radios with keyboard navigation and rollback", async () => {
    const body = new FakeElement("body");
    const document = {
      body,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    let acceptChanges = true;
    const changes = [];
    const core = loadSettingsCoreForTest({}, { document });
    const control = core.helpers.buildSegmentedRadio({
      value: "off",
      ariaLabel: "Completion output",
      options: [
        { value: "off", label: "Without answer", description: "Keep the base notification." },
        { value: "full", label: "Full answer", description: "May contain sensitive data." },
      ],
      onChange: (value) => {
        changes.push(value);
        return Promise.resolve(acceptChanges);
      },
    });
    body.appendChild(control.element);

    const buttons = control.element.querySelectorAll("button");
    assert.equal(control.element.getAttribute("role"), "radiogroup");
    assert.equal(control.element.getAttribute("aria-label"), "Completion output");
    assert.equal(buttons[0].getAttribute("role"), "radio");
    assert.equal(buttons[0].getAttribute("aria-checked"), "true");
    assert.equal(buttons[0].tabIndex, 0);
    assert.equal(buttons[1].tabIndex, -1);
    assert.equal(control.element.querySelectorAll(".settings-segmented-radio-description").length, 2);

    buttons[0].dispatchEvent(createKeyboardEventForTest("ArrowRight"));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(changes, ["full"]);
    assert.equal(buttons[1].focused, true);
    assert.equal(buttons[1].getAttribute("aria-checked"), "true");

    control.setValue("off");
    acceptChanges = false;
    buttons[0].dispatchEvent(createKeyboardEventForTest("End"));
    assert.equal(control.element.getAttribute("aria-busy"), "true");
    assert.equal(buttons[0].getAttribute("aria-disabled"), "true");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(buttons[0].getAttribute("aria-checked"), "true");
    assert.equal(buttons[1].getAttribute("aria-checked"), "false");

    core.ops.clearMountedControls();
    assert.equal(buttons[0].eventListeners.click.length, 0);
    assert.equal(buttons[0].eventListeners.keydown.length, 0);
  });

  it("lets segmented radio and tab clicks reach document listeners unless a row opts out", () => {
    const body = new FakeElement("body");
    const document = {
      body,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const options = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
    const clickWithProbe = (button) => {
      let stopped = false;
      button.eventListeners.click[0]({ currentTarget: button, stopPropagation: () => { stopped = true; } });
      return stopped;
    };
    const plain = core.helpers.buildSegmentedRadio({ value: "a", ariaLabel: "Plain", options, onChange: () => true });
    const isolated = core.helpers.buildSegmentedRadio({
      value: "a", ariaLabel: "Isolated", options, stopPropagation: true, onChange: () => true,
    });
    const tabs = core.helpers.buildTabs({
      id: "probe-tabs",
      ariaLabel: "Pages",
      value: "a",
      options,
      onChange: () => true,
    });
    body.appendChild(plain.element);
    body.appendChild(isolated.element);
    body.appendChild(tabs.element);
    assert.equal(clickWithProbe(plain.element.querySelectorAll("button")[1]), false);
    assert.equal(clickWithProbe(isolated.element.querySelectorAll("button")[1]), true);
    assert.equal(clickWithProbe(tabs.element.querySelectorAll("button")[1]), false);
  });

  it("restores segmented-control focus after a warning dialog closes", async () => {
    const body = new FakeElement("body");
    const modalRoot = new FakeElement("div");
    modalRoot.id = "modalRoot";
    body.appendChild(modalRoot);
    const listeners = new Map();
    const document = {
      body,
      activeElement: body,
      createElement(tagName) {
        const element = new FakeElement(tagName);
        element.focus = () => {
          if (element.disabled) return;
          element.focused = true;
          document.activeElement = element;
        };
        return element;
      },
      createElementNS(_namespace, tagName) {
        return this.createElement(tagName);
      },
      getElementById: (id) => (id === "modalRoot" ? modalRoot : null),
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
    };
    const core = loadSettingsCoreForTest({}, { document });
    const control = core.helpers.buildSegmentedRadio({
      value: "off",
      ariaLabel: "Automation",
      options: [{ value: "off", label: "Off" }, { value: "auto", label: "Auto" }],
      onChange: () => core.helpers.showSettingsConfirmModal({
        title: "Enable automation?",
        detail: "Review the risk first.",
        actions: [
          { id: "cancel", label: "Cancel", defaultFocus: true },
          { id: "confirm", label: "Enable", tone: "danger" },
        ],
      }).then((actionId) => actionId === "confirm"),
    });
    body.appendChild(control.element);
    const source = control.element.querySelectorAll("button")[1];
    source.focus();
    source.dispatchEvent({ type: "click" });

    assert.equal(source.getAttribute("aria-disabled"), "true");
    assert.notStrictEqual(document.activeElement, source);
    listeners.get("keydown")({ key: "Escape", preventDefault() {} });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(source.disabled, false);
    assert.strictEqual(document.activeElement, source);
    assert.equal(source.getAttribute("aria-checked"), "false");
  });

  it("restores a stable Settings focus key across a full content render", () => {
    const body = new FakeElement("body");
    const content = new FakeElement("main");
    content.id = "content";
    body.appendChild(content);
    const document = {
      body,
      activeElement: body,
      createElement(tagName) {
        const element = new FakeElement(tagName);
        element.focus = () => {
          element.focused = true;
          document.activeElement = element;
        };
        return element;
      },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, { document });
    const first = document.createElement("button");
    first.setAttribute("data-settings-focus-key", "feishu-timeout");
    content.appendChild(first);
    first.focus();

    let replacement = null;
    core.ops.installRenderHooks({
      content() {
        content.innerHTML = "";
        replacement = document.createElement("button");
        replacement.setAttribute("data-settings-focus-key", "feishu-timeout");
        content.appendChild(replacement);
      },
    });
    core.ops.requestRender({ content: true });

    assert.equal(first.isConnected, false);
    assert.strictEqual(document.activeElement, replacement);
    assert.equal(replacement.focused, true);
  });

  it("prefers an exact Settings focus key and falls back when that control disappears", () => {
    const body = new FakeElement("body");
    const content = new FakeElement("main");
    content.id = "content";
    body.appendChild(content);
    const document = {
      body,
      activeElement: body,
      createElement(tagName) {
        const element = new FakeElement(tagName);
        element.focus = () => {
          element.focused = true;
          document.activeElement = element;
        };
        return element;
      },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, { document });
    let showRetry = true;
    let period = null;
    let retry = null;
    const render = () => {
      content.innerHTML = "";
      period = document.createElement("button");
      period.setAttribute("data-settings-focus-key", "recap-period-today");
      content.appendChild(period);
      retry = null;
      if (showRetry) {
        retry = document.createElement("button");
        retry.setAttribute("data-settings-focus-key", "recap-retry-today");
        retry.setAttribute("data-settings-focus-fallback-key", "recap-period-today");
        content.appendChild(retry);
      }
    };
    core.ops.installRenderHooks({ content: render });
    render();
    retry.focus();

    core.ops.requestRender({ content: true });
    assert.strictEqual(document.activeElement, retry);

    showRetry = false;
    core.ops.requestRender({ content: true });
    assert.strictEqual(document.activeElement, period);
    assert.equal(period.focused, true);
  });

  it("falls back when the exact Settings focus target becomes disabled", () => {
    const body = new FakeElement("body");
    const content = new FakeElement("main");
    content.id = "content";
    body.appendChild(content);
    const document = {
      body,
      activeElement: body,
      createElement(tagName) {
        const element = new FakeElement(tagName);
        element.focus = () => {
          element.focused = true;
          document.activeElement = element;
        };
        return element;
      },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, { document });
    let disableExact = false;
    let fallback = null;
    let exact = null;
    const render = () => {
      content.innerHTML = "";
      fallback = document.createElement("button");
      fallback.setAttribute("data-settings-focus-key", "recap-recording-toggle");
      content.appendChild(fallback);
      exact = document.createElement("button");
      exact.setAttribute("data-settings-focus-key", "recap-clear");
      exact.setAttribute("data-settings-focus-fallback-key", "recap-recording-toggle");
      exact.disabled = disableExact;
      content.appendChild(exact);
    };
    core.ops.installRenderHooks({ content: render });
    render();
    exact.focus();

    disableExact = true;
    core.ops.requestRender({ content: true });

    assert.equal(exact.disabled, true);
    assert.strictEqual(document.activeElement, fallback);
    assert.equal(fallback.focused, true);
  });

  it("does not steal focus acquired by another live control during a Settings render", () => {
    const body = new FakeElement("body");
    const content = new FakeElement("main");
    content.id = "content";
    body.appendChild(content);
    const document = {
      body,
      activeElement: body,
      createElement(tagName) {
        const element = new FakeElement(tagName);
        element.focus = () => {
          element.focused = true;
          document.activeElement = element;
        };
        return element;
      },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, { document });
    const original = document.createElement("button");
    original.setAttribute("data-settings-focus-key", "recap-clear");
    content.appendChild(original);
    original.focus();

    let replacement = null;
    let newlyFocused = null;
    core.ops.installRenderHooks({
      content() {
        content.innerHTML = "";
        replacement = document.createElement("button");
        replacement.setAttribute("data-settings-focus-key", "recap-clear");
        content.appendChild(replacement);
        newlyFocused = document.createElement("button");
        content.appendChild(newlyFocused);
        newlyFocused.focus();
      },
    });

    core.ops.requestRender({ content: true });

    assert.strictEqual(document.activeElement, newlyFocused);
    assert.equal(newlyFocused.focused, true);
    assert.equal(replacement.focused, false);
  });

  it("restores content scroll after a live full render temporarily clamps it", () => {
    let rawScrollTop = 740;
    let maxScrollTop = 2000;
    const raf = createQueuedRaf();
    const body = new FakeElement("body");
    const content = new FakeElement("main");
    content.id = "content";
    Object.defineProperty(content, "scrollTop", {
      configurable: true,
      get: () => Math.min(rawScrollTop, maxScrollTop),
      set: (value) => {
        rawScrollTop = Math.max(0, Math.min(Number(value) || 0, maxScrollTop));
      },
    });
    body.appendChild(content);
    const document = {
      body,
      activeElement: body,
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, {
      document,
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    core.state.activeTab = "recap";
    core.tabs.recap = {};
    core.ops.installRenderHooks({
      content() {
        maxScrollTop = 0;
        content.scrollTop = content.scrollTop;
        maxScrollTop = 2000;
      },
    });

    core.ops.requestRender({ content: true, preserveScroll: true });
    assert.equal(content.scrollTop, 740);

    content.scrollTop = 0;
    raf.flush();
    assert.equal(content.scrollTop, 740);
  });

  it("builds Settings buttons from one tone, size, and pending-state contract", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const button = core.helpers.buildButton({
      label: "Delete",
      tone: "danger",
      size: "compact",
      pending: true,
      ariaLabel: "Delete profile",
    });

    assert.equal(button.textContent, "Delete");
    assert.equal(button.type, "button");
    assert.equal(button.classList.contains("settings-button"), true);
    assert.equal(button.classList.contains("settings-button-compact"), true);
    assert.equal(button.classList.contains("danger"), true);
    assert.equal(button.classList.contains("pending"), true);
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.getAttribute("aria-label"), "Delete profile");
    assert.equal(button.querySelector(".settings-button-label").textContent, "Delete");
  });

  it("preserves a DOM Node icon while updating label, pressed, pending, and disabled state", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const icon = document.createElement("svg");
    const button = core.helpers.buildButton({
      label: "Install",
      icon,
      disabled: true,
      ariaPressed: false,
    });
    const iconWrapper = button.querySelector(".settings-button-icon");
    const label = button.querySelector(".settings-button-label");

    assert.ok(iconWrapper);
    assert.strictEqual(iconWrapper.children[0], icon);
    assert.equal(iconWrapper.getAttribute("aria-hidden"), "true");
    assert.equal(label.textContent, "Install");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(button.disabled, true);

    core.helpers.setButtonState(button, {
      label: "Installing",
      pending: true,
      ariaPressed: true,
    });
    assert.strictEqual(iconWrapper.children[0], icon, "state updates must retain the icon node");
    assert.strictEqual(button.querySelector(".settings-button-icon"), iconWrapper);
    assert.strictEqual(button.querySelector(".settings-button-label"), label);
    assert.equal(label.textContent, "Installing");
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.disabled, true);

    core.helpers.setButtonState(button, { pending: false });
    assert.equal(button.disabled, true, "clearing pending must preserve business disabled state");
    core.helpers.setButtonState(button, { disabled: false, ariaPressed: null });
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-pressed"), undefined);
    assert.strictEqual(iconWrapper.children[0], icon);
  });

  it("rejects non-node icons and state updates for unmanaged buttons", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    assert.throws(
      () => core.helpers.buildButton({ label: "Invalid", icon: "not-a-node" }),
      /icon must be a DOM Node/,
    );
    const rawButton = document.createElement("button");
    assert.throws(
      () => core.helpers.setButtonState(rawButton, { pending: true }),
      /requires a button built by buildButton/,
    );
  });

  it("builds Settings text inputs from one size, accessibility, state, and IME-safe Enter contract", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const submitted = [];
    const input = core.helpers.buildTextInput({
      type: "password",
      size: "compact",
      value: "secret",
      placeholder: "API key",
      autocomplete: "new-password",
      spellcheck: false,
      inputMode: "text",
      ariaLabel: "Dedicated API key",
      describedBy: "key-help",
      pending: true,
      lockWhilePending: false,
      onEnter: (_event, element) => submitted.push(element.value),
    });

    assert.equal(input.classList.contains("settings-text-input"), true);
    assert.equal(input.classList.contains("settings-text-input-compact"), true);
    assert.equal(input.classList.contains("pending"), true);
    assert.equal(input.type, "password");
    assert.equal(input.value, "secret");
    assert.equal(input.autocomplete, "new-password");
    assert.equal(input.spellcheck, false);
    assert.equal(input.disabled, false, "editable-pending fields stay editable");
    assert.equal(input.getAttribute("aria-busy"), "true");
    assert.equal(input.getAttribute("aria-invalid"), "false");
    assert.equal(input.getAttribute("aria-label"), "Dedicated API key");
    assert.equal(input.getAttribute("aria-describedby"), "key-help");

    input.dispatchEvent({ type: "keydown", key: "Enter", isComposing: true });
    input.dispatchEvent({ type: "keydown", key: "Enter", keyCode: 229 });
    assert.deepStrictEqual(submitted, [], "IME composition must not submit");
    const enter = { type: "keydown", key: "Enter" };
    input.dispatchEvent(enter);
    assert.deepStrictEqual(submitted, ["secret"]);
    assert.equal(enter.defaultPrevented, true);

    core.helpers.setTextInputState(input, {
      invalid: true,
      describedBy: "key-error",
    });
    assert.equal(input.disabled, false, "partial state updates preserve editable-pending mode");
    assert.equal(input.getAttribute("aria-busy"), "true", "partial updates preserve pending state");
    assert.equal(input.classList.contains("invalid"), true);
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.equal(input.getAttribute("aria-describedby"), "key-error");

    core.helpers.setTextInputState(input, { lockWhilePending: true });
    assert.equal(input.disabled, true, "pending fields lock when requested");
    const passive = core.helpers.buildTextInput({ ariaLabel: "Passive field" });
    const passiveEnter = { type: "keydown", key: "Enter" };
    passive.dispatchEvent(passiveEnter);
    assert.notEqual(passiveEnter.defaultPrevented, true, "Enter remains untouched without an onEnter callback");

    const canonical = core.helpers.buildTextInput({
      ariaLabel: "Canonical description",
      ariaDescribedBy: "canonical-help",
    });
    assert.equal(canonical.getAttribute("aria-describedby"), "canonical-help");
    const canonicalEmpty = core.helpers.buildTextInput({
      ariaLabel: "Canonical empty description",
      ariaDescribedBy: "",
      describedBy: "legacy-help",
    });
    assert.ok(!canonicalEmpty.getAttribute("aria-describedby"),
      "an explicit empty canonical value must not fall back to the compatibility alias");
    const canonicalEmptyLabel = core.helpers.buildTextInput({
      ariaLabel: "Canonical empty label relationship",
      ariaLabelledBy: "",
      labelledBy: "legacy-label",
    });
    assert.ok(!canonicalEmptyLabel.getAttribute("aria-labelledby"),
      "an explicit empty canonical label relationship must not fall back to the compatibility alias");
    const compatibility = core.helpers.buildTextInput({
      ariaLabel: "Compatibility description",
      describedBy: "compatibility-help",
    });
    assert.equal(compatibility.getAttribute("aria-describedby"), "compatibility-help");
    core.helpers.setTextInputState(compatibility, { describedBy: "" });
    assert.equal(compatibility.getAttribute("aria-describedby"), null,
      "an explicit empty compatibility value clears the relationship");
  });

  it("builds a controlled Settings switch with unified input and accessibility state", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const toggles = [];
    const control = core.helpers.buildSwitch({
      checked: false,
      ariaLabel: "Enable feature",
      onToggle: (request) => toggles.push(request.nextChecked),
    });

    assert.equal(control.element.tagName, "BUTTON");
    assert.equal(control.element.type, "button");
    assert.equal(control.element.getAttribute("role"), "switch");
    assert.equal(control.element.getAttribute("aria-label"), "Enable feature");
    assert.equal(control.element.getAttribute("aria-checked"), "false");
    assert.equal(control.element.getAttribute("aria-disabled"), "false");
    assert.equal(control.element.getAttribute("aria-busy"), "false");
    assert.equal(control.element.tabIndex, 0);

    control.element.dispatchEvent({ type: "click" });
    control.element.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
    control.element.dispatchEvent({ type: "keydown", key: " ", preventDefault() {} });
    assert.deepStrictEqual(toggles, [true, true, true]);

    control.setState({ checked: true, pending: true });
    assert.equal(control.getChecked(), true);
    assert.equal(control.element.classList.contains("on"), true);
    assert.equal(control.element.classList.contains("pending"), true);
    assert.equal(control.element.getAttribute("aria-checked"), "true");
    assert.equal(control.element.getAttribute("aria-busy"), "true");
    assert.equal(control.element.tabIndex, 0, "pending switches should retain keyboard focus");
    control.element.dispatchEvent({ type: "click" });
    assert.deepStrictEqual(toggles, [true, true, true], "pending switches must ignore duplicate activation");

    control.setState({ disabled: true, ariaLabel: "Enable translated feature" });
    assert.equal(control.element.classList.contains("pending"), true);
    assert.equal(control.element.classList.contains("disabled"), true);
    assert.equal(control.element.getAttribute("aria-label"), "Enable translated feature");
    control.setState({ pending: false });
    assert.equal(control.element.classList.contains("pending"), false);
    assert.equal(control.element.classList.contains("disabled"), true);
    assert.equal(control.element.getAttribute("aria-disabled"), "true");
    assert.equal(control.element.disabled, true);
    assert.equal(control.element.tabIndex, -1);
    control.setState({ disabled: false });
    assert.equal(control.element.disabled, false);
    assert.equal(control.element.tabIndex, 0);

    control.dispose();
    control.element.dispatchEvent({ type: "click" });
    assert.deepStrictEqual(toggles, [true, true, true]);
  });

  it("supports a separate switch host and visual track without duplicating semantics", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const host = document.createElement("button");
    const track = document.createElement("span");
    const control = core.helpers.buildSwitch({
      element: host,
      visualElement: track,
      checked: true,
      pending: true,
      ariaLabelledBy: "remote-option-label",
      ariaDescribedBy: "remote-option-description",
      className: "remote-switch-track",
    });

    assert.strictEqual(control.element, host);
    assert.strictEqual(control.visualElement, track);
    assert.equal(host.getAttribute("role"), "switch");
    assert.equal(host.getAttribute("aria-labelledby"), "remote-option-label");
    assert.equal(host.getAttribute("aria-describedby"), "remote-option-description");
    assert.equal(host.getAttribute("aria-checked"), "true");
    assert.equal(host.getAttribute("aria-busy"), "true");
    assert.equal(host.classList.contains("switch"), false);
    assert.equal(track.classList.contains("switch"), true);
    assert.equal(track.classList.contains("remote-switch-track"), true);
    assert.equal(track.getAttribute("aria-checked"), undefined);
  });

  it("requires every shared Settings switch to have an accessible name", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    assert.throws(() => core.helpers.buildSwitch({ checked: false }), /requires ariaLabel or ariaLabelledBy/);
  });

  it("builds Setting rows with stable label and description relationships", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const first = core.helpers.buildSettingRow({
      label: "Host",
      description: "Remote host name",
      className: "remote-row",
      controlClassName: "remote-control",
    });
    const second = core.helpers.buildSettingRow({ label: "Port" });

    assert.equal(first.element.classList.contains("row"), true);
    assert.equal(first.element.classList.contains("remote-row"), true);
    assert.equal(first.textElement.classList.contains("row-text"), true);
    assert.equal(first.labelElement.textContent, "Host");
    assert.equal(first.descriptionElement.textContent, "Remote host name");
    assert.equal(first.controlElement.classList.contains("row-control"), true);
    assert.equal(first.controlElement.classList.contains("remote-control"), true);
    assert.notEqual(first.labelElement.id, second.labelElement.id);
    assert.equal(second.descriptionElement, null, "description-less rows do not mount an empty node");
  });

  it("controls Form Field state axes, validation relationships, callbacks, and disposal independently", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const calls = [];
    const field = core.helpers.buildFormField({
      type: "search",
      value: "draft",
      ariaLabelledBy: "field-label",
      ariaDescribedBy: "field-help",
      stopPropagation: true,
      disabled: true,
      pending: true,
      onInput: ({ value }) => calls.push(value),
    });

    assert.equal(field.element.classList.contains("settings-form-field"), true);
    assert.equal(field.element.getAttribute("aria-labelledby"), "field-label");
    assert.equal(field.element.getAttribute("aria-describedby"), "field-help");
    assert.equal(field.element.disabled, true);
    assert.equal(field.element.getAttribute("aria-busy"), "true");
    field.setState({ pending: false });
    assert.equal(field.element.disabled, true, "ending pending does not clear business disabled");
    field.setState({
      disabled: false,
      invalid: true,
      validationMessage: "Host is required",
    });
    assert.equal(field.element.disabled, false);
    assert.equal(field.element.getAttribute("aria-invalid"), "true");
    assert.equal(field.validationElement.textContent, "Host is required");
    assert.equal(field.validationElement.hidden, false);
    assert.equal(field.element.getAttribute("aria-describedby"), `field-help ${field.validationElement.id}`);
    assert.equal(document.body.contains(field.validationElement), true,
      "validation messages must be mounted so aria-describedby resolves");

    field.element.value = "new draft";
    field.setState({ invalid: false });
    assert.equal(field.getValue(), "new draft", "unspecified value does not overwrite an active draft");
    field.element.dispatchEvent({ type: "input" });
    assert.deepStrictEqual(calls, ["new draft"]);
    field.setState({ validationMessage: "" });
    assert.equal(field.element.getAttribute("aria-describedby"), "field-help",
      "clearing validation keeps the row description relationship");

    field.dispose();
    assert.equal(document.body.contains(field.validationElement), false,
      "disposed fields remove their validation node");
    field.element.value = "ignored";
    field.element.dispatchEvent({ type: "input" });
    assert.deepStrictEqual(calls, ["new draft"], "disposed fields remove their callbacks");
    assert.equal(core.state.mountedControls.formFields.size, 0);
    const rerenderedField = core.helpers.buildFormField({ ariaLabel: "Rerendered field" });
    assert.equal(core.state.mountedControls.formFields.size, 1);
    core.ops.clearMountedControls();
    rerenderedField.element.dispatchEvent({ type: "input" });
    assert.equal(core.state.mountedControls.formFields.size, 0,
      "Settings rerenders dispose every mounted Form Field controller");
    assert.throws(() => core.helpers.buildFormField({ type: "text" }), /ariaLabel or ariaLabelledBy/);
  });

  it("keeps interactive Settings switch DOM and semantics owned by the shared primitive", () => {
    const allowedOwner = "settings-ui-core.js";
    const sourceFiles = fs.readdirSync(SRC_DIR)
      .filter((name) => name.endsWith(".js") && name.startsWith("settings"));
    const forbidden = [
      /role=["']switch["']/,
      /setAttribute\(["']role["'],\s*["']switch["']\)/,
      /className\s*=\s*["'][^"']*\bswitch\b/,
      /class=["'][^"']*\bswitch\b/,
      /classList\.add\(["']switch["']\)/,
      /\bsetSwitchVisual\b/,
      /\battachAnimatedSwitch\b/,
    ];
    const offenders = [];
    for (const name of sourceFiles) {
      if (name === allowedOwner) continue;
      const source = fs.readFileSync(path.join(SRC_DIR, name), "utf8");
      if (forbidden.some((pattern) => pattern.test(source))) offenders.push(name);
    }
    assert.deepStrictEqual(offenders, []);

    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.equal((coreSource.match(/setAttribute\("role", "switch"\)/g) || []).length, 1);
  });
  it("uses the shared Settings dialog shell with ARIA links and focus restoration", async () => {
    const body = new FakeElement("body");
    const modalRoot = new FakeElement("div");
    const launchButton = new FakeElement("button");
    body.append(launchButton, modalRoot);
    const listeners = new Map();
    const document = {
      body,
      activeElement: launchButton,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: (id) => (id === "modalRoot" ? modalRoot : null),
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
    };
    const core = loadSettingsCoreForTest({}, { document });
    const resultPromise = core.helpers.showSettingsConfirmModal({
      title: "Remove profile?",
      detail: "This cannot be undone.",
      iconText: "this override must be ignored",
      actions: [
        { id: "cancel", label: "Cancel", tone: "neutral", defaultFocus: true },
        { id: "remove", label: "Remove", tone: "danger" },
      ],
    });

    const dialog = modalRoot.querySelector(".settings-dialog");
    assert.ok(dialog);
    assert.equal(dialog.getAttribute("role"), "dialog");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.match(dialog.getAttribute("aria-labelledby"), /^settings-dialog-\d+-title$/);
    assert.match(dialog.getAttribute("aria-describedby"), /^settings-dialog-\d+-detail$/);
    const icon = dialog.querySelector(".settings-confirm-icon");
    assert.ok(icon);
    assert.equal(icon.textContent, "");
    assert.equal(icon.children[0].tagName, "SVG");
    assert.equal(icon.children[0].getAttribute("viewBox"), "0 0 20 20");
    assert.equal(icon.children[0].children[0].getAttribute("d"), "M10 4.2v7.4m0 3.1v.1");
    assert.equal(listeners.has("keydown"), true);
    dialog.querySelectorAll("button")[1].dispatchEvent({ type: "click" });

    assert.equal(await resultPromise, "remove");
    assert.equal(modalRoot.children.length, 0);
    assert.equal(launchButton.focused, true);
    assert.equal(listeners.has("keydown"), false);
  });

  it("does not restore dialog focus to a launch element removed during a Settings rerender", async () => {
    const body = new FakeElement("body");
    const modalRoot = new FakeElement("div");
    const launchButton = new FakeElement("button");
    body.append(launchButton, modalRoot);
    const document = {
      body,
      activeElement: launchButton,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: (id) => (id === "modalRoot" ? modalRoot : null),
      addEventListener() {},
      removeEventListener() {},
    };
    const core = loadSettingsCoreForTest({}, { document });
    const resultPromise = core.helpers.showSettingsConfirmModal({
      title: "Remove profile?",
      detail: "This cannot be undone.",
      actions: [{ id: "cancel", label: "Cancel", tone: "neutral" }],
    });

    launchButton.remove();
    modalRoot.querySelector("button").dispatchEvent({ type: "click" });

    assert.equal(await resultPromise, "cancel");
    assert.equal(launchButton.isConnected, false);
    assert.equal(launchButton.focused, false);
  });

  it("keeps LAN mobile reset visually dangerous while token regeneration stays neutral", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(
      css,
      /\.channel-foot-link\.danger\s*\{[^}]*color:\s*var\(--text-tertiary\);/s
    );
    assert.match(
      css,
      /\.channel-foot-link\.danger:hover\s*\{[^}]*color:\s*var\(--danger-action\);/s
    );
    assert.match(
      css,
      /\.channel-foot-link:hover\s*\{[^}]*color:\s*var\(--accent\);/s
    );
    assert.ok(!css.includes(".mobile-action-btn"));
  });

  it("keeps warning acknowledgements in a wide-hitbox row with the safe action first", async () => {
    const body = new FakeElement("body");
    const modalRoot = new FakeElement("div");
    const launchButton = new FakeElement("button");
    body.append(launchButton, modalRoot);
    const document = {
      body,
      activeElement: launchButton,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: (id) => (id === "modalRoot" ? modalRoot : null),
      addEventListener() {},
      removeEventListener() {},
    };
    const core = loadSettingsCoreForTest({}, { document });
    const resultPromise = core.helpers.showSettingsDialog({
      title: "Auto-approve tools?",
      detail: "Supported tool requests will be approved automatically.",
      checkboxLabel: "I understand the risks. Don’t remind me when enabling this again.",
      returnDetails: true,
      actions: [
        { id: "cancel", label: "Cancel", tone: "neutral", defaultFocus: true },
        { id: "enable", label: "Auto-approve tools", tone: "danger" },
      ],
    });

    const dialog = modalRoot.querySelector(".settings-dialog");
    const checkboxRow = dialog.querySelector(".settings-confirm-checkbox");
    const checkbox = checkboxRow.querySelector("input");
    const buttons = dialog.querySelectorAll("button");
    assert.ok(checkboxRow, "the full acknowledgement row should be a label hit target");
    assert.equal(checkbox.type, "checkbox");
    assert.equal(checkbox.checked, false);
    assert.equal(buttons[0].textContent, "Cancel");
    assert.equal(buttons[0].focused, true, "the safe action keeps default focus");
    assert.equal(buttons[1].textContent, "Auto-approve tools");
    assert.equal(buttons[1].classList.contains("settings-confirm-danger"), true);

    checkbox.checked = true;
    buttons[1].dispatchEvent({ type: "click" });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await resultPromise)), {
      actionId: "enable",
      checkboxChecked: true,
    });
  });

  it("rolls concurrent failed language saves back to the last committed value", async () => {
    const saves = [];
    const changes = [];
    const harness = loadSharedLanguagePickerForTest({
      onChange: (next, previous) => {
        const deferred = createDeferred();
        saves.push(deferred);
        changes.push({ next, previous });
        return deferred.promise;
      },
    });

    harness.trigger.dispatchEvent({ type: "click" });
    harness.optionElements[1].dispatchEvent({ type: "click" });
    harness.trigger.dispatchEvent({ type: "click" });
    harness.optionElements[2].dispatchEvent({ type: "click" });
    assert.strictEqual(harness.valueElement.textContent, "JA");
    assert.deepStrictEqual(changes, [
      { next: "zh", previous: "en" },
      { next: "ja", previous: "en" },
    ]);

    saves[0].resolve(false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(harness.valueElement.textContent, "JA", "stale failure keeps the latest optimistic value");

    saves[1].resolve(false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(harness.valueElement.textContent, "EN", "latest failure restores the committed value");
  });

  it("advances the rollback baseline after a concurrent language save succeeds", async () => {
    const saves = [];
    const harness = loadSharedLanguagePickerForTest({
      onChange: () => {
        const deferred = createDeferred();
        saves.push(deferred);
        return deferred.promise;
      },
    });

    harness.trigger.dispatchEvent({ type: "click" });
    harness.optionElements[1].dispatchEvent({ type: "click" });
    harness.trigger.dispatchEvent({ type: "click" });
    harness.optionElements[2].dispatchEvent({ type: "click" });

    saves[0].resolve(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(harness.valueElement.textContent, "JA", "newer optimistic choice remains visible");

    saves[1].resolve(false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(harness.valueElement.textContent, "ZH", "failed latest choice restores the successful save");
  });

  it("flips and bounds the tutorial picker at minimum-size enlarged-text geometry", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: ["en", "zh", "zh-TW", "ko", "ja"],
      innerHeight: 450,
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 52, bottom: 400 });
    harness.trigger.getBoundingClientRect = () => ({ top: 220, bottom: 274 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 240 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 242 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 240 });

    harness.trigger.dispatchEvent({ type: "click" });

    assert.strictEqual(harness.picker.classList.contains("open-up"), true);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), true);
    assert.strictEqual(harness.menu.style.maxHeight, "162px");
    assert.ok(parseInt(harness.menu.style.maxHeight, 10) < harness.menu.scrollHeight);
    const css = fs.readFileSync(LANGUAGE_PICKER_CSS, "utf8");
    assert.match(css, /\.language-picker\.menu-scrollable \.language-picker-menu\s*\{[\s\S]*overflow-y:\s*auto;/);
    assert.match(css, /\.language-picker\.open-up \.language-picker-menu\s*\{[\s\S]*bottom:\s*calc\(100% \+ 6px\);/);
  });

  it("opens downward for the captured three-line pt-BR/es default-window geometry", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: SUPPORTED_LANGS,
      innerHeight: 668,
    });
    // Captured from real macOS Electron layout; this guards picker placement, not CSS layout.
    harness.boundary.getBoundingClientRect = () => ({ top: 47, bottom: 603 });
    harness.trigger.getBoundingClientRect = () => ({ top: 325, bottom: 361 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 220 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 222 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 220 });

    harness.trigger.dispatchEvent({ type: "click" });

    assert.strictEqual(harness.picker.classList.contains("open-up"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.menu.style.maxHeight, "222px");
  });

  it("keeps the shared picker downward branch covered when six options fit below", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: SUPPORTED_LANGS.slice(0, 6),
      innerHeight: 700,
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 78, bottom: 635 });
    harness.trigger.getBoundingClientRect = () => ({ top: 390, bottom: 426 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 190 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 192 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 190 });

    harness.trigger.dispatchEvent({ type: "click" });

    assert.strictEqual(harness.picker.classList.contains("open-up"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.menu.style.maxHeight, "192px");
  });

  it("initially reveals and bounds the tutorial picker at 150% and 160% text scale", () => {
    const layouts = [
      { scale: "150%", boundaryBottom: 313.7, triggerTop: 317.1, triggerBottom: 353.1 },
      { scale: "160%", boundaryBottom: 290.3, triggerTop: 316.6, triggerBottom: 352.6 },
    ];

    for (const layout of layouts) {
      const harness = loadSharedLanguagePickerForTest({
        options: ["en", "zh", "zh-TW", "ko", "ja"],
        innerHeight: 400,
      });
      harness.boundary.getBoundingClientRect = () => ({ top: 52, bottom: layout.boundaryBottom });
      harness.trigger.getBoundingClientRect = () => ({
        top: layout.triggerTop - harness.boundary.scrollTop,
        bottom: layout.triggerBottom - harness.boundary.scrollTop,
      });
      Object.defineProperty(harness.menu, "scrollHeight", { value: 160 });
      Object.defineProperty(harness.menu, "offsetHeight", { value: 162 });
      Object.defineProperty(harness.menu, "clientHeight", { value: 160 });

      assert.ok(
        harness.trigger.getBoundingClientRect().top > layout.boundaryBottom,
        `${layout.scale}: regression setup must start with the trigger behind the footer`,
      );

      harness.control.ensureVisible();
      const visibleTrigger = harness.trigger.getBoundingClientRect();
      assert.ok(visibleTrigger.top >= 52, `${layout.scale}: trigger top stays inside the body`);
      assert.ok(
        visibleTrigger.bottom <= layout.boundaryBottom,
        `${layout.scale}: trigger bottom stays inside the body`,
      );

      harness.trigger.dispatchEvent({ type: "click" });
      assert.strictEqual(
        harness.picker.classList.contains("open-up"),
        true,
        `${layout.scale}: menu flips upward`,
      );
      const menuBottom = visibleTrigger.top - 6;
      const menuTop = menuBottom - parseInt(harness.menu.style.maxHeight, 10);
      const firstOption = { top: menuTop + 6, bottom: menuTop + 36 };
      const lastOption = { top: menuBottom - 36, bottom: menuBottom - 6 };
      assert.ok(firstOption.top >= 52, `${layout.scale}: first option stays inside the body`);
      assert.ok(
        lastOption.bottom <= layout.boundaryBottom,
        `${layout.scale}: last option stays inside the body`,
      );
    }
  });

  it("can preserve a closed Dashboard picker's scroll without changing tutorial reveal defaults", () => {
    for (const revealWhenClosed of [false, undefined]) {
      const harness = loadSharedLanguagePickerForTest({ revealWhenClosed });
      harness.boundary.getBoundingClientRect = () => ({ top: 50, bottom: 300 });
      harness.trigger.getBoundingClientRect = () => ({
        top: 500 - harness.boundary.scrollTop, bottom: 526 - harness.boundary.scrollTop,
      });
      harness.dispatchWindowEvent("resize");
      harness.flushAnimationFrames();
      if (revealWhenClosed === false) assert.strictEqual(harness.boundary.scrollTop, 0);
      else assert.ok(harness.boundary.scrollTop > 0);
      harness.boundary.scrollTop = 0;
      harness.trigger.dispatchEvent({ type: "click" });
      harness.dispatchWindowEvent("resize");
      harness.flushAnimationFrames();
      assert.ok(harness.boundary.scrollTop > 0, "open menus still reveal their trigger");
      harness.control.dispose();
    }
  });

  it("reflows an open tutorial picker after the window is resized", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: ["en", "zh", "zh-TW", "ko", "ja"],
      innerHeight: 450,
    });
    const layout = {
      boundaryTop: 52,
      boundaryBottom: 352.8,
      triggerTop: 295.7,
      triggerBottom: 331.7,
    };
    harness.boundary.getBoundingClientRect = () => ({
      top: layout.boundaryTop,
      bottom: layout.boundaryBottom,
    });
    harness.trigger.getBoundingClientRect = () => ({
      top: layout.triggerTop - harness.boundary.scrollTop,
      bottom: layout.triggerBottom - harness.boundary.scrollTop,
    });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 160 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 162 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 160 });

    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.picker.classList.contains("open"), true);
    assert.strictEqual(harness.getWindowListenerCount("resize"), 1);

    layout.boundaryBottom = 290.3;
    layout.triggerTop = 316.6;
    layout.triggerBottom = 352.6;
    assert.ok(
      harness.trigger.getBoundingClientRect().top > layout.boundaryBottom,
      "regression setup must put the trigger behind the fixed footer",
    );

    harness.dispatchWindowEvent("resize");
    harness.dispatchWindowEvent("resize");
    assert.strictEqual(
      harness.getPendingAnimationFrameCount(),
      1,
      "resize work is coalesced into one animation frame",
    );
    harness.flushAnimationFrames();

    const visibleTrigger = harness.trigger.getBoundingClientRect();
    assert.ok(visibleTrigger.top >= layout.boundaryTop);
    assert.ok(visibleTrigger.bottom <= layout.boundaryBottom);
    assert.strictEqual(harness.picker.classList.contains("open-up"), true);
    assert.strictEqual(harness.menu.style.maxHeight, "162px");

    harness.control.dispose();
    assert.strictEqual(harness.getWindowListenerCount("resize"), 0);
  });

  it("does not show a scrollbar when an upward menu fits all language options", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: ["en", "zh", "zh-TW", "ko", "ja"],
      innerHeight: 600,
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 72, bottom: 502 });
    harness.trigger.getBoundingClientRect = () => ({ top: 445, bottom: 499 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 160 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 162 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 160 });

    harness.trigger.dispatchEvent({ type: "click" });

    assert.strictEqual(harness.picker.classList.contains("open-up"), true);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.menu.style.maxHeight, "162px");
  });

  it("unmounts a closed upward accessory-style menu and clears its overflow geometry", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: ["none", "cowboy", "party", "wizard", "top", "santa", "pumpkin", "halo"],
      innerHeight: 680,
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 0, bottom: 680 });
    harness.trigger.getBoundingClientRect = () => ({ top: 450, bottom: 498 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 280 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 282 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 280 });

    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), true);
    assert.strictEqual(harness.picker.classList.contains("open-up"), true);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), true);
    assert.strictEqual(harness.menu.style.maxHeight, "240px");

    harness.optionElements[1].dispatchEvent({ type: "click" });
    assert.strictEqual(harness.picker.classList.contains("open"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), true);
    assert.strictEqual(harness.getPendingTimerCount(), 1);
    harness.menu.dispatchEvent({ type: "transitionend", propertyName: "opacity" });

    assert.strictEqual(harness.getPendingTimerCount(), 0);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
    assert.strictEqual(harness.picker.classList.contains("open-up"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.menu.style.maxHeight, "");
    assert.strictEqual(harness.menu.scrollTop, 0);
  });

  it("converts viewport-fixed theme picker DOMRects to unzoomed CSS lengths", () => {
    const css = fs.readFileSync(LANGUAGE_PICKER_CSS, "utf8");
    assert.match(css, /\.language-picker\.viewport-fixed\s+\.language-picker-menu\s*\{\s*position:\s*fixed;/);

    for (const scale of [0.8, 1, 1.25, 1.5, 1.6]) {
      const tint = loadSharedLanguagePickerForTest({
        options: ["none", "midnight", "gold", "vaporwave", "matcha", "mono"],
        viewportPlacement: "down",
        textZoom: scale,
        innerHeight: 700 * scale,
        innerWidth: 1000 * scale,
      });
      tint.boundary.getBoundingClientRect = () => ({
        top: 38 * scale, bottom: 690 * scale, left: 250 * scale, right: 982 * scale,
      });
      tint.trigger.getBoundingClientRect = () => ({
        top: 220 * scale, bottom: 268 * scale, left: 690 * scale, right: 910 * scale, width: 220 * scale,
      });
      // Chromium reports unzoomed scroll/offset heights under root CSS zoom.
      const tintHeight = 190;
      Object.defineProperty(tint.menu, "scrollHeight", { value: tintHeight });
      Object.defineProperty(tint.menu, "offsetHeight", { value: tintHeight + 2 });
      Object.defineProperty(tint.menu, "clientHeight", { value: tintHeight });

      tint.trigger.dispatchEvent({ type: "click" });
      assert.strictEqual(tint.picker.classList.contains("viewport-fixed"), true);
      assert.strictEqual(tint.picker.classList.contains("open-up"), false);
      assert.ok(parseInt(tint.menu.style.top, 10) >= 274);
      assert.ok(parseInt(tint.menu.style.top, 10) + parseInt(tint.menu.style.maxHeight, 10) <= 678);
      assert.strictEqual(tint.menu.style.left, "690px");
      assert.strictEqual(tint.menu.style.width, "220px");

      const accessory = loadSharedLanguagePickerForTest({
        options: ["none", "cowboy", "party", "wizard", "top", "santa", "pumpkin", "halo"],
        viewportPlacement: "up",
        textZoom: scale,
        innerHeight: 700 * scale,
        innerWidth: 1000 * scale,
      });
      accessory.boundary.getBoundingClientRect = tint.boundary.getBoundingClientRect;
      accessory.trigger.getBoundingClientRect = () => ({
        top: 450 * scale, bottom: 498 * scale, left: 690 * scale, right: 910 * scale, width: 220 * scale,
      });
      const accessoryHeight = 240;
      Object.defineProperty(accessory.menu, "scrollHeight", { value: accessoryHeight });
      Object.defineProperty(accessory.menu, "offsetHeight", { value: accessoryHeight + 2 });
      Object.defineProperty(accessory.menu, "clientHeight", { value: accessoryHeight });

      accessory.trigger.dispatchEvent({ type: "click" });
      assert.strictEqual(accessory.picker.classList.contains("open-up"), true);
      assert.ok(parseInt(accessory.menu.style.top, 10) >= 50);
      assert.ok(parseInt(accessory.menu.style.top, 10) + parseInt(accessory.menu.style.maxHeight, 10) <= 444);
      assert.ok(parseInt(accessory.menu.style.maxHeight, 10) <= 240);
    }
  });

  it("falls back from a preferred theme-menu direction only when the other side is safer", () => {
    const preferDown = loadSharedLanguagePickerForTest({
      viewportPlacement: "down",
      innerHeight: 280,
    });
    preferDown.boundary.getBoundingClientRect = () => ({ top: 0, bottom: 280, left: 0, right: 500 });
    preferDown.trigger.getBoundingClientRect = () => ({
      top: 190, bottom: 238, left: 240, right: 368, width: 128,
    });
    Object.defineProperty(preferDown.menu, "scrollHeight", { value: 180 });
    Object.defineProperty(preferDown.menu, "offsetHeight", { value: 182 });
    Object.defineProperty(preferDown.menu, "clientHeight", { value: 180 });
    preferDown.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(preferDown.picker.classList.contains("open-up"), true);
    assert.ok(parseInt(preferDown.menu.style.top, 10) >= 12);

    const preferUp = loadSharedLanguagePickerForTest({
      viewportPlacement: "up",
      innerHeight: 280,
    });
    preferUp.boundary.getBoundingClientRect = preferDown.boundary.getBoundingClientRect;
    preferUp.trigger.getBoundingClientRect = () => ({
      top: 28, bottom: 76, left: 240, right: 368, width: 128,
    });
    Object.defineProperty(preferUp.menu, "scrollHeight", { value: 180 });
    Object.defineProperty(preferUp.menu, "offsetHeight", { value: 182 });
    Object.defineProperty(preferUp.menu, "clientHeight", { value: 180 });
    preferUp.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(preferUp.picker.classList.contains("open-up"), false);
    assert.ok(parseInt(preferUp.menu.style.top, 10) + parseInt(preferUp.menu.style.maxHeight, 10) <= 268);
  });

  it("cleans fixed-menu geometry and scroll listeners across repeated opens and closes", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: ["none", "cowboy", "party", "wizard", "top", "santa", "pumpkin", "halo"],
      viewportPlacement: "up",
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 250, right: 982 });
    const triggerRect = {
      top: 390, bottom: 438, left: 690, right: 910, width: 220,
    };
    harness.trigger.getBoundingClientRect = () => ({ ...triggerRect });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 310 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 312 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 310 });
    for (let index = 0; index < 5; index += 1) {
      harness.trigger.dispatchEvent({ type: "click" });
      assert.strictEqual(harness.picker.classList.contains("open-up"), true);
      harness.trigger.dispatchEvent({ type: "click" });
      harness.flushTimers();
      assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
      assert.strictEqual(harness.menu.style.top, "");
      assert.strictEqual(harness.menu.style.left, "");
    }

    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual((harness.boundary.eventListeners.scroll || []).length, 1);
    const originalTop = harness.menu.style.top;
    triggerRect.top -= 40;
    triggerRect.bottom -= 40;
    harness.dispatchWindowEvent("resize");
    harness.flushAnimationFrames();
    assert.notStrictEqual(harness.menu.style.top, originalTop);
    harness.boundary.scrollTop = 180;
    assert.strictEqual(harness.getActiveElement(), harness.optionElements[0]);
    harness.boundary.dispatchEvent({ type: "scroll", bubbles: false });
    assert.strictEqual(harness.picker.classList.contains("open"), false);
    assert.strictEqual(harness.getActiveElement(), harness.trigger,
      "scroll-close restores focus when an option owned focus");
    assert.strictEqual(harness.boundary.scrollTop, 180,
      "focus restoration must not change the user's scroll position");
    assert.strictEqual((harness.boundary.eventListeners.scroll || []).length, 0);

    harness.trigger.dispatchEvent({ type: "click" });
    const externalControl = new FakeElement("button");
    harness.body.appendChild(externalControl);
    harness.setActiveElement(externalControl);
    harness.boundary.dispatchEvent({ type: "scroll", bubbles: false });
    assert.strictEqual(harness.getActiveElement(), externalControl,
      "scroll-close does not steal focus from another control");
  });

  it("reveals selected and keyboard-focused options in a scrollable picker", () => {
    const harness = loadSharedLanguagePickerForTest({
      value: "halo",
      options: ["none", "cowboy", "party", "wizard", "top", "santa", "pumpkin", "halo"],
      innerHeight: 260,
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 0, bottom: 260 });
    harness.trigger.getBoundingClientRect = () => ({ top: 126, bottom: 162 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 250 });
    Object.defineProperty(harness.menu, "offsetHeight", {
      get() {
        const maxHeight = parseInt(harness.menu.style.maxHeight, 10);
        return Number.isFinite(maxHeight) ? Math.min(252, maxHeight + 2) : 252;
      },
    });
    Object.defineProperty(harness.menu, "clientHeight", {
      get() {
        const maxHeight = parseInt(harness.menu.style.maxHeight, 10);
        return Number.isFinite(maxHeight) ? Math.min(250, maxHeight) : 250;
      },
    });
    for (const [index, option] of harness.optionElements.entries()) {
      Object.defineProperty(option, "offsetTop", { value: 5 + index * 30 });
      Object.defineProperty(option, "offsetHeight", { value: 30 });
    }
    const first = harness.optionElements[0];
    const selected = harness.optionElements.at(-1);

    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), true);
    assert.strictEqual(harness.menu.style.maxHeight, "120px");
    assert.strictEqual(harness.menu.scrollTop, 125);

    harness.trigger.dispatchEvent({ type: "click" });
    harness.menu.dispatchEvent({ type: "transitionend", propertyName: "opacity" });
    assert.strictEqual(harness.menu.scrollTop, 0, "closed menu clears stale overflow geometry");

    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.menu.scrollTop, 125, "reopening scrolls the current choice back into view");
    assert.strictEqual(selected.focused, true);

    harness.trigger.dispatchEvent({ type: "keydown", key: "Home" });
    assert.strictEqual(harness.menu.scrollTop, 5, "trigger Home reveals the first option");
    harness.trigger.dispatchEvent({ type: "keydown", key: "End" });
    assert.strictEqual(harness.menu.scrollTop, 125, "trigger End reveals the last option");

    selected.dispatchEvent({ type: "keydown", key: "ArrowDown" });
    assert.strictEqual(harness.menu.scrollTop, 5, "wrapped ArrowDown reveals the first option");
    first.dispatchEvent({ type: "keydown", key: "End" });
    assert.strictEqual(harness.menu.scrollTop, 125, "option End reveals the last option");
  });

  it("cancels a stale menu unmount when the picker is reopened quickly", () => {
    const harness = loadSharedLanguagePickerForTest();
    harness.boundary.getBoundingClientRect = () => ({ top: 0, bottom: 600 });
    harness.trigger.getBoundingClientRect = () => ({ top: 200, bottom: 240 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 120 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 122 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 120 });

    harness.trigger.dispatchEvent({ type: "click" });
    harness.trigger.dispatchEvent({ type: "click" });
    harness.menu.scrollTop = 78;
    assert.strictEqual(harness.getPendingTimerCount(), 1);
    assert.strictEqual(harness.menu.eventListeners.transitionend.length, 1);
    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.getPendingTimerCount(), 0);
    assert.strictEqual(harness.menu.eventListeners.transitionend.length, 0);
    assert.strictEqual(harness.menu.scrollTop, 0);

    harness.flushTimers();
    harness.menu.dispatchEvent({ type: "transitionend", propertyName: "opacity" });
    assert.strictEqual(harness.picker.classList.contains("open"), true);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), true);

    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.menu.eventListeners.transitionend.length, 1);
    harness.menu.dispatchEvent({ type: "transitionend", propertyName: "opacity" });
    assert.strictEqual(harness.menu.eventListeners.transitionend.length, 0);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
  });

  it("derives the close fallback from the longest CSS transition", () => {
    const harness = loadSharedLanguagePickerForTest({
      transitionDuration: "0.14s, 320ms",
      transitionDelay: "0s, 30ms",
    });
    harness.trigger.dispatchEvent({ type: "click" });
    harness.trigger.dispatchEvent({ type: "click" });

    assert.deepStrictEqual(harness.getPendingTimerDelays(), [390]);
  });

  it("disposes an animating picker without leaving menu or listener state behind", () => {
    const harness = loadSharedLanguagePickerForTest();
    harness.trigger.dispatchEvent({ type: "click" });
    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.getPendingTimerCount(), 1);

    harness.control.dispose();

    assert.strictEqual(harness.getPendingTimerCount(), 0);
    assert.strictEqual(harness.picker.classList.contains("open"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
    assert.strictEqual(harness.picker.classList.contains("open-up"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.getDocumentListenerCount("click"), 0);
    assert.strictEqual(harness.getDocumentListenerCount("keydown"), 0);
    assert.strictEqual(harness.getWindowListenerCount("resize"), 0);
  });

  it("cleans up language picker document listeners across re-renders", () => {
    const harness = loadGeneralLanguageRowForTest({
      snapshot: { lang: "en" },
    });

    harness.core.ops.requestRender({ content: true });
    const staleOption = harness.getLangOptions()[1];
    assert.strictEqual(harness.getDocumentListenerCount("click"), 1);
    assert.strictEqual(harness.getDocumentListenerCount("keydown"), 1);

    harness.core.ops.requestRender({ content: true });
    assert.strictEqual(harness.getDocumentListenerCount("click"), 1);
    assert.strictEqual(harness.getDocumentListenerCount("keydown"), 1);
    assert.strictEqual(harness.core.state.mountedControls.settingsSelects.size, 1);

    staleOption.dispatchEvent({ type: "click" });
    assert.deepStrictEqual(harness.updateCalls, []);
  });

  it("closes the language picker from outside clicks and Escape", () => {
    const harness = loadGeneralLanguageRowForTest({
      snapshot: { lang: "en" },
    });

    harness.core.ops.requestRender({ content: true });
    harness.getLangTrigger().dispatchEvent({ type: "click" });
    assert.strictEqual(harness.getLangPicker().classList.contains("open"), true);

    harness.dispatchDocumentEvent("click", { target: new FakeElement("body") });
    assert.strictEqual(harness.getLangPicker().classList.contains("open"), false);
    assert.strictEqual(harness.getLangPicker().classList.contains("menu-mounted"), false);

    harness.getLangTrigger().dispatchEvent({ type: "click" });
    harness.dispatchDocumentEvent("keydown", {
      key: "Escape",
      preventDefault() { this.defaultPrevented = true; },
    });
    assert.strictEqual(harness.getLangPicker().classList.contains("open"), false);
    assert.strictEqual(harness.getLangPicker().classList.contains("menu-mounted"), false);
  });

  it("fully unmounts a shared picker when it becomes disabled", () => {
    const harness = loadSharedLanguagePickerForTest();
    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), true);

    harness.control.setDisabled(true);
    harness.menu.dispatchEvent({ type: "transitionend", propertyName: "opacity" });

    assert.strictEqual(harness.picker.classList.contains("open"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
    assert.strictEqual(harness.picker.classList.contains("open-up"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.menu.style.maxHeight, "");
  });

  it("lays out idle behavior choices at full width and hides inactive detail rows", () => {
    const css = fs.readFileSync(path.join(SRC_DIR, "settings.css"), "utf8").replace(/\r\n/g, "\n");
    assert.match(css, /\.idle-behavior-group \.row\[hidden\]\s*\{\s*display: none;/);
    assert.match(css, /\.idle-behavior-mode-segmented\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.idle-behavior-group \.settings-segmented-radio\s*\{\s*width: 100%/);
    assert.match(css, /\.idle-behavior-group \.settings-segmented-radio button\s*\{[^}]*white-space: normal/);
  });

  it("adds hover affordance to General sliders via the shared volume-style classes", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(/\.volume-slider:hover::-webkit-slider-thumb\s*\{[\s\S]*transform:\s*scale\(1\.08\);/.test(css));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.volume-slider:hover::-webkit-slider-thumb,[\s\S]*\.size-control\.dragging \.volume-slider::-webkit-slider-thumb\s*\{[\s\S]*transform:\s*none;/.test(css));
  });

  it("stacks wide notification controls from their zoom-corrected section width", () => {
    const notificationsSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-notifications.js"), "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(notificationsSource.includes('row.className = "row volume-slider-row"'));
    assert.match(css, /\.sound-section \.section-rows,\s*\.quota-ring-section \.section-rows\s*\{\s*container-type:\s*inline-size;/s);
    assert.match(css, /@container \(max-width:\s*400px\)\s*\{[\s\S]*\.quota-ring-display-mode-row,[\s\S]*\.volume-slider-row\s*\{[\s\S]*flex-direction:\s*column;/);
    assert.match(css, /@container \(max-width:\s*400px\)\s*\{[\s\S]*\.quota-alert-thresholds-row,[\s\S]*flex-direction:\s*column;/);
    assert.match(css, /@container \(max-width:\s*400px\)\s*\{[\s\S]*\.volume-slider-row \.volume-control\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
  });

  it("describes notification bubble seconds as an auto-close upper bound instead of a guaranteed visible duration", () => {
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");

    assert.ok(i18nSource.includes("auto-close upper bound"));
    assert.ok(i18nSource.includes("later session states may dismiss it earlier"));
    assert.ok(i18nSource.includes("自动关闭上限"));
    assert.ok(i18nSource.includes("后续状态可能提前关闭"));
    assert.ok(i18nSource.includes("자동 종료 상한"));
    assert.ok(i18nSource.includes("후속 상태가 더 일찍 닫을 수 있습니다"));
  });

  it("clears successful switch transient state so rerenders do not keep wait cursors", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(
      /clearTransientState\(seq\);\s*control\.setState\(\{\s*checked:\s*nextVisual,\s*pending:\s*false\s*\}\);/.test(coreSource),
      "successful switch actions must delete transient pending state before any later rerender"
    );
    assert.ok(
      !coreSource.includes("setTransientState({ visualOn: nextVisual, pending: false, seq });"),
      "leaving a non-pending transient row lets rerendered controls inherit stale pending state"
    );
  });

  it("clears settings-broadcast transient state before patching or rerendering", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(coreSource.includes("function clearTransientStateForChanges(changes)"));
    assert.ok(coreSource.includes("state.transientUiState.generalSwitches.delete(key);"));
    assert.ok(coreSource.includes('Object.prototype.hasOwnProperty.call(changes, "agents")'));
    assert.ok(coreSource.includes("state.transientUiState.agentSwitches.clear();"));
    const clearIndex = coreSource.indexOf("clearTransientStateForChanges(changes);");
    const patchIndex = coreSource.indexOf("activeTab.patchInPlace(changes");
    const renderIndex = coreSource.indexOf("requestRender({", patchIndex);
    assert.notStrictEqual(clearIndex, -1);
    assert.notStrictEqual(patchIndex, -1);
    assert.notStrictEqual(renderIndex, -1);
    assert.ok(clearIndex < patchIndex, "broadcast cleanup must happen before in-place patching");
    assert.ok(clearIndex < renderIndex, "broadcast cleanup must happen before full rerender");
  });

  it("keeps macOS entry-point switches behind the Settings controller boundary", () => {
    const generalSource = fs.readFileSync(SETTINGS_TAB_GENERAL, "utf8");
    for (const forbidden of [
      /require\(["']electron["']\)/,
      /\bapp\.dock\b/,
      /\bcreateTray\s*\(/,
      /\bdestroyTray\s*\(/,
      /clawd-prefs\.json/,
      /\bfs\.(?:writeFile|writeFileSync|promises\.writeFile)\b/,
    ]) {
      assert.doesNotMatch(generalSource, forbidden);
    }
  });

  it("uses a roomier grid layout for Settings confirmation buttons", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(/\.settings-confirm-modal\s*\{[\s\S]*width:\s*min\(480px,\s*100%\);/.test(css));
    assert.ok(/\.settings-confirm-actions\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(136px,\s*1fr\)\);[\s\S]*gap:\s*9px;/.test(css));
    assert.ok(/\.settings-confirm-actions\s+\.soft-btn\s*\{[\s\S]*min-height:\s*42px;[\s\S]*padding:\s*6px 10px;[\s\S]*white-space:\s*normal;[\s\S]*text-align:\s*center;/.test(css));
    assert.ok(coreSource.includes('createElementNS("http://www.w3.org/2000/svg", tagName)'));
    assert.ok(coreSource.includes('path.setAttribute("d", "M10 4.2v7.4m0 3.1v.1")'));
    assert.ok(coreSource.includes('String(iconText) === "!"'));
    assert.ok(/\.settings-confirm-icon\s*\{[\s\S]*background:\s*var\(--warning-action\);/.test(css));
    assert.ok(/\.settings-confirm-icon path\s*\{[\s\S]*stroke:\s*currentColor;[\s\S]*stroke-linecap:\s*round;/.test(css));
    assert.ok(/\.settings-confirm-actions\s+\.soft-btn\.settings-confirm-danger\s*\{[\s\S]*color:\s*#ffffff;[\s\S]*background:\s*var\(--danger-action\);[\s\S]*border-color:\s*var\(--danger-action\);/.test(css));
    assert.ok(/\.settings-confirm-checkbox\s*\{[\s\S]*padding:\s*10px 11px;[\s\S]*border-radius:\s*9px;[\s\S]*cursor:\s*pointer;/.test(css));
    assert.ok(/\.settings-confirm-checkbox input:checked\s*\{[\s\S]*background:\s*var\(--accent\);/.test(css));
    assert.ok(css.includes(".settings-confirm-checkbox:has(input:checked)"));
    assert.ok(css.includes(".settings-confirm-checkbox:focus-within"));
  });

  it("provides a persisted collapsible Settings group helper with smart default collapse", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    assert.ok(coreSource.includes("COLLAPSED_GROUPS_STORAGE_KEY"));
    assert.ok(coreSource.includes("function buildCollapsibleGroup("));
    assert.ok(coreSource.includes("localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY)"));
    assert.ok(coreSource.includes("localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY"));
    assert.ok(coreSource.includes("defaultCollapsed = false"));
    assert.ok(coreSource.includes('trigger.setAttribute("aria-expanded"'));
    assert.ok(coreSource.includes("function attachSettingsDisclosure("));
    assert.ok(coreSource.includes("collapsibleSummary"));
    assert.ok(coreSource.includes("function createDisclosureChevron("));
    assert.ok(coreSource.includes('createDisclosureChevron("collapsible-group-chevron")'));
    assert.ok(coreSource.includes('svg.setAttribute("viewBox", "0 0 20 20")'));
    assert.ok(coreSource.includes('path.setAttribute("d", "M8 5l5 5-5 5")'));
    assert.ok(!coreSource.includes('chevron.textContent = "\\u25B8";'));
    assert.ok(!coreSource.includes("chevron.innerHTML"));
    assert.ok(/\.collapsible-group-header\s*\{[\s\S]*gap:\s*4px;/.test(css));
    assert.ok(/\.collapsible-group-chevron,\s*\.anim-override-chevron\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;[\s\S]*opacity:\s*0\.72;/.test(css));
    assert.ok(/\.collapsible-group-chevron,\s*\.anim-override-chevron\s*\{[\s\S]*transform:\s*translateX\(-6px\) rotate\(0deg\);[\s\S]*transform var\(--settings-disclosure-duration\) var\(--settings-disclosure-easing\)/.test(css));
    assert.ok(/\.collapsible-group-chevron svg,\s*\.anim-override-chevron svg\s*\{[\s\S]*width:\s*16px;[\s\S]*height:\s*16px;[\s\S]*overflow:\s*visible;/.test(css));
    assert.ok(/\.collapsible-group-chevron path,\s*\.anim-override-chevron path\s*\{[\s\S]*fill:\s*none;[\s\S]*stroke:\s*currentColor;[\s\S]*stroke-width:\s*2\.2;[\s\S]*stroke-linecap:\s*round;[\s\S]*stroke-linejoin:\s*round;/.test(css));
    assert.ok(/\.collapsible-group-header:hover\s+\.collapsible-group-chevron\s*\{[\s\S]*color:\s*var\(--text-secondary\);[\s\S]*opacity:\s*0\.95;/.test(css));
    // Child selectors, not descendant: nested groups (Feishu event-sub guide
    // inside the channel card) must not inherit the outer group's chevron state.
    assert.ok(/\.collapsible-group\.collapsed\s*>\s*\.collapsible-group-header\s*>\s*\.collapsible-group-chevron\s*\{[\s\S]*transform:\s*translateX\(-6px\) rotate\(0deg\);/.test(css));
    assert.ok(/\.collapsible-group:not\(\.collapsed\)\s*>\s*\.collapsible-group-header\s*>\s*\.collapsible-group-chevron\s*\{[\s\S]*transform:\s*translateX\(-6px\) rotate\(90deg\);[\s\S]*color:\s*var\(--accent\);[\s\S]*opacity:\s*1;/.test(css));
    assert.ok(!/\.collapsible-group\.collapsed\s+\.collapsible-group-chevron/.test(css), "descendant chevron selector would leak outer state into nested groups");
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.collapsible-group-chevron,[\s\S]*\.anim-override-chevron,[\s\S]*transition:\s*none;/.test(css));
    assert.ok(i18nSource.includes("collapsibleExpand"));
    assert.ok(i18nSource.includes("collapsibleCollapse"));
  });

  it("supports non-persisting expand without changing stored collapse state", () => {
    const collapsedGroupsKey = "clawd.settings.collapsedGroups.v1";
    const originalStoredState = {
      "remote-approval.feishu.api-explorer": true,
      "unrelated-group": false,
    };
    let storedRaw = JSON.stringify(originalStoredState);
    const storageWrites = [];
    const localStorage = {
      getItem: (key) => key === collapsedGroupsKey ? storedRaw : null,
      setItem: (key, value) => {
        storageWrites.push({ key, value: String(value) });
        storedRaw = String(value);
      },
    };
    const documentBody = new FakeElement("body");
    const content = new FakeElement("main");
    content.id = "content";
    documentBody.appendChild(content);
    const document = {
      body: documentBody,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: (id) => id === "content" ? content : null,
    };
    const raf = createQueuedRaf();
    const core = loadSettingsCoreForTest({}, {
      document,
      localStorage,
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    const buildGroup = () => {
      const group = core.helpers.buildCollapsibleGroup({
        id: "remote-approval.feishu.api-explorer",
        title: "API Explorer",
        defaultCollapsed: false,
        children: [document.createElement("div")],
      });
      content.appendChild(group);
      return group;
    };

    const group = buildGroup();
    const header = group.querySelector(".collapsible-group-header");
    const body = group.querySelector(".collapsible-group-body");
    assert.equal(group.classList.contains("collapsed"), true);
    assert.equal(header.getAttribute("aria-expanded"), "false");
    assert.equal(body.getAttribute("aria-hidden"), "true");
    assert.equal(body.inert, true);

    const originalRaw = storedRaw;
    group.expand({ persist: false, animate: false });
    assert.equal(group.classList.contains("collapsed"), false);
    assert.equal(group.classList.contains("expanding"), false);
    assert.equal(header.getAttribute("aria-expanded"), "true");
    assert.equal(body.getAttribute("aria-hidden"), "false");
    assert.equal(body.inert, false);
    assert.equal(storedRaw, originalRaw);
    assert.deepStrictEqual(JSON.parse(storedRaw), originalStoredState);
    assert.equal(storageWrites.length, 0);
    raf.flush();

    group.remove();
    const freshGroup = buildGroup();
    const freshHeader = freshGroup.querySelector(".collapsible-group-header");
    const freshBody = freshGroup.querySelector(".collapsible-group-body");
    assert.equal(freshGroup.classList.contains("collapsed"), true);
    assert.equal(freshHeader.getAttribute("aria-expanded"), "false");
    assert.equal(freshBody.getAttribute("aria-hidden"), "true");
    assert.equal(freshBody.inert, true);

    freshHeader.click();
    assert.equal(freshGroup.classList.contains("collapsed"), false);
    assert.equal(freshGroup.classList.contains("expanding"), true);
    assert.equal(freshHeader.getAttribute("aria-expanded"), "true");
    assert.equal(freshBody.getAttribute("aria-hidden"), "false");
    assert.equal(freshBody.inert, true);
    assert.equal(storageWrites.length, 1);
    assert.equal(storageWrites[0].key, collapsedGroupsKey);
    assert.deepStrictEqual(JSON.parse(storageWrites[0].value), {
      "remote-approval.feishu.api-explorer": false,
      "unrelated-group": false,
    });

    freshHeader.click();
    assert.equal(freshGroup.classList.contains("collapsed"), true);
    assert.equal(freshGroup.classList.contains("collapsing"), true);
    assert.equal(freshBody.getAttribute("aria-hidden"), "true");
    assert.equal(freshBody.inert, true);
    freshHeader.click();
    assert.equal(freshGroup.classList.contains("collapsed"), false);
    assert.equal(freshGroup.classList.contains("expanding"), true);
    freshBody.dispatchEvent({
      type: "transitioncancel",
      propertyName: "grid-template-rows",
      bubbles: false,
    });
    assert.equal(freshGroup.classList.contains("expanding"), true);
    assert.equal(freshGroup.classList.contains("collapsing"), false);
    assert.equal(freshBody.getAttribute("aria-hidden"), "false");
    assert.equal(freshBody.inert, true);
    freshBody.dispatchEvent({
      type: "transitionend",
      propertyName: "grid-template-rows",
      bubbles: false,
    });
    assert.equal(freshGroup.classList.contains("expanding"), false);
    assert.equal(freshBody.inert, false);

    freshHeader.dispatchEvent({ type: "keydown", key: "Enter" });
    assert.equal(freshHeader.getAttribute("aria-expanded"), "false");
    assert.equal(freshBody.getAttribute("aria-hidden"), "true");
    assert.equal(freshBody.inert, true);
    assert.equal(storageWrites.length, 4);
    assert.deepStrictEqual(JSON.parse(storageWrites[3].value), {
      "remote-approval.feishu.api-explorer": true,
      "unrelated-group": false,
    });

    freshHeader.dispatchEvent({ type: "keydown", key: " " });
    assert.equal(freshHeader.getAttribute("aria-expanded"), "true");
    assert.equal(freshBody.getAttribute("aria-hidden"), "false");
    assert.equal(freshBody.inert, true);
    assert.equal(storageWrites.length, 5);
    assert.deepStrictEqual(JSON.parse(storageWrites[4].value), {
      "remote-approval.feishu.api-explorer": false,
      "unrelated-group": false,
    });
    freshBody.dispatchEvent({
      type: "transitionend",
      propertyName: "grid-template-rows",
      bubbles: false,
    });
    assert.equal(freshBody.inert, false);
  });

  it("uses one disclosure controller for specialized Settings surfaces", () => {
    const documentBody = new FakeElement("body");
    const document = {
      body: documentBody,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const raf = createQueuedRaf();
    const core = loadSettingsCoreForTest({}, {
      document,
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    const root = document.createElement("div");
    const trigger = document.createElement("div");
    const body = document.createElement("div");
    const inner = document.createElement("div");
    inner.className = "settings-disclosure-body-inner";
    body.appendChild(inner);
    root.appendChild(trigger);
    root.appendChild(body);
    documentBody.appendChild(root);
    const changes = [];
    const controller = core.helpers.attachSettingsDisclosure({
      root,
      trigger,
      body,
      expanded: false,
      onExpandedChange(nextExpanded, options) {
        changes.push({ nextExpanded, persist: options.persist });
      },
    });

    assert.equal(trigger.getAttribute("role"), "button");
    assert.equal(trigger.getAttribute("tabindex"), "0");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(trigger.getAttribute("aria-controls"), body.getAttribute("id"));
    assert.equal(body.getAttribute("aria-hidden"), "true");
    assert.equal(body.inert, true);

    trigger.dispatchEvent({ type: "keydown", key: "Enter" });
    assert.equal(controller.expanded, true);
    assert.equal(root.classList.contains("expanding"), true);
    assert.equal(body.getAttribute("aria-hidden"), "false");
    assert.equal(body.inert, true);
    trigger.click();
    trigger.click();
    trigger.click();
    trigger.click();
    assert.equal(controller.expanded, true, "five total toggles must end expanded");
    body.dispatchEvent({ type: "transitioncancel", propertyName: "grid-template-rows", bubbles: false });
    assert.equal(root.classList.contains("expanding"), true);
    assert.equal(root.classList.contains("collapsing"), false);
    assert.equal(body.inert, true);
    body.dispatchEvent({ type: "transitionend", propertyName: "grid-template-rows", bubbles: false });
    assert.equal(root.classList.contains("expanding"), false);
    assert.equal(root.classList.contains("collapsing"), false);
    assert.equal(body.inert, false);

    controller.collapse({ animate: false, persist: false });
    assert.equal(root.classList.contains("settings-disclosure-no-motion"), true);
    assert.deepStrictEqual(changes.at(-1), { nextExpanded: false, persist: false });
    raf.flush();
    assert.equal(root.classList.contains("settings-disclosure-no-motion"), false);
    controller.dispose();
    trigger.click();
    assert.equal(controller.expanded, false, "disposed triggers must not keep toggling");

    const reducedCore = loadSettingsCoreForTest({}, {
      document,
      matchMedia: () => ({ matches: true }),
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    const reducedRoot = document.createElement("div");
    const reducedTrigger = document.createElement("div");
    const reducedBody = document.createElement("div");
    const reducedInner = document.createElement("div");
    reducedInner.className = "settings-disclosure-body-inner";
    reducedBody.appendChild(reducedInner);
    reducedRoot.appendChild(reducedTrigger);
    reducedRoot.appendChild(reducedBody);
    const reducedController = reducedCore.helpers.attachSettingsDisclosure({
      root: reducedRoot,
      trigger: reducedTrigger,
      body: reducedBody,
      expanded: false,
    });
    reducedTrigger.click();
    assert.equal(reducedController.expanded, true);
    assert.equal(reducedRoot.classList.contains("expanding"), false);
    assert.equal(reducedRoot.classList.contains("settings-disclosure-no-motion"), false);
    reducedController.dispose();
  });

  it("routes every Settings disclosure implementation through the shared controller", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const doctorSource = fs.readFileSync(SETTINGS_DOCTOR_MODAL, "utf8");
    const animSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8");
    assert.ok(coreSource.includes("const controller = attachSettingsDisclosure({"));
    assert.ok(doctorSource.includes("core.helpers.attachSettingsDisclosure({"));
    assert.ok(animSource.includes("helpers.attachSettingsDisclosure({"));
    const rendererSources = fs.readdirSync(SRC_DIR)
      .filter((name) => /^settings(?:-.+)?\.js$/.test(name) || name === "settings.html")
      .map((name) => ({ name, source: fs.readFileSync(path.join(SRC_DIR, name), "utf8") }));
    for (const { name, source } of rendererSources) {
      assert.ok(!/createElement\(\s*["']details["']\s*\)/.test(source), `${name} must not create native details`);
      assert.ok(!/<details(?:\s|>)/i.test(source), `${name} must not render native details markup`);
      assert.ok(!/addEventListener\(\s*["']toggle["']/.test(source), `${name} must not own a disclosure toggle state machine`);
    }
    assert.ok(doctorSource.indexOf("disposeDoctorDisclosures();") < doctorSource.indexOf("rootEl.innerHTML = ("));
    assert.ok(/function closeModal\(\) \{\s*disposeDoctorDisclosures\(\);/.test(doctorSource));
  });

  it("keeps a local theme in the user section when the confirmed catalog never listed its id", () => {
    const { content } = loadThemeTabForTest({
      themes: [
        { id: "clawd", name: "Clawd", builtin: true, active: true },
        { id: "hash-sage", name: "My Local Sage", builtin: false, active: false },
      ],
      officialThemes: [
        { id: "whale-chan", name: "Whale-chan", officialTheme: true, active: false, officialThemeState: "available" },
      ],
      officialCatalogStatus: "ok",
    });

    const sections = content.querySelectorAll(".theme-section");
    const userSection = sections.find(
      (section) => section.querySelector(".theme-section-title").textContent === "User Themes"
    );
    assert.ok(userSection, "the local theme must stay in the user section");
    assert.strictEqual(userSection.querySelectorAll(".theme-card").length, 1);
    assert.ok(collectText(userSection.querySelector(".theme-card")).includes("My Local Sage"));
    assert.strictEqual(userSection.querySelector(".theme-card-footer-official"), null);
  });

  it("returns a stale official local theme to the user section once the catalog drops its id", async () => {
    const { content, commands } = loadThemeTabForTest({
      themes: [
        { id: "clawd", name: "Clawd", builtin: true, active: true },
        {
          id: "hash-sage",
          name: "My Local Sage",
          builtin: false,
          active: false,
          // Decoration left behind by the catalog version that still listed this id.
          officialTheme: true,
          officialThemeState: "conflict",
          officialThemeConflict: true,
          officialThemeCanUninstall: false,
        },
      ],
      officialThemes: [
        { id: "whale-chan", name: "Whale-chan", officialTheme: true, active: false, officialThemeState: "available" },
      ],
      officialCatalogStatus: "ok",
    });

    const sections = content.querySelectorAll(".theme-section");
    const userSection = sections.find(
      (section) => section.querySelector(".theme-section-title").textContent === "User Themes"
    );
    assert.ok(userSection, "the withdrawn local theme must return to the user section");
    const cards = userSection.querySelectorAll(".theme-card");
    assert.strictEqual(cards.length, 1);
    assert.ok(collectText(cards[0]).includes("My Local Sage"));
    assert.strictEqual(cards[0].querySelector(".theme-card-footer-official"), null);
    assert.ok(cards[0].querySelector(".theme-delete-btn"), "plain user themes offer delete");

    cards[0].dispatchEvent({ type: "click" });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(commands)),
      [{ name: "setThemeSelection", payload: { themeId: "hash-sage" } }],
    );
  });

  it("keeps customization visible on every capable pet while omitting Calico", () => {
    const supported = loadThemeTabForTest({
      themes: [
        {
          id: "clawd",
          name: "Clawd",
          builtin: true,
          active: true,
          capabilities: { petTint: true },
        },
        {
          id: "calico",
          name: "Calico",
          builtin: true,
          active: false,
          capabilities: { petTint: false, accessories: false },
        },
        {
          id: "cloudling",
          name: "Cloudling",
          builtin: true,
          active: false,
          capabilities: { petTint: false, accessories: true },
        },
      ],
    });
    const buttons = supported.content.querySelectorAll(".theme-customize-btn");
    assert.strictEqual(buttons.length, 2);
    assert.deepStrictEqual(
      buttons.map((button) => collectText(findAncestorByClass(button, "theme-card")))
        .map((text) => (text.includes("Cloudling") ? "Cloudling" : "Clawd"))
        .sort(),
      ["Clawd", "Cloudling"]
    );

    const calicoActive = loadThemeTabForTest({
      themes: [
        {
          id: "calico",
          name: "Calico",
          builtin: true,
          active: true,
          capabilities: { petTint: false, accessories: false },
        },
      ],
    });
    assert.strictEqual(calicoActive.content.querySelectorAll(".theme-customize-btn").length, 0);
    assert.strictEqual(calicoActive.content.querySelector(".theme-detail-hero"), null);
  });

  it("selects an inactive capable pet and opens its customization in one click", async () => {
    let listThemesCalls = 0;
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "clawd",
          name: "Clawd",
          builtin: true,
          active: true,
          capabilities: { petTint: true },
        },
        {
          id: "cloudling",
          name: "Cloudling",
          builtin: true,
          active: false,
          capabilities: { petTint: false, accessories: true },
        },
      ],
      settingsAPI: {
        listThemes: () => {
          listThemesCalls += 1;
          return Promise.reject(new Error("theme enumeration unavailable"));
        },
      },
    });
    const cloudlingButton = harness.content.querySelectorAll(".theme-customize-btn")
      .find((button) => collectText(findAncestorByClass(button, "theme-card")).includes("Cloudling"));
    assert.ok(cloudlingButton);

    harness.content.scrollTop = 211;
    cloudlingButton.focus();
    cloudlingButton.dispatchEvent({ type: "click" });
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.commands)),
      [{
        name: "setThemeSelection",
        payload: { themeId: "cloudling" },
      }]
    );
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(harness.content.querySelector(".theme-detail-hero"));
    assert.ok(collectText(harness.content.querySelector(".theme-detail-heading")).includes("Cloudling"));
    assert.ok(harness.content.querySelector(".pet-accessory-select"));
    assert.strictEqual(harness.content.querySelector(".pet-tint-select"), null);
    assert.strictEqual(harness.content.querySelector(".theme-grid"), null);
    assert.strictEqual(harness.content.scrollTop, 0);
    assert.strictEqual(harness.core.state.activeTab, "theme");
    assert.strictEqual(harness.content.querySelector(".theme-detail-back").focused, true);
    assert.strictEqual(listThemesCalls, 0, "opening details should not depend on a second theme fetch");

    harness.content.querySelector(".theme-detail-back").dispatchEvent({ type: "click" });
    const restoredCloudlingButton = harness.content.querySelectorAll(".theme-customize-btn")
      .find((button) => collectText(findAncestorByClass(button, "theme-card")).includes("Cloudling"));
    assert.strictEqual(harness.content.scrollTop, 211);
    assert.strictEqual(restoredCloudlingButton.focused, true);
    assert.strictEqual(restoredCloudlingButton.focusOptions.preventScroll, true);
  });

  it("does not open stale customization when the activated runtime disables it", async () => {
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "clawd",
          name: "Clawd",
          builtin: true,
          active: true,
          capabilities: { petTint: true, accessories: true, mouthAccessories: true },
        },
        {
          id: "custom",
          name: "Custom",
          builtin: false,
          active: false,
          capabilities: { petTint: false, accessories: true },
        },
      ],
      settingsAPI: {
        command: () => Promise.resolve({
          status: "ok",
          customizationCapabilities: { petTint: false, accessories: false },
        }),
      },
    });
    const customButton = harness.content.querySelectorAll(".theme-customize-btn")[1];
    assert.ok(customButton);

    customButton.dispatchEvent({ type: "click" });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(harness.content.querySelector(".theme-detail-hero"), null);
    assert.strictEqual(harness.content.querySelector(".pet-accessory-select"), null);
    const runtimeCustom = harness.core.runtime.themeList
      .find((theme) => theme && theme.id === "custom");
    assert.strictEqual(runtimeCustom.active, true);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(runtimeCustom.capabilities)),
      { petTint: false, accessories: false }
    );
    const activeCustomCard = harness.content.querySelectorAll(".theme-card")
      .find((card) => {
        const name = card.querySelector(".theme-card-name");
        return name && collectText(name).includes("Custom");
      });
    assert.strictEqual(activeCustomCard.getAttribute("aria-checked"), "true");
  });

  it("updates customization capability after normal theme-card activation", async () => {
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "clawd",
          name: "Clawd",
          builtin: true,
          active: true,
          capabilities: { petTint: true, accessories: true, mouthAccessories: true },
        },
        {
          id: "custom",
          name: "Custom",
          builtin: false,
          active: false,
          capabilities: { petTint: false, accessories: false },
        },
      ],
      settingsAPI: {
        command: () => Promise.resolve({
          status: "ok",
          customizationCapabilities: { petTint: false, accessories: true },
        }),
      },
    });
    const customCard = harness.content.querySelectorAll(".theme-card")
      .find((card) => {
        const name = card.querySelector(".theme-card-name");
        return name && collectText(name).includes("Custom");
      });
    assert.ok(customCard);
    assert.strictEqual(customCard.querySelector(".theme-customize-btn"), null);

    customCard.dispatchEvent({ type: "click" });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    const activeCustom = harness.core.runtime.themeList
      .find((theme) => theme && theme.id === "custom");
    assert.strictEqual(activeCustom.active, true);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(activeCustom.capabilities)),
      { petTint: false, accessories: true }
    );
    const rerenderedCard = harness.content.querySelectorAll(".theme-card")
      .find((card) => {
        const name = card.querySelector(".theme-card-name");
        return name && collectText(name).includes("Custom");
      });
    assert.ok(rerenderedCard.querySelector(".theme-customize-btn"));
  });

  it("keeps existing theme cards when a refresh returns an impossible empty list", async () => {
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "clawd",
          name: "Clawd",
          builtin: true,
          active: true,
          capabilities: { petTint: true },
        },
      ],
      settingsAPI: {
        // settings:list-themes reports [] when main catches an enumeration
        // failure, even though a healthy install always has built-in themes.
        listThemes: () => Promise.resolve([]),
      },
    });
    const previousThemeList = harness.core.runtime.themeList;

    const result = await harness.core.ops.fetchThemes();
    harness.renderContent();

    assert.strictEqual(result, previousThemeList);
    assert.strictEqual(harness.core.runtime.themeList, previousThemeList);
    assert.strictEqual(harness.content.querySelectorAll(".theme-card").length, 1);
  });

  it("does not let a pending official catalog block the local theme first paint", async () => {
    let resolveOfficial;
    const officialPending = new Promise((resolve) => { resolveOfficial = resolve; });
    const localThemes = [{ id: "clawd", name: "Clawd", builtin: true, active: true }];
    const harness = loadThemeTabForTest({
      themes: localThemes,
      settingsAPI: {
        listThemes: () => Promise.resolve(localThemes),
        listOfficialThemes: () => officialPending,
      },
    });

    let settled = false;
    let result = null;
    harness.core.ops.fetchThemes().then((themes) => {
      settled = true;
      result = themes;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(settled, true);
    assert.deepStrictEqual(result, localThemes);

    resolveOfficial({ status: "ok", catalogStatus: "ok", catalogVersion: 1, themes: [] });
    await Promise.resolve();
    await Promise.resolve();
  });

  it("opens the active pet detail and saves color independently for that theme", async () => {
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "clawd",
          name: "Clawd",
          builtin: true,
          active: true,
          previewFileUrl: "file:///clawd.svg",
          capabilities: { petTint: true, accessories: true, mouthAccessories: true },
        },
      ],
      snapshot: {
        petTint: { clawd: "matcha", cloudling: "vaporwave" },
        petAccessory: { clawd: "wizard-hat", cloudling: "halo" },
        petMouthAccessory: { clawd: "cigarette" },
        holidayAccessoryEnabled: {},
      },
      petTintOptions: [
        { id: "none", labelKey: "tintNone" },
        { id: "midnight", labelKey: "tintMidnight" },
        { id: "gold", labelKey: "tintGold" },
        { id: "vaporwave", labelKey: "tintVaporwave" },
        { id: "matcha", labelKey: "tintMatcha" },
        { id: "mono", labelKey: "tintMono" },
      ],
      petAccessoryOptions: [
        { id: "none", labelKey: "accessoryNone" },
        { id: "cowboy-hat", labelKey: "accessoryCowboyHat" },
        { id: "wizard-hat", labelKey: "accessoryWizardHat" },
        { id: "halo", labelKey: "accessoryHalo" },
      ],
      petMouthAccessoryOptions: [
        { id: "none", labelKey: "accessoryNone" },
        { id: "cigarette", labelKey: "accessoryCigarette" },
      ],
    });

    harness.content.scrollTop = 173;
    const customizeButton = harness.content.querySelector(".theme-customize-btn");
    customizeButton.focus();
    customizeButton.dispatchEvent({ type: "click" });
    assert.ok(harness.content.querySelector(".theme-detail-back"));
    assert.ok(harness.content.querySelector(".theme-detail-hero"));
    assert.strictEqual(harness.content.querySelectorAll(".theme-customization-row").length, 4);
    assert.strictEqual(harness.content.querySelector(".theme-grid"), null);
    assert.strictEqual(harness.content.scrollTop, 0);
    assert.strictEqual(harness.content.querySelector(".theme-detail-back").focused, true);
    assert.strictEqual(harness.content.querySelector(".theme-detail-back").focusOptions.preventScroll, true);

    const select = harness.content.querySelector(".pet-tint-select");
    assert.strictEqual(select.classList.contains("viewport-fixed"), true);
    assert.strictEqual(getSelectedPickerValue(select), "matcha");
    assert.deepStrictEqual(
      select.querySelectorAll(".language-picker-option").map((option) => option.textContent),
      ["Default", "🌙 Midnight", "🥇 Gold", "🌸 Vaporwave", "🍵 Matcha", "⬜ Monochrome"]
    );

    choosePickerOption(select, "gold");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.updates)),
      [{
        key: "petTint",
        value: { clawd: "gold", cloudling: "vaporwave" },
      }]
    );
    assert.strictEqual(select.querySelector(".language-picker-trigger").disabled, false);
    assert.strictEqual(select.querySelector(".language-picker-trigger").getAttribute("aria-disabled"), "true");
    assert.strictEqual(select.classList.contains("pending"), true);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(select.querySelector(".language-picker-trigger").disabled, false);
    assert.strictEqual(select.querySelector(".language-picker-trigger").getAttribute("aria-disabled"), "false");
    assert.strictEqual(select.classList.contains("pending"), false);

    const accessorySelect = harness.content.querySelector(".pet-accessory-select");
    assert.strictEqual(accessorySelect.classList.contains("viewport-fixed"), true);
    assert.strictEqual(getSelectedPickerValue(accessorySelect), "wizard-hat");
    assert.deepStrictEqual(
      accessorySelect.querySelectorAll(".language-picker-option").map((option) => option.textContent),
      ["None", "Cowboy hat", "Wizard hat", "Halo"]
    );
    choosePickerOption(accessorySelect, "halo");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.updates[1])),
      {
        key: "petAccessory",
        value: { clawd: "halo", cloudling: "halo" },
      }
    );
    assert.strictEqual(accessorySelect.querySelector(".language-picker-trigger").disabled, false);
    assert.strictEqual(accessorySelect.querySelector(".language-picker-trigger").getAttribute("aria-disabled"), "true");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(accessorySelect.querySelector(".language-picker-trigger").disabled, false);
    assert.strictEqual(accessorySelect.querySelector(".language-picker-trigger").getAttribute("aria-disabled"), "false");

    const mouthAccessorySelect = harness.content.querySelector(".pet-mouth-accessory-select");
    assert.strictEqual(getSelectedPickerValue(mouthAccessorySelect), "cigarette");
    assert.deepStrictEqual(
      mouthAccessorySelect.querySelectorAll(".language-picker-option").map((option) => option.textContent),
      ["None", "Cigarette"]
    );
    choosePickerOption(mouthAccessorySelect, "none");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.updates[2])),
      { key: "petMouthAccessory", value: {} }
    );
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    const holidaySwitch = harness.content.querySelector(".holiday-accessory-switch");
    assert.ok(holidaySwitch);
    assert.strictEqual(holidaySwitch.getAttribute("role"), "switch");
    assert.strictEqual(holidaySwitch.getAttribute("aria-checked"), "false");
    holidaySwitch.dispatchEvent({ type: "click" });
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.updates[3])),
      {
        key: "holidayAccessoryEnabled",
        value: { clawd: true },
      }
    );
    assert.strictEqual(holidaySwitch.getAttribute("aria-checked"), "true");
    assert.strictEqual(holidaySwitch.classList.contains("pending"), true);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(holidaySwitch.classList.contains("pending"), false);

    holidaySwitch.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.updates[4])),
      {
        key: "holidayAccessoryEnabled",
        value: {},
      }
    );
    assert.strictEqual(holidaySwitch.getAttribute("aria-checked"), "false");

    harness.content.querySelector(".theme-detail-back").dispatchEvent({ type: "click" });
    assert.ok(harness.content.querySelector(".theme-grid"));
    assert.strictEqual(harness.content.querySelector(".theme-detail-hero"), null);
    assert.strictEqual(harness.content.scrollTop, 173);
    const restoredCustomizeButton = harness.content.querySelector(".theme-customize-btn");
    assert.strictEqual(restoredCustomizeButton.focused, true);
    assert.strictEqual(restoredCustomizeButton.focusOptions.preventScroll, true);
  });

  it("resolves holiday switch labels for theme directory names containing spaces", () => {
    for (const themeId of ["clawd", "pixel-cat", "pixel cat"]) {
      const harness = loadThemeTabForTest({
        themes: [{
          id: themeId,
          name: "Test pet",
          builtin: themeId === "clawd",
          active: true,
          capabilities: { accessories: true },
        }],
      });
      harness.content.querySelector(".theme-customize-btn").dispatchEvent({ type: "click" });
      const row = harness.content.querySelector(".holiday-accessory-row");
      const sw = row.querySelector(".holiday-accessory-switch");
      for (const [attribute, labelKey] of [
        ["aria-labelledby", "rowHolidayAccessory"],
        ["aria-describedby", "themeHolidayAccessoryDesc"],
      ]) {
        const refs = (sw.getAttribute(attribute) || "").trim().split(/[\t\n\f\r ]+/);
        const text = refs.map((ref) => {
          const targets = row.querySelectorAll("span").filter((element) => element.id === ref);
          assert.strictEqual(targets.length, 1, `${themeId}: ${attribute} must resolve each ID reference`);
          return targets[0].textContent;
        }).join(" ");
        assert.strictEqual(text, harness.core.helpers.t(labelKey), `${themeId}: ${attribute}`);
      }
    }
  });

  it("patches theme customization broadcasts in place without replacing the detail view", () => {
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "clawd",
          name: "Clawd",
          builtin: true,
          active: true,
          previewFileUrl: "file:///clawd.svg",
          capabilities: { petTint: true, accessories: true, mouthAccessories: true },
        },
      ],
      snapshot: {
        petTint: { clawd: "matcha" },
        petAccessory: { clawd: "wizard-hat" },
        petMouthAccessory: { clawd: "cigarette" },
        holidayAccessoryEnabled: {},
      },
      petTintOptions: [
        { id: "none", labelKey: "tintNone" },
        { id: "matcha", labelKey: "tintMatcha" },
        { id: "gold", labelKey: "tintGold" },
      ],
      petAccessoryOptions: [
        { id: "none", labelKey: "accessoryNone" },
        { id: "wizard-hat", labelKey: "accessoryWizardHat" },
        { id: "halo", labelKey: "accessoryHalo" },
      ],
      petMouthAccessoryOptions: [
        { id: "none", labelKey: "accessoryNone" },
        { id: "cigarette", labelKey: "accessoryCigarette" },
      ],
    });

    harness.content.querySelector(".theme-customize-btn").dispatchEvent({ type: "click" });
    const originalHero = harness.content.querySelector(".theme-detail-hero");
    const originalTint = harness.content.querySelector(".pet-tint-select");
    const originalAccessory = harness.content.querySelector(".pet-accessory-select");
    const originalMouthAccessory = harness.content.querySelector(".pet-mouth-accessory-select");
    const originalHolidaySwitch = harness.content.querySelector(".holiday-accessory-switch");
    harness.content.scrollTop = 137;

    const nextSnapshot = {
      ...harness.core.state.snapshot,
      petTint: { clawd: "gold" },
      petAccessory: { clawd: "halo" },
      petMouthAccessory: {},
      holidayAccessoryEnabled: { clawd: true },
    };
    harness.core.ops.applyChanges({
      changes: {
        petTint: nextSnapshot.petTint,
        petAccessory: nextSnapshot.petAccessory,
        petMouthAccessory: nextSnapshot.petMouthAccessory,
        holidayAccessoryEnabled: nextSnapshot.holidayAccessoryEnabled,
      },
      snapshot: nextSnapshot,
    });

    assert.strictEqual(harness.content.querySelector(".theme-detail-hero"), originalHero);
    assert.strictEqual(harness.content.querySelector(".pet-tint-select"), originalTint);
    assert.strictEqual(harness.content.querySelector(".pet-accessory-select"), originalAccessory);
    assert.strictEqual(harness.content.querySelector(".pet-mouth-accessory-select"), originalMouthAccessory);
    assert.strictEqual(harness.content.querySelector(".holiday-accessory-switch"), originalHolidaySwitch);
    assert.strictEqual(harness.content.scrollTop, 137);
    assert.strictEqual(getSelectedPickerValue(originalTint), "gold");
    assert.strictEqual(getSelectedPickerValue(originalAccessory), "halo");
    assert.strictEqual(getSelectedPickerValue(originalMouthAccessory), "none");
    assert.strictEqual(originalHolidaySwitch.getAttribute("aria-checked"), "true");
  });

  it("animates collapsible Settings groups with natural-height grid rows", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(coreSource.includes('bodyInner.className = "collapsible-group-body-inner"'));
    assert.ok(coreSource.includes("body.appendChild(bodyInner)"));
    assert.ok(coreSource.includes("function preserveScrollAnchor("));
    assert.ok(!coreSource.includes("measureCollapsibleBodyHeight"));
    assert.ok(!coreSource.includes("body.scrollHeight"));
    assert.ok(!coreSource.includes("--collapsible-body-height"));
    assert.ok(coreSource.includes("collapsing"));
    assert.ok(coreSource.includes("expanding"));
    assert.ok(coreSource.includes('ev.propertyName !== "grid-template-rows"'));
    assert.ok(!coreSource.includes('body.addEventListener("transitioncancel"'));
    assert.ok(coreSource.includes("function setBodyInteractivity(nextExpanded, isTransitioning = false)"));
    assert.ok(coreSource.includes('body.setAttribute("aria-hidden"'));
    assert.ok(coreSource.includes("const bodyInert = !nextExpanded || isTransitioning"));
    assert.ok(!coreSource.includes("body.hidden = collapsed;"));
    assert.ok(/\.settings-disclosure-body\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-rows:\s*1fr;[\s\S]*var\(--settings-disclosure-duration\)/.test(css));
    assert.ok(/\.settings-disclosure-body-inner\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*hidden;/.test(css));
    assert.ok(/\.settings-disclosure\.collapsed\s*>\s*\.settings-disclosure-body\s*\{[\s\S]*grid-template-rows:\s*0fr;/.test(css));
    assert.ok(/\.settings-disclosure\.collapsed\s*>\s*\.settings-disclosure-body\s*>\s*\.settings-disclosure-body-inner\s*\{[\s\S]*opacity:\s*0;[\s\S]*transform:\s*translateY\(var\(--settings-disclosure-shift\)\);/.test(css));
    assert.ok(/\.collapsible-group-body\s+\.collapsible-content-entering\s*\{[\s\S]*animation:\s*collapsibleContentEnter/.test(css));
    assert.ok(!css.includes(".collapsible-group.collapsible-content-entering"));
    assert.ok(!css.includes("max-height: var(--collapsible-body-height"));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.settings-disclosure-body/.test(css));
  });

  // #895 T10: medium is half of INSTALL_HINT_CONFIDENCES but every existing
  // test used "high", so dropping medium from the set was invisible. Antigravity
  // squatting in ~/.gemini produces exactly a medium parent-dir hit, so this is
  // the confidence the Gemini half of #895 travels on.

  // #895 T9: before the first detection resolves there is no evidence at all, so
  // the catalog must not be phrased as a detection result. It carries agents
  // Clawd never examines even after the scan lands.

  // #895 T12/T12b/T12c/T12d: cleanup suggestions are gated on metadata that must
  // say, explicitly, that the agent is eligible. Default integrations are not,
  // and a fixture or an IPC failure that omits the field must not be read as
  // permission to propose tearing an integration out.

  // #895: an entry with no verdict is "not checked", and must not propose a
  // deletion any more than a missing entry does.

  it("Codex approval settings: localized descriptions reference the setting and sidebar names", () => {
    const strings = loadSettingsI18nForTest();
    for (const lang of SUPPORTED_LANGS) {
      const locale = strings[lang];
      for (const key of ["rowCodexApprovalRoutingAutoDesc", "rowCodexApprovalOwnerAutoDesc", "rowCodexInterceptApprovalsDesc"]) {
        assert.ok(locale[key].includes(locale.rowPermissionAutomation), `${lang} ${key} names the permission setting`);
      }
      const path = `${locale.sidebarAgents} → Codex → ${locale.agentGroupAdvanced}`;
      assert.ok(locale.rowCodexApprovalOwnerInterceptDesc.includes(path), `${lang} names the sidebar path`);
    }
  });

  it("Codex approval settings: seven languages have the new copy and no retired keys", () => {
    for (const [lang, strings] of Object.entries(loadSettingsI18nForTest())) {
      for (const key of ["agentGroupAdvanced", "rowCodexApprovalRouting", "rowCodexApprovalRoutingAutoDesc",
        "rowCodexApprovalRoutingInterceptDesc", "rowCodexInterceptApprovals", "rowCodexInterceptApprovalsDesc"]) {
        assert.ok(typeof strings[key] === "string" && strings[key].trim(), `${lang}.${key}`);
      }
      for (const key of ["rowCodexPermissionMode", "rowCodexPermissionModeDesc", "codexPermissionModeAuto", "codexPermissionModeIntercept"]) {
        assert.equal(Object.hasOwn(strings, key), false, `${lang}.${key} is retired`);
      }
      assert.doesNotMatch(strings.rowCodexApprovalOwnerAutoDesc, /\b(?:Auto|Intercept)\b(?!-approve)/);
      assert.doesNotMatch(strings.rowCodexApprovalOwnerInterceptDesc, /\b(?:Auto|Intercept)\b/);
    }
  });

  it("uses animated switches and local theme override patching in the Animation Map subtab", () => {
    const animMapSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-map.js"), "utf8");
    const overridesSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8");
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(animMapSource.includes("state.transientUiState.animMapSwitches"));
    assert.ok(animMapSource.includes("state.mountedControls.animMapSwitches"));
    assert.ok(animMapSource.includes("helpers.attachOptimisticSwitch(switchControl, {"));
    assert.ok(animMapSource.includes('command("setThemeOverrideDisabled"'));
    assert.ok(!animMapSource.includes("helpers.attachActivation(sw"));
    assert.ok(animMapSource.includes("function renderMapSubtab(parent)"));
    assert.ok(animMapSource.includes("function patchMapInPlace(changes)"));
    assert.ok(animMapSource.includes('Object.prototype.hasOwnProperty.call(changes, "themeOverrides")'));
    assert.ok(animMapSource.includes("meta.control.setState({"));
    // Folded in: the Animation & Sound Overrides tab renders + patches the map subtab.
    assert.ok(overridesSource.includes("ClawdSettingsTabAnimMap.renderMapSubtab"));
    assert.ok(overridesSource.includes("ClawdSettingsTabAnimMap.patchMapInPlace"));
    assert.ok(coreSource.includes("activeTab.patchInPlace(changes"));
  });

  it("renders the Animation Map switches inside the Animation Overrides 'on / off' subtab", () => {
    const harness = loadAnimMapTabForTest({
      snapshot: { theme: "clawd", themeOverrides: {} },
    });
    // Map is the default subtab; rendering the overrides tab should mount the
    // five interrupt on/off switches under it (folded in, not a standalone tab).
    harness.core.tabs.animOverrides.render(harness.content);
    assert.strictEqual(harness.core.state.mountedControls.animMapSwitches.size, 5);
    assert.ok(
      harness.core.state.mountedControls.animMapReset,
      "the reset-all control should mount under the subtab"
    );
  });

  it("keeps the Animation shell mounted and restores scroll per subtab", () => {
    const harness = loadAnimMapTabForTest({
      snapshot: { theme: "clawd", themeOverrides: {} },
    });
    harness.core.runtime.animationOverridesData = {
      theme: { id: "clawd", name: "Clawd" },
      assets: [],
      sections: [],
      cards: [],
      sounds: [],
    };
    harness.core.runtime.animOverridesSubtab = "map";
    const render = () => {
      harness.content.innerHTML = "";
      harness.core.tabs.animOverrides.render(harness.content, harness.core);
    };
    harness.core.ops.installRenderHooks({ content: render, modal: () => {} });
    render();

    const [heading, subtitle, tablist, body] = harness.content.children;
    assert.equal(heading.tagName, "H1");
    assert.equal(subtitle.className, "subtitle");
    assert.equal(tablist.className, "anim-override-subtabs");
    assert.equal(body.className, "anim-override-subtab-body");

    function switchTo(subtab) {
      const button = harness.content.querySelectorAll("button")
        .find((candidate) => candidate.dataset.animOverridesSubtab === subtab);
      assert.ok(button, `${subtab} tab should render`);
      button.dispatchEvent({ type: "click" });
      assert.strictEqual(harness.content.children[0], heading);
      assert.strictEqual(harness.content.children[1], subtitle);
      assert.strictEqual(harness.content.children[2], tablist);
      assert.strictEqual(harness.content.children[3], body);
      const active = harness.content.querySelectorAll("button")
        .find((candidate) => candidate.classList.contains("active"));
      assert.equal(active.dataset.animOverridesSubtab, subtab);
      assert.equal(active.focused, true);
    }

    switchTo("animations");
    harness.content.scrollTop = 240;
    switchTo("sounds");
    assert.equal(harness.content.scrollTop, 0, "the short target subtab starts at its own scroll position");

    // Chromium clamps a short page to zero. Returning to Animations must use
    // its saved position rather than this clamped value from Sounds.
    harness.content.scrollTop = 0;
    switchTo("animations");
    assert.equal(harness.content.scrollTop, 240);
  });

  it("keeps Animation Map theme override broadcasts in place and syncs the mounted switch", () => {
    const harness = loadAnimMapTabForTest({
      snapshot: {
        theme: "clawd",
        themeOverrides: {
          clawd: {
            states: {
              error: { disabled: false },
            },
          },
        },
      },
    });
    const sw = new FakeElement("div");
    sw.className = "switch on";
    harness.content.appendChild(sw);
    const control = harness.core.helpers.buildSwitch({
      element: sw,
      checked: true,
      ariaLabel: "Error animation",
    });
    harness.core.state.mountedControls.animMapSwitches.set("clawd:error", {
      control,
      element: sw,
      themeId: "clawd",
      stateKey: "error",
    });
    const before = harness.getContentRenderCount();

    harness.core.ops.applyChanges({
      changes: {
        themeOverrides: {
          clawd: {
            states: {
              error: { disabled: true },
            },
          },
        },
      },
      snapshot: {
        theme: "clawd",
        themeOverrides: {
          clawd: {
            states: {
              error: { disabled: true },
            },
          },
        },
      },
    });

    assert.strictEqual(harness.getContentRenderCount(), before);
    assert.strictEqual(sw.classList.contains("on"), false);
    assert.strictEqual(sw.attributes["aria-checked"], "false");
  });

  it("rebuilds Animation Map instead of patching with stale theme ids when the theme changes", () => {
    const harness = loadAnimMapTabForTest({
      snapshot: {
        theme: "clawd",
        themeOverrides: {},
      },
    });
    const sw = new FakeElement("div");
    sw.className = "switch on";
    harness.content.appendChild(sw);
    const control = harness.core.helpers.buildSwitch({
      element: sw,
      checked: true,
      ariaLabel: "Error animation",
    });
    harness.core.state.mountedControls.animMapSwitches.set("clawd:error", {
      control,
      element: sw,
      themeId: "clawd",
      stateKey: "error",
    });
    const before = harness.getContentRenderCount();

    harness.core.ops.applyChanges({
      changes: {
        theme: "calico",
        themeOverrides: {
          calico: {
            states: {
              error: { disabled: true },
            },
          },
        },
      },
      snapshot: {
        theme: "calico",
        themeOverrides: {
          calico: {
            states: {
              error: { disabled: true },
            },
          },
        },
      },
    });

    assert.strictEqual(
      harness.getContentRenderCount(),
      before + 1,
      "theme changes should force a rebuild so Animation Map switches use the new theme id"
    );
  });

  it("invalidates animation cards and refreshes theme capabilities after a map override patch", async () => {
    let listThemesCalls = 0;
    const harness = loadAnimMapTabForTest({
      snapshot: {
        theme: "clawd",
        themeOverrides: { clawd: { states: { error: { disabled: false } } } },
      },
      settingsAPI: {
        listThemes: () => {
          listThemesCalls++;
          return Promise.resolve([{
            id: "clawd",
            active: true,
            capabilities: { petTint: true, accessories: false },
          }]);
        },
      },
    });
    // Simulate having opened the Animations subtab earlier: its card data is cached.
    harness.core.runtime.animationOverridesData = { theme: { id: "clawd" }, cards: [], sounds: [] };
    harness.core.runtime.themeList = [{
      id: "clawd",
      active: true,
      capabilities: { petTint: true, accessories: true },
    }];
    // A mounted map switch so patchMapInPlace takes the in-place themeOverrides branch.
    const sw = new FakeElement("div");
    sw.className = "switch on";
    harness.content.appendChild(sw);
    const control = harness.core.helpers.buildSwitch({
      element: sw,
      checked: true,
      ariaLabel: "Error animation",
    });
    harness.core.state.mountedControls.animMapSwitches.set("clawd:error", {
      control,
      element: sw,
      themeId: "clawd",
      stateKey: "error",
    });

    harness.core.ops.applyChanges({
      changes: { themeOverrides: { clawd: { states: { error: { disabled: true } } } } },
      snapshot: { theme: "clawd", themeOverrides: { clawd: { states: { error: { disabled: true } } } } },
    });

    assert.strictEqual(
      harness.core.runtime.animationOverridesData,
      null,
      "a map-subtab theme-override patch must invalidate the cached cards so Animations/Sounds refetch"
    );
    assert.strictEqual(listThemesCalls, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(
      harness.core.runtime.themeList[0].capabilities.accessories,
      false,
      "the registered map-tab fast path must not leave Theme capability metadata stale"
    );
  });

  it("keeps stale sound override prefs resettable from the settings UI", () => {
    const overridesSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8");
    assert.ok(
      overridesSource.includes("resetBtn.disabled = !slot.hasStoredOverride;"),
      "sound override row reset must stay enabled when prefs still contain a stale sound override entry"
    );
  });

  it("uses the shared SVG chevron treatment for Animation Overrides rows", () => {
    const overridesSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");

    assert.ok(!overridesSource.includes('chevron.textContent = "\\u25B8";'));
    assert.ok(!overridesSource.includes("chevron.innerHTML"));
    assert.ok(overridesSource.includes('helpers.createDisclosureChevron("anim-override-chevron")'));
    assert.ok(overridesSource.includes("helpers.attachSettingsDisclosure({"));
    assert.ok(!overridesSource.includes('document.createElement("details")'));
    assert.ok(/\.collapsible-group-chevron,\s*\.anim-override-chevron\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;[\s\S]*opacity:\s*0\.72;/.test(css));
    assert.ok(/\.collapsible-group-chevron,\s*\.anim-override-chevron\s*\{[\s\S]*transform:\s*translateX\(-6px\) rotate\(0deg\);[\s\S]*transform var\(--settings-disclosure-duration\) var\(--settings-disclosure-easing\)/.test(css));
    assert.ok(/\.collapsible-group-chevron svg,\s*\.anim-override-chevron svg\s*\{[\s\S]*width:\s*16px;[\s\S]*height:\s*16px;[\s\S]*overflow:\s*visible;/.test(css));
    assert.ok(/\.collapsible-group-chevron path,\s*\.anim-override-chevron path\s*\{[\s\S]*fill:\s*none;[\s\S]*stroke:\s*currentColor;[\s\S]*stroke-width:\s*2\.2;[\s\S]*stroke-linecap:\s*round;[\s\S]*stroke-linejoin:\s*round;/.test(css));
    assert.ok(/\.anim-override-row > \.anim-override-summary:hover \.anim-override-chevron\s*\{[\s\S]*color:\s*var\(--text-secondary\);[\s\S]*opacity:\s*0\.95;/.test(css));
    assert.ok(/\.anim-override-row\.expanded\s*>\s*\.anim-override-summary\s+\.anim-override-chevron\s*\{[\s\S]*transform:\s*translateX\(-6px\) rotate\(90deg\);[\s\S]*color:\s*var\(--accent\);[\s\S]*opacity:\s*1;/.test(css));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.anim-override-chevron,[\s\S]*transition:\s*none;/.test(css));
    assert.ok(/\.anim-override-thumb\s*\{[\s\S]*transform:\s*translateX\(-3px\);/.test(css));
    assert.ok(/\.anim-override-summary-text\s*\{[\s\S]*transform:\s*translateX\(-3px\);/.test(css));
    assert.ok(!/\.anim-override-summary-change\s*\{[\s\S]*translateX\(-3px\)/.test(css));
  });

  it("keeps Animation Override expansion state on the shared disclosure controller", () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card, { expandedOverrideRowIds: new Set() });
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);
    const row = parent.querySelector(".anim-override-row");
    const summary = row.querySelector(".anim-override-summary");
    const body = row.querySelector(".anim-override-body");
    const thumb = row.querySelector(".anim-override-thumb");

    assert.equal(row.tagName, "DIV");
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.equal(body.getAttribute("aria-hidden"), "true");
    summary.click();
    assert.equal(summary.getAttribute("aria-expanded"), "true");
    assert.equal(body.getAttribute("aria-hidden"), "false");
    assert.equal(runtime.expandedOverrideRowIds.has(card.id), true);
    thumb.click();
    assert.equal(runtime.expandedOverrideRowIds.has(card.id), true, "preview clicks must not toggle the row");
    summary.click();
    assert.equal(runtime.expandedOverrideRowIds.has(card.id), false);
  });

  it("merges pushed animation preview posters without accepting stale cache keys", () => {
    const merge = require(SETTINGS_ANIM_OVERRIDES_MERGE);
    const cache = new Map();
    merge.rememberAnimationPreviewPoster(cache, {
      themeId: "cloudling",
      filename: "cloudling-thinking.svg",
      previewImageUrl: "data:image/png;base64,poster-k1",
      previewPosterCacheKey: "K1",
    });

    const data = {
      theme: { id: "cloudling" },
      assets: [{
        name: "cloudling-thinking.svg",
        previewImageUrl: null,
        previewPosterCacheKey: "K1",
        previewPosterPending: true,
      }],
      sections: [{
        cards: [{
          currentFile: "cloudling-thinking.svg",
          currentFilePreviewUrl: null,
          currentFilePreviewPosterCacheKey: "K1",
          previewPosterPending: true,
        }],
      }],
      cards: [{
        currentFile: "cloudling-thinking.svg",
        currentFilePreviewUrl: null,
        currentFilePreviewPosterCacheKey: "K1",
        previewPosterPending: true,
      }],
    };
    merge.mergePosterCacheIntoAnimationData(data, cache);
    assert.strictEqual(data.assets[0].previewImageUrl, "data:image/png;base64,poster-k1");
    assert.strictEqual(data.assets[0].previewPosterPending, false);
    assert.strictEqual(data.sections[0].cards[0].currentFilePreviewUrl, "data:image/png;base64,poster-k1");
    assert.strictEqual(data.cards[0].currentFilePreviewUrl, "data:image/png;base64,poster-k1");

    const mismatch = {
      theme: { id: "cloudling" },
      assets: [{
        name: "cloudling-thinking.svg",
        previewImageUrl: null,
        previewPosterCacheKey: "K2",
        previewPosterPending: true,
      }],
      sections: [{
        cards: [{
          currentFile: "cloudling-thinking.svg",
          currentFilePreviewUrl: null,
          currentFilePreviewPosterCacheKey: "K2",
          previewPosterPending: true,
        }],
      }],
      cards: [{
        currentFile: "cloudling-thinking.svg",
        currentFilePreviewUrl: null,
        currentFilePreviewPosterCacheKey: "K2",
        previewPosterPending: true,
      }],
    };
    merge.mergePosterCacheIntoAnimationData(mismatch, cache);
    assert.strictEqual(mismatch.assets[0].previewImageUrl, null);
    assert.strictEqual(mismatch.sections[0].cards[0].currentFilePreviewUrl, null);
    assert.strictEqual(mismatch.cards[0].currentFilePreviewUrl, null);
  });

  it("keeps poster-ready pushes across an overlapping animation overrides fetch", async () => {
    const deferred = createDeferred();
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => deferred.promise,
    });
    const fetchPromise = core.ops.fetchAnimationOverridesData();
    core.ops.applyAnimationPreviewPoster({
      themeId: "cloudling",
      filename: "cloudling-thinking.svg",
      previewImageUrl: "data:image/png;base64,pushed",
      previewPosterCacheKey: "K1",
    });
    deferred.resolve({
      theme: { id: "cloudling" },
      assets: [{
        name: "cloudling-thinking.svg",
        previewImageUrl: null,
        previewPosterCacheKey: "K1",
        previewPosterPending: true,
      }],
      sections: [{
        cards: [{
          currentFile: "cloudling-thinking.svg",
          currentFilePreviewUrl: null,
          currentFilePreviewPosterCacheKey: "K1",
          previewPosterPending: true,
        }],
      }],
      cards: [{
        currentFile: "cloudling-thinking.svg",
        currentFilePreviewUrl: null,
        currentFilePreviewPosterCacheKey: "K1",
        previewPosterPending: true,
      }],
    });
    await fetchPromise;

    assert.strictEqual(core.runtime.animationOverridesData.assets[0].previewImageUrl, "data:image/png;base64,pushed");
    assert.strictEqual(core.runtime.animationOverridesData.sections[0].cards[0].currentFilePreviewUrl, "data:image/png;base64,pushed");
    assert.strictEqual(core.runtime.animationOverridesData.cards[0].currentFilePreviewUrl, "data:image/png;base64,pushed");
  });

  it("patches pending animation override data when a poster push arrives after fetch", async () => {
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => Promise.resolve({
        theme: { id: "cloudling" },
        assets: [{
          name: "cloudling-thinking.svg",
          previewImageUrl: null,
          previewPosterCacheKey: "K1",
          previewPosterPending: true,
        }],
        sections: [{
          cards: [{
            currentFile: "cloudling-thinking.svg",
            currentFilePreviewUrl: null,
            currentFilePreviewPosterCacheKey: "K1",
            previewPosterPending: true,
          }],
        }],
        cards: [{
          currentFile: "cloudling-thinking.svg",
          currentFilePreviewUrl: null,
          currentFilePreviewPosterCacheKey: "K1",
          previewPosterPending: true,
        }],
      }),
    });

    await core.ops.fetchAnimationOverridesData();
    core.ops.applyAnimationPreviewPoster({
      themeId: "cloudling",
      filename: "cloudling-thinking.svg",
      previewImageUrl: "data:image/png;base64,late-push",
      previewPosterCacheKey: "K1",
    });

    assert.strictEqual(core.runtime.animationOverridesData.assets[0].previewImageUrl, "data:image/png;base64,late-push");
    assert.strictEqual(core.runtime.animationOverridesData.assets[0].previewPosterPending, false);
    assert.strictEqual(core.runtime.animationOverridesData.sections[0].cards[0].currentFilePreviewUrl, "data:image/png;base64,late-push");
    assert.strictEqual(core.runtime.animationOverridesData.cards[0].currentFilePreviewUrl, "data:image/png;base64,late-push");
  });

  it("does not let a stale rejected animation overrides fetch clear newer data", async () => {
    const oldFetch = createDeferred();
    const newFetch = createDeferred();
    const fetches = [oldFetch, newFetch];
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => fetches.shift().promise,
    });

    const oldPromise = core.ops.fetchAnimationOverridesData();
    const newPromise = core.ops.fetchAnimationOverridesData();
    newFetch.resolve({ theme: { id: "calico" }, assets: [{ name: "calico-idle.png" }], sections: [], cards: [] });
    await newPromise;
    oldFetch.reject(new Error("old failed"));
    await oldPromise;

    assert.strictEqual(core.runtime.animationOverridesData.theme.id, "calico");
    assert.strictEqual(core.runtime.animationOverridesData.assets[0].name, "calico-idle.png");
  });

  it("renders pending scripted animation previews as placeholders instead of SVG images", () => {
    const merge = require(SETTINGS_ANIM_OVERRIDES_MERGE);
    const asset = {
      name: "cloudling-thinking.svg",
      fileUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      previewImageUrl: null,
      needsScriptedPreviewPoster: true,
      previewPosterCacheKey: "K1",
      previewPosterPending: true,
      cycleMs: null,
      cycleStatus: "unavailable",
    };
    const card = {
      id: "state:thinking",
      slotType: "state",
      sectionId: "work",
      stateKey: "thinking",
      triggerKind: "thinking",
      currentFile: asset.name,
      currentFileUrl: asset.fileUrl,
      currentFilePreviewUrl: null,
      currentFilePreviewPosterCacheKey: "K1",
      needsScriptedPreviewPoster: true,
      previewPosterPending: true,
      bindingLabel: "states.thinking[0]",
      transition: { in: 150, out: 150 },
      supportsAutoReturn: false,
      supportsDuration: false,
      autoReturnMs: null,
      durationMs: null,
      assetCycleMs: null,
      assetCycleStatus: "unavailable",
      suggestedDurationMs: null,
      suggestedDurationStatus: "unavailable",
      previewDurationMs: null,
      displayHintWarning: false,
      displayHintTarget: null,
      fallbackTargetState: null,
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      aspectRatioWarning: null,
    };
    assert.strictEqual(merge.getAssetPreviewUrl(asset), null);
    assert.strictEqual(merge.getCardPreviewUrl(card), null);

    const runtime = {
      animationOverridesData: {
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [asset],
        sections: [{ id: "work", cards: [card] }],
        cards: [card],
        sounds: [],
      },
      animOverridesSubtab: "animations",
      expandedOverrideRowIds: new Set(["state:thinking"]),
      assetPicker: {
        state: null,
        pollTimer: null,
      },
    };
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    runtime.assetPicker.state = { cardId: card.id, selectedFile: asset.name };
    core.renderHooks.modal();

    const svgImages = [
      ...parent.querySelectorAll("img"),
      ...modalRoot.querySelectorAll("img"),
    ].filter((img) => String(img.src || "").includes(".svg"));
    assert.strictEqual(svgImages.length, 0);
    assert.ok(parent.querySelectorAll(".anim-override-preview-pending").length >= 2);
    assert.ok(modalRoot.querySelectorAll(".anim-override-preview-pending").length >= 1);
  });

  it("keeps localized shortcut labels from collapsing into vertical CJK text", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(css, /\.shortcut-row-control\s*\{[\s\S]*?flex:\s*1 1 0;[\s\S]*?min-width:\s*0;[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?justify-content:\s*flex-start;[\s\S]*?\}/);
    assert.match(css, /\.shortcut-row \.row-text\s*\{[\s\S]*?flex:\s*0 0 190px;[\s\S]*?\}/);
    assert.match(css, /\.shortcut-row \.row-label\s*\{[\s\S]*?word-break:\s*keep-all;[\s\S]*?overflow-wrap:\s*normal;[\s\S]*?\}/);
    assert.match(css, /\.shortcut-value\s*\{[\s\S]*?flex:\s*1 1 190px;[\s\S]*?min-width:\s*160px;[\s\S]*?max-width:\s*286px;[\s\S]*?\}/);
  });

  it("counts sound overrides in the theme-overrides reset gate", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(
      coreSource.includes("function hasAnyThemeOverride(themeId)"),
      "settings-ui-core.js should expose a helper for any stored theme override"
    );
    assert.ok(
      coreSource.includes("...(map.sounds ? Object.keys(map.sounds) : []),"),
      "sound overrides must participate in the global reset-all gate"
    );
  });

  it("does not treat an empty hitbox override group as a reset-all override", () => {
    const core = loadSettingsCoreForTest({});
    core.state.snapshot = {
      themeOverrides: {
        cloudling: {
          hitbox: {
            wide: {},
          },
        },
      },
    };

    assert.strictEqual(core.readers.hasAnyThemeOverride("cloudling"), false);

    core.state.snapshot.themeOverrides.cloudling.hitbox.wide["cloudling-thinking.svg"] = true;
    assert.strictEqual(core.readers.hasAnyThemeOverride("cloudling"), true);
  });

  it("keeps current Animation Overrides data visible while theme override refresh is pending", () => {
    const deferred = createDeferred();
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => deferred.promise,
    });
    const previousData = {
      theme: { id: "cloudling", name: "Cloudling" },
      assets: [],
      sections: [{ id: "work", cards: [] }],
      cards: [],
      sounds: [],
    };
    core.state.activeTab = "animOverrides";
    core.state.snapshot = {
      theme: "cloudling",
      themeOverrides: {
        cloudling: {
          states: {
            thinking: {
              transition: { in: 120, out: 180 },
            },
          },
        },
      },
    };
    core.runtime.animationOverridesData = previousData;

    let renderCount = 0;
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {
        renderCount++;
      },
      modal: () => {},
    });
    core.ops.applyChanges({
      changes: {
        themeOverrides: {
          cloudling: {
            states: {
              thinking: {
                transition: { in: 220, out: 180 },
              },
            },
          },
        },
      },
      snapshot: core.state.snapshot,
    });

    assert.strictEqual(
      core.runtime.animationOverridesData,
      previousData,
      "Animation Overrides should keep the last rendered data while the async refresh is pending"
    );
    assert.strictEqual(renderCount, 0, "pending refresh should not immediately rerender into an empty loading page");
  });

  it("lets Animation Overrides patch theme override broadcasts before a full content render", () => {
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => Promise.resolve({ cards: [], sections: [], sounds: [] }),
    });
    core.state.activeTab = "animOverrides";
    core.state.snapshot = {
      theme: "cloudling",
      themeOverrides: {},
    };
    core.runtime.animationOverridesData = {
      theme: { id: "cloudling", name: "Cloudling" },
      assets: [],
      sections: [],
      cards: [],
      sounds: [],
    };

    let patchCount = 0;
    let contentRenderCount = 0;
    core.tabs.animOverrides = {
      patchInPlace(changes) {
        patchCount++;
        assert.ok(changes && Object.prototype.hasOwnProperty.call(changes, "themeOverrides"));
        return true;
      },
    };
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {
        contentRenderCount++;
      },
      modal: () => {},
    });

    core.ops.applyChanges({
      changes: { themeOverrides: { cloudling: { states: {} } } },
      snapshot: core.state.snapshot,
    });

    assert.strictEqual(patchCount, 1);
    assert.strictEqual(contentRenderCount, 0);
  });

  it("renders the idle visual picker and submits setIdleVisual for the chosen option", async () => {
    const commandCalls = [];
    const runtime = createIdleVisualRuntime();
    const modalRoot = new FakeElement("div");
    const { core, document } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          commandCalls.push({ name, payload });
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    const parent = new FakeElement("main");
    document.body.appendChild(parent);
    core.tabs.animOverrides.render(parent, core);

    assert.strictEqual(parent.querySelectorAll(".anim-idle-visual-row").length, 1);
    const valueEl = parent.querySelector(".anim-idle-visual-row .language-picker-value");
    assert.strictEqual(valueEl.textContent, "animIdleVisualThemeDefault");
    const options = parent.querySelectorAll(".anim-idle-visual-row .language-picker-option");
    assert.strictEqual(options.length, 2);

    options[1].dispatchEvent({ type: "click" });
    await Promise.resolve();
    assert.strictEqual(commandCalls.length, 1);
    assert.strictEqual(commandCalls[0].name, "setIdleVisual");
    // spread: the payload object comes from the VM realm, whose Object
    // prototype fails deepStrictEqual against test-realm literals.
    assert.deepStrictEqual(
      { ...commandCalls[0].payload },
      { themeId: "clawd", file: "clawd-idle-reading.svg" }
    );
    assert.strictEqual(valueEl.textContent, "Idle Reading", "optimistic display should show the pick immediately");
  });

  it("mounts the idle visual menu while open and removes it from layout after close", () => {
    const runtime = createIdleVisualRuntime();
    const modalRoot = new FakeElement("div");
    const { core, document } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    document.body.appendChild(parent);
    core.tabs.animOverrides.render(parent, core);

    const picker = parent.querySelector(".anim-idle-visual-row .language-picker");
    const trigger = picker.querySelector(".language-picker-trigger");
    const menu = picker.querySelector(".language-picker-menu");

    trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(trigger.getAttribute("aria-expanded"), "true");
    assert.strictEqual(menu.getAttribute("aria-hidden"), "false");
    assert.strictEqual(
      picker.classList.contains("menu-mounted"),
      true,
      "the shared CSS only displays mounted picker menus",
    );

    trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(trigger.getAttribute("aria-expanded"), "false");
    assert.strictEqual(menu.getAttribute("aria-hidden"), "true");
    assert.strictEqual(picker.classList.contains("menu-mounted"), false);
  });

  it("patches idleVisual-only broadcasts in place and re-syncs the mounted picker", () => {
    const runtime = createIdleVisualRuntime();
    const modalRoot = new FakeElement("div");
    const { core, document } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    document.body.appendChild(parent);
    core.tabs.animOverrides.render(parent, core);
    const valueEl = parent.querySelector(".anim-idle-visual-row .language-picker-value");
    assert.strictEqual(valueEl.textContent, "animIdleVisualThemeDefault");

    const handled = core.tabs.animOverrides.patchInPlace({ idleVisual: { clawd: "clawd-idle-reading.svg" } });
    assert.strictEqual(handled, true, "idleVisual-only broadcast must not trigger a full re-render");
    assert.strictEqual(runtime.animationOverridesData.idleDefaultVisual.selectedFile, "clawd-idle-reading.svg");
    assert.strictEqual(valueEl.textContent, "Idle Reading");

    const handledReset = core.tabs.animOverrides.patchInPlace({ idleVisual: {} });
    assert.strictEqual(handledReset, true);
    assert.strictEqual(runtime.animationOverridesData.idleDefaultVisual.selectedFile, null);
    assert.strictEqual(valueEl.textContent, "animIdleVisualThemeDefault");
  });

  it("cleans up idle visual picker document listeners through the mounted-control dispose contract", () => {
    const runtime = createIdleVisualRuntime();
    const modalRoot = new FakeElement("div");
    const { core, document, documentListenerCount } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    document.body.appendChild(parent);
    core.tabs.animOverrides.render(parent, core);

    assert.strictEqual(documentListenerCount("click"), 1);
    assert.strictEqual(documentListenerCount("keydown"), 1);
    const picker = core.state.mountedControls.idleVisualPicker;
    assert.strictEqual(typeof picker.dispose, "function");
    picker.dispose();
    assert.strictEqual(documentListenerCount("click"), 0);
    assert.strictEqual(documentListenerCount("keydown"), 0);

    // settings-ui-core owns calling dispose between renders — pin that wiring.
    const uiCoreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(uiCoreSource.includes("state.mountedControls.idleVisualPicker.dispose()"));
    assert.ok(uiCoreSource.includes("state.mountedControls.idleVisualPicker = null;"));
    assert.ok(uiCoreSource.includes("idleVisualPicker: null,"));
  });

  it("disposes Animation Override disclosures before rerendering their rows", () => {
    const runtime = createAnimOverridesRuntime(createAnimOverrideCard(), { expandedOverrideRowIds: new Set() });
    const modalRoot = new FakeElement("div");
    const { core, document } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    document.body.appendChild(parent);

    core.tabs.animOverrides.render(parent, core);
    const oldTrigger = parent.querySelector(".anim-override-row").querySelector(".anim-override-summary");
    oldTrigger.click();
    assert.equal(oldTrigger.getAttribute("aria-expanded"), "true");

    core.ops.clearMountedControls();
    core.tabs.animOverrides.render(parent, core);
    oldTrigger.click();
    assert.equal(
      oldTrigger.getAttribute("aria-expanded"),
      "true",
      "the detached row must not retain its disclosure listener",
    );
  });

  it("renders visible loading text for the initial Animation Overrides fetch", () => {
    const runtime = {
      animationOverridesData: null,
      animOverridesSubtab: "animations",
      expandedOverrideRowIds: new Set(),
      assetPicker: {
        state: null,
        pollTimer: null,
      },
    };
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");

    core.tabs.animOverrides.render(parent, core);

    const placeholders = parent.querySelectorAll(".placeholder-desc");
    assert.ok(placeholders.length > 0);
    assert.strictEqual(placeholders[0].textContent, "animOverridesLoading");
  });

  it("renders Animation Overrides theme actions in two intentional rows", () => {
    const runtime = createAnimOverridesRuntime(createAnimOverrideCard());
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");

    core.tabs.animOverrides.render(parent, core);

    const meta = parent.querySelector(".anim-override-meta");
    assert.ok(meta);
    assert.deepStrictEqual(
      meta.querySelectorAll(".anim-override-meta-label").map((label) => label.textContent),
      ["animOverridesCurrentTheme: Cloudling", "animOverridesReplacementConfig"]
    );

    const primary = meta.querySelector(".anim-override-meta-primary-actions");
    const secondary = meta.querySelector(".anim-override-meta-secondary-actions");
    assert.deepStrictEqual(
      primary.querySelectorAll("button").map((button) => button.textContent),
      ["animOverridesOpenThemeTab", "animOverridesOpenAssets"]
    );
    assert.deepStrictEqual(
      secondary.querySelectorAll("button").map((button) => button.textContent),
      ["animOverridesImport", "animOverridesExport", "animOverridesResetAll"]
    );
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(
      css,
      /\.anim-override-meta\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/
    );
    assert.match(
      css,
      /\.anim-override-meta-actions\s*\{[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*flex-end;/
    );
    assert.match(
      css,
      /@media \(max-width:\s*640px\)\s*\{[\s\S]*\.anim-override-meta-actions\s*\{[\s\S]*justify-content:\s*flex-start;/
    );

    const strings = loadSettingsI18nForTest();
    assert.strictEqual(strings.en.animOverridesReplacementConfig, "Animation override settings");
    assert.strictEqual(strings.zh.animOverridesReplacementConfig, "动画覆盖设置");
    assert.strictEqual(strings.ko.animOverridesReplacementConfig, "애니메이션 덮어쓰기 설정");
    assert.strictEqual(strings.ja.animOverridesReplacementConfig, "アニメーション上書き設定");
    assert.strictEqual(strings.en.animOverridesImport, "Import config…");
    assert.strictEqual(strings.zh.animOverridesImport, "导入配置…");
    assert.strictEqual(strings.ko.animOverridesImport, "설정 가져오기…");
    assert.strictEqual(strings.ja.animOverridesImport, "設定をインポート…");
    assert.strictEqual(strings.en.animOverridesExport, "Export config…");
    assert.strictEqual(strings.zh.animOverridesExport, "导出配置…");
    assert.strictEqual(strings.ko.animOverridesExport, "설정 내보내기…");
    assert.strictEqual(strings.ja.animOverridesExport, "設定をエクスポート…");
    assert.strictEqual(strings.en.animOverridesResetAll, "Restore theme defaults");
    assert.strictEqual(strings.zh.animOverridesResetAll, "恢复主题默认");
    assert.strictEqual(strings.ko.animOverridesResetAll, "테마 기본값으로 복원");
    assert.strictEqual(strings.ja.animOverridesResetAll, "テーマのデフォルトに戻す");
    assert.match(
      css,
      /@media \(max-width:\s*640px\)\s*\{[\s\S]*\.anim-override-meta\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/
    );
  });

  it("does not build Animation Overrides theme actions on the Sounds subtab", () => {
    const runtime = createAnimOverridesRuntime(createAnimOverrideCard(), { animOverridesSubtab: "sounds" });
    const modalRoot = new FakeElement("div");
    let activationCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      helpersOverrides: {
        attachActivation: (el, invoke) => {
          activationCount += 1;
          if (typeof invoke === "function") el.addEventListener("click", () => invoke());
          return el;
        },
      },
    });
    const parent = new FakeElement("main");

    core.tabs.animOverrides.render(parent, core);

    assert.strictEqual(parent.querySelector(".anim-override-meta"), null);
    assert.strictEqual(activationCount, 1, "only the Sounds directory button should be wired");
  });

  it("uses specific fade timing labels and gives the slider label enough room", () => {
    const strings = loadSettingsI18nForTest();
    assert.strictEqual(strings.en.animOverridesFadeIn, "Fade in on enter");
    assert.strictEqual(strings.en.animOverridesFadeOut, "Fade out on exit");
    assert.strictEqual(strings.zh.animOverridesFadeIn, "进入时淡入");
    assert.strictEqual(strings.zh.animOverridesFadeOut, "退出时淡出");
    assert.strictEqual(strings.ko.animOverridesFadeIn, "진입 시 페이드 인");
    assert.strictEqual(strings.ko.animOverridesFadeOut, "종료 시 페이드 아웃");
    assert.strictEqual(strings.ja.animOverridesFadeIn, "開始時フェードイン");
    assert.strictEqual(strings.ja.animOverridesFadeOut, "終了時フェードアウト");

    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(
      css,
      /\.anim-override-slider-row\s*\{[\s\S]*grid-template-columns:\s*96px minmax\(0,\s*1fr\) 100px;/
    );
    assert.match(
      css,
      /\.anim-override-number-field\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*white-space:\s*nowrap;/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="number"\]\s*\{[\s\S]*width:\s*76px;[\s\S]*text-align:\s*center;/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]\s*\{[\s\S]*--anim-override-fill:\s*0%;/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]::-webkit-slider-runnable-track\s*\{[\s\S]*var\(--accent\) var\(--anim-override-fill\)/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]::-webkit-slider-runnable-track\s*\{[\s\S]*var\(--row-border\) var\(--anim-override-fill\)/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]::-webkit-slider-thumb\s*\{[\s\S]*-webkit-appearance:\s*none;[\s\S]*box-shadow:/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]::-webkit-slider-thumb\s*\{[\s\S]*color-mix\(in srgb,\s*var\(--accent\)/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]:hover::-webkit-slider-thumb\s*\{[\s\S]*transform:\s*scale\(1\.08\);/
    );
    assert.match(
      css,
      /@media \(forced-colors:\s*active\)\s*\{[\s\S]*accent-color:\s*Highlight;/
    );
  });

  it("keeps committed slider timing visible across a stale animation override refresh", async () => {
    const card = {
      id: "state:thinking",
      slotType: "state",
      stateKey: "thinking",
      triggerKind: "thinking",
      currentFile: "cloudling-thinking.svg",
      currentFileUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      currentFilePreviewUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      bindingLabel: "states.thinking[0]",
      transition: { in: 120, out: 180 },
      supportsAutoReturn: false,
      supportsDuration: false,
      assetCycleMs: 1000,
      assetCycleStatus: "ok",
      suggestedDurationMs: null,
      suggestedDurationStatus: "unavailable",
      previewDurationMs: 1000,
      displayHintWarning: false,
      displayHintTarget: null,
      fallbackTargetState: null,
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      aspectRatioWarning: null,
    };
    const runtime = {
      animationOverridesData: {
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [],
        sections: [{ id: "work", cards: [card] }],
        cards: [card],
        sounds: [],
      },
      animOverridesSubtab: "animations",
      expandedOverrideRowIds: new Set(["state:thinking"]),
      assetPicker: {
        state: null,
        pollTimer: null,
      },
    };
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => Promise.resolve({ status: "ok" }),
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      },
    });
    const parent = new FakeElement("main");
    let contentRenderCount = 0;
    const renderContent = () => {
      contentRenderCount++;
      parent.innerHTML = "";
      core.tabs.animOverrides.render(parent, core);
    };
    core.ops.requestRender = ({ content = false, modal = false } = {}) => {
      if (content) renderContent();
      if (modal && typeof core.renderHooks.modal === "function") core.renderHooks.modal();
    };
    renderContent();

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    assert.ok(range, "expanded animation override row should render a fade-in range input");
    assert.strictEqual(range.style.getPropertyValue("--anim-override-fill"), "12%");
    range.value = "260";
    for (const listener of range.eventListeners.input || []) listener();
    assert.strictEqual(range.style.getPropertyValue("--anim-override-fill"), "26%");
    for (const listener of range.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const nextRange = parent.querySelectorAll("input").find((input) => input.type === "range");
    assert.strictEqual(contentRenderCount, 1, "timing slider commits should not rebuild the content pane");
    assert.strictEqual(nextRange, range, "timing slider commits should keep the mounted range control in place");
    assert.strictEqual(
      nextRange.value,
      "260",
      "stale refreshes should not flash the slider back to the old committed timing"
    );
  });

  it("updates Animation Overrides reset affordances after the first timing commit", async () => {
    const card = createAnimOverrideCard({
      transition: { in: 150, out: 150 },
      transitionThemeDefault: { in: 150, out: 150 },
      hasTransitionOverride: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const payloads = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (_name, payload) => {
          payloads.push(payload);
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          Object.assign(runtime.animationOverridesData.cards[0], {
            transition: { in: 160, out: 150 },
            transitionThemeDefault: { in: 150, out: 150 },
            hasTransitionOverride: true,
          });
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    let contentRenderCount = 0;
    const renderContent = () => {
      contentRenderCount++;
      parent.innerHTML = "";
      core.tabs.animOverrides.render(parent, core);
    };
    core.ops.requestRender = ({ content = false, modal = false } = {}) => {
      if (content) renderContent();
      if (modal && typeof core.renderHooks.modal === "function") core.renderHooks.modal();
    };
    renderContent();

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(range);
    assert.ok(resetButton);
    assert.strictEqual(resetButton.disabled, true);
    assert.strictEqual(parent.querySelector(".anim-override-badge-dot"), null);

    range.value = "160";
    for (const listener of range.eventListeners.input || []) listener();
    for (const listener of range.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(payloads.length, 1);
    assert.strictEqual(payloads[0].transitionThemeDefault.in, 150);
    assert.strictEqual(payloads[0].transitionThemeDefault.out, 150);
    assert.strictEqual(contentRenderCount, 1, "timing-only commits should keep the content DOM mounted");
    assert.strictEqual(resetButton.disabled, false, "first timing commit should enable the slot reset button");
    assert.ok(parent.querySelector(".anim-override-badge-dot"), "first timing commit should show the changed badge");
  });

  it("clears Animation Overrides reset affordances when timing returns to the theme default", async () => {
    const card = createAnimOverrideCard({
      transition: { in: 160, out: 150 },
      transitionThemeDefault: { in: 150, out: 150 },
      hasTransitionOverride: true,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const payloads = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (_name, payload) => {
          payloads.push(payload);
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          Object.assign(runtime.animationOverridesData.cards[0], {
            transition: { in: 150, out: 150 },
            transitionThemeDefault: { in: 150, out: 150 },
            hasTransitionOverride: false,
          });
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
      readersOverrides: {
        readThemeOverrideMap: () => ({
          states: {
            thinking: {
              transition: { in: 160, out: 150 },
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(range);
    assert.ok(resetButton);
    assert.strictEqual(resetButton.disabled, false);
    assert.ok(parent.querySelector(".anim-override-badge-dot"));

    range.value = "150";
    for (const listener of range.eventListeners.input || []) listener();
    for (const listener of range.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(payloads.length, 1);
    assert.strictEqual(payloads[0].transition.in, 150);
    assert.strictEqual(payloads[0].transition.out, 150);
    assert.strictEqual(payloads[0].transitionThemeDefault.in, 150);
    assert.strictEqual(payloads[0].transitionThemeDefault.out, 150);
    assert.strictEqual(resetButton.disabled, true, "returning to default timing should disable slot reset");
    assert.strictEqual(parent.querySelector(".anim-override-badge-dot"), null);
  });

  it("keeps sequential fade timing commits from reverting the previous side", async () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const payloads = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (_name, payload) => {
          payloads.push(payload);
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const ranges = parent.querySelectorAll("input").filter((input) => input.type === "range");
    assert.ok(ranges.length >= 2, "expanded row should render fade in and fade out sliders");

    ranges[0].value = "260";
    for (const listener of ranges[0].eventListeners.input || []) listener();
    for (const listener of ranges[0].eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    ranges[1].value = "300";
    for (const listener of ranges[1].eventListeners.input || []) listener();
    for (const listener of ranges[1].eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(payloads.length, 2);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(payloads[0].transition)), { in: 260, out: 180 });
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(payloads[1].transition)),
      { in: 260, out: 300 },
      "second fade commit should use the pending/latest fade-in value, not the stale rendered card"
    );
  });

  it("does not submit duplicate animation timing commands on number change followed by blur", async () => {
    const card = {
      id: "state:thinking",
      slotType: "state",
      stateKey: "thinking",
      triggerKind: "thinking",
      currentFile: "cloudling-thinking.svg",
      currentFileUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      currentFilePreviewUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      bindingLabel: "states.thinking[0]",
      transition: { in: 120, out: 180 },
      supportsAutoReturn: false,
      supportsDuration: false,
      assetCycleMs: 1000,
      assetCycleStatus: "ok",
      suggestedDurationMs: null,
      suggestedDurationStatus: "unavailable",
      previewDurationMs: 1000,
      displayHintWarning: false,
      displayHintTarget: null,
      fallbackTargetState: null,
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      aspectRatioWarning: null,
    };
    const runtime = {
      animationOverridesData: {
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [],
        sections: [{ id: "work", cards: [card] }],
        cards: [card],
        sounds: [],
      },
      animOverridesSubtab: "animations",
      expandedOverrideRowIds: new Set(["state:thinking"]),
      assetPicker: {
        state: null,
        pollTimer: null,
      },
    };
    const modalRoot = new FakeElement("div");
    let commandCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => {
          commandCount++;
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const inputs = parent.querySelectorAll("input");
    const range = inputs.find((input) => input.type === "range");
    const number = inputs.find((input) => input.type === "number");
    assert.ok(range, "expanded animation override row should render a fade-in range input");
    assert.ok(number, "expanded animation override row should render a fade-in number input");
    assert.ok(number.parentNode.classList.contains("anim-override-number-field"));
    const unit = number.parentNode.querySelector(".anim-override-slider-unit");
    assert.ok(unit, "timing number input should render an inline unit label");
    assert.strictEqual(unit.textContent, "ms");
    number.value = "260";
    for (const listener of number.eventListeners.input || []) listener();
    assert.strictEqual(range.style.getPropertyValue("--anim-override-fill"), "26%");
    for (const listener of number.eventListeners.change || []) listener();
    for (const listener of number.eventListeners.blur || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(commandCount, 1);
  });

  it("renders the wide hitbox control as a scoped toggle instead of a full-row label", () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const row = parent.querySelector(".anim-override-toggle-row");
    const input = parent.querySelectorAll("input").find((candidate) => candidate.type === "checkbox");
    const title = parent.querySelector(".anim-override-toggle-title");

    assert.ok(row, "expanded animation override row should render a wide-hitbox toggle row");
    assert.strictEqual(row.tagName, "DIV");
    assert.strictEqual(input.getAttribute("aria-label"), "animOverridesWideHitboxToggle");
    assert.ok(title);
    assert.strictEqual((title.eventListeners.click || []).length, 0);
  });

  it("uses null to clear wide hitbox overrides that match the theme default and avoids rebuilding content", async () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const payloads = [];
    let fetchCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (_name, payload) => {
          payloads.push(payload);
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          fetchCount++;
          Object.assign(runtime.animationOverridesData.cards[0], fetchCount === 1
            ? {
                wideHitboxEnabled: true,
                wideHitboxOverridden: true,
                wideHitboxThemeDefault: false,
              }
            : {
                wideHitboxEnabled: false,
                wideHitboxOverridden: false,
                wideHitboxThemeDefault: false,
              });
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    let contentRenderCount = 0;
    const renderContent = () => {
      contentRenderCount++;
      parent.innerHTML = "";
      core.tabs.animOverrides.render(parent, core);
    };
    core.ops.requestRender = ({ content = false, modal = false } = {}) => {
      if (content) renderContent();
      if (modal && typeof core.renderHooks.modal === "function") core.renderHooks.modal();
    };
    renderContent();

    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    assert.ok(toggle, "expanded animation override row should render a wide-hitbox checkbox");

    toggle.checked = true;
    for (const listener of toggle.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();
    let resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(parent.querySelector(".anim-override-badge-dot"), "wide-hitbox commit should update the summary changed badge in place");
    assert.strictEqual(resetButton.disabled, false, "wide-hitbox commit should enable reset affordance in place");

    toggle.checked = false;
    for (const listener of toggle.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();
    resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.strictEqual(parent.querySelector(".anim-override-badge-dot"), null, "theme-default hitbox commit should clear the changed badge in place");
    assert.strictEqual(resetButton.disabled, true, "theme-default hitbox commit should disable reset affordance in place");

    assert.strictEqual(payloads.length, 2);
    assert.strictEqual(payloads[0].enabled, true);
    assert.strictEqual(payloads[1].enabled, null);
    assert.strictEqual(contentRenderCount, 1, "wide-hitbox toggle commits should not rebuild the content pane");
  });

  it("shows the wide hitbox reset chip for stale overrides that already match the theme default", () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: false,
      wideHitboxOverridden: true,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const resetChip = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesWideHitboxResetToTheme");
    assert.ok(resetChip, "wide-hitbox reset chip should render for stale no-op overrides");
    assert.strictEqual(resetChip.hidden, false);
    assert.strictEqual(resetChip.disabled, false);
  });

  it("shows a fallback error detail when wide hitbox saves fail without a message", async () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const toasts = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => Promise.resolve({ status: "error" }),
      },
      opsOverrides: {
        showToast: (message) => toasts.push(message),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    toggle.checked = true;
    for (const listener of toggle.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    assert.ok(toasts.some((message) => String(message).includes("unknown error")));
  });

  it("preserves pending wide hitbox state across full Animation Overrides rerenders", async () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    let resolveCommand;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => new Promise((resolve) => {
          resolveCommand = resolve;
        }),
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          Object.assign(runtime.animationOverridesData.cards[0], {
            wideHitboxEnabled: true,
            wideHitboxOverridden: true,
            wideHitboxThemeDefault: false,
          });
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    const renderContent = () => {
      parent.innerHTML = "";
      core.tabs.animOverrides.render(parent, core);
    };
    core.ops.requestRender = ({ content = false, modal = false } = {}) => {
      if (content) renderContent();
      if (modal && typeof core.renderHooks.modal === "function") core.renderHooks.modal();
    };
    renderContent();

    let toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    assert.ok(toggle, "expanded animation override row should render a wide-hitbox checkbox");

    toggle.checked = true;
    for (const listener of toggle.eventListeners.change || []) listener();

    renderContent();

    toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    const resetChip = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesWideHitboxResetToTheme");
    let resetButton = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesReset");
    assert.ok(toggle, "wide-hitbox checkbox should still exist after rerender");
    assert.strictEqual(toggle.checked, true, "pending wide-hitbox toggles should stay on across rerenders");
    assert.strictEqual(toggle.disabled, true, "pending wide-hitbox toggles should stay disabled across rerenders");
    assert.ok(resetChip, "wide-hitbox reset chip should still exist after rerender");
    assert.strictEqual(resetChip.hidden, false, "pending wide-hitbox rerenders should keep the reset chip visible");
    assert.strictEqual(resetChip.disabled, true, "pending wide-hitbox rerenders should keep the reset chip disabled");
    assert.ok(resetButton, "pending wide-hitbox rerenders should keep the slot reset button mounted");
    assert.strictEqual(resetButton.disabled, true, "slot reset should stay disabled while a wide-hitbox edit is pending");

    resolveCommand({ status: "ok" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    resetButton = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesReset");
    assert.strictEqual(toggle.checked, true);
    assert.strictEqual(toggle.disabled, false);
    assert.strictEqual(resetButton.disabled, false);
  });

  it("blocks wide hitbox edits while a same-card timing edit is pending", async () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const calls = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          calls.push({ name, payload });
          return new Promise(() => {});
        },
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    range.value = "260";
    for (const listener of range.eventListeners.change || []) listener();

    assert.strictEqual(toggle.disabled, true, "wide-hitbox toggle should be blocked while timing is pending");
    toggle.checked = true;
    for (const listener of toggle.eventListeners.change || []) listener();
    await Promise.resolve();

    assert.deepStrictEqual(
      calls.map((call) => call.name),
      ["setAnimationOverride"],
      "blocked wide-hitbox changes should not enqueue a second override command"
    );
  });

  it("blocks slot reset while a same-card timing edit is pending", async () => {
    const card = createAnimOverrideCard({
      hasTransitionOverride: true,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const calls = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          calls.push({ name, payload });
          return new Promise(() => {});
        },
      },
      readersOverrides: {
        readThemeOverrideMap: () => ({
          states: {
            thinking: {
              transition: { in: 120, out: 180 },
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    range.value = "260";
    for (const listener of range.eventListeners.change || []) listener();

    assert.strictEqual(resetButton.disabled, true, "slot reset should be blocked while timing is pending");
    for (const listener of resetButton.eventListeners.click || []) listener();
    await Promise.resolve();

    assert.deepStrictEqual(
      calls.map((call) => call.name),
      ["setAnimationOverride"],
      "blocked slot reset should not enqueue a reset command"
    );
  });

  it("blocks timing edits while a same-card wide hitbox edit is pending", async () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const calls = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          calls.push({ name, payload });
          return new Promise(() => {});
        },
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    toggle.checked = true;
    for (const listener of toggle.eventListeners.change || []) listener();

    assert.strictEqual(range.disabled, true, "timing slider should be blocked while wide-hitbox is pending");
    range.value = "260";
    for (const listener of range.eventListeners.change || []) listener();
    await Promise.resolve();

    assert.deepStrictEqual(
      calls.map((call) => call.name),
      ["setWideHitboxOverride"],
      "blocked timing changes should not enqueue a second override command"
    );
  });

  it("reconciles acknowledged pending wide hitbox edits during Animation Overrides render", () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: true,
      wideHitboxOverridden: true,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    runtime.pendingWideHitboxOverrideEdits = new Map([[
      card.id,
      {
        seq: 1,
        currentFile: card.currentFile,
        themeDefault: false,
        effectiveEnabled: true,
        commandEnabled: true,
      },
    ]]);
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    const resetButton = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesReset");
    assert.strictEqual(runtime.pendingWideHitboxOverrideEdits.size, 0);
    assert.strictEqual(toggle.disabled, false);
    assert.strictEqual(resetButton.disabled, false);
  });

  it("treats hitbox-only overrides as overridden for summary badges and reset actions", () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: true,
      wideHitboxOverridden: true,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      readersOverrides: {
        hasAnyThemeOverride: () => true,
        readThemeOverrideMap: () => ({
          hitbox: {
            wide: {
              "cloudling-thinking.svg": true,
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const summaryDot = parent.querySelector(".anim-override-badge-dot");
    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");

    assert.ok(summaryDot, "hitbox-only overrides should still show the overridden summary badge");
    assert.ok(resetButton, "expanded row should render a reset button");
    assert.strictEqual(resetButton.disabled, false, "hitbox-only overrides should enable the reset button");
  });

  it("clears hitbox-only overrides when resetting an animation override slot", async () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: true,
      wideHitboxOverridden: true,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const calls = [];
    let resolveAnimationReset;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          calls.push({ name, payload });
          if (name === "setAnimationOverride") {
            return new Promise((resolve) => {
              resolveAnimationReset = resolve;
            });
          }
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      },
      readersOverrides: {
        readThemeOverrideMap: () => ({
          hitbox: {
            wide: {
              "cloudling-thinking.svg": true,
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(resetButton, "expanded row should render a reset button");
    const resetPromises = (resetButton.eventListeners.click || []).map((listener) => listener());
    await Promise.resolve();
    await Promise.resolve();

    const toggleWhileResetPending = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    const resetChipWhileResetPending = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesWideHitboxResetToTheme");
    assert.strictEqual(toggleWhileResetPending.disabled, true, "slot reset should block wide-hitbox toggles while pending");
    assert.strictEqual(resetChipWhileResetPending.disabled, true, "slot reset should block wide-hitbox reset chips while pending");

    resolveAnimationReset({ status: "ok" });
    await Promise.all(resetPromises);

    assert.deepStrictEqual(
      calls.map((call) => call.name),
      ["setAnimationOverride", "setWideHitboxOverride"]
    );
    assert.strictEqual(calls[1].payload.enabled, null);
    assert.strictEqual(runtime.pendingWideHitboxOverrideEdits.size, 0);
    assert.strictEqual(runtime.pendingAnimationOverrideResets.size, 0);
  });

  it("clears hitbox overrides for the pre-reset replacement file when resetting a slot", async () => {
    const replacementFile = "replacement-thinking.svg";
    const baseFile = "cloudling-thinking.svg";
    const card = createAnimOverrideCard({
      currentFile: replacementFile,
      wideHitboxEnabled: true,
      wideHitboxOverridden: true,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const calls = [];
    let resolveAnimationReset;
    let fetchCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          calls.push({ name, payload });
          if (name === "setAnimationOverride") {
            return new Promise((resolve) => {
              resolveAnimationReset = resolve;
            });
          }
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          fetchCount++;
          if (fetchCount === 1) {
            Object.assign(runtime.animationOverridesData.cards[0], {
              currentFile: baseFile,
              wideHitboxEnabled: true,
              wideHitboxOverridden: false,
              wideHitboxThemeDefault: true,
            });
          }
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
      readersOverrides: {
        readThemeOverrideMap: () => ({
          states: {
            thinking: {
              file: replacementFile,
            },
          },
          hitbox: {
            wide: {
              [replacementFile]: true,
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(resetButton, "expanded row should render a reset button");
    const resetPromises = (resetButton.eventListeners.click || []).map((listener) => listener());
    await Promise.resolve();
    await Promise.resolve();

    resolveAnimationReset({ status: "ok" });
    await Promise.all(resetPromises);

    assert.deepStrictEqual(
      calls.map((call) => call.name),
      ["setAnimationOverride", "setWideHitboxOverride"]
    );
    assert.strictEqual(calls[1].payload.file, replacementFile);
    assert.strictEqual(calls[1].payload.enabled, null);
    assert.strictEqual(runtime.pendingWideHitboxOverrideEdits.size, 0);
    assert.strictEqual(runtime.pendingAnimationOverrideResets.size, 0);
    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    assert.strictEqual(toggle.checked, true, "base file wide-hitbox default should be restored after reset");
    assert.strictEqual(toggle.disabled, false);
  });

  it("clears pending timing edits when animation override commands reject", async () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const toasts = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => Promise.reject(new Error("ipc failed")),
      },
      opsOverrides: {
        showToast: (message) => toasts.push(message),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    range.value = "260";
    for (const listener of range.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(runtime.pendingAnimationOverrideEdits.size, 0);
    assert.strictEqual(toggle.disabled, false, "wide-hitbox toggle should unlock after a rejected timing command");
    assert.ok(toasts.some((message) => String(message).includes("ipc failed")));
  });

  it("treats reaction-only overrides as overridden for summary badges and reset actions", () => {
    const card = createAnimOverrideCard({
      id: "reaction:clickLeft",
      slotType: "reaction",
      reactionKey: "clickLeft",
      stateKey: undefined,
      supportsDuration: true,
      durationMs: 1600,
      hasDurationOverride: true,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      readersOverrides: {
        hasAnyThemeOverride: () => true,
        readThemeOverrideMap: () => ({
          reactions: {
            clickLeft: {
              durationMs: 1600,
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const summaryDot = parent.querySelector(".anim-override-badge-dot");
    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");

    assert.ok(summaryDot, "reaction-only overrides should show the overridden summary badge");
    assert.ok(resetButton, "expanded row should render a reset button");
    assert.strictEqual(resetButton.disabled, false, "reaction-only overrides should enable the reset button");
  });

  it("does not keep reset-slot null timing values as pending slider edits", async () => {
    const card = createAnimOverrideCard({
      supportsAutoReturn: true,
      autoReturnMs: 2600,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const payloads = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (_name, payload) => {
          payloads.push(payload);
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      },
      readersOverrides: {
        readThemeOverrideMap: () => ({
          states: {
            thinking: {
              transition: { in: 120, out: 180 },
            },
          },
          timings: {
            autoReturn: {
              thinking: 2600,
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(resetButton, "expanded row should render a reset button");
    for (const listener of resetButton.eventListeners.click || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(payloads.length, 1);
    assert.strictEqual(payloads[0].autoReturnMs, null);
    assert.ok(
      !core.runtime.pendingAnimationOverrideEdits || core.runtime.pendingAnimationOverrideEdits.size === 0,
      "reset-slot null timing values should not leak into the pending timing edit map"
    );
  });

  it("only patches Animation Overrides broadcasts that exactly acknowledge pending timing edits", () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    let fetchCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => new Promise(() => {}),
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          fetchCount++;
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const fadeInRange = parent.querySelectorAll("input").find((input) => input.type === "range");
    fadeInRange.value = "260";
    for (const listener of fadeInRange.eventListeners.input || []) listener();
    for (const listener of fadeInRange.eventListeners.change || []) listener();

    const previousSnapshot = { themeOverrides: {} };
    const acknowledgedSnapshot = {
      themeOverrides: {
        cloudling: {
          states: {
            thinking: {
              transition: { in: 260, out: 180 },
            },
          },
        },
      },
    };
    assert.strictEqual(
      core.tabs.animOverrides.patchInPlace(
        { themeOverrides: acknowledgedSnapshot.themeOverrides },
        { previousSnapshot, snapshot: acknowledgedSnapshot }
      ),
      true,
      "the in-flight timing edit broadcast should be safe to reconcile in place"
    );

    const unrelatedSnapshot = {
      themeOverrides: {
        cloudling: {
          states: {
            working: {
              file: "other.svg",
            },
          },
        },
      },
    };
    assert.strictEqual(
      core.tabs.animOverrides.patchInPlace(
        { themeOverrides: unrelatedSnapshot.themeOverrides },
        { previousSnapshot, snapshot: unrelatedSnapshot }
      ),
      false,
      "unrelated themeOverrides broadcasts should fall through to a full content refresh"
    );
    assert.strictEqual(fetchCount, 1);
  });

  it("refreshes cached theme capabilities after Animation Overrides changes", async () => {
    let themeFetches = 0;
    const core = loadSettingsCoreForTest({
      listThemes: () => {
        themeFetches++;
        return Promise.resolve([{
          id: "custom",
          name: "Custom",
          active: true,
          capabilities: { petTint: false, accessories: false },
        }]);
      },
      getAnimationOverridesData: () => Promise.resolve({
        theme: { id: "custom", name: "Custom" },
        assets: [],
        sections: [],
        cards: [],
        sounds: [],
      }),
    });
    core.state.activeTab = "animOverrides";
    core.state.snapshot = { theme: "custom", themeOverrides: {} };
    core.runtime.themeList = [{
      id: "custom",
      name: "Custom",
      active: true,
      capabilities: { petTint: false, accessories: true },
    }];
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {},
      modal: () => {},
    });

    const nextSnapshot = {
      theme: "custom",
      themeOverrides: {
        custom: {
          states: {
            idle: { sourceThemeId: "custom", file: "replacement.svg" },
          },
        },
      },
    };
    core.ops.applyChanges({
      changes: { themeOverrides: nextSnapshot.themeOverrides },
      snapshot: nextSnapshot,
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(themeFetches, 1);
    assert.strictEqual(
      core.runtime.themeList[0].capabilities.accessories,
      false,
      "returning to Theme must not reuse capability metadata from before the override"
    );
  });

  it("routes matching Animation Overrides timing broadcasts through applyChanges in place", () => {
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => Promise.resolve({
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [],
        sections: [],
        cards: [{
          id: "state:thinking",
          slotType: "state",
          stateKey: "thinking",
          transition: { in: 260, out: 180 },
        }],
        sounds: [],
      }),
    });
    core.state.activeTab = "animOverrides";
    core.state.snapshot = {
      theme: "cloudling",
      themeOverrides: {},
    };
    core.runtime.animationOverridesData = {
      theme: { id: "cloudling", name: "Cloudling" },
      assets: [],
      sections: [],
      cards: [{
        id: "state:thinking",
        slotType: "state",
        stateKey: "thinking",
        transition: { in: 120, out: 180 },
      }],
      sounds: [],
    };
    core.runtime.animOverridesSubtab = "animations";
    core.runtime.assetPicker.state = null;
    core.runtime.pendingAnimationOverrideEdits.set("state:thinking", {
      seq: 1,
      slotType: "state",
      stateKey: "thinking",
      transition: { in: 260, out: 180 },
    });

    let contentRenderCount = 0;
    let modalRenderCount = 0;
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {
        contentRenderCount++;
      },
      modal: () => {
        modalRenderCount++;
      },
    });

    const nextSnapshot = {
      theme: "cloudling",
      themeOverrides: {
        cloudling: {
          states: {
            thinking: {
              transition: { in: 260, out: 180 },
            },
          },
        },
      },
    };
    core.ops.applyChanges({
      changes: { themeOverrides: nextSnapshot.themeOverrides },
      snapshot: nextSnapshot,
    });

    assert.strictEqual(contentRenderCount, 0, "matching timing ack should avoid rebuilding content");
    assert.strictEqual(modalRenderCount, 0, "modal render happens after the async fetch settles");
  });

  it("routes default-matching timing broadcasts through applyChanges in place", () => {
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => Promise.resolve({
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [],
        sections: [],
        cards: [{
          id: "state:thinking",
          slotType: "state",
          stateKey: "thinking",
          transition: { in: 150, out: 150 },
          transitionThemeDefault: { in: 150, out: 150 },
          hasTransitionOverride: false,
        }],
        sounds: [],
      }),
    });
    core.state.activeTab = "animOverrides";
    core.state.snapshot = {
      theme: "cloudling",
      themeOverrides: {
        cloudling: {
          states: {
            thinking: {
              transition: { in: 160, out: 150 },
            },
          },
        },
      },
    };
    core.runtime.animationOverridesData = {
      theme: { id: "cloudling", name: "Cloudling" },
      assets: [],
      sections: [],
      cards: [{
        id: "state:thinking",
        slotType: "state",
        stateKey: "thinking",
        transition: { in: 160, out: 150 },
        transitionThemeDefault: { in: 150, out: 150 },
        hasTransitionOverride: true,
      }],
      sounds: [],
    };
    core.runtime.animOverridesSubtab = "animations";
    core.runtime.assetPicker.state = null;
    core.runtime.pendingAnimationOverrideEdits.set("state:thinking", {
      seq: 1,
      slotType: "state",
      stateKey: "thinking",
      transition: { in: 150, out: 150 },
      transitionThemeDefault: { in: 150, out: 150 },
    });

    let contentRenderCount = 0;
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {
        contentRenderCount++;
      },
      modal: () => {},
    });

    const nextSnapshot = {
      theme: "cloudling",
      themeOverrides: {},
    };
    core.ops.applyChanges({
      changes: { themeOverrides: nextSnapshot.themeOverrides },
      snapshot: nextSnapshot,
    });

    assert.strictEqual(contentRenderCount, 0, "default timing ack should avoid rebuilding content");
  });

  it("does not patch mixed-key Animation Overrides broadcasts in place", () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    let fetchCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => new Promise(() => {}),
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          fetchCount++;
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const fadeInRange = parent.querySelectorAll("input").find((input) => input.type === "range");
    fadeInRange.value = "260";
    for (const listener of fadeInRange.eventListeners.input || []) listener();
    for (const listener of fadeInRange.eventListeners.change || []) listener();

    const previousSnapshot = { lang: "en", themeOverrides: {} };
    const snapshot = {
      lang: "ja",
      themeOverrides: {
        cloudling: {
          states: {
            thinking: {
              transition: { in: 260, out: 180 },
            },
          },
        },
      },
    };

    assert.strictEqual(
      core.tabs.animOverrides.patchInPlace(
        { lang: "ja", themeOverrides: snapshot.themeOverrides },
        { previousSnapshot, snapshot }
      ),
      false,
      "mixed-key broadcasts should fall through so non-timing UI side effects can render"
    );
    assert.strictEqual(fetchCount, 0);
  });

  it("clears pending Animation Overrides timing edits on theme changes", () => {
    const core = loadSettingsCoreForTest({});
    core.state.snapshot = {
      theme: "cloudling",
      themeVariant: "default",
      themeOverrides: {},
    };
    core.runtime.pendingAnimationOverrideEdits.set("state:thinking", {
      slotType: "state",
      stateKey: "thinking",
      transition: { in: 260, out: 180 },
      seq: 1,
    });
    core.state.mountedControls.animOverrideTimingSliders.set("state:thinking:transition.in", { row: {} });
    core.runtime.pendingAnimationOverrideResets = new Set(["state:thinking"]);

    core.ops.applyChanges({
      changes: { theme: "calico" },
      snapshot: {
        theme: "calico",
        themeVariant: "default",
        themeOverrides: {},
      },
    });

    assert.strictEqual(core.runtime.pendingAnimationOverrideEdits.size, 0);
    assert.strictEqual(core.runtime.pendingAnimationOverrideResets.size, 0);
    assert.strictEqual(core.state.mountedControls.animOverrideTimingSliders.size, 0);
  });

  it("does not patch Animation Overrides broadcasts without a pending timing edit", () => {
    const card = {
      id: "state:thinking",
      slotType: "state",
      stateKey: "thinking",
      triggerKind: "thinking",
      currentFile: "cloudling-thinking.svg",
      currentFileUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      currentFilePreviewUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      bindingLabel: "states.thinking[0]",
      transition: { in: 120, out: 180 },
      supportsAutoReturn: false,
      supportsDuration: false,
      assetCycleMs: 1000,
      assetCycleStatus: "ok",
      suggestedDurationMs: null,
      suggestedDurationStatus: "unavailable",
      previewDurationMs: 1000,
      displayHintWarning: false,
      displayHintTarget: null,
      fallbackTargetState: null,
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      aspectRatioWarning: null,
    };
    const runtime = {
      animationOverridesData: {
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [],
        sections: [{ id: "work", cards: [card] }],
        cards: [card],
        sounds: [],
      },
      animOverridesSubtab: "animations",
      expandedOverrideRowIds: new Set(["state:thinking"]),
      assetPicker: {
        state: null,
        pollTimer: null,
      },
    };
    const modalRoot = new FakeElement("div");
    let fetchCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          fetchCount++;
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    assert.strictEqual(core.tabs.animOverrides.patchInPlace({ themeOverrides: { cloudling: { states: {} } } }), false);
    assert.strictEqual(fetchCount, 0);
  });

  // ── A1 layout contract tests ─────────────────────────────────────────

  it("PR #1329 follow-up: translates the listed-only folder toast in every supported language", () => {
    const strings = loadSettingsI18nForTest();
    for (const lang of SUPPORTED_LANGS) {
      assert.strictEqual(typeof strings[lang].toastClaudeConfigDirListed, "string", lang);
      assert.ok(strings[lang].toastClaudeConfigDirListed.length > 0, lang);
      assert.notStrictEqual(strings[lang].toastClaudeConfigDirListed, strings[lang].toastClaudeConfigDirAdded, lang);
    }
  });

  it("removes the legacy badges, banners and disconnect button from the source", () => {
    const agentsSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-agents.js"), "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(!agentsSource.includes("actionButton:"));
    assert.ok(!agentsSource.includes("agent-badge"));
    assert.ok(!agentsSource.includes("buildAgentInstallHintBanner"));
    assert.ok(!css.includes(".agent-badge"));

    const defaultGroupIndex = css.indexOf("grid-template-columns: minmax(58px, max-content) minmax(0, 1fr)");
    const mobileGroupIndex = css.indexOf("@media (max-width: 720px)", defaultGroupIndex);
    assert.ok(defaultGroupIndex >= 0 && mobileGroupIndex > defaultGroupIndex,
      "the narrow-window single-column rule must come after the default two-column rule");
    const mobileBlock = css.slice(mobileGroupIndex);
    assert.match(
      mobileBlock,
      /\.agent-detail-group,\s*\.settings-detail-group\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
  });
});

describe("macOS platform detection (Settings shortcut labels)", () => {
  const isMac = (platform) => (platform || "").startsWith("Mac");

  it("detects every known macOS navigator.platform value", () => {
    assert.strictEqual(isMac("MacIntel"), true);
    assert.strictEqual(isMac("MacPPC"), true);
    assert.strictEqual(isMac("Mac68K"), true);
    assert.strictEqual(isMac("MacARM64"), true);
  });

  it("returns false for non-macOS platforms and degenerate values", () => {
    assert.strictEqual(isMac("Win32"), false);
    assert.strictEqual(isMac("Linux x86_64"), false);
    assert.strictEqual(isMac("iPhone"), false);
    assert.strictEqual(isMac(""), false);
    assert.strictEqual(isMac(undefined), false);
    assert.strictEqual(isMac(null), false);
  });
});

// A focused document model for real shared-controller and shell tests. Focus
// events and attachment state matter here, unlike the layout-only harnesses.
function createChoiceDocument() {
  const body = new FakeElement("body");
  const document = {
    body, activeElement: body,
    createElement(tag) {
      const node = new FakeElement(tag);
      node.focus = () => {
        if (node.disabled || document.activeElement === node) return;
        const previous = document.activeElement;
        document.activeElement = node;
        previous?.dispatchEvent({ type: "blur", relatedTarget: node, bubbles: false });
        node.dispatchEvent({ type: "focus", relatedTarget: previous, bubbles: false });
      };
      return node;
    },
    getElementById(id) {
      const visit = (node) => node.id === id ? node : node.children.map(visit).find(Boolean);
      return visit(body) || null;
    },
  };
  return document;
}

function mountChoice(document, control) {
  document.body.appendChild(control.element);
  for (const panel of control.panels?.values() || []) document.body.appendChild(panel);
  return control.element.querySelectorAll("button");
}

const choiceOptions = () => [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta", disabled: true },
  { value: "c", label: "Gamma" },
];
const settleChoice = () => new Promise((resolve) => setImmediate(resolve));

describe("Settings tabs and segmented choice contracts", () => {
  it("dismisses the shared hint before replacing its subpage anchor", () => {
    const document = createChoiceDocument();
    const core = loadSettingsCoreForTest({}, { document });
    const panel = document.createElement("div");
    document.body.appendChild(panel);
    const host = core.helpers.createSubpageHost();
    host.render(panel, (body) => {
      const row = buildFakeSettingRow(document, { label: "Label", description: "Folded description" });
      core.helpers.attachDescriptionDisclosure(row.element);
      body.appendChild(row.element);
    });
    const anchor = panel.querySelector(".row-desc-toggle");
    anchor.dispatchEvent({ type: "mouseenter" });
    const tooltip = document.body.querySelector(".settings-tooltip");
    assert.equal(tooltip.classList.contains("visible"), true);

    host.render(panel, () => {
      assert.equal(tooltip.classList.contains("visible"), false);
      assert.equal(tooltip.getAttribute("aria-hidden"), "true");
    });
    assert.equal(anchor.isConnected, false);
    host.dispose();
  });

  it("replaces only subpage bodies, restores lost focus and invalidates disposed scroll work", () => {
    const document = createChoiceDocument();
    const frames = [];
    const core = loadSettingsCoreForTest({}, { document, requestAnimationFrame: (cb) => frames.push(cb) });
    const scroller = document.createElement("main");
    scroller.id = "content";
    document.body.appendChild(scroller);
    const fallback = document.createElement("button");
    fallback.setAttribute("data-settings-focus-key", "period");
    scroller.appendChild(fallback);
    const panel = document.createElement("div");
    scroller.appendChild(panel);
    let cleanups = 0;
    const host = core.helpers.createSubpageHost({ disposeBody: () => { cleanups++; } });
    const renderInput = (body) => {
      const input = document.createElement("input");
      input.setAttribute("data-settings-focus-key", "draft");
      input.setAttribute("data-settings-focus-fallback-key", "period");
      body.appendChild(input);
    };
    host.render(panel, renderInput);
    panel.children[0].focus();
    scroller.scrollTop = 90;
    host.render(panel, renderInput);
    assert.equal(cleanups, 1);
    assert.strictEqual(document.activeElement, panel.children[0]);
    assert.equal(scroller.scrollTop, 90);
    host.render(panel, () => {});
    assert.strictEqual(document.activeElement, fallback);
    const modal = document.createElement("button");
    document.body.appendChild(modal);
    host.render(panel, (body) => { renderInput(body); modal.focus(); });
    assert.strictEqual(document.activeElement, modal, "a dialog keeps its focus");
    host.dispose();
    scroller.scrollTop = 20;
    frames.forEach((frame) => frame());
    assert.equal(scroller.scrollTop, 20);
    assert.equal(host.render(panel, () => { throw new Error("disposed host rendered"); }), false);
  });

  for (const orientation of ["horizontal", "vertical"]) {
    it(`uses manual activation, wrapping and disabled skipping for ${orientation} tabs`, () => {
      const document = createChoiceDocument();
      const core = loadSettingsCoreForTest({}, { document });
      const changes = [];
      const control = core.helpers.buildTabs({ id: "test-tabs", ariaLabel: "Views", value: "a",
        orientation, options: choiceOptions(), onChange: (value) => changes.push(value) });
      const [a, b, c] = mountChoice(document, control);
      assert.equal(control.element.getAttribute("role"), "tablist");
      assert.equal(control.element.getAttribute("aria-orientation"), orientation);
      for (const button of [a, b, c]) {
        const panel = document.getElementById(button.getAttribute("aria-controls"));
        assert.ok(panel);
        assert.equal(panel.getAttribute("aria-labelledby"), button.id);
        assert.equal(panel.getAttribute("role"), "tabpanel");
      }
      a.focus();
      a.dispatchEvent(createKeyboardEventForTest(orientation === "vertical" ? "ArrowDown" : "ArrowRight"));
      assert.strictEqual(document.activeElement, c);
      assert.equal(control.getValue(), "a");
      assert.deepEqual(changes, []);
      assert.equal(c.tabIndex, 0);
      assert.equal(a.tabIndex, -1);
      assert.equal(b.tabIndex, -1);
      assert.equal(control.panels.get("a").hidden, false);
      c.dispatchEvent(createKeyboardEventForTest("Enter"));
      c.dispatchEvent({ type: "click" });
      assert.deepEqual(changes, ["c"], "native click after Enter cannot activate twice");
      assert.equal(c.getAttribute("aria-selected"), "true");
      assert.equal(control.panels.get("a").hidden, true);
      assert.equal(control.panels.get("c").hidden, false);
      c.dispatchEvent(createKeyboardEventForTest(orientation === "vertical" ? "ArrowDown" : "ArrowRight"));
      assert.strictEqual(document.activeElement, a);
      a.dispatchEvent(createKeyboardEventForTest("End"));
      assert.strictEqual(document.activeElement, c);
      c.dispatchEvent(createKeyboardEventForTest("Home"));
      assert.strictEqual(document.activeElement, a);
      const perpendicular = createKeyboardEventForTest(orientation === "vertical" ? "ArrowRight" : "ArrowDown");
      a.dispatchEvent(perpendicular);
      assert.ok(!perpendicular.defaultPrevented);
      const outside = document.createElement("input");
      document.body.appendChild(outside);
      outside.focus();
      assert.equal(c.tabIndex, 0, "reentry targets the selected tab");
      assert.equal(a.tabIndex, -1);
      control.setValue("a");
      assert.deepEqual(changes, ["c"], "snapshot updates never call onChange");
      control.setDisabled(true);
      assert.ok([a, b, c].every((button) => button.disabled && button.tabIndex === -1));
      control.setDisabled(false);
      assert.equal(a.tabIndex, 0);
      control.dispose();
      control.dispose();
      c.click();
      assert.deepEqual(changes, ["c"]);
      assert.ok(Object.values(c.eventListeners).every((listeners) => listeners.length === 0));
    });
  }

  it("requires accessible names and handles empty/all-disabled groups", () => {
    const document = createChoiceDocument();
    const core = loadSettingsCoreForTest({}, { document });
    assert.throws(() => core.helpers.buildTabs({ id: "unnamed" }), /accessible name/);
    assert.throws(() => core.helpers.buildSegmentedRadio({}), /accessible name/);
    for (const options of [[], choiceOptions().map((option) => ({ ...option, disabled: true }))]) {
      const control = core.helpers.buildTabs({ id: "empty", ariaLabel: "Empty", options });
      const buttons = mountChoice(document, control);
      control.focus();
      assert.ok(buttons.every((button) => button.tabIndex === -1));
      assert.strictEqual(document.activeElement, document.body);
    }
  });

  it("keeps radio keyboard selection synchronous, skips disabled values and rolls back rejection", () => {
    const document = createChoiceDocument();
    const core = loadSettingsCoreForTest({}, { document });
    let accept = true;
    const control = core.helpers.buildSegmentedRadio({ id: "choice", ariaLabel: "Mode", value: "a",
      options: choiceOptions(), onChange: () => accept });
    const [a, b, c] = mountChoice(document, control);
    a.focus();
    a.dispatchEvent(createKeyboardEventForTest("ArrowRight"));
    assert.strictEqual(document.activeElement, c);
    assert.equal(control.getValue(), "c");
    assert.equal(control.element.getAttribute("aria-busy"), "false");
    assert.equal(c.getAttribute("aria-checked"), "true");
    assert.equal(b.tabIndex, -1);
    accept = false;
    c.dispatchEvent(createKeyboardEventForTest("Home"));
    assert.equal(control.getValue(), "c");
    assert.equal(c.tabIndex, 0);
    assert.equal(a.getAttribute("aria-checked"), "false");
  });

  for (const outcome of ["reject", "throw", "accept"]) {
    it(`keeps authoritative snapshots and independent locks after async ${outcome}`, async () => {
      const document = createChoiceDocument();
      const core = loadSettingsCoreForTest({}, { document });
      const deferred = createDeferred();
      let calls = 0;
      const control = core.helpers.buildSegmentedRadio({ id: "race", ariaLabel: "Mode", value: "a",
        options: choiceOptions(), onChange: () => { calls++; return deferred.promise; } });
      const [a, , c] = mountChoice(document, control);
      c.focus();
      c.click();
      a.click();
      c.dispatchEvent(createKeyboardEventForTest("Home"));
      assert.equal(calls, 1);
      assert.strictEqual(document.activeElement, c, "pending must not discard focus");
      control.setValue("b");
      control.setPending(true);
      control.setDisabled(true);
      if (outcome === "throw") deferred.reject(new Error("save failed"));
      else deferred.resolve(outcome === "accept");
      await settleChoice();
      assert.equal(control.getValue(), "b", "an old result cannot overwrite a newer snapshot");
      assert.equal(control.element.getAttribute("aria-busy"), "true");
      control.setPending(false);
      assert.equal(c.disabled, true, "clearing pending preserves business disabled");
      control.setDisabled(false);
      assert.equal(c.disabled, false);
    });
  }

  it("locks before invoking a callback and makes disposal invalidate asynchronous completion", async () => {
    const document = createChoiceDocument();
    const core = loadSettingsCoreForTest({}, { document });
    const deferred = createDeferred();
    let calls = 0;
    let buttons;
    const control = core.helpers.buildSegmentedRadio({ ariaLabel: "Mode", value: "a", options: choiceOptions(),
      onChange() { calls++; buttons[0].click(); return deferred.promise; } });
    buttons = mountChoice(document, control);
    buttons[2].focus();
    buttons[2].click();
    assert.equal(calls, 1);
    control.dispose();
    const before = control.element.getAttribute("aria-busy");
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();
    deferred.resolve(false);
    await settleChoice();
    assert.equal(control.getValue(), "c");
    assert.equal(control.element.getAttribute("aria-busy"), before, "disposed DOM must not be patched");
    assert.strictEqual(document.activeElement, outside);
    assert.equal(core.state.mountedControls.segmentedRadios.size, 0);
  });

  it("does not steal focus after an asynchronous save while still mounted", async () => {
    const document = createChoiceDocument();
    const core = loadSettingsCoreForTest({}, { document });
    const deferred = createDeferred();
    const control = core.helpers.buildSegmentedRadio({ ariaLabel: "Mode", value: "a", options: choiceOptions(),
      onChange: () => deferred.promise });
    const buttons = mountChoice(document, control);
    buttons[2].focus();
    buttons[2].click();
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();
    deferred.resolve(false);
    await settleChoice();
    assert.strictEqual(document.activeElement, outside);
    assert.equal(control.getValue(), "a");
  });

  it("restores focused-but-unselected tabs on sidebar and content replacement without stealing modal focus", () => {
    const document = createChoiceDocument();
    const sidebar = document.createElement("aside"); sidebar.id = "sidebar";
    const content = document.createElement("main"); content.id = "content";
    document.body.append(sidebar, content);
    const core = loadSettingsCoreForTest({}, { document });
    let control;
    let options = choiceOptions();
    let modalFocus = null;
    const render = () => {
      control?.dispose();
      sidebar.innerHTML = "";
      content.innerHTML = "";
      control = core.helpers.buildTabs({ id: "navigation", ariaLabel: "Pages", value: "a", options });
      sidebar.appendChild(control.element);
      for (const panel of control.panels.values()) content.appendChild(panel);
    };
    core.ops.installRenderHooks({ sidebar: render, content: () => {}, modal: () => modalFocus?.focus() });
    core.ops.requestRender({ sidebar: true, content: true });
    control.focus("c");
    core.ops.requestRender({ sidebar: true, content: true });
    assert.equal(document.activeElement.dataset.value, "c");
    assert.equal(document.activeElement.getAttribute("aria-selected"), "false");
    assert.equal(document.activeElement.tabIndex, 0);
    options = choiceOptions().filter((option) => option.value !== "c");
    core.ops.requestRender({ sidebar: true, content: true });
    assert.equal(document.activeElement.dataset.value, "a", "removed focus falls back to selected tab");
    modalFocus = document.createElement("input");
    document.body.appendChild(modalFocus);
    core.ops.requestRender({ sidebar: true, content: true, modal: true });
    assert.strictEqual(document.activeElement, modalFocus);
  });
});

describe("issue #1323: theme appearance refreshes animation data", () => {
  it("issue #1323: a themeAppearance change refetches animation overrides data", async () => {
    let fetches = 0;
    const settingsAPI = {
      getAnimationOverridesData: () => {
        fetches += 1;
        return Promise.resolve({ theme: null, assets: [], sections: [], cards: [], sounds: [] });
      },
    };
    const core = loadSettingsCoreForTest(settingsAPI, {
      document: { body: { contains: () => false }, getElementById: () => null },
    });
    core.state.activeTab = "animOverrides";
    core.state.snapshot = { theme: "night", themeAppearance: {}, themeOverrides: {} };
    core.ops.installRenderHooks({ sidebar: () => {}, content: () => {}, modal: () => {} });

    core.ops.applyChanges({
      changes: { themeAppearance: { night: "dark" } },
      snapshot: { ...core.state.snapshot, themeAppearance: { night: "dark" } },
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(fetches >= 1, "animation override data must be refetched");
  });
});
