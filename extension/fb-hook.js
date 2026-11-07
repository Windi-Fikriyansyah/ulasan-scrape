// Hook di halaman Facebook (world: MAIN, run_at: document_start)
// Memastikan Facebook tetap merender feed, memicu infinite scroll, dan memuat data berikutnya di tab latar belakang
(() => {
  if (window.__fbHookInitialized) return;
  window.__fbHookInitialized = true;

  // Simpan nilai asli getter visibilitas sebelum di-override
  let realHiddenGetter;
  let realVisibilityGetter;
  try {
    realHiddenGetter = Object.getOwnPropertyDescriptor(Document.prototype, "hidden")?.get;
    realVisibilityGetter = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState")?.get;
  } catch (_) { }

  const isReallyHidden = () => {
    try {
      if (realHiddenGetter) return realHiddenGetter.call(document);
      if (realVisibilityGetter) return realVisibilityGetter.call(document) === "hidden";
    } catch (_) { }
    return false;
  };

  // 1. Visibilitas & Focus palsu agar Facebook tidak menunda rendering
  try {
    Object.defineProperty(document, "visibilityState", {
      get: () => "visible",
      configurable: true,
    });
    Object.defineProperty(document, "hidden", {
      get: () => false,
      configurable: true,
    });
    document.hasFocus = () => true;
  } catch (_) { }

  // 2. Shim requestAnimationFrame agar tidak dibekukan Chrome di tab latar belakang
  try {
    const origRAF = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null;
    window.requestAnimationFrame = function (cb) {
      if (isReallyHidden()) {
        return setTimeout(() => {
          try {
            cb(performance.now());
          } catch (_) { }
        }, 16);
      }
      let called = false;
      const safeCb = (time) => {
        if (called) return;
        called = true;
        clearTimeout(timer);
        try {
          cb(time);
        } catch (_) { }
      };
      // Timer pengaman 80ms bila browser mendadak menahan rAF di tab latar belakang
      const timer = setTimeout(() => safeCb(performance.now()), 80);
      return origRAF ? origRAF(safeCb) : timer;
    };
  } catch (_) { }

  // 3. Shim requestIdleCallback agar Facebook tidak menunda fetch query halaman berikutnya di tab latar belakang
  try {
    const origRIC = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : null;
    window.requestIdleCallback = function (cb, options) {
      if (isReallyHidden()) {
        return setTimeout(() => {
          try {
            cb({
              didTimeout: true,
              timeRemaining: () => 50,
            });
          } catch (_) { }
        }, 50);
      }
      let called = false;
      const safeCb = (deadline) => {
        if (called) return;
        called = true;
        clearTimeout(timer);
        try {
          cb(deadline);
        } catch (_) { }
      };
      const timeoutVal = (options && options.timeout) || 150;
      const timer = setTimeout(
        () => safeCb({ didTimeout: true, timeRemaining: () => 50 }),
        timeoutVal
      );
      return origRIC ? origRIC(safeCb, options) : timer;
    };
  } catch (_) { }

  // 4. Proxy IntersectionObserver agar pagination / sentinel Facebook terpanggil aktif di tab latar belakang
  try {
    const OriginalIO = window.IntersectionObserver;
    if (OriginalIO) {
      const activeObservers = new Set();

      class ProxyIntersectionObserver {
        constructor(callback, options) {
          const targets = new Set();
          const instance = new OriginalIO((entries, obs) => {
            callback(entries, obs);
          }, options);

          this._instance = instance;
          this._targets = targets;
          this._callback = callback;
          this._options = options;

          activeObservers.add(this);
        }

        observe(el) {
          if (el && el.nodeType === 1) {
            this._targets.add(el);
            this._instance.observe(el);
          }
        }

        unobserve(el) {
          this._targets.delete(el);
          this._instance.unobserve(el);
        }

        disconnect() {
          this._targets.clear();
          this._instance.disconnect();
          activeObservers.delete(this);
        }

        takeRecords() {
          return this._instance.takeRecords();
        }

        get root() {
          return this._instance.root;
        }

        get rootMargin() {
          return this._instance.rootMargin;
        }

        get thresholds() {
          return this._instance.thresholds;
        }
      }

      Object.setPrototypeOf(ProxyIntersectionObserver.prototype, OriginalIO.prototype);
      Object.setPrototypeOf(ProxyIntersectionObserver, OriginalIO);
      window.IntersectionObserver = ProxyIntersectionObserver;

      // Pemicu berkala untuk sentinel pagination di halaman /groups/ saat tab di latar belakang
      setInterval(() => {
        if (!location.pathname.includes("/groups")) return;
        if (!isReallyHidden()) return; // Jika tab sedang aktif/visible, biarkan browser native bekerja

        for (const obs of activeObservers) {
          for (const target of obs._targets) {
            if (document.contains(target)) {
              let rect;
              try {
                rect = target.getBoundingClientRect();
              } catch (_) {
                rect = { top: 0, left: 0, bottom: 50, right: 50, width: 50, height: 50, x: 0, y: 0 };
              }
              const entry = {
                time: performance.now(),
                target,
                isIntersecting: true,
                intersectionRatio: 1,
                boundingClientRect: rect,
                intersectionRect: rect,
                rootBounds: {
                  top: 0,
                  left: 0,
                  right: window.innerWidth || 1280,
                  bottom: window.innerHeight || 800,
                  width: window.innerWidth || 1280,
                  height: window.innerHeight || 800,
                  x: 0,
                  y: 0,
                },
              };
              try {
                obs._callback([entry], obs._instance);
              } catch (_) { }
            }
          }
        }
      }, 800);
    }
  } catch (_) { }

  // 5. Pantau request GraphQL "buat postingan" agar autopost tahu kapan posting BENAR-BENAR selesai
  try {
    const POST_MUTATION_RE = /ComposerStoryCreate|StoryCreateMutation|ComposerPublish|GroupsCometComposer\w*Mutation/i;

    const getFriendlyName = (body) => {
      try {
        if (!body) return "";
        if (typeof body === "string") {
          const m = body.match(/fb_api_req_friendly_name=([^&]+)/);
          return m ? decodeURIComponent(m[1]) : (POST_MUTATION_RE.test(body) ? body.slice(0, 200) : "");
        }
        if (body instanceof URLSearchParams) return body.get("fb_api_req_friendly_name") || "";
        if (body instanceof FormData) return String(body.get("fb_api_req_friendly_name") || "");
      } catch (_) { }
      return "";
    };

    const notify = (type, extra) => {
      try {
        window.postMessage(Object.assign({ __fbAutopostNet: true, type }, extra || {}), "*");
      } catch (_) { }
    };

    const evaluate = (status, text) => {
      const okStatus = status >= 200 && status < 300;
      const body = text || "";
      const hasStory = /story_create|"story"\s*:|"post_id"|"legacy_story_hideable_id"/.test(body);
      let error = "";
      if (!hasStory) {
        const m = body.match(/"(?:summary|description|message)"\s*:\s*"([^"]{3,200})"/);
        if (/"errors"\s*:\s*\[/.test(body) || /"error"\s*:\s*\d+/.test(body)) {
          error = m ? m[1] : "Facebook mengembalikan error.";
        }
      }
      return { ok: okStatus && !error, error: okStatus ? error : "HTTP " + status };
    };

    // XMLHttpRequest (jalur utama GraphQL Facebook)
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__fbUrl = String(url || "");
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (this.__fbUrl.includes("/api/graphql")) {
          const name = getFriendlyName(body);
          if (name && POST_MUTATION_RE.test(name)) {
            notify("start", { name });
            this.addEventListener("loadend", () => {
              let text = "";
              try { text = typeof this.responseText === "string" ? this.responseText : ""; } catch (_) { }
              notify("done", Object.assign({ name }, evaluate(this.status, text)));
            });
          }
        }
      } catch (_) { }
      return origSend.apply(this, arguments);
    };

    // fetch (cadangan)
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input, init) {
        let name = "";
        try {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          if (url.includes("/api/graphql")) name = getFriendlyName(init && init.body);
        } catch (_) { }
        const p = origFetch.apply(this, arguments);
        if (name && POST_MUTATION_RE.test(name)) {
          notify("start", { name });
          p.then((res) => {
            res.clone().text()
              .then((text) => notify("done", Object.assign({ name }, evaluate(res.status, text))))
              .catch(() => notify("done", { name, ok: res.ok, error: res.ok ? "" : "HTTP " + res.status }));
          }).catch((err) => notify("done", { name, ok: false, error: String(err && err.message || err) }));
        }
        return p;
      };
    }
  } catch (_) { }
})();
