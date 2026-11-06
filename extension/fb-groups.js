// Content script: membaca daftar SEMUA grup Facebook yang diikuti di /groups/joins/
(() => {
  let isRunning = false;
  let isStopped = false;
  let activeRunId = null;

  const IGNORED_PATHS = new Set([
    "joins",
    "feed",
    "discover",
    "create",
    "search",
    "notifications",
    "category",
    "you",
    "manage",
    "settings",
    "your_posts",
  ]);

  function tkpSleep(ms) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ kind: "tkp-sleep", ms: Math.max(100, ms) }, () => resolve());
    });
  }

  function detectCheckpoint() {
    const p = location.pathname.toLowerCase();
    if (p.includes("/checkpoint") || p.includes("/login")) {
      return "Terdeteksi halaman login atau verifikasi (checkpoint) Facebook.";
    }
    const body = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : "";
    if (body.includes("diblokir sementara") || body.includes("kami membatasi akun anda") || body.includes("account restricted")) {
      return "Peringatan pembatasan akun Facebook terdeteksi.";
    }
    return null;
  }

  function normalizeUrl(href) {
    if (!href || typeof href !== "string") return { ok: false, reason: "tanpa_slug" };
    try {
      const u = new URL(href, location.origin);
      if (!u.pathname.includes("/groups")) {
        return { ok: false, reason: "bukan_grup", href };
      }

      // Format profile.php?id=123
      if (u.pathname.includes("profile.php") && u.searchParams.get("id")) {
        const id = u.searchParams.get("id").trim();
        return {
          ok: true,
          id: id.toLowerCase(),
          url: `https://www.facebook.com/groups/${id}/`,
        };
      }

      const segs = u.pathname
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);

      const idx = segs.indexOf("groups");
      if (idx !== -1 && segs.length > idx + 1) {
        let key = segs[idx + 1];
        try {
          key = decodeURIComponent(key);
        } catch (_) { }

        if (IGNORED_PATHS.has(key.toLowerCase())) {
          return { ok: false, reason: "jalur_terlarang", href };
        }

        return {
          ok: true,
          id: key.toLowerCase(),
          url: `https://www.facebook.com/groups/${key}/`,
        };
      }
    } catch (_) { }

    return { ok: false, reason: "bukan_grup", href };
  }

  function cleanGroupName(raw, fallbackId) {
    if (!raw) return `Grup ${fallbackId}`;
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let name = lines[0] || "";

    name = name
      .replace(/^grup\s*:\s*/i, "")
      .replace(/\s*[•·]\s*.*$/i, "")
      .trim();

    const lower = name.toLowerCase();
    if (!name || lower === "grup" || lower === "groups" || lower === "gabung" || lower === "join") {
      return `Grup ${fallbackId}`;
    }

    return name;
  }

  function extractNameFromAnchor(a, id) {
    // 1. Cek aria-label
    const aria = a.getAttribute("aria-label");
    if (aria && aria.trim().length > 1) {
      const cleaned = cleanGroupName(aria.trim(), id);
      if (cleaned !== `Grup ${id}`) return cleaned;
    }

    // 2. Cek elemen heading di dalam anchor atau parent terdekat
    const heading = a.querySelector('h2, h3, [role="heading"]');
    if (heading && heading.textContent && heading.textContent.trim().length > 1) {
      const cleaned = cleanGroupName(heading.textContent.trim(), id);
      if (cleaned !== `Grup ${id}`) return cleaned;
    }

    // 3. Cek span teks langsung
    const spans = Array.from(a.querySelectorAll("span"));
    for (const s of spans) {
      const txt = (s.textContent || "").trim();
      if (txt.length > 2 && !txt.toLowerCase().includes("anggota") && !txt.toLowerCase().includes("posting")) {
        const cleaned = cleanGroupName(txt, id);
        if (cleaned !== `Grup ${id}`) return cleaned;
      }
    }

    // 4. Fallback textContent
    if (a.textContent && a.textContent.trim().length > 1) {
      return cleanGroupName(a.textContent.trim(), id);
    }

    return `Grup ${id}`;
  }

  function findScrollContainer() {
    const firstGroupAnchor = document.querySelector('a[href*="/groups/"]');
    if (firstGroupAnchor) {
      let el = firstGroupAnchor.parentElement;
      while (el && el !== document.body && el !== document.documentElement) {
        if (el.scrollHeight > el.clientHeight + 50) {
          const ov = window.getComputedStyle(el).overflowY;
          if (ov === "auto" || ov === "scroll") {
            return el;
          }
        }
        el = el.parentElement;
      }
    }

    const main = document.querySelector('div[role="main"], div[role="feed"]');
    if (main) {
      if (main.scrollHeight > main.clientHeight + 50) {
        const ov = window.getComputedStyle(main).overflowY;
        if (ov === "auto" || ov === "scroll") return main;
      }
      let p = main.parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        if (p.scrollHeight > p.clientHeight + 50) {
          const ov = window.getComputedStyle(p).overflowY;
          if (ov === "auto" || ov === "scroll") return p;
        }
        p = p.parentElement;
      }
    }

    const scrollers = Array.from(document.querySelectorAll("*")).filter((e) => {
      if (e.scrollHeight <= e.clientHeight + 50) return false;
      const ov = window.getComputedStyle(e).overflowY;
      return (ov === "auto" || ov === "scroll") && e.querySelector('a[href*="/groups/"]');
    });
    if (scrollers.length > 0) {
      scrollers.sort(
        (a, b) => b.querySelectorAll('a[href*="/groups/"]').length - a.querySelectorAll('a[href*="/groups/"]').length
      );
      return scrollers[0];
    }

    return document.scrollingElement || document.documentElement || document.body;
  }

  function isLoadingIndicatorPresent() {
    const spinners = document.querySelectorAll(
      '[role="progressbar"], [aria-busy="true"], [data-visualcompletion="loading-state"]'
    );
    return spinners.length > 0;
  }

  function clickSeeMoreButtons() {
    const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], button'));
    let clicked = false;
    for (const b of buttons) {
      const text = (b.textContent || b.getAttribute("aria-label") || "").trim().toLowerCase();
      if (text === "lihat lainnya" || text === "see more" || text === "muat lainnya" || text === "load more") {
        b.click();
        clicked = true;
      }
    }
    return clicked;
  }

  function isEndOfListTextPresent() {
    const body = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : "";
    return (
      body.includes("anda telah melihat semua grup") ||
      body.includes("tidak ada grup lain") ||
      body.includes("semua grup telah dimuat") ||
      body.includes("semua grup ditampilkan") ||
      body.includes("end of results") ||
      body.includes("you've reached the end")
    );
  }

  async function startCollection(runId) {
    if (isRunning) {
      // Jika proses pengambilan sudah aktif berjalan, abaikan pemicu baru
      return;
    }

    activeRunId = runId || ("run_" + Date.now().toString(36));
    const currentRunId = activeRunId;
    isRunning = true;
    isStopped = false;

    const startTime = Date.now();
    const visibilityStart = document.visibilityState;
    const harvested = new Map();
    let newSinceLastBatch = [];

    let hiddenDurationMs = 0;
    let hiddenCount = 0;

    let skippedNotGroup = 0;
    let skippedIgnored = 0;
    let skippedDuplicate = 0;
    const sampleSkipped = [];

    try {
      await tkpSleep(1500);

      const cpEarly = detectCheckpoint();
      if (cpEarly) {
        chrome.runtime.sendMessage({
          kind: "tkp-scrape",
          type: "error",
          message: cpEarly,
          runId: currentRunId,
        }).catch(() => { });
        return;
      }

      let scroller = findScrollContainer();
      let consecutiveNoNew = 0;
      let steps = 0;
      const maxSteps = 600;
      const maxDurationMs = 12 * 60 * 1000;
      let stopReason = "tidak_ada_grup";

      function harvest() {
        const anchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
        let newCount = 0;

        for (const a of anchors) {
          const norm = normalizeUrl(a.href || a.getAttribute("href"));
          if (!norm.ok) {
            if (norm.reason === "jalur_terlarang") skippedIgnored++;
            else skippedNotGroup++;
            if (sampleSkipped.length < 5 && norm.href) sampleSkipped.push(norm.href);
            continue;
          }

          const id = norm.id;
          const name = extractNameFromAnchor(a, id);

          if (harvested.has(id)) {
            skippedDuplicate++;
            const existing = harvested.get(id);
            if (existing.name.startsWith("Grup ") && !name.startsWith("Grup ")) {
              existing.name = name;
            }
            continue;
          }

          const newGroup = {
            id,
            name,
            url: norm.url,
            source: "auto",
            createdAt: Date.now(),
          };

          harvested.set(id, newGroup);
          newSinceLastBatch.push(newGroup);
          newCount++;
        }

        return newCount;
      }

      // Tunggu hingga grup pertama dirender
      for (let waitCount = 0; waitCount < 30; waitCount++) {
        if (isStopped || activeRunId !== currentRunId) break;
        harvest();
        if (harvested.size > 0) break;
        clickSeeMoreButtons();
        window.scrollBy({ top: 120, left: 0, behavior: "instant" });
        await tkpSleep(500);
      }

      if (newSinceLastBatch.length > 0) {
        chrome.runtime.sendMessage({
          kind: "tkp-scrape",
          type: "fb-groups",
          found: harvested.size,
          groups: [...newSinceLastBatch],
          step: steps,
          runId: currentRunId,
        }).catch(() => { });
        newSinceLastBatch = [];
      }

      // Loop scroll bertahap
      while (!isStopped && activeRunId === currentRunId && steps < maxSteps) {
        if (Date.now() - startTime > maxDurationMs) {
          stopReason = "batas_waktu";
          break;
        }

        const cp = detectCheckpoint();
        if (cp) {
          stopReason = "checkpoint";
          break;
        }

        if (document.visibilityState !== "visible") {
          hiddenCount++;
        }

        steps++;

        if (steps % 10 === 0) {
          scroller = findScrollContainer();
        }

        const clientH = scroller.clientHeight || window.innerHeight || 800;
        const stepDistance = Math.max(450, Math.floor(clientH * 0.8));

        if (scroller !== document.documentElement && scroller !== document.body) {
          scroller.scrollTop += stepDistance;
        }
        window.scrollBy({ top: stepDistance, left: 0, behavior: "instant" });

        try {
          if (scroller && scroller.dispatchEvent) {
            scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
          }
          window.dispatchEvent(new Event("scroll"));
        } catch (_) { }

        clickSeeMoreButtons();

        await tkpSleep(850);

        if (isLoadingIndicatorPresent()) {
          await tkpSleep(1400);
        }

        const newFound = harvest();

        if (newFound > 0) {
          consecutiveNoNew = 0;
          if (newSinceLastBatch.length > 0) {
            chrome.runtime.sendMessage({
              kind: "tkp-scrape",
              type: "fb-groups",
              found: harvested.size,
              groups: [...newSinceLastBatch],
              step: steps,
              runId: currentRunId,
            }).catch(() => { });
            newSinceLastBatch = [];
          }
        } else {
          consecutiveNoNew++;

          if (consecutiveNoNew % 3 === 0) {
            if (scroller && scroller !== document.documentElement && scroller !== document.body) {
              scroller.scrollTop = scroller.scrollHeight;
            }
            window.scrollTo(0, document.body ? document.body.scrollHeight : 999999);
            try {
              if (scroller && scroller.dispatchEvent) {
                scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
              }
              window.dispatchEvent(new Event("scroll"));
            } catch (_) { }
            clickSeeMoreButtons();
          }

          await tkpSleep(Math.min(2500, 800 + consecutiveNoNew * 150));
        }

        const scrollH = scroller.scrollHeight || (document.documentElement ? document.documentElement.scrollHeight : 0);
        const scrollT = scroller.scrollTop || window.scrollY || 0;
        const isAtBottom = (scrollT + clientH >= scrollH - 60);

        if (isEndOfListTextPresent()) {
          stopReason = "akhir_daftar";
          break;
        }

        if (consecutiveNoNew >= 25 && isAtBottom && !isLoadingIndicatorPresent()) {
          stopReason = harvested.size > 0 ? "akhir_daftar" : "tidak_ada_grup";
          break;
        }

        if (consecutiveNoNew >= 45 && !isLoadingIndicatorPresent()) {
          stopReason = harvested.size > 0 ? "tidak_bertambah" : "tidak_ada_grup";
          break;
        }
      }

      if (isStopped) {
        stopReason = "dihentikan";
      } else if (stopReason === "tidak_ada_grup" && harvested.size > 0) {
        stopReason = "akhir_daftar";
      }

      chrome.runtime.sendMessage({
        kind: "tkp-scrape",
        type: "fb-groups-done",
        total: harvested.size,
        stopped: isStopped,
        runId: currentRunId,
        diag: {
          jalur: "scroll",
          stopReason,
          total: harvested.size,
          steps,
          durationMs: Date.now() - startTime,
          hiddenDurationMs,
          hiddenCount,
          visibilityStart,
          visibilityEnd: document.visibilityState,
          scrollerTag: scroller.tagName || "WINDOW",
          scrollerRole: scroller.getAttribute ? (scroller.getAttribute("role") || "") : "",
          skipped: {
            notGroup: skippedNotGroup,
            ignoredPath: skippedIgnored,
            duplicate: skippedDuplicate,
          },
          sampleSkipped: sampleSkipped.slice(0, 5),
        },
      }).catch(() => { });
    } finally {
      if (activeRunId === currentRunId) {
        isRunning = false;
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.kind === "fb-groups-start") {
      startCollection(msg.runId);
      sendResponse({ ok: true });
    } else if (msg.kind === "fb-groups-stop") {
      if (!msg.runId || msg.runId === activeRunId) {
        isStopped = true;
        isRunning = false;
      }
      sendResponse({ ok: true });
    }
  });
})();
