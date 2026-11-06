import type { ExtStatus } from "@/lib/bridge";

// Tambah menu baru cukup dengan menambah satu baris di sini.
export const MENUS = [
  { id: "ambil", label: "Ambil reviews" },
  { id: "lead", label: "Lead maps" },
] as const;
export type MenuId = (typeof MENUS)[number]["id"];

type Props = {
  menu: MenuId;
  onMenu: (id: MenuId) => void;
  status: ExtStatus;
  version: string | null;
};

export default function Sidebar({ menu, onMenu, status, version }: Props) {
  const text =
    status === "connected"
      ? `Extension terhubung, versi ${version}`
      : status === "checking"
        ? "Memeriksa extension"
        : "Extension belum terhubung";

  return (
    <aside className="side">
      <span className="mark">Ulasan Tokped</span>

      <nav aria-label="Menu utama">
        <ul className="nav">
          {MENUS.map((m) => (
            <li key={m.id}>
              <button type="button" aria-current={m.id === menu ? "page" : undefined} onClick={() => onMenu(m.id)}>
                <i className="tick" aria-hidden="true" />
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <span className={`conn ${status}`} role="status">
        <i className="sq" aria-hidden="true" />
        {text}
      </span>
    </aside>
  );
}
