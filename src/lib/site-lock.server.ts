import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "site_unlock";
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(secret: string): string {
  return createHmac("sha256", secret).update("unlocked").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isUnlockedServer(): boolean {
  const secret = process.env.SITE_SESSION_SECRET;
  if (!secret) return false;
  const cookie = getCookie(COOKIE_NAME);
  if (!cookie) return false;
  return safeEqual(cookie, sign(secret));
}

export function setUnlockCookie(): void {
  const secret = process.env.SITE_SESSION_SECRET;
  if (!secret) return;
  setCookie(COOKIE_NAME, sign(secret), {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function clearUnlockCookie(): void {
  deleteCookie(COOKIE_NAME, { path: "/" });
}
