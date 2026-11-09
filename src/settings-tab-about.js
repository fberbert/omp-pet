
(function initSettingsTabAbout(root) {
  let runtime = null;
  let helpers = null;
  let ops = null;

  const UPSTREAM_REPO_URL = "https://github.com/rullerzhou-afk/clawd-on-desk";

  function t(key) {
    return helpers.t(key);
  }

  const STATIC_ABOUT_KEYS = ["repoUrl", "license", "copyright", "authorName", "authorUrl", "heroSvgContent"];
  function fetchAboutInfo() {
    if (!window.settingsAPI || typeof window.settingsAPI.getAboutInfo !== "function") {
      return Promise.resolve(runtime.about.infoCache || null);
    }
    return window.settingsAPI.getAboutInfo().then((info) => {
      if (!info) return runtime.about.infoCache || null;
      const merged = { ...(runtime.about.infoCache || {}) };
      for (const key of STATIC_ABOUT_KEYS) {
        if (info[key] != null) merged[key] = info[key];
      }
      merged.version = info.version;
      runtime.about.infoCache = merged;
      return merged;
    }).catch(() => runtime.about.infoCache || null);
  }

  function handleAboutCrabClick(crabWrap) {
    const slot = crabWrap.querySelector("#shake-slot");
    if (slot) {
      slot.classList.remove("shake");
      void slot.getBoundingClientRect();
      slot.classList.add("shake");
      const onEnd = () => {
        slot.classList.remove("shake");
        slot.removeEventListener("animationend", onEnd);
      };
      slot.addEventListener("animationend", onEnd);
    }
    runtime.about.clickCount++;
    if (runtime.about.clickCount >= 7) {
      runtime.about.clickCount = 0;
      ops.showToast(t("aboutEasterEggToast"), { ttl: 5000 });
    }
  }

  function buildInfoRow(label, value) {
    const row = document.createElement("div");
    row.className = "about-info-row";
    const l = document.createElement("div");
    l.className = "about-info-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "about-info-value";
    if (typeof value === "string") v.textContent = value;
    else v.appendChild(value);
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function buildLink(url, displayText) {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = displayText;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      helpers.openExternalSafe(url);
    });
    return a;
  }

  function render(parent) {
    const hero = document.createElement("div");
    hero.className = "about-hero";

    const crabWrap = document.createElement("div");
    crabWrap.className = "about-crab-wrap";

    const title = document.createElement("h2");
    title.className = "about-title";
    title.textContent = "OMP Pet";

    const tagline = document.createElement("p");
    tagline.className = "about-tagline";
    tagline.textContent = t("aboutTagline");

    hero.appendChild(crabWrap);
    hero.appendChild(title);
    hero.appendChild(tagline);
    parent.appendChild(hero);

    const infoSection = document.createElement("section");
    infoSection.className = "section";
    parent.appendChild(infoSection);

    const footer = document.createElement("div");
    footer.className = "about-footer";
    footer.textContent = t("aboutFooter");
    parent.appendChild(footer);

    fetchAboutInfo().then((info) => {
      const safe = info || {};

      if (safe.heroSvgContent) {
        crabWrap.innerHTML = safe.heroSvgContent;
      }
      crabWrap.addEventListener("click", () => handleAboutCrabClick(crabWrap));

      infoSection.innerHTML = "";
      infoSection.appendChild(buildInfoRow(t("aboutVersionLabel"), "v" + (safe.version || "?")));

      if (safe.repoUrl) {
        infoSection.appendChild(buildInfoRow(
          t("aboutRepositoryLabel"),
          buildLink(safe.repoUrl, safe.repoUrl.replace(/^https?:\/\//, ""))
        ));
      }

      if (safe.license) {
        infoSection.appendChild(buildInfoRow(
          t("aboutLicenseLabel"),
          safe.license + (safe.copyright ? " · " + safe.copyright : "")
        ));
      }

      if (safe.authorName) {
        infoSection.appendChild(buildInfoRow(
          t("aboutAuthorLabel"),
          safe.authorUrl ? buildLink(safe.authorUrl, safe.authorName) : safe.authorName
        ));
      }

      infoSection.appendChild(buildInfoRow(
        t("aboutBasedOnLabel"),
        buildLink(UPSTREAM_REPO_URL, "Clawd on Desk (rullerzhou-afk)")
      ));
    });
  }

  function init(core) {
    runtime = core.runtime;
    helpers = core.helpers;
    ops = core.ops;
    core.tabs.about = { render };
  }

  root.ClawdSettingsTabAbout = { init };
})(globalThis);
