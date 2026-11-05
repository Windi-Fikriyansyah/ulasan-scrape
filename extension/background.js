// Service worker: mengatur satu pekerjaan pengambilan ulasan pada satu waktu.

const DASHBOARDS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
];

let job = null; // { jobId, dashTabId, scrapeTabId }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

async function getJob() {
  if (job) return job;
  const s = await chrome.storage.session.get("job");
  job = s.job || null;
  return job;
}

async function setJob(j) {
  job = j;
  if (j) await chrome.storage.session.set({ job: j });
  else await chrome.storage.session.remove("job");
}

function emit(tabId, event) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { kind: "tkp-event", event }).catch(() => {});
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
  chrome.tabs.remove(j.scrapeTabId).catch(() => {});
}

async function failJob(message) {
  const j = await getJob();
  if (!j) return;
  emit(j.dashTabId, { type: "ERROR", jobId: j.jobId, message });
  await endJob(j);
}

async function startJob(cmd, dashTabId) {
  if (await getJob()) {
    emit(dashTabId, {
      type: "ERROR",
      jobId: cmd.jobId,
      message: "Masih ada pengambilan yang berjalan. Tunggu selesai atau hentikan dulu.",
    });
    return;
  }

  let url;
  try {
    const u = new URL(cmd.url);
    if (u.protocol !== "https:" || u.hostname !== "www.tokopedia.com") throw new Error("bad");
    url = u.href;
  } catch (_) {
    emit(dashTabId, { type: "ERROR", jobId: cmd.jobId, message: "Link itu bukan halaman Tokopedia." });
    return;
  }

  const tab = await chrome.tabs.create({ url, active: false });
  await setJob({ jobId: cmd.jobId, dashTabId, scrapeTabId: tab.id });

  const loaded = await waitForLoad(tab.id);
  if (!loaded) return failJob("Halaman Tokopedia tidak selesai dimuat dalam 45 detik.");

  const options = {
    maxPages: clamp(cmd.options && cmd.options.maxPages, 1, 200, 10),
    delay: clamp(cmd.options && cmd.options.delay, 500, 10000, 1200),
  };

  for (let i = 0; i < 20; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { kind: "tkp-start", options });
      if (r && r.ok) return;
    } catch (_) {}
    await sleep(500);
  }
  await failJob("Extension tidak bisa masuk ke halaman Tokopedia. Muat ulang extension, lalu coba lagi.");
}

async function stopJob() {
  const j = await getJob();
  if (!j) return;
  chrome.tabs.sendMessage(j.scrapeTabId, { kind: "tkp-stop" }).catch(() => {});
}

async function handleScrape(msg, senderTabId) {
  const j = await getJob();
  if (!j || senderTabId !== j.scrapeTabId) return;

  switch (msg.type) {
    case "meta":
      emit(j.dashTabId, { type: "META", jobId: j.jobId, title: msg.title, image: msg.image, sample: msg.sample });
      break;
    case "batch":
      emit(j.dashTabId, { type: "BATCH", jobId: j.jobId, page: msg.page, reviews: msg.reviews });
      break;
    case "done":
      emit(j.dashTabId, { type: "DONE", jobId: j.jobId, stopped: !!msg.stopped });
      await endJob(j);
      break;
    case "error":
      emit(j.dashTabId, { type: "ERROR", jobId: j.jobId, message: msg.message });
      await endJob(j);
      break;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // Jeda dijalankan di sini karena timer di tab latar belakang diperlambat browser.
  if (msg.kind === "tkp-sleep") {
    setTimeout(() => sendResponse({ ok: true }), clamp(msg.ms, 0, 20000, 500));
    return true;
  }

  (async () => {
    if (msg.kind === "tkp-cmd") {
      const cmd = msg.cmd || {};
      const dashTabId = sender.tab && sender.tab.id;
      if (cmd.type === "START") await startJob(cmd, dashTabId);
      else if (cmd.type === "STOP") await stopJob();
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
    emit(j.dashTabId, {
      type: "ERROR",
      jobId: j.jobId,
      message: "Tab Tokopedia ditutup sebelum pengambilan selesai.",
    });
    await setJob(null);
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
