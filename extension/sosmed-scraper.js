// Content script Scrape Social Media via Google Search
(() => {
  if (window.__sosmedScraper) return;
  window.__sosmedScraper = true;

  let running = false;
  let stopRequested = false;

  const sleep = async (ms) => {
    try {
      await chrome.runtime.sendMessage({ kind: "tkp-sleep", ms: Math.max(100, ms) });
    } catch (_) {
      await new Promise((r) => setTimeout(r, ms));
    }
  };

  const send = (payload) => {
    try {
      chrome.runtime.sendMessage({ kind: "tkp-scrape", ...payload });
    } catch (_) {}
  };

  // Utilitas pembersih teks
  const clean = (s) =>
    String(s || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();

  // Regex WhatsApp & Nomor Telepon Indonesia dan Internasional
  const WA_URL_IN_TEXT_RE = /(?:wa\.me\/(?:\+?([0-9]{8,16})))|(?:api\.whatsapp\.com\/send\?phone=([0-9]{8,16}))/i;
  // Menangkap format HP (+628, 628, 08) dan telepon area Indonesia ((021), 021, 022, 031, dll)
  // Mendukung variasi pemisah: spasi, titik, tanda hubung (hyphen/en-dash/em-dash), kurung, slash
  const PHONE_MATCH_RE = /(?:(?:\+?62|0)(?:8[1-9][0-9]|2[1-9]|3[1-9]|4[1-9]|5[1-9]|7[1-9]|9[1-9]))[0-9\s.\-–—()/:]{5,18}[0-9]/g;
  const PHONE_INTL_RE = /(?:\+[1-9][0-9]{0,2}[\s.\-–—()/:]{1,3}[0-9]{2,4}[\s.\-–—()/:]{1,3}[0-9]{3,8})/g;

  function extractPhone(text, url) {
    // 1. Periksa link wa.me di URL hasil atau di dalam teks cuplikan
    const sourceForWa = `${url || ""} ${text || ""}`;
    const waMatch = sourceForWa.match(WA_URL_IN_TEXT_RE);
    if (waMatch) {
      const num = waMatch[1] || waMatch[2];
      if (num) {
        const cleanNum = num.replace(/\D/g, "");
        if (cleanNum.length >= 9 && cleanNum.length <= 15) {
          if (cleanNum.startsWith("62")) {
            return (
              "+62 " +
              cleanNum.slice(2, 5) +
              "-" +
              cleanNum.slice(5, 9) +
              (cleanNum.slice(9) ? "-" + cleanNum.slice(9) : "")
            );
          }
          return cleanNum.startsWith("0") ? cleanNum : "+" + cleanNum;
        }
      }
    }

    if (!text) return undefined;

    // Normalisasi karakter visual teks: rapikan Unicode dash, ganti O/o diawal kata nomor jika ada
    let cleanText = String(text)
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
      .replace(/\b[oO]8/g, "08");

    // 2. Prioritas Format Indonesia (+628, 628, 08, atau telp area kota)
    const idMatches = cleanText.match(PHONE_MATCH_RE);
    if (idMatches && idMatches.length > 0) {
      for (const m of idMatches) {
        let rawDigits = m.replace(/\D/g, "");
        // Filter panjang nomor telepon valid di Indonesia (9 - 14 digit)
        if (rawDigits.length >= 9 && rawDigits.length <= 15) {
          if (rawDigits.startsWith("62")) {
            return (
              "+62 " +
              rawDigits.slice(2, 5) +
              "-" +
              rawDigits.slice(5, 9) +
              (rawDigits.slice(9) ? "-" + rawDigits.slice(9) : "")
            );
          } else if (rawDigits.startsWith("08")) {
            return (
              rawDigits.slice(0, 4) +
              "-" +
              rawDigits.slice(4, 8) +
              (rawDigits.slice(8) ? "-" + rawDigits.slice(8) : "")
            );
          } else if (rawDigits.startsWith("0")) {
            // Telp kabel / kantor area kota
            return rawDigits.slice(0, 3) + "-" + rawDigits.slice(3);
          }
          return m.trim();
        }
      }
    }

    // 3. Format Internasional (+...)
    const intlMatches = cleanText.match(PHONE_INTL_RE);
    if (intlMatches && intlMatches.length > 0) {
      for (const m of intlMatches) {
        const rawDigits = m.replace(/\D/g, "");
        if (rawDigits.length >= 8 && rawDigits.length <= 15) {
          return m.trim();
        }
      }
    }

    return undefined;
  }

  // Regex Email
  const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const IGNORE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];

  // Helper normalisasi nomor telepon untuk deduplikasi akurat
  // Contoh: '0812-3456-7890' dan '+62 812-3456-7890' menghasilkan kunci yang sama: '6281234567890'
  function normalizePhoneKey(phone) {
    if (!phone) return null;
    let digits = String(phone).replace(/\D/g, "");
    if (!digits || digits.length < 8) return null;
    if (digits.startsWith("08")) {
      digits = "628" + digits.slice(2);
    } else if (digits.startsWith("8")) {
      digits = "628" + digits.slice(1);
    }
    return digits;
  }

  // Helper normalisasi email untuk deduplikasi akurat
  function normalizeEmailKey(email) {
    if (!email) return null;
    const cleanEmail = String(email).trim().toLowerCase();
    return cleanEmail.length >= 5 && cleanEmail.includes("@") ? cleanEmail : null;
  }

  function extractEmail(text) {
    if (!text) return undefined;
    const matches = String(text).match(EMAIL_RE);
    if (!matches) return undefined;

    for (const em of matches) {
      const lower = em.toLowerCase().trim();
      if (IGNORE_EXTS.some((ext) => lower.endsWith(ext))) continue;
      if (lower.includes("example.com") || lower.includes("domain.com")) continue;
      return lower;
    }
    return undefined;
  }

  // Deteksi platform dari URL
  function detectPlatform(url, fallback) {
    const u = String(url || "").toLowerCase();
    if (u.includes("instagram.com")) return "instagram";
    if (u.includes("facebook.com")) return "facebook";
    if (u.includes("tiktok.com")) return "tiktok";
    if (u.includes("linkedin.com")) return "linkedin";
    if (u.includes("twitter.com") || u.includes("x.com")) return "twitter";
    if (u.includes("youtube.com")) return "youtube";
    return fallback || "instagram";
  }

  // Ekstrak hasil pencarian Google dari dokumen HTML tertentu (baik DOM aktif maupun HTML yang di-fetch)
  function harvestGoogleResultsFromDoc(doc, targetPlatform) {
    const list = [];
    const seenUrls = new Set();

    // Temukan seluruh heading <h3> di area pencarian
    const headings = Array.from(doc.querySelectorAll("div#search a h3, div#rso a h3, div.g a h3, a h3, h3"));

    for (const h3 of headings) {
      const a = h3.closest("a");
      if (!a) continue;

      const rawHref = a.getAttribute("href") || a.href || "";
      if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) continue;

      let finalUrl = rawHref;
      try {
        const parsed = new URL(rawHref, location.origin);
        // Tangani Google redirect link (/url?q=...)
        if (parsed.pathname === "/url") {
          const qParam = parsed.searchParams.get("q") || parsed.searchParams.get("url");
          if (qParam) finalUrl = qParam;
        } else {
          finalUrl = parsed.href;
        }
      } catch (_) {}

      // Abaikan URL Google internal
      if (
        finalUrl.includes("google.com/search") ||
        finalUrl.includes("google.co.id/search") ||
        finalUrl.includes("accounts.google.com") ||
        finalUrl.includes("support.google.com") ||
        finalUrl.includes("policies.google.com") ||
        finalUrl.includes("maps.google.com") ||
        finalUrl.includes("webcache.googleusercontent.com")
      ) {
        continue;
      }

      if (seenUrls.has(finalUrl)) continue;
      seenUrls.add(finalUrl);

      const title = clean(h3.innerText || h3.textContent);
      if (!title) continue;

      // Temukan kartu pembungkus hasil pencarian
      const card =
        h3.closest("div.g, div[data-sokoban-container], div.MjjYud, div[jscontroller]") ||
        a.parentElement?.parentElement ||
        a.parentElement;

      let snippet = "";
      let cardFullText = "";
      if (card) {
        cardFullText = clean(card.innerText || card.textContent);
        const snippetEl = card.querySelector("div[data-sncf], div.VwiC3b, div.yXK7lf, div.Z26q7c, span.aCOpRe");
        if (snippetEl) {
          snippet = clean(snippetEl.innerText || snippetEl.textContent);
        } else {
          snippet = cardFullText.replace(title, "").trim();
        }
      }

      // Gabungkan seluruh teks yang terlihat pada kartu hasil pencarian Google
      const combinedText = `${title} ${snippet} ${cardFullText} ${finalUrl}`;
      const phone = extractPhone(combinedText, finalUrl);
      const email = extractEmail(combinedText);
      const platform = detectPlatform(finalUrl, targetPlatform);

      list.push({
        title,
        url: finalUrl,
        snippet,
        phone,
        email,
        platform,
      });
    }

    return list;
  }

  async function runScraper(options) {
    if (running) return;
    running = true;
    stopRequested = false;

    try {
      const maxResults = Math.min(500, Math.max(1, Number(options.maxResults) || 50));
      const targetPlatform = options.platform || "instagram";
      const delayMs = Math.max(800, Number(options.delay) || 1200);

      // Tentukan aturan kontak yang wajib ada ('wa' | 'email' | 'any' | 'all')
      let contactFilter = options.contactFilter;
      if (!contactFilter) {
        const extraLower = String(options.extraTerm || "").toLowerCase();
        if (extraLower.includes("email") && !extraLower.includes("wa") && !extraLower.includes("telepon")) {
          contactFilter = "email";
        } else {
          contactFilter = "wa"; // Default: wajib ada nomor WA/telepon
        }
      }

      const allLeadsMap = new Map();
      const seenUrls = new Set();
      const seenPhones = new Set();
      const seenEmails = new Set();
      let totalFound = 0;
      let batch = [];

      // Filter: Hanya ambil data yang memiliki kontak sesuai target + Anti-Duplikat
      const tryAddLead = (item) => {
        if (!item || !item.url) return false;

        // 1. Syarat Kontak Wajib: Abaikan jika tidak memiliki nomor WA / Email sesuai filter
        if (contactFilter === "wa" && !item.phone) return false;
        if (contactFilter === "email" && !item.email) return false;
        if (contactFilter === "any" && !item.phone && !item.email) return false;

        // 2. Anti-Duplikat URL
        if (seenUrls.has(item.url)) return false;

        // 3. Anti-Duplikat Nomor Telepon / WA (Format dinormalisasi)
        const pKey = normalizePhoneKey(item.phone);
        if (pKey && seenPhones.has(pKey)) return false;

        // 4. Anti-Duplikat Email
        const eKey = normalizeEmailKey(item.email);
        if (eKey && seenEmails.has(eKey)) return false;

        seenUrls.add(item.url);
        if (pKey) seenPhones.add(pKey);
        if (eKey) seenEmails.add(eKey);

        allLeadsMap.set(item.url, item);
        batch.push(item);
        totalFound++;
        return true;
      };

      console.log(
        `[Sosmed Scraper] Memulai scraping, target ${maxResults} data untuk platform ${targetPlatform} (filter kontak: ${contactFilter}).`
      );

      // 1. Ekstrak data dari halaman 1 yang sedang terbuka di tab
      const page1Items = harvestGoogleResultsFromDoc(document, targetPlatform);
      for (const item of page1Items) {
        if (tryAddLead(item)) {
          if (batch.length >= 5) {
            send({ type: "sosmed-leads", found: totalFound, leads: batch });
            batch = [];
          }
          if (allLeadsMap.size >= maxResults) break;
        }
      }

      if (batch.length > 0) {
        send({ type: "sosmed-leads", found: totalFound, leads: batch });
        batch = [];
      }

      console.log(`[Sosmed Scraper] Halaman 1 menghasilkan ${allLeadsMap.size} data.`);

      // 2. Persiapkan paginasi untuk halaman 2 dan seterusnya
      const currentUrlObj = new URL(location.href);
      let nextLinkEl = document.querySelector('a#pnnext, a[aria-label="Next page"], a[aria-label="Halaman berikutnya"]');
      let nextUrl = nextLinkEl ? nextLinkEl.getAttribute("href") || nextLinkEl.href : null;
      let startIndex = 10;
      let pageNum = 1;
      let emptyStreak = 0;

      // Loop berlanjut ke halaman 2, 3, 4, dst. sampai maxResults terpenuhi
      while (allLeadsMap.size < maxResults && !stopRequested && emptyStreak < 4) {
        pageNum++;
        console.log(`[Sosmed Scraper] Memuat halaman ke-${pageNum} (start=${startIndex})...`);

        // Tentukan URL untuk fetch halaman berikutnya
        let fetchUrl;
        if (nextUrl) {
          try {
            fetchUrl = new URL(nextUrl, location.origin).href;
          } catch (_) {
            currentUrlObj.searchParams.set("start", String(startIndex));
            fetchUrl = currentUrlObj.href;
          }
        } else {
          currentUrlObj.searchParams.set("start", String(startIndex));
          fetchUrl = currentUrlObj.href;
        }

        await sleep(delayMs);
        if (stopRequested) break;

        let res;
        try {
          res = await fetch(fetchUrl, {
            method: "GET",
            credentials: "include",
            headers: {
              accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
        } catch (err) {
          console.warn("[Sosmed Scraper] Gagal fetch halaman berikutnya:", err);
          break;
        }

        if (!res.ok) {
          console.warn(`[Sosmed Scraper] HTTP status ${res.status} pada ${fetchUrl}`);
          break;
        }

        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        // Cek jika Google menampilkan CAPTCHA
        if (
          html.includes("Our systems have detected unusual traffic") ||
          doc.querySelector("form#captcha-form, div#recaptcha")
        ) {
          send({
            type: "error",
            message: "Google meminta verifikasi CAPTCHA. Silakan buka tab Google untuk menyelesaikan verifikasi.",
          });
          return;
        }

        // Ekstrak hasil dari dokumen halaman yang baru dimuat
        const items = harvestGoogleResultsFromDoc(doc, targetPlatform);
        let newItemsInPage = 0;

        for (const item of items) {
          if (tryAddLead(item)) {
            newItemsInPage++;
            if (batch.length >= 5) {
              send({ type: "sosmed-leads", found: totalFound, leads: batch });
              batch = [];
            }
            if (allLeadsMap.size >= maxResults) break;
          }
        }

        if (batch.length > 0) {
          send({ type: "sosmed-leads", found: totalFound, leads: batch });
          batch = [];
        }

        console.log(
          `[Sosmed Scraper] Halaman ${pageNum} selesai. +${newItemsInPage} data baru. Total: ${allLeadsMap.size} dari target ${maxResults}.`
        );

        if (allLeadsMap.size >= maxResults) {
          break;
        }

        if (newItemsInPage === 0) {
          emptyStreak++;
        } else {
          emptyStreak = 0;
        }

        // Ambil URL berikutnya dari doc yang baru di-parse
        const nextInDoc = doc.querySelector('a#pnnext, a[aria-label="Next page"], a[aria-label="Halaman berikutnya"]');
        if (nextInDoc) {
          nextUrl = nextInDoc.getAttribute("href") || nextInDoc.href;
        } else {
          nextUrl = null;
        }

        startIndex += 10;
      }

      if (batch.length > 0) {
        send({ type: "sosmed-leads", found: totalFound, leads: batch });
        batch = [];
      }

      console.log(`[Sosmed Scraper] Selesai. Total data terkumpul: ${allLeadsMap.size}.`);
      send({ type: "done", stopped: stopRequested });
    } catch (err) {
      send({ type: "error", message: "Terjadi kesalahan saat mencari di Google: " + (err.message || String(err)) });
    } finally {
      running = false;
    }
  }

  // Listener perintah dari background.js
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.kind === "tkp-start") {
      if (running) {
        sendResponse({ ok: false });
        return;
      }
      sendResponse({ ok: true });
      runScraper(msg.options || {});
      return;
    } else if (msg.kind === "tkp-stop") {
      stopRequested = true;
      sendResponse({ ok: true });
      return;
    }
  });
})();
