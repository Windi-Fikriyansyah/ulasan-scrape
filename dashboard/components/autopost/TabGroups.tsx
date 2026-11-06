"use client";
import { useId, useMemo, useRef, useState } from "react";
import readXlsxFile from "read-excel-file/browser";
import type { FbFetchJobState, FbGroup, FbGroupsDiag } from "@/lib/types";
import { formatIndoDate, normalizeGroupUrl } from "@/lib/autopost";
import { deleteFbGroups, saveFbGroups } from "@/lib/autopost-api";

type Props = {
  groups: FbGroup[];
  selectedGroupIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelect: () => void;
  onGroupsChange: (groups: FbGroup[]) => void;
  isExtensionConnected: boolean;
  onStartFetchGroups: () => void;
  onStopFetchGroups: () => void;
  onShowFetchWindow: () => void;
  fetchingGroups: boolean;
  fetchJobState?: FbFetchJobState;
  fetchJobReason?: string;
  fetchedCount: number;
  fetchResult: { total: number; newCount: number; diag?: FbGroupsDiag; reason?: string } | null;
  dbSaveError: string | null;
  onRetryDbSave: () => void;
};

type ImportPreview = {
  valid: FbGroup[];
  duplicates: number;
  invalid: number;
  totalRows: number;
};

function formatStopReason(reason?: string): string {
  switch (reason) {
    case "akhir_daftar":
      return "sudah mencapai akhir daftar grup yang diikuti";
    case "tidak_bertambah":
      return "tidak ada grup baru yang muncul setelah beberapa kali scroll";
    case "batas_waktu":
      return "batas waktu maksimal 8 menit tercapai";
    case "batas_langkah":
      return "batas maksimal 600 langkah scroll tercapai";
    case "dihentikan":
      return "dihentikan oleh pengguna";
    case "jendela_ditutup":
    case "tab_ditutup_pengguna":
      return "jendela Facebook ditutup sebelum selesai";
    case "jendela_tersembunyi":
      return "jendela Facebook tersembunyi atau tertutup terlalu lama";
    case "checkpoint":
      return "terdeteksi verifikasi atau pembatasan akun Facebook";
    default:
      return reason || "proses selesai";
  }
}

