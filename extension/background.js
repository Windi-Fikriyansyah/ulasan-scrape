// Service worker: mengatur pekerjaan ulasan marketplace, lead maps, dan autopost grup Facebook.

const DASHBOARDS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
];

let job = null; // { jobId, dashTabId, scrapeTabId, market, type, ... }
let activeUserId = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

async function getJob() {
  if (job) return job;
  try {
    const s = await chrome.storage.session.get("job");
    job = s.job || null;
  } catch (_) {
    job = null;
  }
  return job;
}

async function setJob(j) {
  job = j;
  try {
    if (j) await chrome.storage.session.set({ job: j });
    else await chrome.storage.session.remove("job");
  } catch (_) { }
}

function emit(tabId, event) {
  if (event && !event.userId) {
    const uId = (job && job.userId) || (fbFetchJob && fbFetchJob.userId) || (autopostState && autopostState.userId) || activeUserId;
    if (uId) event.userId = uId;
  }
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { kind: "tkp-event", event }).catch(() => { });
  }
  // Broadcast ke seluruh tab dashboard yang terbuka agar event tidak hilang saat ganti tab / reload
  try {
    chrome.tabs.query({}).then((tabs) => {
      for (const t of tabs) {
        if (t.id && t.id !== tabId && t.url && DASHBOARDS.some((d) => t.url.startsWith(d))) {
          chrome.tabs.sendMessage(t.id, { kind: "tkp-event", event }).catch(() => { });
        }
      }
    }).catch(() => { });
  } catch (_) {}
}

function waitForLoad(tabId, timeout = 45000) {
  return new Promise((resolve) => {
    let finished = false;
    let timer;
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish(true);
    };
    function finish(v) {
      if (finished) return;
      finished = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(v);
    }
    timer = setTimeout(() => finish(false), timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") finish(true); }).catch(() => finish(false));
  });
}

async function endJob(j) {
  await setJob(null);
  if (j && j.scrapeTabId) {
    chrome.tabs.remove(j.scrapeTabId).catch(() => { });
  }
}

async function failJob(message) {
  const j = await getJob();
  if (!j) return;
  emit(j.dashTabId, { type: "ERROR", jobId: j.jobId, message });
  await endJob(j);
}

// -----------------------------------------------------------------------------
// PENGAMBILAN ULASAN & LEAD MAPS
// -----------------------------------------------------------------------------

async function startJob(cmd, dashTabId) {
  if (await getJob()) {
    emit(dashTabId, {
      type: "ERROR",
      jobId: cmd.jobId,
      message: "Masih ada proses yang berjalan. Tunggu selesai atau hentikan dulu.",
    });
    return;
  }

  const market = cmd.market || "tokopedia";
  let url;
  try {
    const u = new URL(cmd.url);
    if (u.protocol !== "https:") throw new Error("bad");
    if (market === "tokopedia") {
      if (u.hostname !== "www.tokopedia.com") throw new Error("bad");
    } else if (market === "shopee") {
      if (u.hostname !== "shopee.co.id") throw new Error("bad");
    } else if (market === "gmaps") {
      if (u.hostname !== "www.google.com" || !u.pathname.startsWith("/maps")) throw new Error("bad");
    } else if (market === "sosmed") {
      const h = u.hostname.toLowerCase();
      if ((h !== "www.google.com" && h !== "www.google.co.id" && h !== "google.com") || !u.pathname.startsWith("/search")) throw new Error("bad");
    } else {
      throw new Error("bad");
    }
    url = u.href;
  } catch (_) {
    const label = market === "shopee" ? "Shopee" : market === "gmaps" ? "Google Maps" : market === "sosmed" ? "Google Search" : "Tokopedia";
    emit(dashTabId, { type: "ERROR", jobId: cmd.jobId, message: `Link itu bukan halaman ${label}.` });
    return;
  }

  const tab = await chrome.tabs.create({ url, active: false });
  await setJob({ jobId: cmd.jobId, dashTabId, scrapeTabId: tab.id, market, type: "scrape", userId: cmd.userId });

  const label = market === "shopee" ? "Shopee" : market === "gmaps" ? "Google Maps" : market === "sosmed" ? "Google Search" : "Tokopedia";
  const loaded = await waitForLoad(tab.id);
  if (!loaded) return failJob(`Halaman ${label} tidak selesai dimuat dalam 45 detik.`);

  const options = {
    ...(cmd.options || {}),
    maxResults: clamp(cmd.options && cmd.options.maxResults, 1, 1000, 50),
    maxPages: clamp(cmd.options && cmd.options.maxPages, 1, 200, 10),
    delay: clamp(cmd.options && cmd.options.delay, 500, 10000, 1200),
  };

  for (let i = 0; i < 20; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { kind: "tkp-start", options });
      if (r && r.ok) return;
    } catch (_) { }
    await sleep(500);
  }
  await failJob(`Extension tidak bisa masuk ke halaman ${label}. Muat ulang extension, lalu coba lagi.`);
}

