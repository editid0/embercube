// Smart download button. Without JavaScript (or if GitHub's API is
// unreachable) the button is a plain link to the latest release page.
//
// For testing, ?platform=mac-arm|mac-intel|mac|windows|windows-arm|linux|mobile|unknown
// overrides detection.
(function () {
  "use strict";

  var REPO = "EmbercubeMC/embercube-releases";
  var RELEASE_PAGE = "https://github.com/" + REPO + "/releases/latest";

  // Every downloadable file, how to recognise it, and who it is for.
  var KINDS = [
    { id: "mac-arm", os: "mac", match: /_aarch64\.dmg$/, label: "macOS · Apple Silicon", file: ".dmg",
      blurb: "For Macs with an M-series chip, which is most Macs since late 2020." },
    { id: "win-exe", os: "windows", match: /-setup\.exe$/, label: "Windows installer", file: ".exe",
      blurb: "Recommended for Windows 10 and 11. Installs for your user, no admin rights needed." },
    { id: "win-msi", os: "windows", match: /\.msi$/, label: "Windows MSI package", file: ".msi",
      blurb: "For IT-managed or scripted installs across a whole machine." },
    { id: "linux-appimage", os: "linux", match: /\.AppImage$/, label: "Linux · AppImage", file: ".AppImage",
      blurb: "Works on most distributions. Mark it executable and run it." },
    { id: "linux-deb", os: "linux", match: /\.deb$/, label: "Linux · Debian/Ubuntu", file: ".deb",
      blurb: "For Debian, Ubuntu, Linux Mint, Pop!_OS and Linux on Chromebooks." },
    { id: "linux-rpm", os: "linux", match: /\.rpm$/, label: "Linux · Fedora/openSUSE", file: ".rpm",
      blurb: "For Fedora, openSUSE and RHEL-based distributions." },
  ];

  var OS_NAMES = { mac: "macOS", windows: "Windows", linux: "Linux" };

  function webglRenderer() {
    try {
      var gl = document.createElement("canvas").getContext("webgl");
      var ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    } catch (e) {
      return "";
    }
  }

  /** Best guess at { os, arch }; arch is null when the browser won't say. */
  async function detect() {
    var forced = new URLSearchParams(location.search).get("platform");
    if (forced) {
      var map = {
        "mac-arm": { os: "mac", arch: "arm64" }, "mac-intel": { os: "mac", arch: "x64" }, mac: { os: "mac", arch: null },
        windows: { os: "windows", arch: "x64" }, "windows-arm": { os: "windows", arch: "arm64" },
        linux: { os: "linux", arch: "x64" }, mobile: { os: "mobile", arch: null }, unknown: { os: "unknown", arch: null },
      };
      if (map[forced]) return map[forced];
    }

    var ua = navigator.userAgent;
    var os = "unknown";
    if (/iPhone|iPad|iPod|Android/.test(ua)) os = "mobile";
    else if (/Windows/.test(ua)) os = "windows";
    else if (/Macintosh|Mac OS X/.test(ua)) os = navigator.maxTouchPoints > 1 ? "mobile" : "mac"; // iPadOS claims to be a Mac
    else if (/CrOS|Linux|X11/.test(ua)) os = "linux";

    var arch = null;
    var uad = navigator.userAgentData;
    if (uad && uad.getHighEntropyValues) {
      try {
        var hints = await uad.getHighEntropyValues(["architecture", "bitness"]);
        if (hints.architecture === "arm") arch = "arm64";
        else if (hints.architecture === "x86") arch = hints.bitness === "32" ? "x86" : "x64";
      } catch (e) {
        // Hints refused; fall through to the other signals.
      }
    }
    // Safari and Firefox report every Mac as "Intel"; the GPU name gives Apple Silicon away.
    if (os === "mac" && !arch) {
      var gpu = webglRenderer();
      if (/Apple (M\d|GPU)/i.test(gpu)) arch = "arm64";
      else if (/Intel|AMD|Radeon|NVIDIA/i.test(gpu)) arch = "x64";
    }
    if (os === "linux" && !arch && /x86_64|amd64/i.test(ua)) arch = "x64";
    return { os: os, arch: arch };
  }

  /** The one file to offer, or null when we can't be sure. */
  function pick(platform, byKind) {
    // Apple Silicon only: Intel Macs were dropped after 0.5.0.
    if (platform.os === "mac") return platform.arch === "arm64" ? byKind["mac-arm"] : null;
    // There's no ARM build for Windows yet; the x64 build runs under Windows' emulation.
    if (platform.os === "windows") return byKind["win-exe"];
    return null; // Linux (which package?), phones and unknown systems get a choice.
  }

  function candidates(platform, items) {
    if (platform.os === "mac" || platform.os === "windows" || platform.os === "linux") {
      return items.filter(function (i) { return i.kind.os === platform.os; });
    }
    return items;
  }

  function size(bytes) {
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function option(item, recommended) {
    return el("a", { class: "dl-item", role: "menuitem", href: item.url }, [
      el("span", { class: "dl-item-head" }, [
        el("span", { class: "dl-item-title", text: item.kind.label }),
        recommended ? el("span", { class: "dl-badge", text: "Recommended" }) : el("span"),
        el("span", { class: "dl-item-size", text: item.kind.file + " · " + size(item.size) }),
      ]),
      el("span", { class: "dl-item-blurb", text: item.kind.blurb }),
    ]);
  }

  async function init() {
    var root = document.getElementById("download");
    if (!root) return;
    var main = root.querySelector(".dl-main");
    var toggle = root.querySelector(".dl-toggle");
    var menu = root.querySelector(".dl-menu");
    var meta = root.querySelector(".dl-meta");

    var release;
    try {
      var res = await fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error("GitHub API " + res.status);
      release = await res.json();
    } catch (e) {
      return; // Keep the plain link to the release page.
    }

    var items = [];
    KINDS.forEach(function (kind) {
      var asset = (release.assets || []).find(function (a) { return kind.match.test(a.name); });
      if (asset) items.push({ kind: kind, url: asset.browser_download_url, size: asset.size });
    });
    if (items.length === 0) return;
    var byKind = {};
    items.forEach(function (i) { byKind[i.kind.id] = i; });

    var platform = await detect();
    var chosen = pick(platform, byKind);
    var version = release.tag_name;
    var likely = candidates(platform, items);

    // Build the menu: likely options first, then a "show all" expander.
    menu.textContent = "";
    var heading =
      chosen ? OS_NAMES[platform.os] + " downloads"
      : platform.os === "mac" && platform.arch === "x64" ? "Intel Macs aren't supported"
      : platform.os === "mac" ? "Embercube needs a Mac with Apple silicon"
      : platform.os === "linux" ? "Pick the package for your distribution"
      : platform.os === "mobile" ? "Embercube runs on computers. Download it there:"
      : "Choose your download";
    menu.appendChild(el("div", { class: "dl-menu-head", text: heading }));
    if (platform.os === "mac" && !chosen) {
      menu.appendChild(el("p", { class: "dl-hint", text: platform.arch === "x64"
        ? "Embercube runs on Macs with an M-series chip (M1 or newer). This Mac looks like it has an Intel processor."
        : "Check under Apple menu → About This Mac: it should say \"Chip: Apple M…\". Macs with an Intel processor aren't supported." }));
    }
    var likelyList = el("div", { class: "dl-list" });
    likely.forEach(function (i) {
      likelyList.appendChild(option(i, chosen ? i === chosen : platform.os === "linux" && i.kind.id === "linux-appimage"));
    });
    menu.appendChild(likelyList);

    var rest = items.filter(function (i) { return likely.indexOf(i) === -1; });
    if (rest.length > 0) {
      var restList = el("div", { class: "dl-list dl-rest", hidden: "" });
      rest.forEach(function (i) { restList.appendChild(option(i, false)); });
      var showAll = el("button", { type: "button", class: "dl-showall", text: "Show all downloads (" + items.length + ")" });
      showAll.addEventListener("click", function () {
        restList.hidden = false;
        showAll.remove();
        var first = restList.querySelector(".dl-item");
        if (first) first.focus();
      });
      menu.appendChild(showAll);
      menu.appendChild(restList);
    }
    menu.appendChild(
      el("a", { class: "dl-github", href: RELEASE_PAGE, text: "All files, checksums and release notes on GitHub →" })
    );

    function setOpen(open) {
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      main.setAttribute("aria-expanded", String(open));
    }

    if (chosen) {
      main.href = chosen.url;
      main.textContent = "Download for " + OS_NAMES[platform.os];
      main.removeAttribute("aria-haspopup");
      toggle.hidden = false;
      var note = platform.os === "windows" && platform.arch === "arm64" ? " · runs on ARM via emulation" : "";
      meta.textContent = chosen.kind.label + " · " + size(chosen.size) + " · " + version + note;
      root.classList.add("dl-detected");
    } else {
      // Can't tell which file: the main button opens the choices.
      main.href = RELEASE_PAGE;
      main.textContent = platform.os in OS_NAMES ? "Download for " + OS_NAMES[platform.os] : "Choose a download";
      main.setAttribute("aria-haspopup", "menu");
      main.setAttribute("aria-expanded", "false");
      main.appendChild(el("span", { class: "dl-caret", "aria-hidden": "true", text: "▾" }));
      toggle.hidden = true;
      meta.textContent = version + " for macOS, Windows and Linux";
      main.addEventListener("click", function (e) {
        e.preventDefault();
        setOpen(menu.hidden);
      });
    }

    toggle.addEventListener("click", function () {
      setOpen(menu.hidden);
    });
    document.addEventListener("click", function (e) {
      // composedPath() still includes elements a handler removed mid-click
      // (like "Show all downloads"), so those don't count as outside clicks.
      if (e.composedPath().indexOf(root) === -1) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !menu.hidden) {
        setOpen(false);
        (toggle.hidden ? main : toggle).focus();
      }
    });
  }

  init();
})();
