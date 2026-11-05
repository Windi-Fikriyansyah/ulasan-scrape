// Dijalankan di "MAIN world" halaman Tokopedia (bukan dunia terisolasi extension).
// Tujuan: membaca data ulasan asli (rating, foto profil, foto ulasan) karena di tab
// latar belakang gambar lazy-load Tokopedia tidak pernah dimuat, sehingga DOM hanya
// berisi gambar placeholder (zeus_v2/xxxx.svg).
// Sumber data:
// 1) Respons GraphQL/JSON ulasan (fetch & XHR) yang dicegat.
// 2) State awal halaman (__NEXT_DATA__, Apollo cache, dll).
// 3) Props React pada elemen <img> untuk mendapatkan URL gambar asli.
// Komunikasi dengan scraper.js lewat CustomEvent di document.
(() => {
  if (window.__tkpHook) return;
  window.__tkpHook = true;

  const PLACEHOLDER = /^data:|zeus_v2\/[^/?#]+\.svg/i;
  const isUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s) && !PLACEHOLDER.test(s);
  const store = new Map();

  function makeResolver(root) {
    return (v) => {
      if (v && typeof v === "object" && root && typeof root === "object") {
        if (typeof v.__ref === "string" && root[v.__ref]) return root[v.__ref];
        if (v.type === "id" && typeof v.id === "string" && root[v.id]) return root[v.id];
      }
      return v;
    };
  }

  const pickImg = (a) => {
    if (!a) return "";
    if (typeof a === "string") return a;
    return (
      a.imageUrl || a.imageURL || a.fullsizeURL || a.fullSizeURL || a.fullsizeUrl ||
      a.url || a.imageThumbnailUrl || a.thumbnailURL || a.thumbnailUrl || a.thumbnail || ""
    );
  };

  function looksLikeReview(o) {
    const hasText = "message" in o || "reviewText" in o || "review" in o;
    return hasText && ("productRating" in o || "ratingStar" in o || "rating" in o);
  }

  function normalize(o, res) {
    const rating = Number(o.productRating ?? o.ratingStar ?? o.rating);
    if (!(rating >= 1 && rating <= 5)) return null;
    const user = res(o.user || o.reviewer || o.userInfo) || {};
    let atts = res(o.imageAttachments || o.attachments || o.imageAttachment || o.images || []);
    if (!Array.isArray(atts)) atts = [];
    const images = atts.map((a) => pickImg(res(a))).filter(isUrl);
    let avatar = user.image || user.imageUrl || user.imageURL || user.avatar || user.profilePicture || o.userImage || "";
    if (!isUrl(avatar)) avatar = "";
    const message = o.message ?? o.reviewText ?? o.review ?? "";
    return {
      id: String(o.feedbackID ?? o.feedbackId ?? o.reviewID ?? o.id ?? ""),
      name: String(user.fullName || user.name || o.userName || o.reviewerName || ""),
      message: typeof message === "string" ? message : "",
      rating: Math.round(rating),
      avatar,
      images: [...new Set(images)],
    };
  }

  function collect(data, root) {
    const res = makeResolver(root);
    const seen = new WeakSet();
    const found = [];
    (function walk(v, d) {
      v = res(v);
      if (!v || typeof v !== "object" || d > 40 || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) { for (const x of v) walk(x, d + 1); return; }
      if (looksLikeReview(v)) {
        const r = normalize(v, res);
        if (r) found.push(r);
      }
      for (const k in v) {
        const x = v[k];
        if (x && typeof x === "object" && /apollo/i.test(k) && !Array.isArray(x)) {
          for (const r of collect(x, x)) found.push(r);
        }
        walk(x, d + 1);
      }
    })(data, 0);
    return found;
  }

  function add(list) {
    for (const r of list) {
      const key = r.id || `${r.name}|${r.message.slice(0, 80)}`;
      store.set(key, r);
    }
  }

  function scanText(t) {
    if (typeof t !== "string" || !/productRating|imageAttachments|ratingStar/.test(t)) return;
    try { const j = JSON.parse(t); add(collect(j, j)); } catch (_) {}
  }

  // ---- Cegat fetch ----
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      p.then((r) => {
        try { r.clone().text().then(scanText).catch(() => {}); } catch (_) {}
      }).catch(() => {});
      return p;
    };
  }

  // ---- Cegat XHR ----
  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const origSend = XHR.send;
    XHR.send = function (...args) {
      try {
        this.addEventListener("load", () => {
          try {
            if (this.responseType === "" || this.responseType === "text") scanText(this.responseText);
            else if (this.responseType === "json" && this.response) add(collect(this.response, this.response));
          } catch (_) {}
        });
      } catch (_) {}
      return origSend.apply(this, args);
    };
  }

  // ---- State awal halaman (ulasan halaman pertama bisa dirender dari server) ----
  function scanInitial() {
    for (const k of ["__NEXT_DATA__", "__APOLLO_STATE__", "__cache", "__INITIAL_STATE__", "__PRELOADED_STATE__"]) {
      try { const g = window[k]; if (g && typeof g === "object") add(collect(g, g)); } catch (_) {}
    }
    document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__').forEach((s) => scanText(s.textContent));
  }

  // ---- URL gambar asli dari props React ----
  function fiberOf(el) {
    for (const k in el) {
      if (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) return el[k];
    }
    return null;
  }

  const URL_KEYS = ["src", "imageUrl", "imageURL", "image", "url", "fullsizeURL", "imageThumbnailUrl", "thumbnail", "thumbnailURL"];

  function findUrl(props, depth) {
    if (!props || typeof props !== "object" || depth > 2) return "";
    for (const k of URL_KEYS) if (isUrl(props[k])) return props[k];
    for (const k in props) {
      if (k === "children" || k.startsWith("_")) continue;
      const v = props[k];
      if (v && typeof v === "object" && !v.$$typeof && !(v instanceof Node)) {
        const u = findUrl(v, depth + 1);
        if (u) return u;
      }
    }
    return "";
  }

  function resolveImages() {
    document.querySelectorAll("article img").forEach((img) => {
      let url = "";
      const cur = img.currentSrc || img.getAttribute("src") || "";
      if (isUrl(cur)) url = cur;
      let f = fiberOf(img);
      for (let i = 0; f && i < 6 && !url; i++, f = f.return) url = findUrl(f.memoizedProps, 0);
      if (url) img.setAttribute("data-tkp-src", url);
      else img.removeAttribute("data-tkp-src");
    });
  }

  document.addEventListener("tkp-hook-req", () => {
    try { scanInitial(); } catch (_) {}
    try { resolveImages(); } catch (_) {}
    document.dispatchEvent(new CustomEvent("tkp-hook-data", { detail: JSON.stringify([...store.values()]) }));
  });
})();