async function stopJob() {
  const j = await getJob();
  if (!j) return;
  if (j.type === "autopost") {
    await stopAutopostRun();
    return;
  }
  if (j.type === "fb-groups") {
    await stopFbGroups();
    return;
  }
  if (j.scrapeTabId) {
    chrome.tabs.sendMessage(j.scrapeTabId, { kind: "tkp-stop" }).catch(() => { });
  }
}

// -----------------------------------------------------------------------------
// AUTOPOST: AMBIL DAFTAR GRUP FACEBOOK (Tahan Refresh & Jendela Popup)
// -----------------------------------------------------------------------------

let fbFetchJob = null;
let fbFetchBuffer = [];
let fbSaveStorageTimer = null;
let fbGroupsWatchdog = null;

async function loadFbFetchStorage() {
  try {
    const s = await chrome.storage.local.get(["fbFetchJob", "fbFetchBuffer"]);
    if (s.fbFetchJob) fbFetchJob = s.fbFetchJob;
    if (Array.isArray(s.fbFetchBuffer)) fbFetchBuffer = s.fbFetchBuffer;
  } catch (_) { }
}
loadFbFetchStorage();

function scheduleSaveFbFetchStorage(immediate = false) {
  if (immediate) {
    if (fbSaveStorageTimer) clearTimeout(fbSaveStorageTimer);
    fbSaveStorageTimer = null;
    chrome.storage.local.set({ fbFetchJob, fbFetchBuffer }).catch(() => { });
    return;
  }
  if (!fbSaveStorageTimer) {
    fbSaveStorageTimer = setTimeout(() => {
      fbSaveStorageTimer = null;
      chrome.storage.local.set({ fbFetchJob, fbFetchBuffer }).catch(() => { });
    }, 1000);
  }
}

function emitFbFetchState(tabId) {
  if (!fbFetchJob) return;
  const targetTab = tabId || fbFetchJob.dashTabId;
  if (!targetTab) return;
  emit(targetTab, {
    type: "FB_FETCH_STATE",
    job: {
      id: fbFetchJob.id,
      state: fbFetchJob.state,
      reason: fbFetchJob.reason,
      found: fbFetchJob.found || 0,
      step: fbFetchJob.step || 0,
      startedAt: fbFetchJob.startedAt,
      updatedAt: fbFetchJob.updatedAt,
      seq: fbFetchJob.seq || 0,
      ackSeq: fbFetchJob.ackSeq || 0,
      diag: fbFetchJob.diag,
    },
  });
}

// Heartbeat berkala tiap 2 detik selama aktif
setInterval(() => {
  if (fbFetchJob && (fbFetchJob.state === "berjalan" || fbFetchJob.state === "tertahan")) {
    emitFbFetchState();
  }
}, 2000);

