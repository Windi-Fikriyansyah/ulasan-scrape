"use client";

import { useMemo, useState } from "react";
import type { Job, Review } from "@/lib/types";

type Props = {
  job: Job;
  onClose: () => void;
};

type RatingFilter = "all" | "5" | "4-5";
type LayoutMode = "grid" | "list";

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const COLOR_PRESETS = [
  { label: "Emas Bintang", color: "#f59e0b" },
  { label: "Hijau Tokopedia", color: "#03ac0e" },
  { label: "Oranye Shopee", color: "#ee4d2d" },
  { label: "Biru Modern", color: "#2563eb" },
  { label: "Hitam Elegan", color: "#0f172a" },
];

export default function EmbedReviewModal({ job, onClose }: Props) {
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("4-5");
  const [photoOnly, setPhotoOnly] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>("grid");
  const [accentColor, setAccentColor] = useState<string>("#f59e0b");
  const [title, setTitle] = useState<string>("Ulasan Pembeli Terverifikasi");
  const [showSummary, setShowSummary] = useState(true);
  const [showVerifiedBadge, setShowVerifiedBadge] = useState(true);
  const [showVariant, setShowVariant] = useState(true);
  const [showDate, setShowDate] = useState(true);
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);

  // Pengaturan Load More
  const [enableLoadMore, setEnableLoadMore] = useState<boolean>(true);
  const [initialCount, setInitialCount] = useState<number>(6);
  const [loadMoreStep, setLoadMoreStep] = useState<number>(6);
  const [loadMoreMaxTotal, setLoadMoreMaxTotal] = useState<number>(18);
  const [loadMoreBtnText, setLoadMoreBtnText] = useState<string>("Muat Lebih Banyak Ulasan");

  // Pengaturan ulasan statis jika tanpa Load More
  const [maxCount, setMaxCount] = useState<number>(6);

  // Status interaktif preview lokal
  const [previewRevealedCount, setPreviewRevealedCount] = useState<number>(6);

  // Saring ulasan sesuai rating dan foto
  const eligibleReviews = useMemo(() => {
    let list = [...job.reviews];
    if (ratingFilter === "5") {
      list = list.filter((r) => Math.round(r.rating || 0) === 5);
    } else if (ratingFilter === "4-5") {
      list = list.filter((r) => Math.round(r.rating || 0) >= 4);
    }
    if (photoOnly) {
      list = list.filter((r) => r.images && r.images.length > 0);
    }
    return list;
  }, [job.reviews, ratingFilter, photoOnly]);

  // Ulasan yang masuk ke dalam blok HTML
  const targetReviews = useMemo(() => {
    if (enableLoadMore) {
      if (loadMoreMaxTotal > 0) {
        return eligibleReviews.slice(0, loadMoreMaxTotal);
      }
      return eligibleReviews;
    }
    if (maxCount > 0) {
      return eligibleReviews.slice(0, maxCount);
    }
    return eligibleReviews;
  }, [eligibleReviews, enableLoadMore, loadMoreMaxTotal, maxCount]);

  // Hitung rata-rata rating dari seluruh ulasan
  const avgRating = useMemo(() => {
    const valid = job.reviews.filter((r) => r.rating >= 1 && r.rating <= 5);
    if (!valid.length) return "5.0";
    const sum = valid.reduce((acc, r) => acc + r.rating, 0);
    return (sum / valid.length).toFixed(1);
  }, [job.reviews]);

  // ID unik container untuk namespace script
  const containerId = useMemo(
    () => "ut-widget-" + Math.random().toString(36).slice(2, 8),
    []
  );

  // Helper pembuat kartu ulasan
  const renderCardHtml = (r: Review, isHidden: boolean) => {
    const name = escapeHtml(r.name || "Pembeli");
    const initial = name.charAt(0).toUpperCase();
    const reviewText = escapeHtml(r.review || "Ulasan tanpa teks.");
    const variantText = escapeHtml(r.variant || "");
    const dateText = escapeHtml(r.date || "");

    const makeStarSvg = (fill: boolean) =>
      `<svg viewBox="0 0 24 24" class="ut-star-icon" style="width:16px;height:16px;fill:${fill ? accentColor : "#e2e8f0"};display:inline-block;vertical-align:middle;margin-right:2px;"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;

    const rRating = Math.max(1, Math.min(5, Math.round(r.rating || 5)));
    const starsHtml = [1, 2, 3, 4, 5].map((i) => makeStarSvg(i <= rRating)).join("");

    const avatarHtml = r.avatar
      ? `<img src="${escapeHtml(r.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="ut-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" style="width:40px;height:40px;border-radius:50%;object-fit:cover;display:block;"><div class="ut-avatar-fallback" style="display:none;width:40px;height:40px;border-radius:50%;background:#f1f5f9;color:#334155;font-weight:700;font-size:16px;align-items:center;justify-content:center;">${initial}</div>`
      : `<div class="ut-avatar-fallback" style="width:40px;height:40px;border-radius:50%;background:#f1f5f9;color:#334155;font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center;">${initial}</div>`;

    const verifiedHtml = showVerifiedBadge
      ? `<span class="ut-badge-verified" style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:#16a34a;background:#dcfce7;padding:2px 6px;border-radius:12px;margin-left:6px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Terverifikasi</span>`
      : "";

    const variantHtml =
      showVariant && variantText
        ? `<div class="ut-variant" style="font-size:12px;color:#64748b;margin-bottom:8px;background:#f8fafc;padding:3px 8px;border-radius:4px;display:inline-block;">${variantText}</div>`
        : "";

    const dateHtml =
      showDate && dateText
        ? `<span class="ut-date" style="font-size:12px;color:#94a3b8;">${dateText}</span>`
        : "";

    const photosHtml =
      r.images && r.images.length > 0
        ? `<div class="ut-gallery" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${r.images
            .map(
              (img) =>
                `<a href="${escapeHtml(img)}" target="_blank" rel="noreferrer" style="display:inline-block;border-radius:6px;overflow:hidden;border:1px solid #e2e8f0;line-height:0;"><img src="${escapeHtml(img)}" alt="Foto ulasan" loading="lazy" referrerpolicy="no-referrer" style="width:58px;height:58px;object-fit:cover;display:block;"></a>`
            )
            .join("")}</div>`
        : "";

    const cardDisplay = isHidden ? "display:none !important;" : "display:flex;";
    const hiddenClass = isHidden ? " ut-card-hidden" : "";

    return `
    <div class="ut-card${hiddenClass}" style="${cardDisplay}background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;flex-direction:column;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,0.04);box-sizing:border-box;">
      <div>
        <div class="ut-card-header" style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
          <div class="ut-avatar-wrap" style="flex-shrink:0;">
            ${avatarHtml}
          </div>
          <div class="ut-user-info" style="min-width:0;flex:1;">
            <div style="display:flex;align-items:center;flex-wrap:wrap;">
              <strong class="ut-user-name" style="font-size:14px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</strong>
              ${verifiedHtml}
            </div>
            <div class="ut-stars" style="margin-top:2px;display:flex;align-items:center;">
              ${starsHtml}
            </div>
          </div>
        </div>
        ${variantHtml}
        <p class="ut-review-body" style="font-size:14px;line-height:1.55;color:#334155;margin:0 0 8px 0;word-break:break-word;">${reviewText}</p>
        ${photosHtml}
      </div>
      <div class="ut-card-footer" style="margin-top:12px;padding-top:8px;border-top:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;">
        ${dateHtml}
        <span style="font-size:11px;color:#94a3b8;font-weight:500;">Ulasan Pembeli</span>
      </div>
    </div>`;
  };

  // Generator kode HTML Embed mandiri (untuk disalin pengguna)
  const generatedHtml = useMemo(() => {
    const totalCount = job.reviews.length;
    const roundedAvg = Math.round(Number(avgRating) || 5);

    const makeStarSvg = (fill: boolean) =>
      `<svg viewBox="0 0 24 24" class="ut-star-icon" style="width:16px;height:16px;fill:${fill ? accentColor : "#e2e8f0"};display:inline-block;vertical-align:middle;margin-right:2px;"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;

    const headerStars = [1, 2, 3, 4, 5].map((i) => makeStarSvg(i <= roundedAvg)).join("");

    const cardsHtml = targetReviews
      .map((r, idx) => {
        const isHidden = enableLoadMore && idx >= initialCount;
        return renderCardHtml(r, isHidden);
      })
      .join("\n");

    const headerSummaryHtml = showSummary
      ? `
  <!-- Ringkasan Rating Header -->
  <div class="ut-summary-box" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
    <div style="display:flex;align-items:center;gap:14px;">
      <div class="ut-big-rating" style="font-size:36px;font-weight:800;color:#0f172a;line-height:1;">${avgRating}</div>
      <div>
        <div style="display:flex;align-items:center;margin-bottom:4px;">
          ${headerStars}
        </div>
        <div style="font-size:13px;color:#64748b;font-weight:500;">Rata-rata dari ${totalCount} ulasan pembeli</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#16a34a;background:#dcfce7;padding:6px 12px;border-radius:20px;font-weight:600;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      100% Ulasan Asli Terverifikasi
    </div>
  </div>`
      : "";

    const gridLayoutCss =
      layout === "grid"
        ? `display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;`
        : `display: flex; flex-direction: column; gap: 14px;`;

    // Tombol Load More & Script (hanya jika diaktifkan dan ada ulasan yang disembunyikan)
    const hasMoreReviews = enableLoadMore && targetReviews.length > initialCount;
    const loadMoreButtonHtml = hasMoreReviews
      ? `
  <!-- Tombol Load More -->
  <div class="ut-load-more-wrap" style="text-align:center;margin-top:24px;">
    <button type="button" class="ut-load-more-btn" onclick="var w=document.getElementById('${containerId}')||this.closest('.ut-reviews-container');if(w){var h=w.querySelectorAll('.ut-card-hidden');for(var i=0;i<h.length&&i<${loadMoreStep};i++){h[i].classList.remove('ut-card-hidden');h[i].style.setProperty('display','flex','important');}if(w.querySelectorAll('.ut-card-hidden').length===0){this.parentElement.style.display='none';}}" style="background:${accentColor};color:#ffffff;border:none;padding:11px 26px;border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);transition:transform 0.15s,opacity 0.15s;">
      <span>${escapeHtml(loadMoreBtnText || "Muat Lebih Banyak Ulasan")}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
  </div>
  <script>
    (function() {
      var wrap = document.getElementById("${containerId}");
      if (!wrap) return;
      var btn = wrap.querySelector(".ut-load-more-btn");
      if (!btn) return;
      var step = ${loadMoreStep};
      btn.addEventListener("click", function() {
        var hiddenCards = wrap.querySelectorAll(".ut-card-hidden");
        var count = 0;
        for (var i = 0; i < hiddenCards.length && count < step; i++) {
          hiddenCards[i].classList.remove("ut-card-hidden");
          hiddenCards[i].style.setProperty("display", "flex", "important");
          count++;
        }
        if (wrap.querySelectorAll(".ut-card-hidden").length === 0) {
          if (btn.parentElement) btn.parentElement.style.display = "none";
        }
      });
    })();
  </script>`
      : "";

    return `<!-- ======================================================== -->
<!-- WIDGET ULASAN PEMBELI (CUSTOM HTML SCALEV / MAYAR / FORMULIR) -->
<!-- ======================================================== -->
<div id="${containerId}" class="ut-reviews-container" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:16px 12px;box-sizing:border-box;">
  <style>
    #${containerId} * { box-sizing: border-box; }
    #${containerId} a:hover { opacity: 0.9; }
    #${containerId} .ut-load-more-btn:hover { opacity: 0.92; transform: translateY(-1px); }
    #${containerId} .ut-load-more-btn:active { transform: translateY(0); }
    #${containerId} .ut-card.ut-card-hidden,
    #${containerId} .ut-card-hidden { display: none !important; }
    @media (max-width: 640px) {
      #${containerId} .ut-summary-box { flex-direction: column; align-items: flex-start !important; }
      #${containerId} .ut-reviews-grid { grid-template-columns: 1fr !important; }
    }
  </style>

  ${title ? `<h3 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 16px 0;text-align:left;">${escapeHtml(title)}</h3>` : ""}
  ${headerSummaryHtml}

  <!-- Grid Daftar Ulasan -->
  <div class="ut-reviews-grid" style="${gridLayoutCss}">
${cardsHtml}
  </div>
${loadMoreButtonHtml}
</div>
<!-- ======================================================== -->`;
  }, [
    targetReviews,
    avgRating,
    accentColor,
    layout,
    title,
    showSummary,
    showVerifiedBadge,
    showVariant,
    showDate,
    job.reviews.length,
    enableLoadMore,
    initialCount,
    loadMoreStep,
    loadMoreBtnText,
    containerId,
  ]);

  // HTML interaktif khusus untuk Live Preview di dalam Modal
  const previewHtml = useMemo(() => {
    const totalCount = job.reviews.length;
    const roundedAvg = Math.round(Number(avgRating) || 5);

    const makeStarSvg = (fill: boolean) =>
      `<svg viewBox="0 0 24 24" class="ut-star-icon" style="width:16px;height:16px;fill:${fill ? accentColor : "#e2e8f0"};display:inline-block;vertical-align:middle;margin-right:2px;"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;

    const headerStars = [1, 2, 3, 4, 5].map((i) => makeStarSvg(i <= roundedAvg)).join("");

    const effectiveLimit = enableLoadMore ? previewRevealedCount : targetReviews.length;

    const cardsHtml = targetReviews
      .map((r, idx) => {
        const isHidden = idx >= effectiveLimit;
        return renderCardHtml(r, isHidden);
      })
      .join("\n");

    const headerSummaryHtml = showSummary
      ? `
  <div class="ut-summary-box" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
    <div style="display:flex;align-items:center;gap:14px;">
      <div class="ut-big-rating" style="font-size:36px;font-weight:800;color:#0f172a;line-height:1;">${avgRating}</div>
      <div>
        <div style="display:flex;align-items:center;margin-bottom:4px;">
          ${headerStars}
        </div>
        <div style="font-size:13px;color:#64748b;font-weight:500;">Rata-rata dari ${totalCount} ulasan pembeli</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#16a34a;background:#dcfce7;padding:6px 12px;border-radius:20px;font-weight:600;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      100% Ulasan Asli Terverifikasi
    </div>
  </div>`
      : "";

    const gridLayoutCss =
      layout === "grid"
        ? `display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;`
        : `display: flex; flex-direction: column; gap: 14px;`;

    const hasMoreInPreview = enableLoadMore && effectiveLimit < targetReviews.length;
    const loadMoreButtonHtml = hasMoreInPreview
      ? `
  <div class="ut-load-more-wrap" style="text-align:center;margin-top:24px;">
    <button type="button" class="ut-load-more-btn" style="background:${accentColor};color:#ffffff;border:none;padding:11px 26px;border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
      <span>${escapeHtml(loadMoreBtnText || "Muat Lebih Banyak Ulasan")}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
  </div>`
      : "";

    return `<div class="ut-reviews-container" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:16px 12px;box-sizing:border-box;">
  <style>
    .ut-reviews-container * { box-sizing: border-box; }
    .ut-reviews-container a:hover { opacity: 0.9; }
    .ut-load-more-btn:hover { opacity: 0.92; transform: translateY(-1px); }
    .ut-card.ut-card-hidden, .ut-card-hidden { display: none !important; }
  </style>
  ${title ? `<h3 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 16px 0;text-align:left;">${escapeHtml(title)}</h3>` : ""}
  ${headerSummaryHtml}
  <div class="ut-reviews-grid" style="${gridLayoutCss}">
${cardsHtml}
  </div>
${loadMoreButtonHtml}
</div>`;
  }, [
    targetReviews,
    avgRating,
    accentColor,
    layout,
    title,
    showSummary,
    showVerifiedBadge,
    showVariant,
    showDate,
    job.reviews.length,
    enableLoadMore,
    previewRevealedCount,
    loadMoreBtnText,
  ]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(generatedHtml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {
      const ta = document.getElementById("ut-code-textarea") as HTMLTextAreaElement | null;
      if (ta) {
        ta.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    }
  };

  // Klik tombol Load More di live preview
  const handlePreviewContainerClick = (e: React.MouseEvent) => {
    const btn = (e.target as HTMLElement).closest(".ut-load-more-btn");
    if (btn) {
      setPreviewRevealedCount((prev) => Math.min(targetReviews.length, prev + loadMoreStep));
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="embed-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(23, 43, 77, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        zIndex: 1000,
        overflowY: "auto",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sheet"
        style={{
          maxWidth: "1050px",
          width: "100%",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          padding: "24px",
          background: "#ffffff",
          border: "2px solid var(--ink)",
          boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
        }}
      >
        {/* Header Modal */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", borderBottom: "2px solid var(--line)", paddingBottom: "12px" }}>
          <div>
            <h2 id="embed-modal-title" className="mark" style={{ fontSize: "21px", marginBottom: "4px" }}>
              Salin Block HTML untuk Landingpage
            </h2>
            <p className="muted small" style={{ margin: 0 }}>
              Tempelkan (paste) kode HTML ini pada blok <b>Custom HTML</b> di platform landingpage seperti Scalev, Formulir, Mayar, Berdu, atau WordPress.
            </p>
          </div>
          <button
            type="button"
            className="btn quiet"
            onClick={onClose}
            aria-label="Tutup modal"
            style={{ fontSize: "16px", padding: "4px 10px", fontWeight: "bold" }}
          >
            ✕
          </button>
        </div>

        {/* Konten 2 Kolom: Kolom Kiri Pengaturan, Kolom Kanan Pratinjau / Kode */}
        <div style={{ display: "grid", gridTemplateColumns: "330px minmax(0, 1fr)", gap: "20px", flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* Kolom Kiri: Opsi Widget */}
          <div style={{ overflowY: "auto", paddingRight: "6px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label className="small" style={{ fontWeight: 700, display: "block", marginBottom: "6px" }}>
                Filter Rating
              </label>
              <select
                className="field"
                value={ratingFilter}
                onChange={(e) => {
                  setRatingFilter(e.target.value as RatingFilter);
                  setPreviewRevealedCount(initialCount);
                }}
                style={{ width: "100%" }}
              >
                <option value="4-5">Bintang 4 & 5 (Rekomendasi Landingpage)</option>
                <option value="5">Hanya Bintang 5</option>
                <option value="all">Semua Rating (1 - 5)</option>
              </select>
            </div>

            {/* PENGATURAN LOAD MORE */}
            <div style={{ background: "rgba(23, 43, 77, 0.04)", padding: "12px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              <label className="check" style={{ fontSize: "13px", fontWeight: 700, marginBottom: enableLoadMore ? "10px" : "0", display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="checkbox"
                  checked={enableLoadMore}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setEnableLoadMore(checked);
                    setPreviewRevealedCount(initialCount);
                  }}
                />
                Gunakan Tombol "Load More"
              </label>

              {enableLoadMore ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
                  <div>
                    <label className="small muted" style={{ display: "block", marginBottom: "4px" }}>
                      1. Ulasan Awal yang Tampil
                    </label>
                    <select
                      className="field"
                      value={initialCount}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setInitialCount(val);
                        setPreviewRevealedCount(val);
                      }}
                      style={{ width: "100%", fontSize: "13px" }}
                    >
                      <option value={3}>3 Ulasan Awal</option>
                      <option value={4}>4 Ulasan Awal</option>
                      <option value={6}>6 Ulasan Awal (Ideal)</option>
                      <option value={8}>8 Ulasan Awal</option>
                      <option value={12}>12 Ulasan Awal</option>
                    </select>
                  </div>

                  <div>
                    <label className="small muted" style={{ display: "block", marginBottom: "4px" }}>
                      2. Tambah per Klik Load More
                    </label>
                    <select
                      className="field"
                      value={loadMoreStep}
                      onChange={(e) => setLoadMoreStep(Number(e.target.value))}
                      style={{ width: "100%", fontSize: "13px" }}
                    >
                      <option value={3}>+3 Ulasan per klik</option>
                      <option value={4}>+4 Ulasan per klik</option>
                      <option value={6}>+6 Ulasan per klik (Ideal)</option>
                      <option value={8}>+8 Ulasan per klik</option>
                      <option value={12}>+12 Ulasan per klik</option>
                    </select>
                  </div>

                  <div>
                    <label className="small muted" style={{ display: "block", marginBottom: "4px" }}>
                      3. Batas Maksimal Total Ulasan
                    </label>
                    <select
                      className="field"
                      value={loadMoreMaxTotal}
                      onChange={(e) => {
                        setLoadMoreMaxTotal(Number(e.target.value));
                        setPreviewRevealedCount(initialCount);
                      }}
                      style={{ width: "100%", fontSize: "13px" }}
                    >
                      <option value={12}>Maksimal 12 Ulasan</option>
                      <option value={18}>Maksimal 18 Ulasan (Ideal)</option>
                      <option value={24}>Maksimal 24 Ulasan</option>
                      <option value={36}>Maksimal 36 Ulasan</option>
                      <option value={50}>Maksimal 50 Ulasan</option>
                      <option value={0}>Semua Ulasan ({job.reviews.length})</option>
                    </select>
                  </div>

                  <div>
                    <label className="small muted" style={{ display: "block", marginBottom: "4px" }}>
                      Teks Tombol Load More
                    </label>
                    <input
                      type="text"
                      className="field"
                      value={loadMoreBtnText}
                      onChange={(e) => setLoadMoreBtnText(e.target.value)}
                      placeholder="Muat Lebih Banyak Ulasan"
                      style={{ width: "100%", fontSize: "13px" }}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: "10px" }}>
                  <label className="small muted" style={{ display: "block", marginBottom: "4px" }}>
                    Jumlah Ulasan Tampil (Tanpa Load More)
                  </label>
                  <select
                    className="field"
                    value={maxCount}
                    onChange={(e) => setMaxCount(Number(e.target.value))}
                    style={{ width: "100%", fontSize: "13px" }}
                  >
                    <option value={4}>4 Ulasan</option>
                    <option value={6}>6 Ulasan (Ideal)</option>
                    <option value={9}>9 Ulasan</option>
                    <option value={12}>12 Ulasan</option>
                    <option value={20}>20 Ulasan</option>
                    <option value={0}>Semua Ulasan ({job.reviews.length})</option>
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="small" style={{ fontWeight: 700, display: "block", marginBottom: "6px" }}>
                Tata Letak (Layout)
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className={`btn small ${layout === "grid" ? "solid" : ""}`}
                  style={{ flex: 1 }}
                  onClick={() => setLayout("grid")}
                >
                  Grid (2-3 Kolom)
                </button>
                <button
                  type="button"
                  className={`btn small ${layout === "list" ? "solid" : ""}`}
                  style={{ flex: 1 }}
                  onClick={() => setLayout("list")}
                >
                  List (1 Kolom)
                </button>
              </div>
            </div>

            <div>
              <label className="small" style={{ fontWeight: 700, display: "block", marginBottom: "6px" }}>
                Warna Bintang & Tombol
              </label>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                {COLOR_PRESETS.map((p) => (
                  <button
                    key={p.color}
                    type="button"
                    onClick={() => setAccentColor(p.color)}
                    title={p.label}
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      background: p.color,
                      border: accentColor === p.color ? "3px solid var(--ink)" : "2px solid #e2e8f0",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  style={{ width: "28px", height: "28px", border: "1px solid var(--line)", padding: 0, cursor: "pointer", borderRadius: "4px" }}
                  title="Warna kustom"
                />
              </div>
            </div>

            <div>
              <label className="small" style={{ fontWeight: 700, display: "block", marginBottom: "6px" }}>
                Judul Bagian Ulasan
              </label>
              <input
                type="text"
                className="field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Judul ulasan (kosongkan jika tanpa judul)"
                style={{ width: "100%", fontSize: "13px" }}
              />
            </div>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <label className="check" style={{ fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={photoOnly}
                  onChange={(e) => {
                    setPhotoOnly(e.target.checked);
                    setPreviewRevealedCount(initialCount);
                  }}
                />
                Hanya ulasan yang ada foto
              </label>
              <label className="check" style={{ fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={showSummary}
                  onChange={(e) => setShowSummary(e.target.checked)}
                />
                Tampilkan ringkasan rating atas
              </label>
              <label className="check" style={{ fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={showVerifiedBadge}
                  onChange={(e) => setShowVerifiedBadge(e.target.checked)}
                />
                Tampilkan badge "Terverifikasi"
              </label>
              <label className="check" style={{ fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={showVariant}
                  onChange={(e) => setShowVariant(e.target.checked)}
                />
                Tampilkan varian produk
              </label>
              <label className="check" style={{ fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={showDate}
                  onChange={(e) => setShowDate(e.target.checked)}
                />
                Tampilkan tanggal ulasan
              </label>
            </div>

            <div className="note" style={{ fontSize: "12px", padding: "10px", marginTop: "auto", lineHeight: 1.4 }}>
              <b>💡 Kompatibel:</b> Bekerja langsung di blok <i>Custom HTML</i> <b>Scalev, Formulir, Mayar, Berdu</b>, & website HTML mana pun tanpa library tambahan.
            </div>
          </div>

          {/* Kolom Kanan: Pratinjau / Kode Tab */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderLeft: "1px solid var(--line)", paddingLeft: "20px" }}>
            {/* Tab Navigasi Pratinjau vs Kode */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className={`btn small ${activeTab === "preview" ? "solid" : ""}`}
                  onClick={() => setActiveTab("preview")}
                >
                  Pratinjau ({enableLoadMore ? `${Math.min(previewRevealedCount, targetReviews.length)} dari ${targetReviews.length}` : targetReviews.length} Ulasan)
                </button>
                <button
                  type="button"
                  className={`btn small ${activeTab === "code" ? "solid" : ""}`}
                  onClick={() => setActiveTab("code")}
                >
                  Kode HTML
                </button>
              </div>

              <button
                type="button"
                className="btn solid"
                onClick={handleCopyCode}
                style={{
                  background: copied ? "#16a34a" : "var(--ink)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontWeight: 700,
                }}
              >
                {copied ? "✓ Kode HTML Berhasil Disalin!" : "Salin Kode HTML"}
              </button>
            </div>

            {/* Konten Tab */}
            {activeTab === "preview" ? (
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  border: "1px solid #cbd5e1",
                  borderRadius: "8px",
                  background: "#f8fafc",
                  padding: "16px",
                }}
                onClick={handlePreviewContainerClick}
              >
                {targetReviews.length === 0 ? (
                  <p className="muted" style={{ textAlign: "center", padding: "40px 0" }}>
                    Tidak ada ulasan yang sesuai dengan kombinasi filter rating/foto saat ini. Ubah filter di sebelah kiri.
                  </p>
                ) : (
                  <div>
                    <div
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                      style={{ width: "100%" }}
                    />
                    {enableLoadMore && previewRevealedCount < targetReviews.length && (
                      <p className="small muted" style={{ textAlign: "center", marginTop: "10px" }}>
                        (Klik tombol <i>{loadMoreBtnText}</i> di atas untuk mencoba memuat ulasan berikutnya)
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <textarea
                  id="ut-code-textarea"
                  readOnly
                  value={generatedHtml}
                  className="field code"
                  style={{
                    flex: 1,
                    width: "100%",
                    resize: "none",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    lineHeight: 1.5,
                    padding: "12px",
                    background: "#0f172a",
                    color: "#f8fafc",
                    borderRadius: "6px",
                  }}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
                <p className="muted small" style={{ marginTop: "8px", marginBottom: 0 }}>
                  Klik teks di atas atau klik tombol <b>Salin Kode HTML</b> untuk menyalin ke clipboard.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Modal */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", paddingTop: "12px", borderTop: "2px solid var(--line)" }}>
          <span className="small muted">
            {enableLoadMore
              ? `${initialCount} ulasan awal tampil, bertambah +${loadMoreStep} per klik (maksimal ${loadMoreMaxTotal || targetReviews.length} ulasan).`
              : `${targetReviews.length} ulasan tampil secara statis tanpa tombol load more.`}
          </span>
          <div style={{ display: "flex", gap: "10px" }}>
            <button type="button" className="btn" onClick={onClose}>
              Tutup
            </button>
            <button
              type="button"
              className="btn solid"
              onClick={handleCopyCode}
              style={{
                background: copied ? "#16a34a" : "var(--ink)",
                color: "#fff",
                fontWeight: 700,
              }}
            >
              {copied ? "✓ Kode HTML Tersalin!" : "Salin Kode HTML"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
