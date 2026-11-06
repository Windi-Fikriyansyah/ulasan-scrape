"use client";
import { useRef, useState } from "react";
import type { PostImage, PostTemplate } from "@/lib/types";
import { compressImage, renderTemplateText } from "@/lib/autopost";
import { deleteTemplate, saveTemplate, updateTemplate } from "@/lib/autopost-api";

type Props = {
  templates: PostTemplate[];
  onTemplatesChange: (templates: PostTemplate[]) => void;
};

const MAX_BODY_LEN = 5000;
const MAX_IMAGES = 4;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // 4MB

export default function TabTemplates({ templates, onTemplatesChange }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    templates.length > 0 ? templates[0].id : null
  );

  // Form state
  const activeTemplate = templates.find((t) => t.id === selectedId);
  const [name, setName] = useState(activeTemplate?.name || "");
  const [body, setBody] = useState(activeTemplate?.body || "");
  const [images, setImages] = useState<PostImage[]>(activeTemplate?.images || []);
  const [isEditingExisting, setIsEditingExisting] = useState(!!activeTemplate);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ganti template yang sedang dipilih
  const handleSelectTemplate = (t: PostTemplate) => {
    setSelectedId(t.id);
    setName(t.name);
    setBody(t.body);
    setImages(t.images || []);
    setIsEditingExisting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  // Buat template baru kosong
  const handleNew = () => {
    setSelectedId(null);
    setName("Template Baru");
    setBody("");
    setImages([]);
    setIsEditingExisting(false);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  // Gandakan template aktif
  const handleClone = async () => {
    if (!activeTemplate) return;
    const cloneData: Partial<PostTemplate> & { name: string; body: string } = {
      name: `${activeTemplate.name} (Salinan)`,
      body: activeTemplate.body,
      images: activeTemplate.images,
    };
    try {
      const newId = await saveTemplate(cloneData);
      const created: PostTemplate = {
        id: newId,
        name: cloneData.name,
        body: cloneData.body,
        images: cloneData.images || [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const updatedList = [created, ...templates];
      onTemplatesChange(updatedList);
      handleSelectTemplate(created);
      setSuccessMsg("Template berhasil digandakan.");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Gagal menggandakan template.");
    }
  };

  // Sisipkan variabel ke posisi kursor textarea
  const insertVariable = (variable: string) => {
    const el = textareaRef.current;
    if (!el) {
      setBody((prev) => prev + variable);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const nextBody = body.substring(0, start) + variable + body.substring(end);
    if (nextBody.length <= MAX_BODY_LEN) {
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    }
  };

  // Upload dan kompresi gambar
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setUploading(true);

    try {
      const remainingSlots = MAX_IMAGES - images.length;
      if (remainingSlots <= 0) {
        throw new Error(`Maksimal ${MAX_IMAGES} gambar per template.`);
      }

      const filesToProcess = Array.from(files).slice(0, remainingSlots);
      const compressedList: PostImage[] = [];

      for (const f of filesToProcess) {
        if (!f.type.startsWith("image/")) continue;
        const compressed = await compressImage(f, 1600, 0.85);
        compressedList.push(compressed);
      }

      const nextImages = [...images, ...compressedList];
      const totalBytes = nextImages.reduce((sum, img) => sum + img.size, 0);

      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("Total ukuran seluruh gambar melebihi 4MB. Hapus beberapa gambar.");
      }

      setImages(nextImages);
    } catch (err: any) {
      setErrorMsg(err.message || "Gagal memproses gambar.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Hapus satu gambar dari daftar
  const handleRemoveImage = (imgId: string) => {
    setImages((prev) => prev.filter((img) => img.id !== imgId));
  };

  // Simpan template (tambah baru atau update)
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!name.trim()) {
      setErrorMsg("Nama template wajib diisi.");
      return;
    }
    if (!body.trim() && images.length === 0) {
      setErrorMsg("Isi teks template atau sertakan minimal 1 gambar.");
      return;
    }

    try {
      if (isEditingExisting && selectedId) {
        await updateTemplate(selectedId, {
          name: name.trim(),
          body: body.slice(0, MAX_BODY_LEN),
          images,
        });
        const updatedList = templates.map((t) =>
          t.id === selectedId
            ? { ...t, name: name.trim(), body: body.slice(0, MAX_BODY_LEN), images, updatedAt: Date.now() }
            : t
        );
        onTemplatesChange(updatedList);
        setSuccessMsg("Template berhasil diperbarui.");
      } else {
        const newId = await saveTemplate({
          name: name.trim(),
          body: body.slice(0, MAX_BODY_LEN),
          images,
        });
        const created: PostTemplate = {
          id: newId,
          name: name.trim(),
          body: body.slice(0, MAX_BODY_LEN),
          images,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const updatedList = [created, ...templates];
        onTemplatesChange(updatedList);
        setSelectedId(newId);
        setIsEditingExisting(true);
        setSuccessMsg("Template berhasil disimpan.");
      }
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Gagal menyimpan template.");
    }
  };

  // Hapus template
  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm(`Hapus template "${name}"?`)) return;
    try {
      await deleteTemplate(selectedId);
      const remaining = templates.filter((t) => t.id !== selectedId);
      onTemplatesChange(remaining);
      if (remaining.length > 0) {
        handleSelectTemplate(remaining[0]);
      } else {
        handleNew();
      }
      setSuccessMsg("Template berhasil dihapus.");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Gagal menghapus template.");
    }
  };

  // Simulasi preview teks
  const previewText = renderTemplateText(body, "Komunitas Pengusaha Online");

  return (
    <div className="fb-templates-layout" style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: "24px" }}>
      {/* Kolom kiri: Daftar Template tersimpan */}
      <aside className="sheet" style={{ height: "fit-content" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h2 className="mark" style={{ fontSize: "17px" }}>
            Template ({templates.length})
          </h2>
          <button type="button" className="btn small run" onClick={handleNew}>
            + Baru
          </button>
        </div>

        {templates.length === 0 ? (
          <p className="small muted">Belum ada template. Klik "+ Baru" untuk membuat template postingan.</p>
        ) : (
          <ul className="archive" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {templates.map((t) => (
              <li key={t.id} style={{ marginBottom: "6px" }}>
                <button
                  type="button"
                  className="entry"
                  aria-current={t.id === selectedId ? "true" : undefined}
                  onClick={() => handleSelectTemplate(t)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    border: t.id === selectedId ? "2px solid var(--ink)" : "1px solid var(--line)",
                    background: t.id === selectedId ? "rgba(245, 197, 24, 0.15)" : "var(--paper)",
                    fontWeight: t.id === selectedId ? 700 : 500,
                  }}
                >
                  <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.name}
                  </div>
                  <div className="small muted" style={{ fontSize: "11px", marginTop: "2px" }}>
                    {t.images && t.images.length > 0 ? `${t.images.length} gambar • ` : ""}
                    {t.body ? `${t.body.length} kar.` : "Hanya gambar"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Kolom kanan: Editor Template & Live Preview */}
      <main className="sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
          <h2 className="mark" style={{ fontSize: "20px" }}>
            {isEditingExisting ? "Ubah Template" : "Buat Template Baru"}
          </h2>
          <div style={{ display: "flex", gap: "8px" }}>
            {isEditingExisting && (
              <>
                <button type="button" className="btn small" onClick={handleClone} title="Gandakan template ini">
                  Gandakan
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={handleDelete}
                  style={{ color: "var(--red)" }}
                  title="Hapus template ini"
                >
                  Hapus
                </button>
              </>
            )}
          </div>
        </div>

        <form onSubmit={handleSave}>
          <div style={{ marginBottom: "14px" }}>
            <label className="small" style={{ display: "block", fontWeight: 700, marginBottom: "4px" }}>
              Nama Template:
            </label>
            <input
              type="text"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Promo Diskon Akhir Pekan"
              style={{ width: "100%" }}
              required
            />
          </div>

          {/* Variabel cepat */}
          <div style={{ marginBottom: "10px" }}>
            <span className="small muted" style={{ display: "block", marginBottom: "4px" }}>
              Sisipkan variabel dinamis:
            </span>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="chip"
                onClick={() => insertVariable("{nama_grup}")}
                title="Diganti otomatis dengan nama grup target saat dikirim"
              >
                + &#123;nama_grup&#125;
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => insertVariable("{tanggal}")}
                title="Diganti otomatis dengan tanggal saat posting (misal: 6 November 2026)"
              >
                + &#123;tanggal&#125;
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => insertVariable("{hari}")}
                title="Diganti otomatis dengan nama hari (misal: Jumat)"
              >
                + &#123;hari&#125;
              </button>
            </div>
          </div>

          {/* Textarea isi template */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <label className="small" style={{ fontWeight: 700 }}>
                Isi Postingan:
              </label>
              <span className="small muted">
                {body.length} / {MAX_BODY_LEN} karakter
              </span>
            </div>
            <textarea
              ref={textareaRef}
              className="field"
              rows={8}
              value={body}
              maxLength={MAX_BODY_LEN}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Tulis pesan promosi Anda di sini... Gunakan variabel seperti Halo rekan {nama_grup}..."
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>

          {/* Upload Gambar */}
          <div style={{ marginBottom: "16px", padding: "12px", border: "1px dashed var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span className="small" style={{ fontWeight: 700 }}>
                Gambar (maksimal {MAX_IMAGES} gambar, total maks 4MB):
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={handleImageUpload}
              />
              <button
                type="button"
                className="btn small"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || images.length >= MAX_IMAGES}
              >
                {uploading ? "Mengompres gambar..." : "+ Tambah Gambar"}
              </button>
            </div>

            {images.length > 0 ? (
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {images.map((img) => (
                  <div
                    key={img.id}
                    style={{
                      position: "relative",
                      border: "1px solid var(--ink)",
                      width: "90px",
                      height: "90px",
                      background: "#000",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(img.id)}
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        background: "var(--red)",
                        color: "#fff",
                        border: "none",
                        width: "20px",
                        height: "20px",
                        lineHeight: "18px",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: "12px",
                      }}
                      title="Hapus gambar ini"
                    >
                      &times;
                    </button>
                    <span
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: "rgba(0,0,0,0.6)",
                        color: "#fff",
                        fontSize: "9px",
                        textAlign: "center",
                        padding: "1px 0",
                      }}
                    >
                      {Math.round(img.size / 1024)} KB
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                Belum ada gambar yang dilampirkan.
              </p>
            )}
          </div>

          {errorMsg && <div className="note warn" style={{ marginBottom: "12px" }}>{errorMsg}</div>}
          {successMsg && <div className="note" style={{ marginBottom: "12px", background: "rgba(23,43,77,0.05)" }}>{successMsg}</div>}

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button type="submit" className="btn run">
              Simpan Template
            </button>
          </div>
        </form>

        {/* Live Preview */}
        <section style={{ marginTop: "24px", paddingTop: "18px", borderTop: "2px solid var(--ink)" }}>
          <h3 className="mark" style={{ fontSize: "16px", marginBottom: "8px" }}>
            Simulasi Tampilan di Grup (Live Preview):
          </h3>
          <div
            style={{
              border: "1px solid var(--ink)",
              padding: "14px",
              background: "#ffffff",
              maxWidth: "520px",
            }}
          >
            <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "var(--ground)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "14px",
                }}
              >
                FB
              </div>
              <div>
                <strong style={{ fontSize: "14px", display: "block" }}>Akun Facebook Anda</strong>
                <span className="small muted">
                  Diposting ke: <strong>Komunitas Pengusaha Online</strong>
                </span>
              </div>
            </div>

            <div
              style={{
                whiteSpace: "pre-wrap",
                fontSize: "14px",
                lineHeight: 1.45,
                marginBottom: images.length > 0 ? "10px" : 0,
              }}
            >
              {previewText || <span className="muted">[Teks template kosong]</span>}
            </div>

            {images.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: images.length === 1 ? "1fr" : "1fr 1fr",
                  gap: "4px",
                  marginTop: "8px",
                }}
              >
                {images.map((img) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={img.id}
                    src={img.dataUrl}
                    alt="Preview lampiran"
                    style={{ width: "100%", maxHeight: "180px", objectFit: "cover", border: "1px solid var(--line)" }}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

