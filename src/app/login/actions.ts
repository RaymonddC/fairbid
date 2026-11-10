"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { log } from "@/lib/log";
import { createLimiter } from "@/lib/rate-limit";
import { DEMO_USERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/lib/password";
import { SELLER_COUNTRIES } from "@/lib/format";
import { safeNext } from "@/lib/safe-next";
import { clearSession, setSession } from "@/lib/session";

const FIFTEEN_MINUTES = 15 * 60_000;
const signInByEmail = createLimiter(8, FIFTEEN_MINUTES);
const signInByIp = createLimiter(30, FIFTEEN_MINUTES);
const registerByIp = createLimiter(10, 60 * 60_000);

/** The caller's address. Google's front end appends the real client address to any
 * X-Forwarded-For the client sent, so the last entry is the one a client cannot forge.
 * The per-email limit is the real guard; this one only slows a single address. */
async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",").at(-1)?.trim() || "unknown";
}

export async function signInAction(formData: FormData) {
  const user = DEMO_USERS.find((candidate) => candidate.id === formData.get("userId"));
  if (!user) throw new Error("That demo account does not exist.");
  await setSession(user.id);
  redirect(safeNext(formData.get("next")));
}

/** `field` names the one field to mark when only that one is missing; otherwise both are marked. */
export type PasswordSignInState = { error: string | null; email: string; field?: "email" | "password" };

/** Email and password sign-in. A wrong email and a wrong password get the same answer
 * and take the same time, so the form does not reveal which emails have accounts. */
export async function passwordSignInAction(_prev: PasswordSignInState, formData: FormData): Promise<PasswordSignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  if (!email && !password) return { error: "Enter your email and password.", email };
  if (!email) return { error: "Enter your email.", email, field: "email" };
  if (!password) return { error: "Enter your password.", email, field: "password" };

  // Limits guessing per account and per address. The same answer either way, so it
  // reveals nothing about which emails exist.
  const ip = await clientIp();
  if (!signInByEmail.hit(email) || !signInByIp.hit(ip)) {
    log.warn("sign-in rate limited", { ip });
    return { error: "Too many attempts. Wait 15 minutes, then try again.", email };
  }

  const account = await db.account.findUnique({ where: { email } });
  const ok = verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
  if (!account || !ok) return { error: "That email and password do not match an account.", email };

  signInByEmail.reset(email);
  await setSession(account.id);
  redirect(safeNext(formData.get("next")));
}

export async function signOutAction() {
  await clearSession();
  redirect("/login");
}

export type RegisterField = "name" | "email" | "password" | "country" | "paypalEmail";

/** `error` is for the form as a whole; `errors` holds every field's problem at once, shown under that field. */
export type RegisterState = { error: string | null; errors?: Partial<Record<RegisterField, string>>; values: Record<string, string> };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Creates a buyer or seller account and signs it in. A seller also gets a Seller
 * profile with the PayPal account that receives their payments. */
export async function registerAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const values = { name: get("name"), email: get("email").toLowerCase(), role: get("role"), country: get("country"), paypalEmail: get("paypalEmail").toLowerCase() };
  const password = String(formData.get("password") ?? "");
  const fail = (error: string | null, errors?: RegisterState["errors"]): RegisterState => ({ error, errors, values });

  if (!registerByIp.hit(await clientIp())) return fail("Too many new accounts from here. Try again in an hour.");
  const role = values.role === "seller" ? "seller" : "buyer";

  // Every field is checked at once, so one try shows everything that needs fixing.
  const errors: Partial<Record<RegisterField, string>> = {};
  if (values.name.length < 2 || values.name.length > 80) {
    errors.name = role === "seller" ? "Enter your name or your workshop's name." : "Enter your name or your company's name.";
  }
  if (!EMAIL.test(values.email) || values.email.length > 200) errors.email = "Enter a valid email address.";
  if (password.length < 8) errors.password = "Use at least 8 characters.";
  else if (password.length > 200) errors.password = "That password is too long.";
  if (role === "seller") {
    if (!(SELLER_COUNTRIES as readonly string[]).includes(values.country)) errors.country = "Choose the country you ship from.";
    if (!EMAIL.test(values.paypalEmail)) errors.paypalEmail = "Enter the PayPal email that should receive your payments.";
  }
  if (Object.keys(errors).length > 0) return fail(null, errors);

  if (await db.account.findUnique({ where: { email: values.email } })) {
    return fail(null, { email: "An account with this email already exists. Sign in instead." });
  }

  const id = `acct-${randomUUID()}`;
  const sellerId = role === "seller" ? `seller-${randomUUID()}` : null;
  try {
    await db.$transaction(async (tx) => {
      if (sellerId) {
        await tx.seller.create({ data: { id: sellerId, name: values.name, country: values.country, paypalEmail: values.paypalEmail } });
      }
      await tx.account.create({
        data: {
          id,
          email: values.email,
          name: values.name,
          role,
          sellerId,
          detail: role === "seller" ? "Seller" : "Buyer",
          passwordHash: hashPassword(password),
        },
      });
    });
  } catch (error) {
    // Two sign-ups with the same email at once: the second gets the same answer as above.
    if ((error as { code?: unknown })?.code === "P2002") return fail(null, { email: "An account with this email already exists. Sign in instead." });
    throw error;
  }
  await setSession(id);
  redirect("/");
}