async function startFbGroups(cmd, dashTabId) {
  const current = await getJob();
  const isFbActive = fbFetchJob && (fbFetchJob.state === "berjalan" || fbFetchJob.state === "tertahan");
  if (current || isFbActive) {
    let tabExists = false;
    if (fbFetchJob && fbFetchJob.tabId) {
      try {
        const t = await chrome.tabs.get(fbFetchJob.tabId);
        if (t) tabExists = true;
      } catch (_) { }
    }
    const isStale = Date.now() - (fbFetchJob?.updatedAt || 0) > 2 * 60 * 1000;
    if (!tabExists || isStale) {
      if (fbFetchJob && fbFetchJob.tabId) {
        chrome.tabs.remove(fbFetchJob.tabId).catch(() => { });
      }
      fbFetchJob = null;
      await setJob(null);
    } else {
      emit(dashTabId, {
        type: "ERROR",
        message: "Masih ada proses lain yang berjalan. Tunggu selesai atau hentikan dulu.",
      });
      return;
    }
  }

  const url = "https://www.facebook.com/groups/joins/";

  // Buka tab baru di latar belakang agar pengguna bebas membuka tab atau aplikasi lain
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    if (tab && tab.id) {
      chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => { });
    }
  } catch (err) {
    emit(dashTabId, { type: "ERROR", message: "Gagal membuka tab Facebook: " + err.message });
    return;
  }

  if (!tab || !tab.id) {
    emit(dashTabId, { type: "ERROR", message: "Gagal menginisialisasi tab Facebook." });
    return;
  }

  const jobId = "fbfetch_" + Date.now().toString(36);
  fbFetchJob = {
    id: jobId,
    userId: cmd.userId,
    state: "berjalan",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    tabId: tab.id,
    dashTabId,
    found: 0,
    step: 0,
    seq: 0,
    ackSeq: 0,
  };
  fbFetchBuffer = [];
  scheduleSaveFbFetchStorage(true);

  await setJob({ dashTabId, scrapeTabId: tab.id, type: "fb-groups", userId: cmd.userId });
  emitFbFetchState();

  // Batas waktu pengaman 10 menit di background
  if (fbGroupsWatchdog) clearTimeout(fbGroupsWatchdog);
  fbGroupsWatchdog = setTimeout(async () => {
    if (fbFetchJob && (fbFetchJob.state === "berjalan" || fbFetchJob.state === "tertahan")) {
      fbFetchJob.state = "error";
      fbFetchJob.reason = "Pengambilan grup Facebook melebihi batas waktu maksimal (10 menit).";
      scheduleSaveFbFetchStorage(true);
      emit(fbFetchJob.dashTabId, {
        type: "ERROR",
        message: "Pengambilan grup Facebook melebihi batas waktu maksimal (10 menit).",
      });
      emitFbFetchState();
      if (fbFetchJob.tabId) {
        chrome.tabs.remove(fbFetchJob.tabId).catch(() => { });
      }
      await setJob(null);
    }
  }, 10 * 60 * 1000);

  const loaded = await waitForLoad(tab.id);
  if (!loaded) {
    if (fbGroupsWatchdog) clearTimeout(fbGroupsWatchdog);
    fbFetchJob.state = "error";
    fbFetchJob.reason = "Halaman grup Facebook tidak selesai dimuat dalam 45 detik.";
    scheduleSaveFbFetchStorage(true);
    emit(dashTabId, { type: "ERROR", message: "Halaman grup Facebook tidak selesai dimuat." });
    emitFbFetchState();
    if (tab.id) chrome.tabs.remove(tab.id).catch(() => { });
    await setJob(null);
    return;
  }

  // Inisiasi pengumpulan grup
  let started = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, {
        kind: "fb-groups-start",
        runId: fbFetchJob.id,
      });
      if (r && r.ok) {
        started = true;
        fbFetchJob.started = true;
        break;
      }
    } catch (_) {
      // Jika content script belum terpasang di tab latar belakang, injeksi langsung
      if (i === 3 || i === 8) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["fb-groups.js"],
          });
        } catch (_) { }
      }
    }
    await sleep(700);
  }

  if (started || (fbFetchJob && fbFetchJob.found > 0)) return;

  if (fbGroupsWatchdog) clearTimeout(fbGroupsWatchdog);
  fbFetchJob.state = "error";
  fbFetchJob.reason = "Extension tidak dapat berkomunikasi dengan halaman Facebook.";
  scheduleSaveFbFetchStorage(true);
  emit(dashTabId, { type: "ERROR", message: "Extension tidak dapat berkomunikasi dengan halaman Facebook." });
  emitFbFetchState();
  if (tab.id) chrome.tabs.remove(tab.id).catch(() => { });
  await setJob(null);
}

