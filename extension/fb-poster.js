// Content script: posting otomatis atau pengujian di halaman grup Facebook
(() => {
  if (window.__fbPosterLoaded) return;
  window.__fbPosterLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function detectCheckpoint() {
    const path = location.pathname.toLowerCase();
    if (path.includes("/checkpoint") || path.includes("/login")) {
      return "Terdeteksi halaman checkpoint atau login Facebook.";
    }

    const bodyText = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : "";
    const warningPhrases = [
      "diblokir sementara",
      "kami membatasi akun anda",
      "tindakan ini diblokir",
      "coba lagi nanti",
      "temporarily blocked",
      "we restrict certain activity",
      "account restricted",
      "action blocked",
    ];

    for (const phrase of warningPhrases) {
      if (bodyText.includes(phrase)) {
        return `Peringatan keamanan Facebook terdeteksi: "${phrase}".`;
      }
    }

    return null;
  }

  function findComposerButton() {
    // Cari tombol "Tulis sesuatu...", "Buat postingan publik...", dsb
    const candidates = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
    for (const el of candidates) {
      const text = (el.textContent || el.getAttribute("aria-label") || "").trim().toLowerCase();
      if (
        text.includes("tulis sesuatu") ||
        text.includes("write something") ||
        text.includes("buat postingan") ||
        text.includes("create a public post") ||
        text.includes("apa yang anda pikirkan") ||
        text.includes("what's on your mind")
      ) {
        return el;
      }
    }
    return null;
  }

  function checkMembershipStatus() {
    const bodyText = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : "";
    if (bodyText.includes("gabung ke grup") || bodyText.includes("join group")) {
      return "Bukan anggota grup ini.";
    }
    if (bodyText.includes("hanya admin yang dapat memposting") || bodyText.includes("only admins can post")) {
      return "Hanya admin yang diizinkan memposting di grup ini.";
    }
    return null;
  }

  async function dataUrlToFile(dataUrl, filename) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || "image/jpeg" });
  }

  async function executePost(target, template, dry) {
    // 1. Cek keamanan akun
    const cpError = detectCheckpoint();
    if (cpError) {
      return {
        type: "fb-target-done",
        status: "failed",
        checkpoint: true,
        message: cpError,
      };
    }

    // Tunggu awal 3 detik agar grup dimuat
    await sleep(3000);

    const memStatus = checkMembershipStatus();
    if (memStatus) {
      return {
        type: "fb-target-done",
        status: "skipped",
        message: memStatus,
      };
    }

    const composerBtn = findComposerButton();
    if (!composerBtn) {
      return {
        type: "fb-target-done",
        status: "failed",
        message: "Kotak komposer postingan tidak ditemukan di halaman grup.",
      };
    }

    // 2. Jika Mode Uji (Dry run)
    if (dry) {
      return {
        type: "fb-target-done",
        status: "success",
        message: "[Mode Uji] Komposer grup terverifikasi aktif (posting dilewati).",
      };
    }

    // 3. Posting Nyata
    composerBtn.click();
    await sleep(2000);

    // Cari dialog modal komposer
    let dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) {
      await sleep(1500);
      dialog = document.querySelector('div[role="dialog"]');
    }
    if (!dialog) {
      return {
        type: "fb-target-done",
        status: "failed",
        message: "Modal komposer tidak terbuka setelah diklik.",
      };
    }

    // Cari textbox contenteditable
    const textbox = dialog.querySelector('div[contenteditable="true"][role="textbox"]');
    if (!textbox) {
      return {
        type: "fb-target-done",
        status: "failed",
        message: "Area pengetikan teks tidak ditemukan dalam modal.",
      };
    }

    // Masukkan teks
    textbox.focus();
    await sleep(300);

    const postContent = template.renderedText || template.body || "";
    if (postContent) {
      try {
        // Gunakan execCommand insertText agar dideteksi oleh Lexical Facebook
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, postContent);
      } catch (_) {
        textbox.textContent = postContent;
      }
      textbox.dispatchEvent(new Event("input", { bubbles: true }));
      textbox.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(1000);
    }

    // Masukkan gambar bila ada
    if (template.images && template.images.length > 0) {
      let fileInput = dialog.querySelector('input[type="file"][accept*="image"]');
      if (!fileInput) {
        // Coba klik tombol foto/video di modal
        const photoBtns = Array.from(dialog.querySelectorAll('div[role="button"], div[aria-label*="Foto" i], div[aria-label*="Photo" i]'));
        for (const btn of photoBtns) {
          btn.click();
          await sleep(800);
          fileInput = dialog.querySelector('input[type="file"][accept*="image"]');
          if (fileInput) break;
        }
      }

      if (fileInput) {
        try {
          const dt = new DataTransfer();
          for (let i = 0; i < template.images.length; i++) {
            const img = template.images[i];
            const f = await dataUrlToFile(img.dataUrl, img.name || `gambar_${i + 1}.jpg`);
            dt.items.add(f);
          }
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event("change", { bubbles: true }));
          // Beri jeda agar Facebook memproses thumbnail upload gambar
          await sleep(3500);
        } catch (imgErr) {
          console.warn("Gagal melampirkan gambar:", imgErr);
        }
      }
    }

    // Cari tombol "Posting" / "Post"
    const buttons = Array.from(dialog.querySelectorAll('div[role="button"]'));
    let postBtn = null;
    for (const b of buttons) {
      const label = (b.getAttribute("aria-label") || b.textContent || "").trim().toLowerCase();
      if (label === "posting" || label === "post" || label === "publikasikan") {
        postBtn = b;
        break;
      }
    }

    if (!postBtn) {
      return {
        type: "fb-target-done",
        status: "failed",
        message: "Tombol Posting tidak ditemukan di modal.",
      };
    }

    // Pastikan tombol tidak dinonaktifkan
    if (postBtn.getAttribute("aria-disabled") === "true") {
      await sleep(2000);
    }

    postBtn.click();
    await sleep(4000);

    // Cek apakah ada pesan kesalahan dalam dialog
    const errorAlert = dialog.querySelector('div[role="alert"]');
    if (errorAlert && errorAlert.textContent) {
      return {
        type: "fb-target-done",
        status: "failed",
        message: "Facebook menolak postingan: " + errorAlert.textContent.trim(),
      };
    }

    return {
      type: "fb-target-done",
      status: "success",
      message: "Postingan berhasil dikirim ke grup.",
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.kind === "fb-post-start") {
      executePost(msg.target, msg.template, !!msg.dry)
        .then((res) => {
          chrome.runtime.sendMessage({
            kind: "tkp-scrape",
            ...res,
            targetId: msg.target && msg.target.id,
          }).catch(() => {});
          sendResponse({ ok: true });
        })
        .catch((err) => {
          chrome.runtime.sendMessage({
            kind: "tkp-scrape",
            type: "fb-target-done",
            status: "failed",
            message: err.message || "Terjadi kesalahan saat memproses grup",
            targetId: msg.target && msg.target.id,
          }).catch(() => {});
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }
  });
})();

