import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Ulasan Tokped",
  description: "Ambil dan baca ulasan produk Tokopedia dari satu dashboard.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
