"use client";
import { useState } from "react";

type Props = {
  ready: boolean;
  running: boolean;
  error: string | null;
  onStart: (url: string, pages: number, delaySec: number) => void;
  onStop: () => void;
};

export default function Capture({ ready, running, error, onStart, onStop }: Props) {
  const [url, setUrl] = useState("");
  const [pages, setPages] = useState(10);
  const [delay, setDelay] = useState(1.2);

  return (
    <form
      className="capture"
      onSubmit={(e) => {
        e.preventDefault();
        if (!running) onStart(url, pages, delay);
      }}
    >
      <div className="sentence">
        <label htmlFor="url">Ambil ulasan dari</label>
        <input
          id="url"
          className="fill url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="tokopedia.com/nama-toko/nama-produk"
          value={url}
          disabled={running}
          onChange={(e) => setUrl(e.target.value)}
        />
        <label htmlFor="pages">sebanyak</label>
        <input
          id="pages"
          className="fill num"
          type="number"
          min={1}
          max={200}
          value={pages}
          disabled={running}
          onChange={(e) => setPages(Number(e.target.value))}
        />
        <label htmlFor="delay">halaman dengan jeda</label>
        <input
          id="delay"
          className="fill num"
          type="number"
          min={0.5}
          max={10}
          step={0.1}
          value={delay}
          disabled={running}
          onChange={(e) => setDelay(Number(e.target.value))}
        />
        <span>detik.</span>
        {running ? (
          <button type="button" className="btn danger" onClick={onStop}>
            Hentikan
          </button>
        ) : (
          <button type="submit" className="btn solid" disabled={!ready}>
            Mulai ambil
          </button>
        )}
      </div>
      {!ready && !running && <p className="hint">Tombol aktif setelah extension terhubung.</p>}
      {error && (
        <p className="err-line" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