async function stopFbGroups() {
  if (fbGroupsWatchdog) {
    clearTimeout(fbGroupsWatchdog);
    fbGroupsWatchdog = null;
  }
  if (fbFetchJob) {
    fbFetchJob.state = "dihentikan";
    fbFetchJob.reason = "dihentikan";
    fbFetchJob.updatedAt = Date.now();
    scheduleSaveFbFetchStorage(true);
    emitFbFetchState();
    if (fbFetchJob.tabId) {
      chrome.tabs.sendMessage(fbFetchJob.tabId, {
        kind: "fb-groups-stop",
        runId: fbFetchJob.id,
      }).catch(() => { });
    }
    await sleep(300);
    if (fbFetchJob.tabId) {
      chrome.tabs.remove(fbFetchJob.tabId).catch(() => { });
      fbFetchJob.tabId = undefined;
    }
  }
  await setJob(null);
}

// -----------------------------------------------------------------------------
// AUTOPOST: PENGIRIMAN POSTINGAN OTOMATIS
// -----------------------------------------------------------------------------

let autopostState = {
  active: false,
  paused: false,
  stopped: false,
  run: null,
  templates: [],
  targetIndex: 0,
  dashTabId: null,
  activeTabId: null,
};

async function startAutopostRun(cmd, dashTabId) {
  if (await getJob()) {
    emit(dashTabId, {
      type: "ERROR",
      message: "Masih ada proses lain yang berjalan. Tunggu selesai atau hentikan dulu.",
    });
    return;
  }

  const run = cmd.run;
  if (!run || !run.targets || run.targets.length === 0) {
    emit(dashTabId, { type: "ERROR", message: "Daftar target postingan kosong." });
    return;
  }

  await setJob({ jobId: run.id, dashTabId, type: "autopost", userId: cmd.userId });

  autopostState = {
    active: true,
    paused: false,
    stopped: false,
    userId: cmd.userId,
    run,
    templates: cmd.templates || [],
    targetIndex: 0,
    dashTabId,
    activeTabId: null,
  };

  emit(dashTabId, { type: "FB_STATUS", runId: run.id, state: "running" });

  // Jalankan loop pengiriman secara asinkron di latar belakang
  runAutopostLoop().catch((err) => {
    console.error("Autopost loop error:", err);
  });
}

async function pauseAutopostRun() {
  if (!autopostState.active) return;
  autopostState.paused = true;
  emit(autopostState.dashTabId, {
    type: "FB_STATUS",
    runId: autopostState.run.id,
    state: "paused",
  });
}

async function resumeAutopostRun() {
  if (!autopostState.active) return;
  autopostState.paused = false;
  emit(autopostState.dashTabId, {
    type: "FB_STATUS",
    runId: autopostState.run.id,
    state: "running",
  });
}

async function stopAutopostRun() {
  if (!autopostState.active) return;
  autopostState.stopped = true;
  autopostState.active = false;
  if (autopostState.activeTabId) {
    chrome.tabs.remove(autopostState.activeTabId).catch(() => { });
  }
  emit(autopostState.dashTabId, {
    type: "FB_STATUS",
    runId: autopostState.run.id,
    state: "stopped",
  });
  await setJob(null);
}

