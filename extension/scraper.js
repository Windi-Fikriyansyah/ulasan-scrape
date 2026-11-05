// Dijalankan di halaman Tokopedia. Hanya bekerja bila diperintah oleh background.js.
(() => {
  if (window.__tkpScraper) return;
  window.__tkpScraper = true;

  let running = false;
  let stopRequested = false;

  // Jeda lewat service worker supaya tidak terkena throttle timer tab latar belakang.
  const sleep = async (ms) => {
    try { await chrome.runtime.sendMessage({ kind: "tkp-sleep", ms }); }
    catch (_) { await new Promise((r) => setTimeout(r, ms)); }
  };

  const send = (payload) => {
    try { chrome.runtime.sendMessage({ kind: "tkp-scrape", ...payload }); } catch (_) {}
  };

  const REL_DATE = /(hari ini|kemarin|\d+\s*(hari|minggu|bulan|tahun)\s*lalu|sebulan lalu|seminggu lalu|setahun lalu|\d{1,2}\s+\w+\s+\d{4})/i;

  function findReviewCards() {
    const cards = new Set();
    document.querySelectorAll('[data-testid="lblItemUlasan"]').forEach((t) => {
      const card = t.closest("article") || (t.parentElement && t.parentElement.parentElement && t.parentElement.parentElement.parentElement);
      if (card) cards.add(card);
    });
    if (cards.size) return [...cards];
    return [...document.querySelectorAll("article")].filter((a) =>
      a.querySelector('[data-testid="icnStarRating"], [aria-label*="bintang" i]')
    );
  }

  // ---------------------------------------------------------------
  // RATING BINTANG
  // Dicoba berlapis, karena Tokopedia sering mengubah markup-nya:
  // 1) aria-label/title/alt seperti "bintang 5" atau "5 bintang"
  // 2) itemprop="ratingValue"
  // 3) menghitung ikon bintang SVG/img yang terisi
  // ---------------------------------------------------------------
  const RATING_RE = /(?:bintang|star|rating)\D*([1-5])(?!\d)|(?<!\d)([1-5])\D*(?:bintang|star)|([1-5])\s*(?:\/|dari|of)\s*5|^([1-5])$/i;

  function parseRatingValue(str) {
    if (!str) return 0;
    const m = String(str).trim().match(RATING_RE);
    if (m) {
      const v = Number(m[1] || m[2] || m[3] || m[4]);
      if (v >= 1 && v <= 5) return v;
    }
    return 0;
  }

  function isSvgStarFilled(svg) {
    const shape = svg.querySelector("path, polygon, circle") || svg;
    const fillAttr = (svg.getAttribute("fill") || shape.getAttribute("fill") || "").toLowerCase();
    if (/var\(--yn|#ffd|#ffc|yellow|gold/i.test(fillAttr)) return true;
    if (/var\(--nn|#e4e|#d|grey|gray/i.test(fillAttr)) return false;

    const cls = (svg.getAttribute("class") || shape.getAttribute("class") || "").toLowerCase();
    if (/empty|inactive|disable|unfill/.test(cls)) return false;
    if (/active|filled/.test(cls)) return true;

    try {
      const s = getComputedStyle(shape).fill || getComputedStyle(svg).fill || "";
      const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (r > 180 && g > 140 && b < 160) return true;
        const grey = Math.max(r, g, b) - Math.min(r, g, b) <= 40 && (r + g + b) / 3 > 150;
        return !grey;
      }
    } catch (_) {}
    return true;
  }

  function countStars(card) {
    const box = card.querySelector('[data-testid="icnStarRating"], [role="img"][aria-label*="bintang" i]');
    if (box) {
      const svgs = [...box.querySelectorAll("svg")];
      if (svgs.length >= 1 && svgs.length <= 5) {
        const filled = svgs.filter(isSvgStarFilled).length;
        if (filled >= 1 && filled <= 5) return filled;
      }
      const imgs = [...box.querySelectorAll("img")];
      if (imgs.length >= 1 && imgs.length <= 5) {
        const filled = imgs.filter((i) => !/empty|outline|inactive|grey|gray/i.test(i.src || i.getAttribute("src") || "")).length;
        if (filled >= 1 && filled <= 5) return filled;
      }
    }
    const allSvgs = [...card.querySelectorAll('svg[fill*="YN300"], svg[fill*="FFD45F"]')];
    if (allSvgs.length >= 1 && allSvgs.length <= 5) {
      return allSvgs.length;
    }
    return 0;
  }

  function parseRating(card) {
    const box = card.querySelector('[data-testid="icnStarRating"], [role="img"][aria-label*="bintang" i]');
    if (box) {
      for (const a of ["aria-label", "title", "alt"]) {
        const r = parseRatingValue(box.getAttribute(a));
        if (r) return r;
      }
      for (const el of box.querySelectorAll("[aria-label], [title], img[alt]")) {
        for (const a of ["aria-label", "title", "alt"]) {
          const r = parseRatingValue(el.getAttribute(a));
          if (r) return r;
        }
      }
      const cnt = countStars(card);
      if (cnt) return cnt;
    }
    for (const el of card.querySelectorAll('[aria-label*="bintang" i], [title*="bintang" i]')) {
      for (const a of ["aria-label", "title"]) {
        const r = parseRatingValue(el.getAttribute(a));
        if (r) return r;
      }
    }
    const ip = card.querySelector('[itemprop="ratingValue"]');
    if (ip) {
      const v = Number(ip.getAttribute("content") || ip.textContent);
      if (v >= 1 && v <= 5) return Math.round(v);
    }
    return countStars(card);
  }

  // ---------------------------------------------------------------
  // GAMBAR: pisahkan foto profil (avatar) dari foto ulasan
  // Avatar = gambar pembeli (alt="foto profil", di samping nama, atau URL avatar)
  // Foto ulasan = gambar ulasan produk (data-testid="imgItemPhotoulasan",
  // data-ipo-scene="PDP_review_buyer", atau alt="foto review produk...")
  // ---------------------------------------------------------------
  // Gambar lazy-load Tokopedia berisi placeholder (zeus_v2/xxxx.svg) sampai terlihat
  // di layar. Di tab latar belakang gambar itu tidak pernah dimuat, jadi placeholder
  // harus diabaikan, bukan disimpan sebagai foto.
  const PLACEHOLDER = /^data:|zeus_v2\/[^/?#]+\.svg/i;
  const goodUrl = (s) => !!s && /^https?:\/\//i.test(s) && !PLACEHOLDER.test(s);

  const imgUrl = (img) => {
    if (!img) return "";
    // 1. Gambar yang sudah benar-benar dimuat browser
    for (const s of [img.currentSrc, img.getAttribute("src")]) if (goodUrl(s)) return s;
    // 2. URL asli hasil baca props React oleh page-hook.js
    const hook = img.getAttribute("data-tkp-src");
    if (goodUrl(hook)) return hook;
    // 3. srcset / atribut lazy load
    const srcset = img.getAttribute("srcset") || "";
    const cands = srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(goodUrl);
    if (cands.length) return cands[cands.length - 1];
    for (const attr of ["data-src", "data-original", "data-lazy-src", "data-high-res-src"]) {
      const v = img.getAttribute(attr);
      if (goodUrl(v)) return v;
    }
    return "";
  };

  // ---------------------------------------------------------------
  // DATA ASLI DARI page-hook.js (respons API ulasan Tokopedia)
  // ---------------------------------------------------------------
  let hookData = [];
  document.addEventListener("tkp-hook-data", (e) => {
    try { hookData = JSON.parse(e.detail) || []; } catch (_) {}
  });
  const refreshHook = () => {
    try { document.dispatchEvent(new CustomEvent("tkp-hook-req")); } catch (_) {}
  };

  const norm = (s) => String(s || "").toLowerCase().replace(/\.{3}|…/g, " ").replace(/\s+/g, " ").trim();

  function cardName(card) {
    const nameEl = card.querySelector('[data-testid="lblUserName"], span.name, .name');
    if (nameEl && nameEl.innerText.trim()) return nameEl.innerText.trim();
    const av = card.querySelector('img[alt*="foto profil" i]');
    const box = av && (av.closest('[data-testid="imgLeg-c"]') || av);
    const span = box && box.parentElement && box.parentElement.querySelector(":scope > span");
    return ((span && span.innerText) || "").trim();
  }

  function matchApi(review, name) {
    if (!hookData.length) return null;
    const key = norm(review).slice(0, 40);
    const n = norm(name);
    let cands;
    if (key) cands = hookData.filter((h) => norm(h.message).startsWith(key));
    else cands = hookData.filter((h) => !norm(h.message) && n && norm(h.name) === n);
    if (cands.length > 1 && n) {
      const byName = cands.filter((h) => norm(h.name) === n);
      if (byName.length) cands = byName;
    }
    return cands[0] || null;
  }

  function classifyImages(card, textEl, replyEl) {
    let avatar = "";
    const photos = [];

    // 1. Temukan Avatar
    const avatarImg = card.querySelector(
      'img[alt*="foto profil" i], img[alt*="profile" i], img[alt*="avatar" i], [data-testid*="avatar" i] img'
    );
    if (avatarImg && (!replyEl || !replyEl.contains(avatarImg))) {
      avatar = imgUrl(avatarImg);
    }

    // 2. Temukan Foto-foto Ulasan
    const photoImgs = card.querySelectorAll(
      'img[data-testid="imgItemPhotoulasan"], img[data-ipo-scene="PDP_review_buyer"], img[alt*="foto review" i], img[alt*="review produk" i]'
    );
    if (photoImgs.length > 0) {
      for (const img of photoImgs) {
        if (replyEl && replyEl.contains(img)) continue;
        if (img === avatarImg) continue;
        const src = imgUrl(img);
        if (src) photos.push(src);
      }
    }

    // 3. Fallback bila avatar atau foto ulasan belum ditemukan dari selector spesifik
    if (!avatar || photos.length === 0) {
      let firstSeen = false;
      for (const img of card.querySelectorAll("img")) {
        if (replyEl && replyEl.contains(img)) continue;
        if (img === avatarImg) continue;
        if (img.getAttribute("data-testid") === "imgLeg-si") continue; // sizer svg

        const src = imgUrl(img);
        if (!src) continue;
        if (/emoji|badge|icon|medal|star/i.test(src)) continue;

        const beforeText = textEl
          ? !!(textEl.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_PRECEDING)
          : !firstSeen;
        firstSeen = true;

        const isAvatar = /user-\d+|default_picture_user|default[_-]toped|avatar|profile/i.test(src) || (beforeText && !avatar);
        if (isAvatar && !avatar) {
          avatar = src;
        } else if (!isAvatar) {
          photos.push(src);
        }
      }
    }

    return { avatar, images: [...new Set(photos)] };
  }

  function parseCard(card) {
    const textEl = card.querySelector('[data-testid="lblItemUlasan"]');
    const review = ((textEl && textEl.innerText) || "").trim();

    const nameEl = card.querySelector('[data-testid="lblUserName"], span.name, .name');
    const name = ((nameEl && nameEl.innerText) || "").trim();

    let date = "";
    for (const el of card.querySelectorAll("p, span, time")) {
      const t = (el.innerText || "").trim();
      if (t && t.length < 30 && REL_DATE.test(t)) { date = t; break; }
    }

    let variant = "";
    for (const el of card.querySelectorAll("p, span")) {
      const t = (el.innerText || "").trim();
      if (/^varian\s*:/i.test(t)) { variant = t.replace(/^varian\s*:\s*/i, ""); break; }
    }

    const replyEl = card.querySelector('[data-testid="lblSellerReply"], [data-testid*="reply" i]');
    const dom = classifyImages(card, textEl, replyEl);
    const api = matchApi(review, cardName(card));
    const avatar = (api && api.avatar) || dom.avatar;
    const images = api && api.images.length ? api.images : dom.images;

    return {
      name,
      avatar,
      rating: (api && api.rating) || parseRating(card),
      date,
      variant,
      review,
      images,
      seller_reply: ((replyEl && replyEl.innerText) || "").trim(),
    };
  }

  // HTML ringkas satu kartu ulasan, untuk diagnosa bila rating/foto salah baca.
  function sampleHtml(card) {
    try {
      const c = card.cloneNode(true);
      c.querySelectorAll("script, style").forEach((n) => n.remove());
      c.querySelectorAll("path").forEach((p) => p.removeAttribute("d"));
      c.querySelectorAll("*").forEach((n) => {
        n.removeAttribute("class");
        n.removeAttribute("style");
        n.removeAttribute("srcset");
        for (const a of ["src", "data-src"]) {
          const v = n.getAttribute(a);
          if (v && v.length > 140) n.setAttribute(a, v.slice(0, 140) + "…");
        }
      });
      return c.outerHTML.slice(0, 9000);
    } catch (_) {
      return "";
    }
  }

  function expandAll() {
    document.querySelectorAll("article button, article span, article p").forEach((el) => {
      const t = (el.innerText || "").trim().toLowerCase();
      if (t === "selengkapnya" || t === "lihat selengkapnya") {
        try { el.click(); } catch (_) {}
      }
    });
  }

  async function scrapeVisible() {
    expandAll();
    await sleep(350);
    refreshHook(); // minta data API + URL gambar asli dari page-hook.js (sinkron)
    return findReviewCards().map(parseCard).filter((r) => r.review || r.rating);
  }

  const keyOf = (r) => [r.name, r.date, r.rating, r.review.slice(0, 80)].join("¦");
  const signature = () => findReviewCards().map((c) => c.innerText.slice(0, 40)).join("|");

  function findNextButton() {
    return (
      document.querySelector('button[aria-label^="Laman berikutnya"]') ||
      document.querySelector('button[aria-label*="berikutnya" i]') ||
      document.querySelector('button[aria-label*="next" i]')
    );
  }
  const isDisabled = (b) => !b || b.disabled || b.getAttribute("aria-disabled") === "true";

  async function waitForChange(prev, timeout = 7000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await sleep(300);
      const sig = signature();
      if (sig && sig !== prev) return true;
    }
    return false;
  }

  async function waitForReviews(timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (findReviewCards().length) return true;
      window.scrollBy(0, Math.round(window.innerHeight * 0.8));
      await sleep(500);
    }
    return false;
  }

  function productMeta() {
    const og = (p) => {
      const el = document.querySelector(`meta[property="${p}"]`);
      return (el && el.content) || "";
    };
    const h1 = document.querySelector("h1");
    let title = og("og:title") || (h1 && h1.innerText) || document.title;
    title = title.replace(/^Ulasan\s+/i, "").replace(/\s*\|\s*Tokopedia.*$/i, "").trim();
    return { title, image: og("og:image") };
  }

  async function run({ maxPages = 10, delay = 1200 }) {
    running = true;
    stopRequested = false;
    try {
      const ok = await waitForReviews();
      if (!ok) {
        send({
          type: "error",
          message: "Ulasan tidak ditemukan di halaman ini. Pastikan produknya punya ulasan, dan Tokopedia tidak sedang meminta verifikasi.",
        });
        return;
      }
      const first = findReviewCards()[0];
      if (first) first.scrollIntoView({ block: "center" });
      send({ type: "meta", ...productMeta(), sample: first ? sampleHtml(first) : "" });

      const seen = new Set();
      let page = 1;
      while (page <= maxPages && !stopRequested) {
        const fresh = [];
        for (const r of await scrapeVisible()) {
          const k = keyOf(r);
          if (!seen.has(k)) { seen.add(k); fresh.push(r); }
        }
        send({ type: "batch", page, reviews: fresh });

        const next = findNextButton();
        if (isDisabled(next)) break;
        const sig = signature();
        next.scrollIntoView({ block: "center" });
        next.click();
        if (!(await waitForChange(sig))) break;
        await sleep(delay);
        page++;
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
      if (running) { sendResponse({ ok: false }); return; }
      run(msg.options || {});
      sendResponse({ ok: true });
    } else if (msg.kind === "tkp-stop") {
      stopRequested = true;
      sendResponse({ ok: true });
    }
  });
})();
