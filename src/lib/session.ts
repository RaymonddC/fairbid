import { cookies } from "next/headers";
import { DEMO_USERS, SESSION_COOKIE, type User } from "./auth";
import { SESSION_MAX_AGE_SECONDS, signSession, verifySession } from "./session-token";

export async function getUser(): Promise<User | null> {
  const id = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return DEMO_USERS.find((user) => user.id === id) ?? null;
}

export async function setSession(userId: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    // Not in dev: http://localhost is not https, so a Secure cookie would be refused.
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
