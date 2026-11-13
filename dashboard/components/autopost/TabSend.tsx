"use client";
import { useMemo, useState } from "react";
import type { FbGroup, PostRun, PostTarget, PostTemplate } from "@/lib/types";
import { formatIndoDate } from "@/lib/autopost";
import { deleteRun } from "@/lib/autopost-api";

type Props = {
  groups: FbGroup[];
  selectedGroupIds: Set<string>;
  onSelectGroupIds: (ids: string[]) => void;
  templates: PostTemplate[];
  runs: PostRun[];
  activeRun: PostRun | null;
  activeCountdown: number | null;
  onStartRun: (options: {
    targetGroups: FbGroup[];
    selectedTemplateId: string;
    delayMin: number;
    delayMax: number;
    dailyLimit: number;
    dry: boolean;
  }) => void;
  onPauseRun: () => void;
  onResumeRun: () => void;
  onStopRun: () => void;
  onDeleteRun: (id: string) => void;
  isExtensionConnected: boolean;
  onSwitchToTab: (tab: "grup" | "template") => void;
};

export default function TabSend({
  groups,
  selectedGroupIds,
  onSelectGroupIds,
  templates,
  runs,
  activeRun,
  activeCountdown,
  onStartRun,
  onPauseRun,
  onResumeRun,
  onStopRun,
  onDeleteRun,
  isExtensionConnected,
  onSwitchToTab,
}: Props) {
  // Settings form
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    templates.length > 0 ? templates[0].id : ""
  );
  const [delayMin, setDelayMin] = useState<number>(60);
  const [delayMax, setDelayMax] = useState<number>(150);
  const [dailyLimit, setDailyLimit] = useState<number>(15);
  const [dryMode, setDryMode] = useState<boolean>(true); // DEFAULT ON
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  // Filter grup yang dipilih
  const targetGroups = useMemo(() => {
    return groups.filter((g) => selectedGroupIds.has(g.id));
  }, [groups, selectedGroupIds]);

  // Hitung kuota rolling 24 jam dari riwayat runs
  const quota24h = useMemo(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let sentCount = 0;

    for (const r of runs) {
      if (r.dry) continue; // Mode uji tidak dihitung dalam kuota postingan Facebook
      for (const t of r.targets || []) {
        if (t.status === "success" && t.at && t.at > oneDayAgo) {
          sentCount++;
        }
      }
    }
    const maxSafe = 40;
    const remaining = Math.max(0, maxSafe - sentCount);
    return { sent: sentCount, remaining, maxSafe };
  }, [runs]);

  // Validasi sebelum buka modal konfirmasi
  const handleOpenConfirm = () => {
    if (targetGroups.length === 0) {
      alert("Pilih minimal 1 grup di tab Grup terlebih dahulu.");
      return;
    }
    if (!selectedTemplateId) {
      alert("Pilih template postingan terlebih dahulu.");
      return;
    }
    setShowConfirmModal(true);
  };

  const handleConfirmStart = () => {
    setShowConfirmModal(false);
    onStartRun({
      targetGroups,
      selectedTemplateId,
      delayMin: Math.max(30, Number(delayMin) || 60),
      delayMax: Math.max(delayMin, Number(delayMax) || 150),
      dailyLimit: Math.min(40, Math.max(1, Number(dailyLimit) || 15)),
      dry: dryMode,
    });
  };

  // Unduh hasil postingan ke CSV
  const handleExportCsv = (run: PostRun) => {
    const headers = ["ID Target", "Nama Grup", "Link Grup", "Status", "Pesan/Keterangan", "Waktu"];
    const rows = (run.targets || []).map((t) => [
      t.id,
      `"${(t.groupName || "").replace(/"/g, '""')}"`,
      t.groupUrl,
      t.status,
      `"${(t.message || "").replace(/"/g, '""')}"`,
      t.at ? new Date(t.at).toLocaleString("id-ID") : "-",
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hasil-autopost-${run.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Kirim ulang grup yang gagal dari riwayat
  const handleRetryFailed = (run: PostRun) => {
    const failedGroupIds = (run.targets || [])
      .filter((t) => t.status === "failed")
      .map((t) => t.groupId);

    if (failedGroupIds.length === 0) {
      alert("Tidak ada grup yang gagal pada riwayat posting ini.");
      return;
    }

    onSelectGroupIds(failedGroupIds);
    alert(`${failedGroupIds.length} grup yang gagal telah dipilih. Anda dapat memulai pengiriman baru.`);
  };

  // Run yang sedang ditampilkan di tampilan riwayat
  const historyRuns = useMemo(() => {
    return runs.filter((r) => !activeRun || r.id !== activeRun.id);
  }, [runs, activeRun]);

  const displayedHistoryRun = useMemo(() => {
    if (!selectedHistoryId) return historyRuns[0] || null;
    return historyRuns.find((r) => r.id === selectedHistoryId) || historyRuns[0] || null;
  }, [historyRuns, selectedHistoryId]);

  return (
    <div className="fb-send-layout">
      {/* Jika tidak ada proses berjalan, tampilkan form konfigurasi pengiriman */}
      {!activeRun ? (
        <section className="sheet" style={{ marginBottom: "20px" }}>
          <h2 className="mark" style={{ fontSize: "19px", marginBottom: "16px" }}>
            Mulai Pengiriman Otomatis
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "20px" }}>
            {/* 1. Target Grup */}
            <div style={{ padding: "12px", border: "1px solid var(--line)" }}>
              <span className="small" style={{ fontWeight: 700, display: "block", marginBottom: "4px" }}>
                1. Target Grup:
              </span>
              <p style={{ margin: "4px 0", fontSize: "16px", fontWeight: 700 }}>
                {targetGroups.length} grup terpilih
              </p>
              {targetGroups.length === 0 ? (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => onSwitchToTab("grup")}
                  style={{ marginTop: "6px" }}
                >
                  Pilih grup di tab Grup
                </button>
              ) : (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => onSwitchToTab("grup")}
                  style={{ marginTop: "6px" }}
                >
                  Ubah pilihan grup
                </button>
              )}
            </div>

            {/* 2. Pilihan Template */}
            <div style={{ padding: "12px", border: "1px solid var(--line)" }}>
              <span className="small" style={{ fontWeight: 700, display: "block", marginBottom: "4px" }}>
                2. Template Postingan:
              </span>
              {templates.length === 0 ? (
                <div>
                  <p className="small muted">Belum ada template.</p>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => onSwitchToTab("template")}
                    style={{ marginTop: "6px" }}
                  >
                    Buat template baru
                  </button>
                </div>
              ) : (
                <select
                  className="field"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  style={{ width: "100%", marginTop: "6px" }}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.body.length} kar, {t.images?.length || 0} gbr)
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 3. Pengaturan Jeda & Kuota */}
            <div style={{ padding: "12px", border: "1px solid var(--line)" }}>
              <span className="small" style={{ fontWeight: 700, display: "block", marginBottom: "4px" }}>
                3. Jeda Acak (Detik, Min 30s):
              </span>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "6px" }}>
                <input
                  type="number"
                  className="field"
                  min={30}
                  max={600}
                  value={delayMin}
                  onChange={(e) => setDelayMin(Number(e.target.value))}
                  style={{ width: "80px" }}
                  title="Jeda minimal (detik)"
                />
                <span>s/d</span>
                <input
                  type="number"
                  className="field"
                  min={30}
                  max={600}
                  value={delayMax}
                  onChange={(e) => setDelayMax(Number(e.target.value))}
                  style={{ width: "80px" }}
                  title="Jeda maksimal (detik)"
                />
                <span className="small muted">detik</span>
              </div>
              <div className="small muted" style={{ marginTop: "6px" }}>
                Batas harian: <strong>{dailyLimit}</strong>/hari (Terkirim 24 jam: {quota24h.sent}/{quota24h.maxSafe})
              </div>
            </div>
          </div>

          {/* Opsi Mode Uji (Dry Run) - Default ON */}
          <div
            style={{
              marginTop: "16px",
              padding: "12px 14px",
              background: dryMode ? "rgba(245, 197, 24, 0.15)" : "rgba(201, 58, 36, 0.08)",
              border: "1px solid var(--ink)",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <input
              id="dryModeCheck"
              type="checkbox"
              checked={dryMode}
              onChange={(e) => setDryMode(e.target.checked)}
              style={{ width: "18px", height: "18px", cursor: "pointer" }}
            />
            <label htmlFor="dryModeCheck" style={{ cursor: "pointer", fontWeight: 700 }}>
              Mode Uji (Dry Run) — Verifikasi alur tanpa memposting nyata ke grup Facebook
            </label>
          </div>

          <div style={{ marginTop: "18px", display: "flex", gap: "12px", alignItems: "center" }}>
            <button
              type="button"
              className="btn run"
              onClick={handleOpenConfirm}
              disabled={!isExtensionConnected || targetGroups.length === 0 || templates.length === 0}
              title={!isExtensionConnected ? "Extension belum terhubung" : "Mulai pengiriman"}
            >
              Mulai kirim otomatis
            </button>
            {!isExtensionConnected && (
              <span className="small muted">Hubungkan extension terlebih dahulu.</span>
            )}
          </div>
        </section>
      ) : (
        /* MONITOR STATUS PROSES YANG SEDANG BERJALAN */
        <section className="sheet" style={{ marginBottom: "20px", border: "3px solid var(--ink)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <span className="chip" style={{ background: "var(--tape)", fontWeight: 700, marginRight: "8px" }}>
                {activeRun.dry ? "MODE UJI (DRY RUN)" : "PENGIRIMAN NYATA"}
              </span>
              <h2 className="mark" style={{ fontSize: "20px", display: "inline-block" }}>
                Pengiriman Sedang Berjalan
              </h2>
            </div>

            {/* Tombol Kontrol: Jeda / Lanjutkan / Hentikan */}
            <div style={{ display: "flex", gap: "8px" }}>
              {activeRun.state === "paused" ? (
                <button type="button" className="btn run" onClick={onResumeRun}>
                  Lanjutkan
                </button>
              ) : (
                <button type="button" className="btn" onClick={onPauseRun}>
                  Jeda
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={onStopRun}
                style={{ color: "var(--red)" }}
              >
                Hentikan
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ margin: "16px 0" }}>
            {(() => {
              const finishedCount = (activeRun.targets || []).filter(
                (t) => t.status === "success" || t.status === "failed" || t.status === "skipped"
              ).length;
              const total = activeRun.total || activeRun.targets.length || 1;
              const pct = Math.round((finishedCount / total) * 100);

              return (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span className="small" style={{ fontWeight: 700 }}>
                      Progres: {finishedCount} dari {total} grup selesai ({pct}%)
                    </span>
                    <span className="small muted">
                      {activeRun.state === "paused"
                        ? "Proses Dijeda"
                        : activeCountdown != null && activeCountdown > 0
                          ? `Jeda acak: grup berikutnya dalam ${activeCountdown} detik...`
                          : "Sedang memproses grup..."}
                    </span>
                  </div>
                  <div className="track" style={{ height: "12px" }}>
                    <div className="bar-run" style={{ width: `${pct}%`, height: "100%" }} />
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Tabel status live grup dalam run aktif */}
          <div className="lead-table-wrap" style={{ maxHeight: "300px", overflowY: "auto" }}>
            <table className="lead-table">
              <thead>
                <tr>
                  <th style={{ width: "36px", textAlign: "center" }}>No</th>
                  <th>Grup Facebook</th>
                  <th style={{ width: "110px" }}>Status</th>
                  <th>Pesan / Keterangan</th>
                  <th style={{ width: "80px" }}>Waktu</th>
                </tr>
              </thead>
              <tbody>
                {(activeRun.targets || []).map((t, idx) => {
                  const statusLabel =
                    t.status === "success"
                      ? "Berhasil"
                      : t.status === "failed"
                        ? "Gagal"
                        : t.status === "posting"
                          ? "Memproses..."
                          : t.status === "skipped"
                            ? "Dilewati"
                            : "Menunggu";

                  const statusColor =
                    t.status === "success"
                      ? "var(--ink)"
                      : t.status === "failed"
                        ? "var(--red)"
                        : t.status === "posting"
                          ? "var(--ink-soft)"
                          : undefined;

                  return (
                    <tr key={t.id}>
                      <td style={{ textAlign: "center" }}>{idx + 1}</td>
                      <td>
                        <strong>{t.groupName}</strong>
                        <div className="small muted">{t.groupUrl}</div>
                      </td>
                      <td style={{ fontWeight: 700, color: statusColor }}>{statusLabel}</td>
                      <td className="small">{t.message || "-"}</td>
                      <td className="small muted">{t.at ? new Date(t.at).toLocaleTimeString("id-ID") : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* MODAL KONFIRMASI PENGIRIMAN */}
      {showConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(23, 43, 77, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "20px",
          }}
        >
          <div className="sheet" style={{ maxWidth: "520px", width: "100%" }}>
            <h2 id="confirm-modal-title" className="mark" style={{ fontSize: "20px", marginBottom: "12px" }}>
              Konfirmasi Mulai Pengiriman
            </h2>

            <div style={{ margin: "14px 0", lineHeight: 1.6 }}>
              <p>
                <strong>Jumlah Target:</strong> {targetGroups.length} grup Facebook
              </p>
              <p>
                <strong>Template:</strong>{" "}
                {templates.find((t) => t.id === selectedTemplateId)?.name || "-"}
              </p>
              <p>
                <strong>Mode Pengiriman:</strong>{" "}
                {dryMode ? (
                  <span style={{ color: "var(--ink)", fontWeight: 700 }}>
                    Mode Uji (Dry Run) — Tidak memposting nyata
                  </span>
                ) : (
                  <span style={{ color: "var(--red)", fontWeight: 700 }}>
                    MODE NYATA — Postingan akan diterbitkan ke akun Facebook Anda
                  </span>
                )}
              </p>
              <p>
                <strong>Jeda Antar Grup:</strong> {delayMin} s/d {delayMax} detik secara acak
              </p>
            </div>

            <div className="note warn" style={{ marginBottom: "16px" }}>
              Pastikan akun Facebook Anda sudah login di browser ini sebelum memulai proses. Tab grup akan terbuka
              di latar belakang satu per satu.
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShowConfirmModal(false)}>
                Batal
              </button>
              <button type="button" className="btn run" onClick={handleConfirmStart}>
                Ya, Mulai Pengiriman
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RIWAYAT PENGIRIMAN (ARCHIVE) */}
      <section className="sheet" style={{ marginTop: "24px" }}>
        <h3 className="mark" style={{ fontSize: "18px", marginBottom: "12px" }}>
          Riwayat Pengiriman ({historyRuns.length})
        </h3>

        {historyRuns.length === 0 ? (
          <p className="small muted">Belum ada riwayat pengiriman.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", gap: "20px" }}>
            {/* Kolom kiri: List run */}
            <ul className="archive" style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: "400px", overflowY: "auto" }}>
              {historyRuns.map((r) => {
                const isSelected = displayedHistoryRun?.id === r.id;
                const successCount = (r.targets || []).filter((t) => t.status === "success").length;
                const total = r.total || r.targets?.length || 0;

                return (
                  <li key={r.id} style={{ marginBottom: "6px" }}>
                    <button
                      type="button"
                      className="entry"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => setSelectedHistoryId(r.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        border: isSelected ? "2px solid var(--ink)" : "1px solid var(--line)",
                        background: isSelected ? "rgba(245, 197, 24, 0.15)" : "var(--paper)",
                        fontWeight: isSelected ? 700 : 500,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="small">{formatIndoDate(new Date(r.startedAt))}</span>
                        <span className="small muted">{r.dry ? "Uji" : "Nyata"}</span>
                      </div>
                      <div className="small muted" style={{ marginTop: "2px" }}>
                        {successCount} / {total} sukses • {r.state}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Kolom kanan: Detail run terpilih */}
            {displayedHistoryRun ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
                  <div>
                    <h4 className="mark" style={{ fontSize: "16px" }}>
                      Pekerjaan: {displayedHistoryRun.id}
                    </h4>
                    <span className="small muted">
                      Dimulai: {new Date(displayedHistoryRun.startedAt).toLocaleString("id-ID")} • Mode:{" "}
                      {displayedHistoryRun.dry ? "Uji" : "Nyata"} • Status: {displayedHistoryRun.state}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => handleExportCsv(displayedHistoryRun)}
                      title="Unduh laporan posting dalam format CSV"
                    >
                      Unduh CSV hasil
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => handleRetryFailed(displayedHistoryRun)}
                      title="Pilih kembali grup yang gagal diposting"
                    >
                      Kirim ulang yang gagal
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => onDeleteRun(displayedHistoryRun.id)}
                      style={{ color: "var(--red)" }}
                      title="Hapus riwayat pekerjaan ini"
                    >
                      Hapus
                    </button>
                  </div>
                </div>

                {/* Tabel target */}
                <div className="lead-table-wrap" style={{ maxHeight: "320px", overflowY: "auto" }}>
                  <table className="lead-table">
                    <thead>
                      <tr>
                        <th style={{ width: "30px", textAlign: "center" }}>No</th>
                        <th>Grup</th>
                        <th style={{ width: "90px" }}>Status</th>
                        <th>Keterangan</th>
                        <th style={{ width: "70px" }}>Waktu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(displayedHistoryRun.targets || []).map((t, idx) => (
                        <tr key={t.id}>
                          <td style={{ textAlign: "center" }}>{idx + 1}</td>
                          <td>
                            <strong>{t.groupName}</strong>
                            <div className="small muted">{t.groupUrl}</div>
                          </td>
                          <td
                            style={{
                              fontWeight: 700,
                              color:
                                t.status === "success"
                                  ? "var(--ink)"
                                  : t.status === "failed"
                                    ? "var(--red)"
                                    : undefined,
                            }}
                          >
                            {t.status === "success"
                              ? "Berhasil"
                              : t.status === "failed"
                                ? "Gagal"
                                : t.status === "skipped"
                                  ? "Dilewati"
                                  : t.status}
                          </td>
                          <td className="small">{t.message || "-"}</td>
                          <td className="small muted">
                            {t.at ? new Date(t.at).toLocaleTimeString("id-ID") : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="small muted">Pilih riwayat untuk melihat detail.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

