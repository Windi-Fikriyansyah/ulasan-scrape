// Content script: posting otomatis atau pengujian di halaman grup Facebook
(() => {
  if (window.__fbPosterLoaded) return;
  window.__fbPosterLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let isExecutingPost = false;

  // Pelacak request jaringan "buat postingan" yang dilaporkan oleh fb-hook.js (world MAIN)
  const postNet = { started: 0, done: 0, lastOk: null, lastError: "" };
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__fbAutopostNet !== true) return;
    if (d.type === "start") {
      postNet.started++;
    } else if (d.type === "done") {
      postNet.done++;
      postNet.lastOk = !!d.ok;
      postNet.lastError = d.error || "";
    }
  });

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

  // Cek apakah suatu elemen berada di dalam artikel/postingan pengguna lain atau merupakan kolom komentar
  // INI PENTING agar script TIDAK PERNAH mengetik di komentar orang lain!
  function isCommentOrArticle(el) {
    if (!el) return false;

    // 1. Elemen berada di dalam postingan feed (role="article"), feed unit, atau form komentar
    if (
      el.closest(
        'div[role="article"], [data-pagelet^="FeedUnit_"], [data-testid*="comment" i], [data-testid*="UFI" i], form[action*="comment" i], [aria-label*="komentar" i], [aria-label*="comment" i]'
      )
    ) {
      return true;
    }

    // 2. Cek atribut teks yang menunjukkan elemen komentar
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
    const title = (el.getAttribute("title") || "").toLowerCase();

    if (
      aria.includes("komentar") ||
      aria.includes("comment") ||
      aria.includes("balas") ||
      aria.includes("reply") ||
      placeholder.includes("komentar") ||
      placeholder.includes("comment") ||
      title.includes("komentar") ||
      title.includes("comment")
    ) {
      return true;
    }

    return false;
  }

  // Simulasi klik tunggal (Pointer, Mouse, Focus) agar dideteksi oleh React Facebook TANPA memicu dobel klik
  function simulateClick(el) {
    if (!el) return;

    const targetBtn = el.closest('div[role="button"], div[tabindex="0"], button') || el;

    try {
      targetBtn.scrollIntoView({ behavior: "instant", block: "center" });
    } catch (_) {}

    try {
      if (typeof targetBtn.focus === "function") targetBtn.focus();
    } catch (_) {}

    const rect = targetBtn.getBoundingClientRect();
    const clientX = rect.left > 0 ? rect.left + rect.width / 2 : 100;
    const clientY = rect.top > 0 ? rect.top + rect.height / 2 : 100;

    const eventOpts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      buttons: 1,
    };

    try { targetBtn.dispatchEvent(new PointerEvent("pointerdown", eventOpts)); } catch (_) {}
    try { targetBtn.dispatchEvent(new MouseEvent("mousedown", eventOpts)); } catch (_) {}
    try { targetBtn.dispatchEvent(new PointerEvent("pointerup", eventOpts)); } catch (_) {}
    try { targetBtn.dispatchEvent(new MouseEvent("mouseup", eventOpts)); } catch (_) {}

    // PENTING: Hanya kirim SATU event click agar modal tidak terbuka ganda (dobel klik)
    if (typeof targetBtn.click === "function") {
      try { targetBtn.click(); } catch (_) {}
    } else {
      try { targetBtn.dispatchEvent(new MouseEvent("click", eventOpts)); } catch (_) {}
    }
  }

  // Cari tombol pembuka komposer postingan grup resmi (HARUS di luar artikel postingan & bukan komentar)
  function findComposerButton() {
    const promptKeywords = [
      "tulis sesuatu",
      "write something",
      "apa yang anda pikirkan",
      "what's on your mind",
      "buat postingan",
      "create a post",
      "create a public post",
      "mulai diskusi",
      "start a discussion",
      "tulis postingan",
    ];

    // 1. Cari container resmi composer grup Facebook
    const pageletSelectors = [
      '[data-pagelet="GroupInlineComposer"]',
      '[data-pagelet*="GroupInlineComposer"]',
      '[data-pagelet="FeedInlineComposer"]',
      '[data-pagelet*="FeedInlineComposer"]',
      '[data-pagelet="GroupComposer"]',
    ];

    for (const pSel of pageletSelectors) {
      const pagelet = document.querySelector(pSel);
      if (pagelet) {
        // Di dalam pagelet, cari elemen teks pemantik utama
        const candidates = Array.from(
          pagelet.querySelectorAll('div[role="button"], div[tabindex="0"], span, p, div')
        );
        for (const el of candidates) {
          if (isCommentOrArticle(el)) continue;
          const text = (el.innerText || el.textContent || "").trim().toLowerCase();
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          for (const kw of promptKeywords) {
            if ((text && text.includes(kw)) || (aria && aria.includes(kw))) {
              return el.closest('div[role="button"], div[tabindex="0"]') || el;
            }
          }
        }

        // Jika teks tidak cocok persis (misal bahasa lain), ambil tombol utama yang bukan avatar profil dan bukan tombol anonim
        const buttons = Array.from(pagelet.querySelectorAll('div[role="button"], div[tabindex="0"]'));
        for (const b of buttons) {
          if (isCommentOrArticle(b)) continue;
          const label = (b.getAttribute("aria-label") || b.innerText || "").toLowerCase();
          if (label.includes("profil") || label.includes("profile") || label.includes("anonim") || label.includes("anonymous")) {
            continue;
          }
          return b;
        }
      }
    }

    // 2. Jika pagelet resmi tidak terdeteksi via atribut data-pagelet,
    // cari di area sebelum feed artikel pertama (di atas daftar postingan)
    const firstArticle = document.querySelector('div[role="article"], [data-pagelet^="FeedUnit_"]');
    const mainArea = document.querySelector('div[role="main"]') || document.body;

    const ariaSelectors = [
      '[aria-label*="Tulis sesuatu" i]',
      '[aria-label*="Write something" i]',
      '[aria-label*="Apa yang Anda pikirkan" i]',
      '[aria-label*="What\'s on your mind" i]',
      '[aria-label*="Buat postingan" i]',
      '[aria-label*="Create a post" i]',
      '[aria-label*="Create a public post" i]',
      '[aria-label*="Mulai diskusi" i]',
      '[aria-label*="Start a discussion" i]',
    ];

    for (const sel of ariaSelectors) {
      const matches = Array.from(mainArea.querySelectorAll(sel));
      for (const el of matches) {
        if (isCommentOrArticle(el)) continue;
        // Pastikan letaknya di atas postingan pertama (bukan di dalam feed)
        if (firstArticle && (firstArticle.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          continue;
        }
        return el.closest('div[role="button"], div[tabindex="0"], button') || el;
      }
    }

    // 3. Cari berdasarkan teks di dalam elemen div/span/p di atas feed artikel
    const allElements = Array.from(mainArea.querySelectorAll('div[role="button"], div[tabindex="0"], span, p'));
    for (const el of allElements) {
      if (isCommentOrArticle(el)) continue;
      if (firstArticle && (firstArticle.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        continue;
      }
      const text = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (text.length > 0 && text.length < 80) {
        for (const kw of promptKeywords) {
          if (text.includes(kw)) {
            return el.closest('div[role="button"], div[tabindex="0"], button') || el;
          }
        }
      }
    }

    return null;
  }

  // Temukan dialog modal "Buat Postingan" resmi (pilih dialog teratas/terbaru, BUKAN modal komentar)
  function findCreatePostDialog() {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
    if (dialogs.length === 0) return null;

    // Periksa dari dialog terakhir (dialog paling depan di DOM)
    for (let i = dialogs.length - 1; i >= 0; i--) {
      const d = dialogs[i];
      if (isCommentOrArticle(d)) continue;

      const heading = (d.querySelector('h2, h1, [role="heading"]') || {}).innerText || "";
      const aria = (d.getAttribute("aria-label") || "").toLowerCase();
      const fullText = (d.innerText || "").toLowerCase();

      // Cek apakah dialog ini memiliki editor teks Lexical komposer
      const hasEditor = d.querySelector(
        'div[contenteditable="true"][role="textbox"], div[data-lexical-editor="true"], div[contenteditable="true"]'
      );

      const titleMatch =
        aria.includes("buat postingan") ||
        aria.includes("create post") ||
        aria.includes("create a post") ||
        heading.toLowerCase().includes("buat postingan") ||
        heading.toLowerCase().includes("create post") ||
        fullText.includes("buat postingan") ||
        fullText.includes("create post") ||
        fullText.includes("posting") ||
        fullText.includes("post");

      if (hasEditor && titleMatch) {
        return d;
      }
    }

    // Fallback: dialog terakhir yang memiliki contenteditable dan bukan komentar
    for (let i = dialogs.length - 1; i >= 0; i--) {
      const d = dialogs[i];
      const hasEditor = d.querySelector('div[contenteditable="true"]');
      if (hasEditor && !isCommentOrArticle(hasEditor)) {
        return d;
      }
    }

    return null;
  }

  // Temukan elemen editor pengetikan di dalam dialog modal
  function findEditorInDialog(dialog) {
    if (!dialog) return null;

    const editorSelectors = [
      'div[contenteditable="true"][role="textbox"]',
      'div[data-lexical-editor="true"]',
      'div[contenteditable="true"][aria-label*="Apa yang Anda pikirkan" i]',
      'div[contenteditable="true"][aria-label*="Tulis sesuatu" i]',
      'div[contenteditable="true"][aria-label*="Write something" i]',
      'div[contenteditable="true"][aria-label*="What\'s on your mind" i]',
      'div[contenteditable="true"]',
    ];

    for (const sel of editorSelectors) {
      const el = dialog.querySelector(sel);
      if (el && !isCommentOrArticle(el)) {
        return el;
      }
    }

    return null;
  }

  // Temukan editor inline HANYA jika berada di dalam GroupInlineComposer (bukan di feed artikel)
  function findInlineEditor() {
    const pagelet = document.querySelector(
      '[data-pagelet="GroupInlineComposer"], [data-pagelet*="GroupInlineComposer"], [data-pagelet="FeedInlineComposer"]'
    );
    if (!pagelet) return null;

    const el = pagelet.querySelector('div[contenteditable="true"][role="textbox"], div[contenteditable="true"]');
    if (el && !isCommentOrArticle(el)) {
      return el;
    }
    return null;
  }

  function checkMembershipStatus() {
    const mainArea = document.querySelector('div[role="main"]') || document.body;
    const bodyText = (mainArea && mainArea.innerText) ? mainArea.innerText.toLowerCase() : "";

    // Cek larangan posting hanya admin
    if (bodyText.includes("hanya admin yang dapat memposting") || bodyText.includes("only admins can post")) {
      return "Hanya admin yang diizinkan memposting di grup ini.";
    }

    // Cek tombol bergabung yang ada di toolbar/header utama grup
    const joinButtons = Array.from(
      document.querySelectorAll(
        'div[role="main"] div[role="button"][aria-label*="Gabung" i], div[role="main"] div[role="button"][aria-label*="Join" i]'
      )
    );
    for (const b of joinButtons) {
      const text = (b.innerText || b.textContent || b.getAttribute("aria-label") || "").toLowerCase();
      if (text.includes("gabung ke grup") || text.includes("join group")) {
        return "Bukan anggota grup ini (perlu gabung ke grup terlebih dahulu).";
      }
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

    // 2. Tunggu dan cari tombol komposer postingan grup (polling hingga 15 detik)
    let composerBtn = null;
    const startTime = Date.now();
    let scrollAttempts = 0;

    while (Date.now() - startTime < 15000) {
      const cpCheck = detectCheckpoint();
      if (cpCheck) {
        return {
          type: "fb-target-done",
          status: "failed",
          checkpoint: true,
          message: cpCheck,
        };
      }

      composerBtn = findComposerButton();
      if (composerBtn) break;

      // Scroll secukupnya agar header grup dan komposer dirender, TIDAK scroll terlalu jauh ke dalam feed
      scrollAttempts++;
      if (scrollAttempts === 1) {
        window.scrollTo(0, 250);
      } else if (scrollAttempts === 2) {
        window.scrollTo(0, 400);
      } else if (scrollAttempts === 3) {
        window.scrollTo(0, 100);
      } else {
        window.scrollTo(0, 0);
      }

      await sleep(1000);
    }

    // Jika tombol komposer tidak ditemukan setelah 15 detik, periksa alasan kegagalan
    if (!composerBtn) {
      const memStatus = checkMembershipStatus();
      if (memStatus) {
        return {
          type: "fb-target-done",
          status: "skipped",
          message: memStatus,
        };
      }

      return {
        type: "fb-target-done",
        status: "failed",
        message: "Kotak komposer postingan tidak ditemukan di halaman grup (pastikan akun sudah bergabung dan grup mengizinkan anggota memposting).",
      };
    }

    // 3. Jika Mode Uji (Dry run)
    if (dry) {
      return {
        type: "fb-target-done",
        status: "success",
        message: "[Mode Uji] Komposer grup terverifikasi aktif (posting dilewati).",
      };
    }

    // 4. Buka dialog komposer postingan (pastikan hanya dibuka SATU KALI)
    let dialog = findCreatePostDialog();
    let editor = dialog ? findEditorInDialog(dialog) : null;

    if (!dialog || !editor) {
      // Klik pembuka komposer sekali
      simulateClick(composerBtn);
      await sleep(1500);

      const dialogStart = Date.now();
      let retryClickDone = false;

      while (Date.now() - dialogStart < 10000) {
        dialog = findCreatePostDialog();
        if (dialog) {
          editor = findEditorInDialog(dialog);
          if (editor) break;
        }

        // Cek apakah ada komposer inline resmi (HANYA di dalam GroupInlineComposer)
        const inlineEditor = findInlineEditor();
        if (inlineEditor) {
          editor = inlineEditor;
          break;
        }

        // HANYA klik ulang jika setelah 4 detik dialog benar-benar belum muncul sama sekali
        if (!dialog && !retryClickDone && Date.now() - dialogStart > 4000) {
          retryClickDone = true;
          simulateClick(composerBtn);
        }

        await sleep(1000);
      }
    }

    if (!editor) {
      return {
        type: "fb-target-done",
        status: "failed",
        message: "Modal komposer postingan grup tidak terbuka atau area pengetikan tidak ditemukan.",
      };
    }

    // 5. Masukkan teks postingan ke dalam editor komposer grup
    try {
      editor.focus();
    } catch (_) {}
    await sleep(400);

    let postContent = template.renderedText || template.body || "";
    if (target && target.groupName) {
      postContent = postContent.replace(/\{nama_grup\}/gi, target.groupName);
    }

    if (postContent) {
      // Normalisasi teks (hapus semua spasi/baris baru) untuk perbandingan isi editor
      const norm = (s) => (s || "").replace(/[\s\u200B\uFEFF]+/g, "");
      const wanted = norm(postContent);
      const readEditor = () => norm(editor.innerText || editor.textContent || "");

      // Letakkan kursor & seleksi HANYA di dalam editor (bukan seluruh halaman)
      const selectAllInEditor = () => {
        try {
          editor.focus();
          const range = document.createRange();
          range.selectNodeContents(editor);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (_) {}
      };

      // Kosongkan editor lalu tunggu Lexical selesai memperbarui DOM
      const clearEditor = async () => {
        if (!readEditor()) return;
        selectAllInEditor();
        try { document.execCommand("delete", false, null); } catch (_) {}
        await sleep(500);
      };

      // Tunggu sampai isi editor stabil (Lexical merender secara asinkron)
      const waitForText = async (ms) => {
        const start = Date.now();
        while (Date.now() - start < ms) {
          if (readEditor()) break;
          await sleep(150);
        }
        await sleep(400);
        return readEditor();
      };

      // Metode 1: tempel (paste) — Lexical memproses paste satu kali secara utuh
      const insertByPaste = () => {
        try {
          const dt = new DataTransfer();
          dt.setData("text/plain", postContent);
          const evt = new ClipboardEvent("paste", {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
          });
          editor.dispatchEvent(evt);
        } catch (_) {}
      };

      // Metode 2: execCommand insertText
      const insertByExec = () => {
        try { document.execCommand("insertText", false, postContent); } catch (_) {}
      };

      await clearEditor();
      selectAllInEditor();

      // Jalankan SATU metode, lalu TUNGGU hasilnya sebelum mencoba metode lain
      insertByPaste();
      let current = await waitForText(2500);

      if (!current) {
        // Paste tidak diproses → coba execCommand (editor masih kosong, jadi aman)
        selectAllInEditor();
        insertByExec();
        current = await waitForText(2500);
      }

      // Jika ternyata teks terduplikasi, kosongkan dan masukkan ulang sekali saja
      for (let fix = 0; fix < 2 && current && current !== wanted && current.length > wanted.length; fix++) {
        await clearEditor();
        selectAllInEditor();
        insertByExec();
        current = await waitForText(2500);
      }

      if (!current) {
        return {
          type: "fb-target-done",
          status: "failed",
          message: "Teks postingan gagal dimasukkan ke editor Facebook.",
        };
      }

      await sleep(800);
    }

    // 6. Masukkan lampiran gambar bila ada
    if (template.images && template.images.length > 0) {
      const scope = dialog || document.querySelector('[data-pagelet*="GroupInlineComposer"]');
      if (scope) {
        let fileInput = scope.querySelector('input[type="file"][accept*="image"]');

        if (!fileInput) {
          // Cari tombol Foto/Video di dalam modal komposer
          const photoBtns = Array.from(
            scope.querySelectorAll(
              'div[role="button"][aria-label*="Foto" i], div[role="button"][aria-label*="Photo" i], div[aria-label*="Foto" i], div[aria-label*="Photo" i]'
            )
          );
          for (const btn of photoBtns) {
            simulateClick(btn);
            await sleep(1200);
            fileInput = scope.querySelector('input[type="file"][accept*="image"]');
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
            await sleep(4000);
          } catch (imgErr) {
            console.warn("Gagal melampirkan gambar:", imgErr);
          }
        }
      }
    }

    // 7. Cari tombol "Posting" / "Post" / "Kirim" KHUSUS di dalam modal komposer
    const scope = dialog || document.querySelector('[data-pagelet*="GroupInlineComposer"]');
    if (!scope) {
      return {
        type: "fb-target-done",
        status: "failed",
        message: "Komposer postingan tidak ditemukan saat mencari tombol Posting.",
      };
    }

    let postBtn = null;
    const postSelectors = [
      'div[aria-label="Posting" i][role="button"]',
      'div[aria-label="Post" i][role="button"]',
      'div[aria-label="Publikasikan" i][role="button"]',
      'div[aria-label="Kirim" i][role="button"]',
      'div[aria-label*="Posting" i][role="button"]',
    ];

    for (const sel of postSelectors) {
      const b = scope.querySelector(sel);
      if (b && !isCommentOrArticle(b)) {
        postBtn = b;
        break;
      }
    }

    if (!postBtn) {
      const allButtons = Array.from(scope.querySelectorAll('div[role="button"], button'));
      for (const b of allButtons) {
        if (isCommentOrArticle(b)) continue;
        const label = (b.getAttribute("aria-label") || b.innerText || b.textContent || "").trim().toLowerCase();
        if (label === "posting" || label === "post" || label === "publikasikan" || label === "kirim") {
          postBtn = b;
          break;
        }
      }
    }

    if (!postBtn) {
      return {
        type: "fb-target-done",
        status: "failed",
        message: "Tombol Posting tidak ditemukan pada modal komposer.",
      };
    }

    // Tunggu bila tombol posting masih berstatus disabled (misal gambar sedang diunggah) — maksimal 60 detik
    const isBtnDisabled = (b) =>
      b.getAttribute("aria-disabled") === "true" || b.disabled || b.classList.contains("disabled");
    for (let waitDisabled = 0; waitDisabled < 60 && isBtnDisabled(postBtn); waitDisabled++) {
      await sleep(1000);
    }
    if (isBtnDisabled(postBtn)) {
      return {
        type: "fb-target-done",
        status: "failed",
        message: "Tombol Posting tetap nonaktif (gambar mungkin masih diunggah).",
      };
    }

    // Catat jumlah request posting (dari fb-hook.js) SEBELUM klik, sebagai pembanding
    const netBase = { started: postNet.started, done: postNet.done };

    simulateClick(postBtn);

    // ---------------------------------------------------------------------------------
    // Tunggu sampai Facebook BENAR-BENAR selesai memposting sebelum melapor selesai.
    // Sinyal utama : request GraphQL pembuatan postingan sudah selesai di jaringan.
    // Sinyal cadangan: semua modal komposer & indikator "Memposting..." hilang stabil 8 detik.
    // ---------------------------------------------------------------------------------
    const isVisible = (el) => {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const cs = window.getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
    };

    const POSTING_RE = /memposting|sedang memposting|posting\.\.\.|posting…|publishing|mengunggah|uploading/i;

    // Apakah masih ada modal komposer / proses posting yang terlihat di MANA PUN di halaman
    const isComposerStillBusy = () => {
      if (dialog && isVisible(dialog)) return true;
      if (!dialog && editor.isConnected && (editor.innerText || editor.textContent || "").trim()) return true;

      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).filter(isVisible);
      for (const d of dialogs) {
        if (d.querySelector('div[contenteditable="true"]:not([aria-label*="komentar" i]):not([aria-label*="comment" i])')) return true;
        if (d.querySelector('[role="progressbar"], [aria-busy="true"]')) return true;
        if (POSTING_RE.test(d.innerText || "")) return true;
      }

      const busy = document.querySelectorAll(
        '[aria-label*="Memposting" i], [aria-label*="Posting..." i], [aria-label*="Publishing" i]'
      );
      for (const b of busy) if (isVisible(b)) return true;

      return false;
    };

    const readAlert = () => {
      const roots = [];
      if (dialog && dialog.isConnected) roots.push(dialog);
      roots.push(...Array.from(document.querySelectorAll('div[role="dialog"]')).filter(isVisible));
      for (const r of roots) {
        const a = r.querySelector('div[role="alert"]');
        const t = a && (a.textContent || "").trim();
        if (t && !POSTING_RE.test(t)) return t;
      }
      return "";
    };

    const postStart = Date.now();
    let confirmed = false;
    let confirmedByNetwork = false;
    let stableCount = 0;

    while (Date.now() - postStart < 150000) {
      await sleep(1000);

      const cpCheck = detectCheckpoint();
      if (cpCheck) {
        return { type: "fb-target-done", status: "failed", checkpoint: true, message: cpCheck };
      }

      const netStarted = postNet.started > netBase.started;
      const netDone = postNet.done > netBase.done;

      // 1) Request posting sudah selesai di jaringan → pakai hasilnya
      if (netDone) {
        if (postNet.lastOk === false) {
          return {
            type: "fb-target-done",
            status: "failed",
            message: "Facebook menolak postingan: " + (postNet.lastError || "request posting gagal."),
          };
        }
        confirmed = true;
        confirmedByNetwork = true;
        break;
      }

      // 2) Request posting sedang berjalan → JANGAN selesai dulu, tunggu terus
      if (netStarted) {
        stableCount = 0;
        continue;
      }

      // Pesan kesalahan Facebook di modal
      const alertText = readAlert();
      if (alertText && !isComposerStillBusyByProgress()) {
        return { type: "fb-target-done", status: "failed", message: "Facebook menolak postingan: " + alertText };
      }

      // 3) Cadangan bila request jaringan tidak terdeteksi: modal harus hilang stabil 8 detik
      if (!isComposerStillBusy()) {
        stableCount++;
        if (stableCount >= 8 && Date.now() - postStart >= 10000) {
          confirmed = true;
          break;
        }
      } else {
        stableCount = 0;
      }
    }

    function isComposerStillBusyByProgress() {
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).filter(isVisible);
      return dialogs.some(
        (d) => d.querySelector('[role="progressbar"], [aria-busy="true"]') || POSTING_RE.test(d.innerText || "")
      );
    }

    if (!confirmed) {
      return {
        type: "fb-target-done",
        status: "failed",
        message: "Postingan belum terkonfirmasi terkirim setelah 150 detik (proses posting belum selesai).",
      };
    }

    // Setelah request selesai, tunggu modal komposer benar-benar tertutup (maks 20 detik)
    if (confirmedByNetwork) {
      const closeStart = Date.now();
      while (Date.now() - closeStart < 20000 && isComposerStillBusy()) {
        await sleep(1000);
      }
    }

    // Jeda tambahan agar semua request lanjutan Facebook tuntas sebelum tab ditutup
    await sleep(4000);

    const pageText = (document.body.innerText || "").toLowerCase();
    const pending =
      pageText.includes("menunggu persetujuan") ||
      pageText.includes("pending approval") ||
      pageText.includes("ditinjau oleh admin");

    return {
      type: "fb-target-done",
      status: "success",
      message: pending
        ? "Postingan terkirim dan menunggu persetujuan admin grup."
        : "Postingan berhasil dikirim ke grup.",
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.kind === "fb-post-start") {
      if (isExecutingPost) {
        // Cegah eksekusi ganda jika background mengirim pesan berulang
        sendResponse({ ok: true, running: true });
        return;
      }
      isExecutingPost = true;

      // Segera kirim respons balik agar loop percobaan di background.js langsung berhenti dan tidak mengirim ulang
      sendResponse({ ok: true });

      // Detak jantung agar service worker extension tetap hidup selama proses posting yang lama
      const heartbeat = setInterval(() => {
        try {
          chrome.runtime.sendMessage({ kind: "fb-heartbeat" }).catch(() => {});
        } catch (_) {}
      }, 10000);

      executePost(msg.target, msg.template, !!msg.dry)
        .then((res) => {
          chrome.runtime.sendMessage({
            kind: "tkp-scrape",
            ...res,
            targetId: msg.target && msg.target.id,
          }).catch(() => {});
        })
        .catch((err) => {
          chrome.runtime.sendMessage({
            kind: "tkp-scrape",
            type: "fb-target-done",
            status: "failed",
            message: err.message || "Terjadi kesalahan saat memproses grup",
            targetId: msg.target && msg.target.id,
          }).catch(() => {});
        })
        .finally(() => {
          clearInterval(heartbeat);
          isExecutingPost = false;
        });

      return false;
    }
  });
})();