function formatDiagText(d: FbGroupsDiag): string {
  return [
    `=== RINGKASAN DIAGNOSA PENGAMBILAN GRUP ===`,
    `Alasan berhenti : ${d.stopReason} (${formatStopReason(d.stopReason)})`,
    `Total grup      : ${d.total}`,
    `Jumlah langkah  : ${d.steps != null ? d.steps + " langkah scroll" : "-"}`,
    `Durasi          : ${d.durationMs ? Math.round(d.durationMs / 1000) + " detik" : "-"}`,
    d.hiddenDurationMs != null && d.hiddenDurationMs > 0
      ? `Tertahan (jendela tersembunyi): ${Math.round(d.hiddenDurationMs / 1000)} detik (${d.hiddenCount || 1} kali)`
      : "",
    `Visibility tab  : ${d.visibilityStart || "-"} -> ${d.visibilityEnd || "-"}`,
    `Kontainer scroll: <${d.scrollerTag || "unknown"}> role="${d.scrollerRole || ""}"`,
    `Anchor dilewati : notGroup=${d.skipped?.notGroup || 0}, ignoredPath=${d.skipped?.ignoredPath || 0}, duplicate=${d.skipped?.duplicate || 0}`,
    d.sampleSkipped && d.sampleSkipped.length > 0
      ? `Contoh dilewati :\n  ` + d.sampleSkipped.join("\n  ")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export default function TabGroups({
  groups,
  selectedGroupIds,
  onToggleSelect,
  onSelectAll,
  onClearSelect,
  onGroupsChange,
  isExtensionConnected,
  onStartFetchGroups,
  onStopFetchGroups,
  onShowFetchWindow,
  fetchingGroups,
  fetchJobState,
  fetchJobReason,
  fetchedCount,
  fetchResult,
  dbSaveError,
  onRetryDbSave,
}: Props) {
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [copiedDiag, setCopiedDiag] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputId = useId();

  const isJobActive = fetchingGroups || fetchJobState === "berjalan" || fetchJobState === "tertahan";

  // Filter daftar grup
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter(
      (g) => g.name.toLowerCase().includes(q) || g.url.toLowerCase().includes(q)
    );
  }, [groups, search]);

  // Tambah grup manual
  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);
    if (!manualUrl.trim()) {
      setManualError("Link grup tidak boleh kosong.");
      return;
    }
    const norm = normalizeGroupUrl(manualUrl);
    if (!norm) {
      setManualError("Link grup Facebook tidak valid. Contoh: https://www.facebook.com/groups/12345/");
      return;
    }
    const name = manualName.trim() || `Grup ${norm.id}`;
    const newGroup: FbGroup = {
      id: norm.id,
      name,
      url: norm.url,
      source: "manual",
      createdAt: Date.now(),
    };

    try {
      await saveFbGroups([newGroup]);
      const updated = [newGroup, ...groups.filter((g) => g.url !== norm.url)];
      onGroupsChange(updated);
      setManualName("");
      setManualUrl("");
      setActionMsg("Grup berhasil ditambahkan.");
      setTimeout(() => setActionMsg(null), 3000);
    } catch (err: any) {
      setManualError(err.message || "Gagal menyimpan grup.");
    }
  };

  // Unduh template contoh CSV
  const handleDownloadSample = () => {
    const csvContent =
      "link,nama\r\n" +
      "https://www.facebook.com/groups/123456789/,Komunitas Bisnis Online\r\n" +
      "https://www.facebook.com/groups/belajar-coding-indonesia/,Grup Belajar Coding\r\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-grup-facebook.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Proses upload file Excel / CSV
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setImporting(true);
    setManualError(null);

    try {
      const rows: string[][] = [];
      const ext = file.name.split(".").pop()?.toLowerCase();

      if (ext === "xlsx" || ext === "xls") {
        const parsed = (await readXlsxFile(file)) as unknown as Array<any[]>;
        for (const r of parsed) {
          if (Array.isArray(r)) {
            rows.push(r.map((c) => (c == null ? "" : String(c))));
          }
        }
      } else {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const sep = line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
          rows.push(line.split(sep).map((c) => c.replace(/^["']|["']$/g, "").trim()));
        }
      }

      if (rows.length === 0) {
        throw new Error("File kosong atau tidak dapat dibaca.");
      }

      let startIdx = 0;
      const firstRow = rows[0].map((c) => c.toLowerCase());
      let linkCol = 0;
      let nameCol = 1;

      if (firstRow.some((c) => c.includes("link") || c.includes("url") || c.includes("grup") || c.includes("nama"))) {
        startIdx = 1;
        const lIdx = firstRow.findIndex((c) => c.includes("link") || c.includes("url"));
        const nIdx = firstRow.findIndex((c) => c.includes("nama") || c.includes("title"));
        if (lIdx !== -1) linkCol = lIdx;
        if (nIdx !== -1) nameCol = nIdx;
      }

      const existingUrls = new Set(groups.map((g) => g.url.toLowerCase()));
      const seenInFile = new Set<string>();
      const valid: FbGroup[] = [];
      let duplicates = 0;
      let invalid = 0;

      for (let i = startIdx; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        const rawUrl = row[linkCol] || row[0] || "";
        const rawName = (row[nameCol] !== undefined ? row[nameCol] : row[1]) || "";

        const norm = normalizeGroupUrl(rawUrl);
        if (!norm) {
          invalid++;
          continue;
        }

        const lowerUrl = norm.url.toLowerCase();
        if (existingUrls.has(lowerUrl) || seenInFile.has(lowerUrl)) {
          duplicates++;
          continue;
        }

        seenInFile.add(lowerUrl);
        valid.push({
          id: norm.id,
          name: rawName.trim() || `Grup ${norm.id}`,
          url: norm.url,
          source: "import",
          createdAt: Date.now(),
        });
      }

      setPreview({
        valid,
        duplicates,
        invalid,
        totalRows: rows.length - startIdx,
      });
    } catch (err: any) {
      setManualError(err.message || "Gagal memproses file.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Simpan hasil import
  const handleConfirmImport = async () => {
    if (!preview || preview.valid.length === 0) {
      setPreview(null);
      return;
    }
    try {
      await saveFbGroups(preview.valid);
      onGroupsChange([...preview.valid, ...groups]);
      setActionMsg(`Berhasil mengimpor ${preview.valid.length} grup baru.`);
      setPreview(null);
      setTimeout(() => setActionMsg(null), 3000);
    } catch (err: any) {
      setManualError(err.message || "Gagal menyimpan grup hasil impor.");
    }
  };

  // Hapus grup terpilih
  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedGroupIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Hapus ${ids.length} grup yang dipilih dari daftar?`)) return;

    try {
      await deleteFbGroups(ids);
      const remaining = groups.filter((g) => !selectedGroupIds.has(g.id));
      onGroupsChange(remaining);
      onClearSelect();
      setActionMsg(`${ids.length} grup berhasil dihapus.`);
      setTimeout(() => setActionMsg(null), 3000);
    } catch (err: any) {
      setManualError(err.message || "Gagal menghapus grup.");
    }
  };

  // Hapus satu grup
  const handleDeleteSingle = async (id: string, name: string) => {
    if (!window.confirm(`Hapus grup "${name}"?`)) return;
    try {
      await deleteFbGroups([id]);
      onGroupsChange(groups.filter((g) => g.id !== id));
      if (selectedGroupIds.has(id)) onToggleSelect(id);
    } catch (err: any) {
      setManualError(err.message || "Gagal menghapus grup.");
    }
  };

  return (
    <div className="fb-groups-section">
      {/* Tombol aksi utama & pengambil otomatis */}
      <section className="sheet" aria-labelledby="fb-actions-title">
        <h2 id="fb-actions-title" className="mark" style={{ fontSize: "19px", marginBottom: "14px" }}>
          Kelola Grup Facebook
        </h2>

        <p className="hint" style={{ margin: "0 0 10px 0", fontSize: "13px", color: "var(--muted)" }}>
          Pengambilan akan membuka tab baru di latar belakang. Anda bebas berpindah tab atau membuka aplikasi lain; proses tetap berjalan sampai selesai.
        </p>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          {isJobActive ? (
            <button type="button" className="btn" onClick={onStopFetchGroups}>
              Hentikan pengambilan
            </button>
          ) : (
            <button
              type="button"
              className="btn run"
              onClick={onStartFetchGroups}
              disabled={!isExtensionConnected}
              title={!isExtensionConnected ? "Extension belum terhubung" : "Baca seluruh grup yang Anda ikuti secara otomatis"}
            >
              Ambil semua grup otomatis
            </button>
          )}

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing || isJobActive}
            >
              {importing ? "Membaca file..." : "Import Excel / CSV"}
            </button>

            <button
              type="button"
              className="btn small"
              onClick={handleDownloadSample}
              title="Unduh file contoh CSV untuk impor link grup"
            >
              Unduh contoh CSV
            </button>
          </div>
        </div>

        {/* Indikator Live Pengambilan Berjalan */}
        {isJobActive && (
          <div
            style={{
              marginTop: "14px",
              padding: "12px 14px",
              border: "2px solid var(--ink)",
              background: "rgba(245, 197, 24, 0.12)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span className="small" style={{ fontWeight: 700 }}>
                Mengambil grup… {fetchedCount} grup terbaca.
              </span>
              <span className="small muted">Tab Facebook aktif di latar belakang</span>
            </div>
            <div className="track" style={{ height: "10px" }}>
              <div className="bar-run" style={{ width: "100%", height: "100%" }} />
            </div>
            <span className="small muted" style={{ display: "block", marginTop: "6px" }}>
              Halaman Facebook sedang di-scroll otomatis sampai dasar. Tab akan tertutup otomatis saat seluruh grup selesai diambil.
            </span>
          </div>
        )}

        {/* Pesan Selesai / Status Pengambilan */}
        {fetchResult && !isJobActive && (
          <div style={{ marginTop: "14px" }}>
            {fetchResult.diag?.stopReason === "akhir_daftar" || (!fetchResult.reason && !fetchResult.diag?.stopReason) ? (
              <div className="note" style={{ background: "rgba(23, 43, 77, 0.05)" }}>
                <strong>Selesai.</strong> {fetchResult.total} grup terbaca ({fetchResult.newCount} baru), berhenti karena {formatStopReason(fetchResult.diag?.stopReason || fetchResult.reason || "akhir_daftar")}.
              </div>
            ) : (
              <div className="note warn">
                <strong>Pengambilan {fetchResult.reason === "dihentikan" ? "dihentikan" : "berhenti"} ({formatStopReason(fetchResult.diag?.stopReason || fetchResult.reason)}).</strong> {fetchResult.total} grup sempat terbaca ({fetchResult.newCount} baru). Jalankan lagi untuk melengkapi jika perlu. Grup yang sudah ada tidak akan digandakan.
              </div>
            )}

            {/* Bagian Lipat Diagnosa (.diag) */}
            {fetchResult.diag && (
              <details className="diag" style={{ marginTop: "10px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }} className="small">
                  Lihat Ringkasan Diagnosa Pengambilan
                </summary>
                <div style={{ marginTop: "8px", padding: "10px 12px", background: "var(--paper)", border: "1px solid var(--line)" }}>
                  <pre style={{ margin: 0, fontSize: "12px", whiteSpace: "pre-wrap", fontFamily: "monospace", lineHeight: 1.5 }}>
                    {formatDiagText(fetchResult.diag)}
                  </pre>
                  <div style={{ marginTop: "10px" }}>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        if (fetchResult.diag) {
                          navigator.clipboard.writeText(formatDiagText(fetchResult.diag));
                          setCopiedDiag(true);
                          setTimeout(() => setCopiedDiag(false), 2500);
                        }
                      }}
                    >
                      {copiedDiag ? "Diagnosa berhasil disalin!" : "Salin diagnosa"}
                    </button>
                  </div>
                </div>
              </details>
            )}
          </div>
        )}

        {/* Peringatan kegagalan simpan ke database */}
        {dbSaveError && (
          <div
            className="note warn"
            style={{
              marginTop: "12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span>Gagal menyimpan data grup ke database: {dbSaveError}</span>
            <button type="button" className="btn small" onClick={onRetryDbSave}>
              Coba simpan lagi
            </button>
          </div>
        )}

        {/* Form tambah manual */}
        <form onSubmit={handleAddManual} style={{ marginTop: "18px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            type="text"
            className="field"
            placeholder="Nama grup (opsional)"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            style={{ width: "220px" }}
          />
          <input
            type="text"
            className="field"
            placeholder="Link grup (contoh: https://www.facebook.com/groups/12345/)"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            style={{ flex: 1, minWidth: "280px" }}
          />
          <button type="submit" className="btn">
            Tambah manual
          </button>
        </form>

        {manualError && (
          <div className="note warn" style={{ marginTop: "12px" }}>
            {manualError}
          </div>
        )}
        {actionMsg && (
          <div className="note" style={{ marginTop: "12px", background: "rgba(23, 43, 77, 0.05)" }}>
            {actionMsg}
          </div>
        )}
      </section>

      {/* Modal Tinjau / Preview Impor */}
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
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
          <div className="sheet" style={{ maxWidth: "600px", width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
            <h2 id="preview-title" className="mark" style={{ fontSize: "20px", marginBottom: "12px" }}>
              Tinjau Hasil Impor
            </h2>
            <p className="small muted">
              Total baris terbaca: <strong>{preview.totalRows}</strong>
            </p>

            <div style={{ display: "flex", gap: "12px", margin: "14px 0", flexWrap: "wrap" }}>
              <span className="chip" style={{ border: "2px solid var(--ink)" }}>
                Valid & baru: <strong>{preview.valid.length}</strong>
              </span>
              <span className="chip muted">Duplikat (dilewati): {preview.duplicates}</span>
              <span className="chip muted">Tidak valid (dilewati): {preview.invalid}</span>
            </div>

            {preview.valid.length > 0 ? (
              <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--line)", padding: "8px", marginBottom: "16px" }}>
                <p className="small" style={{ fontWeight: 700, marginBottom: "6px" }}>Contoh grup yang akan disimpan:</p>
                <ul className="small" style={{ margin: 0, paddingLeft: "18px" }}>
                  {preview.valid.slice(0, 5).map((g) => (
                    <li key={g.id}>
                      <strong>{g.name}</strong> - <span className="muted">{g.url}</span>
                    </li>
                  ))}
                  {preview.valid.length > 5 && <li className="muted">...dan {preview.valid.length - 5} grup lainnya.</li>}
                </ul>
              </div>
            ) : (
              <p className="small note warn">Tidak ada grup valid baru yang dapat diimpor dari file ini.</p>
            )}

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setPreview(null)}>
                Batal
              </button>
              {preview.valid.length > 0 && (
                <button type="button" className="btn run" onClick={handleConfirmImport}>
                  Simpan {preview.valid.length} grup
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabel daftar grup */}
      <section className="sheet" style={{ marginTop: "18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h3 className="mark" style={{ fontSize: "17px" }}>
              Daftar Grup ({groups.length})
            </h3>
            <span className="chip" title="Jumlah grup yang dipilih untuk pengiriman">
              Terpilih: <strong>{selectedGroupIds.size}</strong>
            </span>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <input
              id={searchInputId}
              type="search"
              className="field"
              placeholder="Cari grup..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "200px" }}
            />
            <button
              type="button"
              className="btn small"
              onClick={() => onSelectAll(filteredGroups.map((g) => g.id))}
              disabled={filteredGroups.length === 0}
            >
              Pilih semua ({filteredGroups.length})
            </button>
            <button
              type="button"
              className="btn small"
              onClick={onClearSelect}
              disabled={selectedGroupIds.size === 0}
            >
              Batal pilih
            </button>
            <button
              type="button"
              className="btn small"
              onClick={handleDeleteSelected}
              disabled={selectedGroupIds.size === 0}
              style={{ color: "var(--red)" }}
            >
              Hapus terpilih
            </button>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="empty" style={{ padding: "40px 10px" }}>
            <p>Belum ada grup Facebook yang tersimpan.</p>
            <p className="small muted">
              Gunakan tombol <strong>Ambil semua grup otomatis</strong> untuk membaca grup dari akun Anda,
              atau klik <strong>Import Excel / CSV</strong>.
            </p>
          </div>
        ) : (
          <div className="lead-table-wrap">
            <table className="lead-table">
              <thead>
                <tr>
                  <th style={{ width: "36px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      aria-label="Pilih semua baris yang tampil"
                      checked={
                        filteredGroups.length > 0 &&
                        filteredGroups.every((g) => selectedGroupIds.has(g.id))
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          onSelectAll(filteredGroups.map((g) => g.id));
                        } else {
                          onClearSelect();
                        }
                      }}
                    />
                  </th>
                  <th>Nama Grup</th>
                  <th>Link Grup</th>
                  <th>Sumber</th>
                  <th>Ditambahkan</th>
                  <th style={{ width: "60px", textAlign: "center" }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map((g) => {
                  const isChecked = selectedGroupIds.has(g.id);
                  return (
                    <tr key={g.id} style={{ background: isChecked ? "rgba(245, 197, 24, 0.12)" : undefined }}>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          aria-label={`Pilih grup ${g.name}`}
                          checked={isChecked}
                          onChange={() => onToggleSelect(g.id)}
                        />
                      </td>
                      <td style={{ fontWeight: 600 }}>{g.name}</td>
                      <td>
                        <a href={g.url} target="_blank" rel="noopener noreferrer" className="muted" style={{ fontSize: "13px" }}>
                          {g.url}
                        </a>
                      </td>
                      <td>
                        <span className="small muted">
                          {g.source === "auto" ? "Otomatis" : g.source === "import" ? "Impor" : "Manual"}
                        </span>
                      </td>
                      <td className="small muted">
                        {g.createdAt ? formatIndoDate(new Date(g.createdAt)) : "-"}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => handleDeleteSingle(g.id, g.name)}
                          style={{ padding: "2px 6px", fontSize: "12px", color: "var(--red)" }}
                          title="Hapus grup ini"
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
