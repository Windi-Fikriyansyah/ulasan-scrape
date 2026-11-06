// Dijalankan di halaman Shopee. Hanya bekerja bila diperintah oleh background.js.
(() => {
  if (window.__shopeeScraper) return;
  window.__shopeeScraper = true;

  let running = false;
  let stopRequested = false;

  // Jeda lewat service worker supaya tidak terkena throttle timer tab latar belakang.
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

  const REL_DATE = /(hari ini|kemarin|\d+\s*(hari|minggu|bulan|tahun)\s*lalu|sebulan lalu|seminggu lalu|setahun lalu|\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4})/i;

  function isLoginOrVerifyPage() {
    const p = window.location.pathname.toLowerCase();
    if (
      p.includes("/buyer/login") ||
      p.includes("/account/verify") ||
      p.includes("/verify") ||
      p.includes("/universal-link")
    ) {
      return true;
    }
    if (
      document.querySelector(
        '.shopee-popup-form--verify, .shopee-popup-form--voice-otp, #main input[type="password"]'
      )
    ) {
      return true;
    }
    return false;
  }

  function findReviewCards() {
    // 1. data-cmtid attribute pada setiap kartu ulasan
    const byCmtId = document.querySelectorAll("[data-cmtid]");
    if (byCmtId.length) return [...byCmtId];

    // 2. Class .shopee-product-rating
    const byCls = document.querySelectorAll(".shopee-product-rating");
    if (byCls.length) return [...byCls];

    // 3. Anak dari .shopee-product-comment-list atau .product-ratings__list
    const list = document.querySelector(".shopee-product-comment-list, .product-ratings__list");
    if (list) {
      const items = [...list.children].filter((el) => {
        if (
          el.matches(
            ".product-ratings__page-controller, .shopee-page-controller, .product-ratings-comments-view__no-data"
          )
        ) {
          return false;
        }
        return el.querySelector(
          '.icon-rating-solid, [class*="rating-solid"], svg[class*="icon-rating"], .shopee-avatar, [class*="shopee-avatar"], .XYk98l, .j5ucs4'
        );
      });
      if (items.length) return items;
    }

    // 4. Selector struktur fallback (.q2b7Oq atau kontainer ulasan)
    const cands = document.querySelectorAll('.q2b7Oq, [class*="product-rating__item"], [class*="product-rating"]');
    const filtered = [...cands].filter((el) =>
      el.querySelector('.icon-rating-solid, svg polygon, .shopee-avatar, [class*="shopee-avatar"]')
    );
    if (filtered.length) return filtered;

    return [];
  }

  // ---------------------------------------------------------------
  // RATING BINTANG
  // Dibaca secara berlapis:
  // 1) aria-label / title seperti "bintang 5", "5 dari 5"
  // 2) ikon bintang svg dengan class .icon-rating-solid / polygon terisi
  // 3) .shopee-rating-stars__primary-star / .shopee-rating-stars__lit
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

  function countShopeeStars(card) {
    const starBox = card.querySelector(
      '.rGdC5O, .BnXxkm, .shopee-product-rating__rating, [class*="rating-stars"], [class*="rating__stars"]'
    );
    const scope = starBox || card;

    // 1. Selector solid/filled star
    const solidStars = scope.querySelectorAll(
      '.icon-rating-solid, [class*="icon-rating-solid"], [class*="rating-star--full"], [class*="star--solid"]'
    );
    if (solidStars.length >= 1 && solidStars.length <= 5) {
      return solidStars.length;
    }

    // 2. Periksa elemen polygon di dalam SVG (Shopee menggunakan polygon tanpa fill="none" untuk bintang penuh)
    const svgs = scope.querySelectorAll("svg");
    let filled = 0;
    let starCount = 0;
    for (const svg of svgs) {
      const poly = svg.querySelector("polygon");
      if (!poly) continue;
      const pts = poly.getAttribute("points") || "";
      if (
        pts.includes("7.5 .8") ||
        pts.includes("7.5,0.8") ||
        pts.includes("9.7 5.4") ||
        pts.includes("9.7,5.4") ||
        svg.classList.contains("icon-rating") ||
        svg.closest('.icon-rating, [class*="icon-rating"]')
      ) {
        starCount++;
        const fill = (poly.getAttribute("fill") || svg.getAttribute("fill") || "").toLowerCase();
        if (fill !== "none") {
          filled++;
        }
      }
    }
    if (starCount >= 1 && starCount <= 5 && filled >= 1 && filled <= 5) {
      return filled;
    }
    if (filled >= 1 && filled <= 5) {
      return filled;
    }

    // 3. Shopee rating stars lit
    const lit = scope.querySelectorAll(
      ".shopee-rating-stars__lit, .shopee-rating-stars__primary-star, .shopee-rating-stars__gold-star"
    );
    if (lit.length >= 1 && lit.length <= 5) {
      return lit.length;
    }

    return 0;
  }

  function parseRating(card) {
    // 1. Atribut aria-label atau title
    for (const el of card.querySelectorAll(
      '[aria-label*="bintang" i], [aria-label*="star" i], [title*="bintang" i], [title*="star" i]'
    )) {
      for (const a of ["aria-label", "title"]) {
        const r = parseRatingValue(el.getAttribute(a));
        if (r) return r;
      }
    }

    // 2. Hitung jumlah bintang terisi
    const cnt = countShopeeStars(card);
    if (cnt >= 1 && cnt <= 5) return cnt;

    return 0;
  }

  // ---------------------------------------------------------------
  // FOTO & AVATAR
  // Avatar: foto profil pembeli (kRbrbH, .shopee-avatar, .shopee-avatar__img, Z6X9mv)
  // Images: foto ulasan (background-image pada .shopee-rating-media-list-image__content,
  //         atau img pada rating-media-list). Mengabaikan gambar balasan penjual.
  // ---------------------------------------------------------------
  const PLACEHOLDER = /^data:|svg/i;
  const goodUrl = (s) => !!s && /^https?:\/\//i.test(s) && !PLACEHOLDER.test(s);

  function extractBgUrl(str) {
    if (!str) return "";
    const m = str.match(/url\(['"]?([^'"]+)['"]?\)/i);
    return m ? m[1] : "";
  }

  function classifyImages(card, replyBox) {
    let avatar = "";
    const photos = [];

    // 1. Temukan Avatar Pembeli
    const avatarImg = card.querySelector(
      '.kRbrbH img, .shopee-avatar img, .shopee-avatar__img, [class*="avatar"] img, a[href*="/buyer/"] img'
    );
    if (avatarImg && (!replyBox || !replyBox.contains(avatarImg))) {
      const src = avatarImg.currentSrc || avatarImg.getAttribute("src") || "";
      if (goodUrl(src)) avatar = src;
    }

    // 2. Temukan Foto-foto Ulasan dari Pembeli
    // Shopee menyimpan foto ulasan sebagai background-image pada .shopee-rating-media-list-image__content
    const bgElements = card.querySelectorAll(
      '.shopee-rating-media-list-image__content, .rating-media-list__image-wrapper, [class*="rating-media-list-image__content"], .ZBCPg1 [style*="background-image"]'
    );
    for (const el of bgElements) {
      if (replyBox && replyBox.contains(el)) continue;
      const bg = el.style.backgroundImage || getComputedStyle(el).backgroundImage || "";
      const url = extractBgUrl(bg);
      if (goodUrl(url) && url !== avatar) photos.push(url);
    }

    // Jika Shopee menggunakan tag <img> untuk foto ulasan
    const photoImgs = card.querySelectorAll(
      '.ZBCPg1 img, .rating-media-list img, .rating-media-list__image-wrapper img, .rating-media-list__zoomed-image-item img'
    );
    for (const img of photoImgs) {
      if (replyBox && replyBox.contains(img)) continue;
      if (img === avatarImg) continue;
      const src = img.currentSrc || img.getAttribute("src") || "";
      if (goodUrl(src) && src !== avatar) photos.push(src);
    }

    // Fallback bila foto ulasan belum ditemukan
    if (photos.length === 0) {
      for (const img of card.querySelectorAll("img")) {
        if (replyBox && replyBox.contains(img)) continue;
        if (img === avatarImg) continue;
        if (/badge|icon|medal|star|headshot/i.test(img.className || "")) continue;
        const src = img.currentSrc || img.getAttribute("src") || "";
        if (!goodUrl(src) || src === avatar) continue;
        if (/avatar|profile|headshot/i.test(src)) {
          if (!avatar) avatar = src;
        } else {
          photos.push(src);
        }
      }
    }

    return { avatar, images: [...new Set(photos)] };
  }

  function parseSellerReply(card) {
    const replyBox = card.querySelector(
      '.p5tg3L, [class*="seller_response"], [class*="seller-response"], [class*="seller_reply"], [class*="seller-reply"]'
    );
    if (replyBox) {
      const contentEl = replyBox.querySelector('.QSiE2A, [class*="content"]');
      if (contentEl && contentEl.innerText.trim()) {
        return contentEl.innerText.trim();
      }
      const t = replyBox.innerText.replace(/^(respon penjual|balasan penjual|seller response)\s*:?\s*/i, "").trim();
      if (t) return t;
    }
    for (const el of card.querySelectorAll("div, p")) {
      const txt = (el.innerText || "").trim();
      if (/^(respon penjual|balasan penjual|seller response)\s*:/i.test(txt)) {
        return txt.replace(/^(respon penjual|balasan penjual|seller response)\s*:\s*/i, "").trim();
      }
    }
    return "";
  }

  function parseCard(card) {
    // 1. Balasan Penjual
    const replyBox = card.querySelector(
      '.p5tg3L, [class*="seller_response"], [class*="seller-response"], [class*="seller_reply"], [class*="seller-reply"]'
    );
    const seller_reply = parseSellerReply(card);

    // 2. Nama Pembeli
    const nameEl = card.querySelector(
      '.InK5kS, .shopee-product-rating__author-name, .d72He7 a, a[href*="/buyer/"], [class*="author-name"]'
    );
    let name = ((nameEl && nameEl.innerText) || "").trim();
    if (!name) {
      const headEl = card.querySelector(".d72He7");
      if (headEl) {
        const firstSpan = headEl.querySelector("span, div, a");
        if (firstSpan) name = (firstSpan.innerText || "").trim();
      }
    }

    // 3. Tanggal dan Varian
    let date = "";
    let variant = "";
    const timeEl = card.querySelector(
      '.XYk98l, .j5ucs4, .shopee-product-rating__time, [class*="rating__time"]'
    );
    const timeText = ((timeEl && timeEl.innerText) || "").trim();
    if (timeText) {
      const parts = timeText.split("|").map((s) => s.trim());
      for (const part of parts) {
        if (/^variasi\s*:/i.test(part) || /^variation\s*:/i.test(part)) {
          variant = part.replace(/^variasi\s*:\s*/i, "").replace(/^variation\s*:\s*/i, "").trim();
        } else if (/\d{4}-\d{2}-\d{2}/.test(part) || REL_DATE.test(part)) {
          date = part;
        }
      }
    }

    if (!date || !variant) {
      for (const el of card.querySelectorAll("div, span, p")) {
        const t = (el.innerText || "").trim();
        if (!variant && (/^variasi\s*:/i.test(t) || /^variation\s*:/i.test(t))) {
          variant = t.replace(/^variasi\s*:\s*/i, "").replace(/^variation\s*:\s*/i, "").trim();
        } else if (!date && t.length < 35 && (/\d{4}-\d{2}-\d{2}/.test(t) || REL_DATE.test(t))) {
          date = t;
        }
      }
    }

    // 4. Teks Ulasan
    const reviewEl = card.querySelector(
      '.YNedDV, .meQyXP, .shopee-product-rating__content, [class*="rating__content"]'
    );
    let review = "";
    if (reviewEl) {
      review = (reviewEl.innerText || "").trim();
    } else {
      // Cari elemen teks ulasan di dalam kontainer utama ulasan
      const mainEl = card.querySelector('.A7MThp, .shopee-product-rating__main');
      if (mainEl) {
        const paragraphs = [...mainEl.querySelectorAll("div, p")].filter((p) => {
          if (replyBox && replyBox.contains(p)) return false;
          if (p.closest('.BnXxkm, .XYk98l, .j5ucs4, .d72He7, .ZBCPg1, .rating-media-list')) return false;
          const txt = (p.innerText || "").trim();
          return txt.length > 0 && !/^variasi\s*:/i.test(txt) && !REL_DATE.test(txt);
        });
        if (paragraphs.length) review = paragraphs[0].innerText.trim();
      }
    }

    // 5. Foto dan Avatar
    const { avatar, images } = classifyImages(card, replyBox);

    // 6. Rating Bintang
    const rating = parseRating(card);

    return {
      name,
      avatar,
      rating,
      date,
      variant,
      review,
      images,
      seller_reply,
    };
  }

  // HTML ringkas satu kartu ulasan untuk diagnosa di dashboard
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
    document
      .querySelectorAll(
        '.shopee-product-comment-list button, [data-cmtid] button, .q2b7Oq button, .shopee-product-rating button'
      )
      .forEach((el) => {
        const t = (el.innerText || "").trim().toLowerCase();
        if (t === "selengkapnya" || t === "lihat selengkapnya" || t === "lainnya") {
          try {
            el.click();
          } catch (_) {}
        }
      });
  }

  async function scrapeVisible() {
    expandAll();
    await sleep(350);
    return findReviewCards().map(parseCard).filter((r) => r.review || r.rating);
  }

  const keyOf = (r) => [r.name, r.date, r.rating, r.review.slice(0, 80)].join("¦");
  const signature = () => findReviewCards().map((c) => c.innerText.slice(0, 40)).join("|");

  function findNextButton() {
    return (
      document.querySelector(".product-ratings__page-controller button.shopee-icon-button--right") ||
      document.querySelector(".shopee-page-controller button.shopee-icon-button--right") ||
      document.querySelector("button.shopee-icon-button--right") ||
      document.querySelector('.shopee-page-controller [class*="shopee-icon-button--right"]') ||
      document.querySelector('button[aria-label*="next" i]') ||
      document.querySelector('button[aria-label*="berikutnya" i]') ||
      document.querySelector(".shopee-page-controller button:last-child")
    );
  }

  function isBtnDisabled(b) {
    if (!b) return true;
    if (b.disabled) return true;
    if (b.getAttribute("aria-disabled") === "true") return true;
    if (b.classList.contains("shopee-icon-button--disabled") || b.classList.contains("disabled")) return true;
    return false;
  }

  async function waitForChange(prev, timeout = 7000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await sleep(300);
      const sig = signature();
      if (sig && sig !== prev) return true;
    }
    return false;
  }

  async function waitForReviews(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (isLoginOrVerifyPage()) {
        return { ok: false, reason: "login_or_verify" };
      }
      if (findReviewCards().length) return { ok: true };

      const noData = document.querySelector(".product-ratings-comments-view__no-data");
      if (noData && (noData.innerText || "").includes("Belum ada penilaian")) {
        return { ok: false, reason: "no_reviews" };
      }

      window.scrollBy(0, Math.round(window.innerHeight * 0.8));
      await sleep(600);
    }
    return { ok: false, reason: "timeout" };
  }

  function productMeta() {
    const og = (p) => {
      const el = document.querySelector(`meta[property="${p}"]`);
      return (el && el.content) || "";
    };
    const h1 = document.querySelector("h1");
    let title = og("og:title") || (h1 && h1.innerText) || document.title;
    title = title.replace(/\s*\|\s*Shopee.*$/i, "").trim();
    return { title, image: og("og:image") };
  }

  async function run({ maxPages = 10, delay = 1200 }) {
    running = true;
    stopRequested = false;
    try {
      const res = await waitForReviews();
      if (!res.ok) {
        if (res.reason === "no_reviews") {
          send({
            type: "error",
            message: "Produk ini belum memiliki ulasan.",
          });
        } else {
          send({
            type: "error",
            message:
              "Shopee meminta login atau verifikasi. Buka shopee.co.id di tab biasa, login, selesaikan verifikasi, lalu coba lagi.",
          });
        }
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
          if (!seen.has(k)) {
            seen.add(k);
            fresh.push(r);
          }
        }
        send({ type: "batch", page, reviews: fresh });

        const next = findNextButton();
        if (isBtnDisabled(next)) break;
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