async function runAutopostLoop() {
  const state = autopostState;
  const run = state.run;
  const targets = run.targets;
  const settings = run.settings || {};
  const delayMin = Math.max(30, Number(settings.delayMin) || 60);
  const delayMax = Math.max(delayMin, Number(settings.delayMax) || 150);

  for (let i = 0; i < targets.length; i++) {
    if (state.stopped) break;

    // Tunggu jika dalam status jeda (paused)
    while (state.paused && !state.stopped) {
      await sleep(1000);
    }
    if (state.stopped) break;

    state.targetIndex = i;
    const target = targets[i];

    // Beritahu dashboard bahwa target ini sedang diproses
    emit(state.dashTabId, {
      type: "FB_TARGET",
      runId: run.id,
      target: { ...target, status: "posting" },
    });

    // Temukan template yang cocok
    const template = state.templates.find((t) => t.id === target.templateId) || state.templates[0] || {
      body: "",
      images: [],
    };

    // Buka tab grup di latar belakang
    let targetTab = null;
    let postResult = null;

    try {
      targetTab = await chrome.tabs.create({ url: target.groupUrl, active: false });
      state.activeTabId = targetTab.id;

      const loaded = await waitForLoad(targetTab.id, 40000);
      if (!loaded) {
        postResult = {
          status: "failed",
          message: "Halaman grup tidak selesai dimuat dalam 40 detik.",
        };
      } else {
        // Tunggu content script merespons
        let started = false;
        for (let attempt = 0; attempt < 15; attempt++) {
          if (state.stopped) break;
          try {
            const r = await chrome.tabs.sendMessage(targetTab.id, {
              kind: "fb-post-start",
              target,
              template,
              dry: run.dry,
            });
            if (r && r.ok) {
              started = true;
              break;
            }
          } catch (_) { }
          await sleep(700);
        }

        if (!started && !state.stopped) {
          postResult = {
            status: "failed",
            message: "Extension tidak dapat terhubung ke halaman grup Facebook.",
          };
        } else {
          // Tunggu hasil dari konten script via tkp-scrape fb-target-done
          const waitResult = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              chrome.runtime.onMessage.removeListener(listener);
              resolve({ status: "failed", message: "Waktu tunggu proses posting grup habis (timeout 360s)." });
            }, 360000);

            const listener = (msg) => {
              if (msg && msg.kind === "tkp-scrape" && msg.type === "fb-target-done") {
                clearTimeout(timeout);
                chrome.runtime.onMessage.removeListener(listener);
                resolve(msg);
              }
            };
            chrome.runtime.onMessage.addListener(listener);
          });
          postResult = waitResult;
        }
      }
    } catch (tabErr) {
      postResult = {
        status: "failed",
        message: tabErr.message || "Gagal membuka tab grup Facebook.",
      };
    } finally {
      if (targetTab) {
        chrome.tabs.remove(targetTab.id).catch(() => { });
        state.activeTabId = null;
      }
    }

    if (state.stopped) break;

    // Perbarui status target di memory dan dashboard
    target.status = postResult.status || "failed";
    target.message = postResult.message || "";
    target.at = Date.now();
    const finalTarget = { ...target };

    emit(state.dashTabId, {
      type: "FB_TARGET",
      runId: run.id,
      target: finalTarget,
    });

    // Jika terdeteksi checkpoint atau pembatasan akun, HENTIKAN SEMUA
    if (postResult.checkpoint) {
      state.stopped = true;
      state.active = false;
      emit(state.dashTabId, {
        type: "ERROR",
        message: "Akun Facebook terkena pembatasan atau verifikasi (checkpoint). Pengiriman otomatis dihentikan demi keamanan akun.",
      });
      emit(state.dashTabId, {
        type: "FB_STATUS",
        runId: run.id,
        state: "error",
      });
      await setJob(null);
      return;
    }

    // Jika masih ada target berikutnya dan belum selesai/dihentikan
    if (i < targets.length - 1 && !state.stopped) {
      // Hitung jeda acak
      const delaySec = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
      const nextTarget = targets[i + 1];

      for (let s = delaySec; s > 0; s--) {
        if (state.stopped) break;
        while (state.paused && !state.stopped) {
          await sleep(1000);
        }
        if (state.stopped) break;

        emit(state.dashTabId, {
          type: "FB_STATUS",
          runId: run.id,
          state: "running",
          nextInSec: s,
          currentTargetId: nextTarget.id,
        });
        await sleep(1000);
      }
    }
  }

  if (!state.stopped) {
    state.active = false;
    await sleep(400);
    emit(state.dashTabId, {
      type: "FB_STATUS",
      runId: run.id,
      state: "done",
      targets: state.run.targets,
    });
    await setJob(null);
  }
}

// -----------------------------------------------------------------------------
// EVENT HANDLERS & LISTENERS
// -----------------------------------------------------------------------------

