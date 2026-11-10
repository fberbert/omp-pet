"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC_DIR = path.join(__dirname, "..", "src");
const ICONS = path.join(SRC_DIR, "settings-icons.js");
const RENDERER = path.join(SRC_DIR, "settings-renderer.js");

class FakeClassList {
  constructor(el) {
    this.el = el;
  }

  _values() {
    return new Set(String(this.el.className || "").split(/\s+/).filter(Boolean));
  }

  _set(values) {
    this.el.className = [...values].join(" ");
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
    if (typeof document !== "undefined") document.activeElement = this;
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
    return this.children.some((child) => child.contains(target));
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
}

function loadIcons() {
  const context = { globalThis: null };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(ICONS, "utf8"), context);
  return context.ClawdSettingsIcons;
}

// `modelBrowserScroll` reproduces what a real browser does to a scrolled
// container when its children are replaced: the emptied pane clamps scrollTop
// to 0 and the focused control drops back to <body>. The default (false) keeps
// the older FakeElement behavior the other tests were written against.

describe("settings tab split", () => {
  it("wires the deep-link receiver for sessions and recap only", () => {
    const source = fs.readFileSync(RENDERER, "utf8");
    const initStart = source.indexOf("globalThis.ClawdSettingsTabGeneral.init(core);");
    const wiringStart = source.indexOf("core.ops.restoreNavigationState();");
    const slice = source.slice(0, initStart) + source.slice(wiringStart);

    function run(consumeTab) {
      const selected = [];
      let requestedCallback = null;
      const core = {
        state: { activeTab: "general" },
        helpers: {
          t: (key) => key,
          escapeHtml: (value) => value,
          buildTabs: () => ({
            element: new FakeElement("div"),
            panels: new Map(),
            dispose() {},
            setValue() {},
          }),
        },
        ops: {
          installRenderHooks() {},
          restoreNavigationState() {},
          persistNavigationState() {},
          selectTab(tab, options) {
            selected.push([tab, options]);
          },
        },
        tabs: {},
      };
      const windowObject = {
        addEventListener() {},
        settingsAPI: {
          onRequestedTab(cb) {
            requestedCallback = cb;
          },
          consumeRequestedTab() {
            return consumeTab;
          },
          onChanged() {},
          onAgentActivity() {},
          onRecapChanged() {},
          onAnimationPreviewPosterReady() {},
          onShortcutRecordKey() {},
          onShortcutFailuresChanged() {},
          onRemoteApprovalStatusChanged() {},
          onUpdateCheckStatus() {},
          onOfficialThemeProgress() {},
        },
      };
      const document = {
        title: "",
        getElementById: () => null,
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (value) => {
      const node = new FakeElement("#text");
      node.textContent = String(value || "");
      return node;
    },
      };
      vm.runInNewContext(slice, {
        ClawdSettingsCore: core,
        ClawdSettingsIcons: loadIcons(),
        window: windowObject,
        document,
        globalThis: { ClawdSettingsCore: core, ClawdSettingsIcons: loadIcons() },
      });
      return { selected, requestedCallback };
    }

    const sessions = run("sessions");
    assert.deepEqual(sessions.selected, [["sessions", { persist: false }]]);
    sessions.requestedCallback("sessions");
    sessions.requestedCallback("recap");
    sessions.requestedCallback("agents");
    assert.deepEqual(sessions.selected, [
      ["sessions", { persist: false }],
      ["sessions", { persist: false }],
      ["recap", { persist: false }],
    ]);

    const recap = run("recap");
    assert.deepEqual(recap.selected, [["recap", { persist: false }]]);

    const agents = run("agents");
    assert.deepEqual(agents.selected, []);
  });
});

