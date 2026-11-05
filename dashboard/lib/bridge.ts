"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtEvent } from "./types";

export type ExtStatus = "checking" | "connected" | "missing";

export function sendToExtension(msg: Record<string, unknown>) {
  window.postMessage({ source: "tkp-dashboard", ...msg }, window.location.origin);
}

export function useExtension(onEvent: (e: ExtEvent) => void) {
  const [status, setStatus] = useState<ExtStatus>("checking");
  const [version, setVersion] = useState<string | null>(null);
  const lastSeen = useRef(0);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.source !== "tkp-extension") return;
      lastSeen.current = Date.now();
      if (d.type === "PONG") {
        setVersion(d.version);
        setStatus("connected");
        return;
      }
      handler.current(d as ExtEvent);
    };
    window.addEventListener("message", listen);

    const started = Date.now();
    const ping = () => sendToExtension({ type: "PING" });
    ping();
    const pinger = setInterval(ping, 2500);
    const watcher = setInterval(() => {
      const quiet = Date.now() - (lastSeen.current || started);
      if (quiet > 7000) setStatus("missing");
    }, 1000);

    return () => {
      window.removeEventListener("message", listen);
      clearInterval(pinger);
      clearInterval(watcher);
    };
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => sendToExtension(msg), []);
  return { status, version, send };
}