async function handleScrape(msg, senderTabId) {
  const j = await getJob();
  if (!j) return;

  switch (msg.type) {
    case "meta":
      if (senderTabId === j.scrapeTabId) {
        emit(j.dashTabId, { type: "META", jobId: j.jobId, title: msg.title, image: msg.image, sample: msg.sample });
      }
      break;
    case "batch":
      if (senderTabId === j.scrapeTabId) {
        emit(j.dashTabId, { type: "BATCH", jobId: j.jobId, page: msg.page, reviews: msg.reviews });
      }
      break;
    case "leads":
      if (senderTabId === j.scrapeTabId) {
        emit(j.dashTabId, { type: "LEADS", jobId: j.jobId, found: msg.found, leads: msg.leads });
      }
      break;
    case "sosmed-leads":
      if (senderTabId === j.scrapeTabId) {
        emit(j.dashTabId, { type: "SOSMED_LEADS", jobId: j.jobId, found: msg.found, leads: msg.leads });
      }
      break;
    case "done":
      if (senderTabId === j.scrapeTabId) {
        emit(j.dashTabId, { type: "DONE", jobId: j.jobId, stopped: !!msg.stopped });
        await endJob(j);
      }
      break;
    case "error":
      if (senderTabId === j.scrapeTabId) {
        emit(j.dashTabId, { type: "ERROR", jobId: j.jobId, message: msg.message });
        await endJob(j);
      }
      break;
    case "state":
      if (fbFetchJob) {
        fbFetchJob.state = msg.state;
        fbFetchJob.reason = msg.reason;
        fbFetchJob.updatedAt = Date.now();
        if (msg.found != null) fbFetchJob.found = msg.found;
        if (msg.step != null) fbFetchJob.step = msg.step;
        if (msg.state === "tertahan" && fbFetchJob.windowId) {
          chrome.windows.update(fbFetchJob.windowId, { drawAttention: true }).catch(() => { });
        }
        scheduleSaveFbFetchStorage(true);
        emitFbFetchState();
      }
      break;
    case "fb-groups": {
      const groups = msg.groups || [];
      const withSeq = [];
      if (fbFetchJob) {
        fbFetchJob.found = msg.found || fbFetchJob.found;
        fbFetchJob.step = msg.step != null ? msg.step : fbFetchJob.step;
        fbFetchJob.updatedAt = Date.now();
        for (const g of groups) {
          fbFetchJob.seq = (fbFetchJob.seq || 0) + 1;
          const item = { ...g, seq: fbFetchJob.seq };
          fbFetchBuffer.push({ seq: fbFetchJob.seq, group: item });
          withSeq.push(item);
        }
        scheduleSaveFbFetchStorage();
        emit(fbFetchJob.dashTabId, { type: "FB_GROUPS", found: fbFetchJob.found, groups: withSeq });
        emitFbFetchState();
      } else {
        emit(j.dashTabId, { type: "FB_GROUPS", found: msg.found, groups });
      }
      break;
    }
    case "fb-groups-done":
      if (fbGroupsWatchdog) {
        clearTimeout(fbGroupsWatchdog);
        fbGroupsWatchdog = null;
      }
      if (fbFetchJob) {
        fbFetchJob.state = msg.stopped ? "dihentikan" : "selesai";
        fbFetchJob.reason = msg.diag && msg.diag.stopReason;
        fbFetchJob.diag = msg.diag;
        fbFetchJob.updatedAt = Date.now();
        scheduleSaveFbFetchStorage(true);
        emit(fbFetchJob.dashTabId, {
          type: "FB_GROUPS_DONE",
          stopped: !!msg.stopped,
          total: msg.total,
          diag: msg.diag,
        });
        emitFbFetchState();
        if (fbFetchJob.tabId) {
          chrome.tabs.remove(fbFetchJob.tabId).catch(() => { });
          fbFetchJob.tabId = undefined;
        }
        if (fbFetchJob.dashTabId) {
          chrome.tabs.update(fbFetchJob.dashTabId, { active: true }).catch(() => { });
        }
      } else {
        emit(j.dashTabId, {
          type: "FB_GROUPS_DONE",
          stopped: !!msg.stopped,
          total: msg.total,
          diag: msg.diag,
        });
        if (j.dashTabId) {
          chrome.tabs.update(j.dashTabId, { active: true }).catch(() => { });
        }
      }
      await endJob(j);
      break;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.kind === "tkp-sleep") {
    setTimeout(() => sendResponse({ ok: true }), clamp(msg.ms, 0, 20000, 500));
    return true;
  }

  (async () => {
    if (msg.kind === "tkp-cmd") {
      const cmd = msg.cmd || {};
      const dashTabId = sender.tab && sender.tab.id;
      if (cmd.userId) {
        activeUserId = cmd.userId;
      }

      if (cmd.type === "AUTH_LOGOUT") {
        const targetUser = cmd.userId;
        const cur = await getJob();
        if (cur && (!targetUser || cur.userId === targetUser)) {
          await endJob(cur);
        }
        if (fbFetchJob && (!targetUser || fbFetchJob.userId === targetUser)) {
          await stopFbGroups();
        }
        if (autopostState && autopostState.active && (!targetUser || autopostState.userId === targetUser)) {
          await stopAutopostRun();
        }
        if (targetUser) {
          chrome.storage.local.remove([
            `fbFetchJob_${targetUser}`,
            `fbFetchBuffer_${targetUser}`,
          ]).catch(() => {});
        }
        chrome.storage.local.remove(["fbFetchJob", "fbFetchBuffer"]).catch(() => {});
        chrome.storage.session.remove("job").catch(() => {});
        if (!targetUser || activeUserId === targetUser) {
          activeUserId = null;
        }
        sendResponse({ ok: true });
        return;
      }

      if (cmd.type === "START") await startJob(cmd, dashTabId);
      else if (cmd.type === "STOP") await stopJob();
      else if (cmd.type === "FB_FETCH_GROUPS") await startFbGroups(cmd, dashTabId);
      else if (cmd.type === "FB_STOP_FETCH_GROUPS" || cmd.type === "FB_FETCH_STOP") await stopFbGroups();
      else if (cmd.type === "FB_FETCH_SHOW") {
        if (fbFetchJob && fbFetchJob.tabId) {
          chrome.tabs.update(fbFetchJob.tabId, { active: true }).catch(() => { });
        }
      } else if (cmd.type === "FB_FETCH_STATUS") {
        if (fbFetchJob && (!cmd.userId || fbFetchJob.userId === cmd.userId)) {
          fbFetchJob.dashTabId = dashTabId;
          emitFbFetchState(dashTabId);
          // Replay grup yang belum di-ack
          const unacked = fbFetchBuffer.filter((item) => item.seq > (fbFetchJob.ackSeq || 0));
          for (let i = 0; i < unacked.length; i += 200) {
            const chunk = unacked.slice(i, i + 200).map((item) => item.group);
            emit(dashTabId, { type: "FB_GROUPS", found: fbFetchJob.found, groups: chunk });
          }
          if (fbFetchJob.state === "selesai" || fbFetchJob.state === "dihentikan" || fbFetchJob.state === "error") {
            emit(dashTabId, {
              type: "FB_GROUPS_DONE",
              stopped: fbFetchJob.state !== "selesai",
              total: fbFetchJob.found,
              diag: fbFetchJob.diag,
            });
          }
        }
      } else if (cmd.type === "FB_FETCH_ACK") {
        if (fbFetchJob && cmd.seq != null) {
          fbFetchJob.ackSeq = Math.max(fbFetchJob.ackSeq || 0, Number(cmd.seq) || 0);
          fbFetchBuffer = fbFetchBuffer.filter((item) => item.seq > fbFetchJob.ackSeq);
          scheduleSaveFbFetchStorage();
        }
      } else if (cmd.type === "FB_RUN_START") await startAutopostRun(cmd, dashTabId);
      else if (cmd.type === "FB_RUN_PAUSE") await pauseAutopostRun();
      else if (cmd.type === "FB_RUN_RESUME") await resumeAutopostRun();
      else if (cmd.type === "FB_RUN_STOP") await stopAutopostRun();
      else if (cmd.type === "FB_RUN_STATUS") {
        if (autopostState && autopostState.active && autopostState.run) {
          if (!cmd.userId || !autopostState.userId || cmd.userId === autopostState.userId) {
            autopostState.dashTabId = dashTabId;
            emit(dashTabId, {
              type: "FB_RUN_SYNC",
              run: autopostState.run,
              state: autopostState.paused ? "paused" : "running",
              targetIndex: autopostState.targetIndex,
            });
          }
        }
      }
    } else if (msg.kind === "tkp-scrape") {
      await handleScrape(msg, sender.tab && sender.tab.id);
    }
    sendResponse({ ok: true });
  })();
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const j = await getJob();
  if (j && tabId === j.scrapeTabId) {
    if (j.type === "fb-groups") {
      if (fbGroupsWatchdog) {
        clearTimeout(fbGroupsWatchdog);
        fbGroupsWatchdog = null;
      }
      if (fbFetchJob && (fbFetchJob.state === "berjalan" || fbFetchJob.state === "tertahan")) {
        fbFetchJob.state = "dihentikan";
        fbFetchJob.reason = "tab_ditutup_pengguna";
        fbFetchJob.updatedAt = Date.now();
        scheduleSaveFbFetchStorage(true);
        emit(fbFetchJob.dashTabId, {
          type: "FB_GROUPS_DONE",
          stopped: true,
          total: fbFetchJob.found,
          diag: { stopReason: "tab_ditutup_pengguna", total: fbFetchJob.found },
        });
        emitFbFetchState();
      }
      if (j.dashTabId) {
        chrome.tabs.update(j.dashTabId, { active: true }).catch(() => { });
      }
      await setJob(null);
    } else {
      const label = j.market === "shopee" ? "Shopee" : j.market === "gmaps" ? "Google Maps" : j.market === "sosmed" ? "Google Search" : "Tokopedia";
      emit(j.dashTabId, {
        type: "ERROR",
        jobId: j.jobId,
        message: `Tab ${label} ditutup sebelum pengambilan selesai.`,
      });
      await setJob(null);
    }
  }
});


chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (fbFetchJob && (fbFetchJob.state === "berjalan" || fbFetchJob.state === "tertahan")) {
    if (tabId === fbFetchJob.tabId && changeInfo.status === "complete") {
        if (!fbFetchJob.started && (fbFetchJob.reloadCount || 0) < 2) {
          fbFetchJob.reloadCount = (fbFetchJob.reloadCount || 0) + 1;
          await sleep(1000);
          chrome.tabs.sendMessage(tabId, {
            kind: "fb-groups-start",
            runId: fbFetchJob.id,
          }).catch(() => { });
        }
      }
    }
  });

try {
  chrome.alarms.create("fb-fetch-watchdog", { periodInMinutes: 1 });
} catch (_) { }

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "fb-fetch-watchdog") return;
  if (!fbFetchJob) return;
  if (fbFetchJob.state === "berjalan") {
    if (Date.now() - (fbFetchJob.updatedAt || 0) > 3 * 60 * 1000) {
      fbFetchJob.state = "error";
      fbFetchJob.reason = "Pengambilan tidak merespons (timeout 3 menit).";
      fbFetchJob.updatedAt = Date.now();
      scheduleSaveFbFetchStorage(true);
      emit(fbFetchJob.dashTabId, {
        type: "ERROR",
        message: "Pengambilan grup tidak merespons (timeout 3 menit).",
      });
      emitFbFetchState();
      if (fbFetchJob.windowId) {
        chrome.windows.remove(fbFetchJob.windowId).catch(() => { });
        fbFetchJob.windowId = undefined;
      }
      await setJob(null);
    }
  }
  // Bersihkan pekerjaan lama setelah 24 jam
  if (Date.now() - (fbFetchJob.startedAt || 0) > 24 * 60 * 60 * 1000) {
    fbFetchJob = null;
    fbFetchBuffer = [];
    chrome.storage.local.remove(["fbFetchJob", "fbFetchBuffer"]).catch(() => { });
  }
});

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  const found = tabs.find((t) => t.url && DASHBOARDS.some((d) => t.url.startsWith(d)));
  if (found) {
    await chrome.tabs.update(found.id, { active: true });
    await chrome.windows.update(found.windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: DASHBOARDS[0] });
  }
});
