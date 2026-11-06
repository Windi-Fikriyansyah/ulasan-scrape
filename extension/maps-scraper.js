// Dijalankan di halaman Google Maps. Hanya bekerja bila diperintah oleh background.js.
(() => {
  if (window.__mapsScraper) return;
  window.__mapsScraper = true;

  let running = false;
  let stopRequested = false;

  const sleep = async (ms) => {
    try {
      await chrome.runtime.sendMessage({ kind: "tkp-sleep", ms });
    } catch (_) {
      await new Promise((r) => setTimeout(r, ms));
    }
  };

  const send = (payload) => {
    try {
      chrome.runtime.sendMessage({ kind: "tkp-scrape", ...payload });
    } catch (_) {}
  };

  const randSleep = (min = 700, max = 1600) => {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return sleep(ms);
  };

  // ---------- Utilitas teks ----------

  // Google Maps memakai karakter ikon (Private Use Area) di dalam teks tombol.
  const PUA = /[\uE000-\uF8FF]/g;
  const clean = (s) =>
    String(s || "")
      .replace(PUA, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  const norm = (s) => clean(s).toLowerCase();
  const textOf = (el) => (el ? clean(el.innerText || el.textContent || "") : "");

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (_) {
      return s;
    }
  }

  function placeIdOf(url) {
    const s = safeDecode(String(url || ""));
    const m = s.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  function coordsOf(url) {
    const s = String(url || "");
    const m = s.match(/!3d(-?\d+(?:\.\d+)?).*?!4d(-?\d+(?:\.\d+)?)/) || s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : { lat: undefined, lng: undefined };
  }

  // Angka seperti "151", "1.234", "1,2 rb", "3 jt"
  function parseCount(str) {
    const s = String(str || "").toLowerCase();
    const m = s.match(/(\d[\d.,]*)\s*(rb|ribu|k|jt|juta)?/);
    if (!m) return undefined;
    if (m[2]) {
      const base = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(base)) return undefined;
      return Math.round(base * (/^(jt|juta)$/.test(m[2]) ? 1e6 : 1e3));
    }
    const n = parseInt(m[1].replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : undefined;
  }

  // Satu potongan teks dianggap nomor telepon bila diawali +, 0, atau ( dan 8-15 digit.
  function asPhone(part) {
    const t = clean(part);
    if (!/^[+0(]/.test(t.replace(/\s+/g, ""))) return undefined;
    if (!/^\+?[\d\s().-]+$/.test(t)) return undefined;
    const digits = t.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return undefined;
    return t;
  }

  const STATUS_RE =
    /^(buka|tutup|segera|akan buka|open|opens|closed|closes|closing|temporarily|permanently)\b/i;
  const PRICE_RE = /(^|\s)(rp|idr)\s?\d|^[$€£¥]+$|^[$€£¥]\s?\d|\d\s?(rb|ribu)\b/i;

  function unwrapUrl(href) {
    if (!href) return undefined;
    try {
      const u = new URL(href, location.origin);
      if (/google\./.test(u.hostname) && u.pathname === "/url") {
        return u.searchParams.get("q") || u.searchParams.get("url") || undefined;
      }
      if (/google\./.test(u.hostname) && u.pathname.startsWith("/aclk")) return undefined;
      return u.href;
    } catch (_) {
      return undefined;
    }
  }

  // ---------- Pemeriksaan halaman ----------

  function checkPageError() {
    const href = window.location.href;
    const host = window.location.hostname;
    if (host === "consent.google.com" || href.includes("consent.google.com")) {
      return "Google meminta persetujuan cookie. Buka Google Maps di tab biasa, klik Setuju, lalu coba lagi.";
    }
    if (
      href.includes("/sorry/") ||
      document.title.includes("Sorry") ||
      document.querySelector('#captcha-form, form[action*="Sorry"]')
    ) {
      return "Google mendeteksi lalu lintas tidak biasa. Tunggu beberapa menit, kurangi jumlah hasil, lalu coba lagi.";
    }
    return null;
  }

  function findFeed() {
    return document.querySelector('div[role="feed"]');
  }

  function isSinglePlace() {
    if (!window.location.pathname.includes("/maps/place/")) return false;
    if (findFeed()) return false;
    const h1 = document.querySelector("h1");
    return !!(
      h1 &&
      document.querySelector('[data-item-id="address"], [data-item-id^="phone:"], a[data-item-id="authority"]')
    );
  }

  function isEndOfList(feed) {
    if (!feed) return true;
    const t = norm(feed.textContent).slice(-1500);
    return (
      t.includes("anda telah mencapai akhir daftar") ||
      t.includes("telah mencapai akhir daftar") ||
      t.includes("you've reached the end of the list") ||
      t.includes("reached the end of the list") ||
      !!feed.querySelector(".HlvSq, div.PbZDve")
    );
  }

  // ---------- Kartu di daftar hasil ----------

  function getPlaceCards(feed) {
    if (!feed) return [];
    const seen = new Set();
    const out = [];
    for (const link of feed.querySelectorAll('a[href*="/maps/place/"]')) {
      const card = link.closest('div[role="article"]') || link.parentElement;
      if (!card) continue;
      const mapsUrl = (link.href || "").split("?")[0].split("#")[0];
      const placeId = placeIdOf(link.href);
      const key = placeId || mapsUrl;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // Sertakan semua tempat valid di daftar (termasuk yang berlabel bersponsor)
      out.push({ card, link, key, placeId, mapsUrl });
    }
    return out;
  }

  function cardLines(card, name) {
    const raw = (card.innerText || card.textContent || "").split(/\n+/).map(clean).filter(Boolean);
    const skip = /^(bersponsor|sponsored|situs web|website|rute|directions|petunjuk arah|telepon|call|bagikan|share|simpan|save|pesan|order online|reservasi|reserve a table|tidak ada ulasan|no reviews)$/i;
    const out = [];
    for (const l of raw) {
      if (l.length < 2) continue;
      if (norm(l) === norm(name)) continue;
      if (skip.test(l)) continue;
      if (/^[\d.,]+$/.test(l)) continue; // rating "5,0"
      if (/^\(?[\d.,]+\s*(rb|ribu|k|jt)?\)?$/i.test(l)) continue; // "(151)"
      if (/^[\d.,]+\s*\([\d.,\s]+(rb|ribu|k|jt)?\)$/i.test(l)) continue; // "5,0(151)"
      if (/^["“].*["”]$/.test(l)) continue; // cuplikan ulasan
      if (out[out.length - 1] !== l) out.push(l);
    }
    return out;
  }

  function parseCardData(item) {
    const { card, link, placeId, mapsUrl } = item;
    const rawUrl = link.href || "";

    // Nama
    let name = clean(link.getAttribute("aria-label"));
    if (!name) {
      const nameEl = card.querySelector('.qBF1Pd, [class*="fontHeadlineSmall"], h3, .fontTitleMedium');
      name = textOf(nameEl) || textOf(link);
    }

    // Rating dan jumlah ulasan: aria-label seperti "5,0 bintang 151 Ulasan" / "4.5 stars 1,234 Reviews"
    let rating;
    let reviews;
    const rEl = card.querySelector(
      'span[role="img"][aria-label*="bintang" i], span[role="img"][aria-label*="star" i], span[role="img"][aria-label*="ulasan" i]'
    );
    if (rEl) {
      const aria = clean(rEl.getAttribute("aria-label"));
      const m = aria.match(/([1-5](?:[.,]\d)?)\s*(?:bintang|stars?)/i) || aria.match(/^([1-5](?:[.,]\d)?)/);
      if (m) rating = parseFloat(m[1].replace(",", "."));
      const mr = aria.match(/(?:bintang|stars?)\s+([\d.,]+\s*(?:rb|ribu|k|jt)?)\s*(?:ulasan|reviews?)/i);
      if (mr) reviews = parseCount(mr[1]);
      if (reviews === undefined) {
        const inner = textOf(rEl).match(/\(([^)]+)\)/);
        if (inner) reviews = parseCount(inner[1]);
      }
    }
    if (rating === undefined) {
      const el = card.querySelector("span.MW4etd");
      const m = textOf(el).match(/^([1-5](?:[.,]\d)?)$/);
      if (m) rating = parseFloat(m[1].replace(",", "."));
    }
    if (reviews === undefined) {
      const el = card.querySelector("span.UY7F9");
      const m = textOf(el).match(/\(([^)]+)\)/);
      if (m) reviews = parseCount(m[1]);
    }

    // Baris info: "Binatu · No.44 Jalan Tamansari" lalu "Buka · Tutup pukul 23.00 · 0851-1756-8408"
    const lines = cardLines(card, name);
    let category;
    let address;
    let status;
    let phone;

    // 1. Ekstraksi telepon dari potongan baris
    for (const l of lines) {
      for (const part of l.split(/[·•|]/).map(clean)) {
        if (!phone) phone = asPhone(part);
      }
    }
    // 2. Ekstraksi telepon dari elemen teks leaf pada kartu bila belum dapat
    if (!phone) {
      for (const el of card.querySelectorAll("span, div")) {
        if (el.children.length === 0) {
          const p = asPhone(el.textContent);
          if (p) {
            phone = p;
            break;
          }
        }
      }
    }

    const statusIdx = lines.findIndex((l) => l.split(/[·•|]/).some((p) => STATUS_RE.test(clean(p))));
    if (statusIdx >= 0) {
      const parts = lines[statusIdx].split(/[·•|]/).map(clean).filter((p) => p && !asPhone(p));
      const st = parts.filter((p) => STATUS_RE.test(p) || /pukul|jam|\d{1,2}[.:]\d{2}/i.test(p));
      if (st.length) status = st.join(" · ");
    }

    const catLine = lines.find((l, i) => i !== statusIdx && !asPhone(l));
    if (catLine) {
      const parts = catLine
        .split(/[·•|]/)
        .map(clean)
        .filter((p) => p && !PRICE_RE.test(p) && !asPhone(p) && !STATUS_RE.test(p));
      if (parts.length) {
        if (!/^\d/.test(parts[0])) category = parts[0];
        if (parts.length > 1) address = parts[parts.length - 1];
      }
    }

    // Website dari tombol "Situs Web" di kartu
    let website;
    const webA = card.querySelector(
      'a[data-value="Situs Web" i], a[data-value="Website" i], a[aria-label*="situs" i], a[aria-label*="website" i]'
    );
    if (webA) website = unwrapUrl(webA.getAttribute("href"));

    const { lat, lng } = coordsOf(rawUrl);

    return { name, rating, reviews, category, address, status, phone, website, lat, lng, mapsUrl, placeId };
  }

  // ---------- Panel detail ----------

  function findDetailRoot(name) {
    const n = norm(name);
    if (!n) return null;
    const mains = [...document.querySelectorAll('div[role="main"]')];
    let root = mains.find((m) => norm(m.getAttribute("aria-label")) === n && !m.querySelector('div[role="feed"]'));
    if (!root) {
      root = mains.find(
        (m) => !m.querySelector('div[role="feed"]') && [...m.querySelectorAll("h1")].some((h) => norm(h.textContent) === n)
      );
    }
    return root || null;
  }

  function detailSig(root) {
    return [...root.querySelectorAll("[data-item-id]")]
      .map((e) => `${e.getAttribute("data-item-id")}=${textOf(e)}`)
      .join("|");
  }

  function urlHasPlace(placeId) {
    if (!placeId) return false;
    return safeDecode(window.location.href).toLowerCase().includes(placeId);
  }

  function parseDetailAddress(root) {
    const el = root.querySelector('button[data-item-id="address"], [data-item-id="address"]');
    if (el) {
      const val = textOf(el.querySelector(".Io6YTe, .fontBodyMedium") || el).replace(/^(alamat|address)\s*:\s*/i, "");
      if (val) return val;
      const aria = clean(el.getAttribute("aria-label")).replace(/^(alamat|address)\s*:\s*/i, "");
      if (aria) return aria;
    }
    for (const b of root.querySelectorAll('[aria-label^="Alamat:" i], [aria-label^="Address:" i]')) {
      const val = clean(b.getAttribute("aria-label")).replace(/^(alamat|address)\s*:\s*/i, "");
      if (val) return val;
    }
    return undefined;
  }

  function parseDetailPhone(root) {
    const el = root.querySelector('[data-item-id^="phone:"]');
    if (el) {
      const txt = textOf(el.querySelector(".Io6YTe, .fontBodyMedium") || el).replace(/^(telepon|phone)\s*:\s*/i, "");
      if (asPhone(txt)) return asPhone(txt);
      const aria = clean(el.getAttribute("aria-label")).replace(/^(telepon|phone)\s*:\s*/i, "");
      if (asPhone(aria)) return asPhone(aria);
      const id = (el.getAttribute("data-item-id") || "").replace(/^phone:(tel:)?/i, "");
      if (asPhone(id)) return id;
    }
    for (const b of root.querySelectorAll('[aria-label^="Telepon:" i], [aria-label^="Phone:" i]')) {
      const val = clean(b.getAttribute("aria-label")).replace(/^(telepon|phone)\s*:\s*/i, "");
      if (asPhone(val)) return asPhone(val);
    }
    const tel = root.querySelector('a[href^="tel:"]');
    if (tel) {
      const val = asPhone(textOf(tel)) || asPhone(tel.getAttribute("href").replace(/^tel:/, ""));
      if (val) return val;
    }
    return undefined;
  }

  function parseDetailWebsite(root) {
    const a = root.querySelector('a[data-item-id="authority"]');
    if (a) {
      const u = unwrapUrl(a.getAttribute("href"));
      if (u) return u;
    }
    for (const el of root.querySelectorAll('a[aria-label^="Situs web:" i], a[aria-label^="Website:" i]')) {
      const u = unwrapUrl(el.getAttribute("href"));
      if (u) return u;
    }
    return undefined;
  }

  function parseDetailHours(root) {
    // 1. aria-label berisi jadwal mingguan, dipisah titik koma
    for (const el of root.querySelectorAll("[aria-label]")) {
      const aria = clean(el.getAttribute("aria-label"));
      if ((aria.match(/;/g) || []).length >= 4) {
        const list = aria
          .replace(/\.?\s*(sembunyikan|tampilkan|hide|show)[^;]*$/i, "")
          .split(";")
          .map(clean)
          .filter((s) => s && !/^(sembunyikan|tampilkan|hide|show)/i.test(s));
        if (list.length >= 5) return list.join(" | ");
      }
    }
    // 2. Tabel jam buka (bisa tersembunyi, dibaca lewat textContent)
    for (const t of root.querySelectorAll("table")) {
      const rows = t.querySelectorAll("tr");
      if (rows.length < 5) continue;
      const list = [];
      for (const r of rows) {
        const cells = [...r.querySelectorAll("td, th")].map((c) => clean(c.textContent)).filter(Boolean);
        if (cells.length >= 2) list.push(`${cells[0]} ${cells.slice(1).join(" ")}`);
      }
      if (list.length >= 5) return list.join(" | ");
    }
    // 3. Ringkasan baris jam buka
    const oh = root.querySelector('[data-item-id="oh"]');
    if (oh) return textOf(oh).replace(/\n+/g, " | ") || undefined;
    return undefined;
  }

  function parseDetailClosure(root) {
    for (const s of root.querySelectorAll("span, div")) {
      if (s.children.length > 2) continue;
      const t = textOf(s);
      if (/^(tutup permanen|tutup sementara|permanently closed|temporarily closed)$/i.test(t)) return t;
    }
    return undefined;
  }

  function parseDetailStatus(root) {
    const closure = parseDetailClosure(root);
    if (closure) return closure;
    let n = 0;
    for (const s of root.querySelectorAll("span")) {
      if (++n > 600) break;
      if (s.children.length > 3) continue;
      const t = textOf(s);
      if (t.length < 60 && /^(buka 24 jam|buka|tutup|segera tutup|segera buka|open 24 hours|open|closed|closes soon|opens soon)\b/i.test(t)) {
        return t;
      }
    }
    return undefined;
  }

  function parseDetailCategory(root) {
    const btn = root.querySelector('button[jsaction*="category"], button.DkEaL');
    const t = textOf(btn);
    return t || undefined;
  }

  // Cari kembali anchor tempat di daftar (referensi lama bisa terlepas bila daftar dirender ulang).
  function findLinkFor(item) {
    if (item.link && item.link.isConnected) return item.link;
    for (const a of document.querySelectorAll('a[href*="/maps/place/"]')) {
      if (item.placeId && placeIdOf(a.href) === item.placeId) return a;
      if ((a.href || "").split("?")[0] === item.mapsUrl) return a;
    }
    return null;
  }

  async function backToListIfNeeded() {
    if (findFeed()) return true;
    const backBtn = document.querySelector(
      'button[aria-label="Kembali" i], button[aria-label="Back" i], button[aria-label^="Kembali ke" i], button[aria-label^="Back to" i], button[jsaction*="back" i]'
    );
    if (backBtn) {
      backBtn.click();
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      if (findFeed()) return true;
      await sleep(250);
    }
    return !!findFeed();
  }

  // Klik tempat lalu tunggu panel detail MILIK tempat itu (bukan panel tempat sebelumnya).
  async function openDetail(item, prev) {
    let link = findLinkFor(item);
    if (!link) {
      await backToListIfNeeded();
      link = findLinkFor(item);
    }
    if (!link) return null;

    link.scrollIntoView({ block: "center" });
    link.click();

    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !stopRequested) {
      const root = findDetailRoot(item.name);
      if (root) {
        const elapsed = Date.now() - t0;
        const urlOk = urlHasPlace(item.placeId);
        const otherName = !prev || norm(prev.name) !== norm(item.name);
        const changed = !prev || detailSig(root) !== prev.sig;
        if (urlOk || (otherName && elapsed > 500) || (changed && elapsed > 2500)) {
          // Tunggu sebentar agar baris data dirender
          const t1 = Date.now();
          while (
            Date.now() - t1 < 2500 &&
            !root.querySelector('[data-item-id="address"], [data-item-id^="phone:"], a[data-item-id="authority"]')
          ) {
            await sleep(200);
          }
          await sleep(300);
          return root;
        }
      }
      await sleep(200);
    }
    return null;
  }

  // ---------- Memuat hasil lebih banyak (Scroll & Akumulasi) ----------

  async function nudgeFeed(feed, stale) {
    const fire = () => {
      feed.dispatchEvent(new Event("scroll", { bubbles: true }));
      feed.dispatchEvent(new WheelEvent("wheel", { deltaY: 1500, bubbles: true, cancelable: true }));
    };
    if (stale > 0) {
      feed.scrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight - 800);
      fire();
      await sleep(300);
    }
    const anchors = feed.querySelectorAll('a[href*="/maps/place/"]');
    const last = anchors[anchors.length - 1];
    if (last) {
      last.scrollIntoView({ block: "end", behavior: "instant" });
    }
    feed.scrollTop = feed.scrollHeight;
    fire();
  }

  // Akumulasi semua tempat secara bertahap saat scroll agar tidak ada kartu yang terlewat atau ter-unmount.
  async function collectPlaces(target) {
    const collected = new Map();
    const deadline = Date.now() + Math.min(300000, Math.max(60000, target * 2500));
    let lastSize = 0;
    let stale = 0;

    while (!stopRequested && Date.now() < deadline) {
      const feed = findFeed();
      if (!feed) break;

      // Kumpulkan kartu yang saat ini ada di DOM
      const currentCards = getPlaceCards(feed);
      for (const it of currentCards) {
        if (!collected.has(it.key)) {
          collected.set(it.key, { ...it, data: parseCardData(it) });
        }
      }

      if (collected.size >= target || isEndOfList(feed)) {
        break;
      }

      if (collected.size > lastSize) {
        lastSize = collected.size;
        stale = 0;
      } else {
        stale++;
        if (stale >= 7) {
          // Tidak ada hasil baru setelah 7 kali percobaan scroll berturut-turut
          break;
        }
      }

      await nudgeFeed(feed, stale);

      // Tunggu hingga elemen baru muncul atau timeout 4 detik
      const t = Date.now();
      while (Date.now() - t < 4000 && !stopRequested) {
        await sleep(350);
        const f = findFeed();
        if (!f) break;
        if (getPlaceCards(f).some((c) => !collected.has(c.key)) || isEndOfList(f)) {
          break;
        }
      }
    }

    return [...collected.values()].slice(0, target);
  }

  // ---------- Sampel untuk diagnosa ----------

  function makeSample(firstCard, detailPanel) {
    try {
      let html = "";
      const strip = (root) => {
        root.querySelectorAll("script, style").forEach((n) => n.remove());
        root.querySelectorAll("path").forEach((p) => p.removeAttribute("d"));
        root.querySelectorAll("*").forEach((n) => {
          n.removeAttribute("class");
          n.removeAttribute("style");
          n.removeAttribute("srcset");
          for (const a of ["src", "data-src", "href"]) {
            const v = n.getAttribute(a);
            if (v && v.length > 140) n.setAttribute(a, v.slice(0, 140) + "…");
          }
        });
      };
      if (firstCard) {
        const c = firstCard.cloneNode(true);
        strip(c);
        html += c.outerHTML;
      }
      if (detailPanel) {
        const d = detailPanel.cloneNode(true);
        strip(d);
        html += "\n<!-- DETAIL PANEL -->\n" + d.outerHTML;
      }
      return html.slice(0, 9000);
    } catch (_) {
      return "";
    }
  }

  function filterLeadFields(lead, requestedFields) {
    const out = { name: lead.name || "Tempat Usaha" };
    if (requestedFields.includes("kategori") && lead.category) out.category = lead.category;
    if (requestedFields.includes("alamat") && lead.address) out.address = lead.address;
    if (requestedFields.includes("telepon") && lead.phone) out.phone = lead.phone;
    if (requestedFields.includes("website") && lead.website) out.website = lead.website;
    if (requestedFields.includes("rating") && typeof lead.rating === "number") out.rating = lead.rating;
    if (requestedFields.includes("jumlah_ulasan") && typeof lead.reviews === "number") out.reviews = lead.reviews;
    if (requestedFields.includes("jam_buka") && (lead.hours || lead.status)) out.hours = lead.hours || lead.status;
    if (requestedFields.includes("koordinat")) {
      if (typeof lead.lat === "number") out.lat = lead.lat;
      if (typeof lead.lng === "number") out.lng = lead.lng;
    }
    if (requestedFields.includes("link_maps") && lead.mapsUrl) out.mapsUrl = lead.mapsUrl;
    if (requestedFields.includes("status") && lead.status) out.status = lead.status;
    return out;
  }

  // Hanya buka panel detail bila data yang diminta benar-benar belum ada di kartu.
  function needsDetailFor(cardData, fields) {
    if (fields.includes("alamat") && !cardData.address) return true;
    if (fields.includes("telepon") && !cardData.phone) return true;
    if (fields.includes("website") && !cardData.website) return true;
    if (fields.includes("jam_buka") && (!cardData.hours || !cardData.hours.includes("|"))) return true;
    return false;
  }

  async function run({ maxResults = 50, fields = [] }) {
    running = true;
    stopRequested = false;
    maxResults = Math.min(200, Math.max(1, Math.round(Number(maxResults)) || 50));
    fields = Array.isArray(fields) ? fields : [];

    try {
      const initErr = checkPageError();
      if (initErr) {
        send({ type: "error", message: initErr });
        return;
      }

      // Tunggu daftar hasil atau detail satu tempat (maksimal 20 detik)
      const startWait = Date.now();
      let feed = null;
      let single = false;

      while (Date.now() - startWait < 20000) {
        const err = checkPageError();
        if (err) {
          send({ type: "error", message: err });
          return;
        }
        if (isSinglePlace()) {
          single = true;
          break;
        }
        feed = findFeed();
        if (feed && getPlaceCards(feed).length > 0) break;

        const main = document.querySelector('div[role="main"]');
        const mt = norm(main && main.textContent);
        if (mt.includes("tidak dapat menemukan") || mt.includes("can't find") || mt.includes("no results")) {
          send({ type: "error", message: "Tidak ada tempat ditemukan untuk pencarian ini. Coba kata kunci atau lokasi lain." });
          return;
        }
        await sleep(500);
      }

      // Pencarian langsung membuka satu tempat
      if (single) {
        await sleep(800);
        const h1 = document.querySelector("h1");
        const name = textOf(h1) || "Tempat Usaha";
        const root = findDetailRoot(name) || document.querySelector('div[role="main"]') || document.body;
        const rawUrl = window.location.href;
        const { lat, lng } = coordsOf(rawUrl);

        let rating;
        let reviews;
        const rEl = root.querySelector('span[role="img"][aria-label*="bintang" i], span[role="img"][aria-label*="star" i]');
        if (rEl) {
          const m = clean(rEl.getAttribute("aria-label")).match(/([1-5](?:[.,]\d)?)/);
          if (m) rating = parseFloat(m[1].replace(",", "."));
        }
        const revEl = root.querySelector('[aria-label*="ulasan" i]:not([role="img"]), [aria-label*="reviews" i]:not([role="img"])');
        if (revEl) reviews = parseCount(revEl.getAttribute("aria-label"));

        const leadRaw = {
          name,
          category: parseDetailCategory(root),
          address: parseDetailAddress(root),
          phone: parseDetailPhone(root),
          website: parseDetailWebsite(root),
          hours: parseDetailHours(root),
          status: parseDetailStatus(root),
          rating,
          reviews,
          lat,
          lng,
          mapsUrl: rawUrl.split("?")[0].split("#")[0],
        };

        send({ type: "meta", sample: makeSample(null, root) });
        send({ type: "leads", found: 1, leads: [filterLeadFields(leadRaw, fields)] });
        send({ type: "done", stopped: false });
        return;
      }

      if (!feed) {
        send({ type: "error", message: "Tidak ada tempat ditemukan untuk pencarian ini. Coba kata kunci atau lokasi lain." });
        return;
      }

      const firstPair = getPlaceCards(feed)[0];
      if (firstPair) send({ type: "meta", sample: makeSample(firstPair.card, null) });

      // Kumpulkan kartu tempat secara bertahap sambil scroll feed
      const items = await collectPlaces(maxResults);

      if (items.length === 0) {
        send({ type: "error", message: "Tidak ada tempat ditemukan untuk pencarian ini. Coba kata kunci atau lokasi lain." });
        return;
      }

      const seenKeys = new Set();
      let totalFound = 0;
      let batch = [];
      let prev = null;
      let sentDetailSample = false;

      for (let i = 0; i < items.length && !stopRequested; i++) {
        const item = items[i];
        const leadRaw = { ...item.data };

        // Jika butuh detail tambahan yang belum ada di kartu
        if (needsDetailFor(item.data, fields)) {
          const root = await openDetail({ ...item, name: item.data.name }, prev);
          if (root) {
            const address = parseDetailAddress(root);
            const phone = parseDetailPhone(root);
            const website = parseDetailWebsite(root);
            const hours = parseDetailHours(root);
            const category = parseDetailCategory(root);
            const closure = parseDetailClosure(root);

            if (address) leadRaw.address = address;
            if (phone) leadRaw.phone = phone;
            if (website) leadRaw.website = website;
            if (hours) leadRaw.hours = hours;
            if (category) leadRaw.category = category;
            if (closure) leadRaw.status = closure;
            else if (!leadRaw.status) leadRaw.status = parseDetailStatus(root);

            prev = { name: item.data.name, placeId: item.placeId, sig: detailSig(root) };

            if (!sentDetailSample) {
              sentDetailSample = true;
              send({ type: "meta", sample: makeSample(item.card, root) });
            }
          }
          // Selalu kembali ke feed agar referensi daftar tetap sinkron
          await backToListIfNeeded();
          await randSleep(600, 1200);
        }

        const key = item.key || `${norm(leadRaw.name)}¦${norm(leadRaw.address)}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        batch.push(filterLeadFields(leadRaw, fields));
        totalFound++;
        if (batch.length >= 5) {
          send({ type: "leads", found: totalFound, leads: batch });
          batch = [];
        }
      }

      if (batch.length > 0) {
        send({ type: "leads", found: totalFound, leads: batch });
        batch = [];
      }

      send({ type: "done", stopped: stopRequested });
    } catch (e) {
      send({ type: "error", message: String((e && e.message) || e) });
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.kind === "tkp-start") {
      if (running) {
        sendResponse({ ok: false });
        return;
      }
      run(msg.options || {});
      sendResponse({ ok: true });
    } else if (msg.kind === "tkp-stop") {
      stopRequested = true;
      sendResponse({ ok: true });
    }
  });
})();
