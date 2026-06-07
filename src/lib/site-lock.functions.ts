import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const checkUnlocked = createServerFn({ method: "GET" }).handler(async () => {
  const { isUnlockedServer } = await import("./site-lock.server");
  return { unlocked: isUnlockedServer() };
});

export const unlockSite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ password: z.string().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { safeEqual, setUnlockCookie } = await import("./site-lock.server");
    const expected = process.env.SITE_PASSWORD;
    const secret = process.env.SITE_SESSION_SECRET;
    if (!expected || !secret) {
      return { ok: false, error: "Site lock is not configured." };
    }
    if (!safeEqual(data.password, expected)) {
      return { ok: false, error: "Incorrect password." };
    }
    setUnlockCookie();
    return { ok: true, error: null };
  });

export const lockSite = createServerFn({ method: "POST" }).handler(async () => {
  const { clearUnlockCookie } = await import("./site-lock.server");
  clearUnlockCookie();
  return { ok: true };
});
