"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtEvent } from "./types";

export type ExtStatus = "checking" | "connected" | "missing";

let currentBridgeUserId: string | null = null;

export function setBridgeUser(userId: string | null) {
  currentBridgeUserId = userId;
}

export function notifyExtensionLogout(userId?: string) {
  sendToExtension({ type: "AUTH_LOGOUT", userId: userId || currentBridgeUserId });
}

export function sendToExtension(msg: Record<string, unknown>) {
  const payload = currentBridgeUserId ? { userId: currentBridgeUserId, ...msg } : msg;
  window.postMessage({ source: "tkp-dashboard", ...payload }, window.location.origin);
}

// Berapa lama tanpa balasan (saat tab terlihat) sebelum dianggap terputus.
const SILENT_LIMIT_MS = 10000;

export function useExtension(onEvent: (e: ExtEvent) => void) {
  const [status, setStatus] = useState<ExtStatus>("checking");
  const [version, setVersion] = useState<string | null>(null);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const started = Date.now();
    let lastSeen = 0; // terakhir ada pesan apa pun dari extension
    let visibleSince = started; // terakhir tab ini kembali terlihat

    const listen = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.source !== "tkp-extension") return;

      // Isolasi event extension: bila event membawa userId dan berbeda dari user aktif, abaikan
      if (d.userId && currentBridgeUserId && d.userId !== currentBridgeUserId) {
        return;
      }

      lastSeen = Date.now();
      if (d.type === "PONG") {
        setVersion(d.version);
        setStatus("connected");
        return;
      }
      handler.current(d as ExtEvent);
    };
    window.addEventListener("message", listen);

    const ping = () => sendToExtension({ type: "PING" });

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        visibleSince = Date.now();
        ping();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    ping();
    const pinger = setInterval(ping, 2500);
    const watcher = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const quiet = Date.now() - Math.max(lastSeen, visibleSince, started);
      if (quiet > SILENT_LIMIT_MS) setStatus("missing");
    }, 1000);

    return () => {
      window.removeEventListener("message", listen);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(pinger);
      clearInterval(watcher);
    };
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => sendToExtension(msg), []);
  return { status, version, send };
}
