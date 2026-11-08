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
    if (Document.prototype && Object.getOwnPropertyDescriptor(Document.prototype, "hasFocus")) {
      Object.defineProperty(Document.prototype, "hasFocus", {
        value: () => true,
        configurable: true,
        writable: true,
      });
    } else {
      document.hasFocus = () => true;
    }
  } catch (_) { }

  // 2. Shim requestAnimationFrame & cancelAnimationFrame
  try {
    const origRAF = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null;
    const origCancelRAF = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : null;
    let nextFakeId = 1000000;
    const fakeTimers = new Map();

    if (origRAF) {
      window.requestAnimationFrame = function (cb) {
        if (typeof cb !== "function") return origRAF ? origRAF(cb) : 0;
        if (isReallyHidden()) {
          const fakeId = ++nextFakeId;
          const tid = setTimeout(() => {
            fakeTimers.delete(fakeId);
            try {
              cb(performance.now());
            } catch (_) {}
          }, 16);
          fakeTimers.set(fakeId, tid);
          return fakeId;
        }
        return origRAF(cb);
      };

      if (origCancelRAF) {
        window.cancelAnimationFrame = function (id) {
          if (fakeTimers.has(id)) {
            const tid = fakeTimers.get(id);
            fakeTimers.delete(id);
            clearTimeout(tid);
          } else {
            origCancelRAF(id);
          }
        };
      }
    }
  } catch (_) { }

  // 3. Shim requestIdleCallback & cancelIdleCallback
  try {
    const origRIC = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : null;
    const origCancelRIC = window.cancelIdleCallback ? window.cancelIdleCallback.bind(window) : null;
    let nextFakeRicId = 2000000;
    const fakeRicTimers = new Map();

    if (origRIC) {
      window.requestIdleCallback = function (cb, options) {
        if (typeof cb !== "function") return origRIC ? origRIC(cb, options) : 0;
        if (isReallyHidden()) {
          const fakeId = ++nextFakeRicId;
          const timeoutVal = (options && options.timeout) || 50;
          const tid = setTimeout(() => {
            fakeRicTimers.delete(fakeId);
            try {
              cb({
                didTimeout: true,
                timeRemaining: () => 50,
              });
            } catch (_) {}
          }, Math.min(timeoutVal, 50));
          fakeRicTimers.set(fakeId, tid);
          return fakeId;
        }
        return origRIC(cb, options);
      };

      if (origCancelRIC) {
        window.cancelIdleCallback = function (id) {
          if (fakeRicTimers.has(id)) {
            const tid = fakeRicTimers.get(id);
            fakeRicTimers.delete(id);
            clearTimeout(tid);
          } else {
            origCancelRIC(id);
          }
        };
      }
    }
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
            if (typeof callback === "function") {
              try {
                callback(entries, this);
              } catch (_) {}
            }
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
            try {
              this._instance.observe(el);
            } catch (_) {}
          }
        }

        unobserve(el) {
          this._targets.delete(el);
          try {
            this._instance.unobserve(el);
          } catch (_) {}
        }

        disconnect() {
          this._targets.clear();
          try {
            this._instance.disconnect();
          } catch (_) {}
          activeObservers.delete(this);
        }

        takeRecords() {
          try {
            return this._instance.takeRecords();
          } catch (_) {
            return [];
          }
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
                if (typeof obs._callback === "function") {
                  obs._callback([entry], obs);
                }
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
          if (typeof url === "string" && url.includes("/api/graphql")) name = getFriendlyName(init && init.body);
        } catch (_) { }
        const p = origFetch.apply(this, arguments);
        if (name && POST_MUTATION_RE.test(name)) {
          notify("start", { name });
          p.then((res) => {
            try {
              res.clone().text()
                .then((text) => notify("done", Object.assign({ name }, evaluate(res.status, text))))
                .catch(() => notify("done", { name, ok: res.ok, error: res.ok ? "" : "HTTP " + res.status }));
            } catch (_) {
              notify("done", { name, ok: res.ok, error: res.ok ? "" : "HTTP " + res.status });
            }
          }).catch((err) => notify("done", { name, ok: false, error: String(err && err.message || err) }));
        }
        return p;
      };
    }
  } catch (_) { }
})();
