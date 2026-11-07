"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { DEMO_USERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/lib/password";
import { SELLER_COUNTRIES } from "@/lib/format";
import { safeNext } from "@/lib/safe-next";
import { clearSession, setSession } from "@/lib/session";

export async function signInAction(formData: FormData) {
  const user = DEMO_USERS.find((candidate) => candidate.id === formData.get("userId"));
  if (!user) throw new Error("That demo account does not exist.");
  await setSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export type PasswordSignInState = { error: string | null; email: string };

/** Email and password sign-in. A wrong email and a wrong password get the same answer
 * and take the same time, so the form does not reveal which emails have accounts. */
export async function passwordSignInAction(_prev: PasswordSignInState, formData: FormData): Promise<PasswordSignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  if (!email || !password) return { error: "Enter your email and password.", email };

  const account = await db.account.findUnique({ where: { email } });
  const ok = verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
  if (!account || !ok) return { error: "That email and password do not match an account.", email };

  await setSession(account.id);
  redirect(safeNext(formData.get("next")));
}

export async function signOutAction() {
  await clearSession();
  redirect("/login");
}

export type RegisterState = { error: string | null; field?: "name" | "email" | "password" | "paypalEmail"; values: Record<string, string> };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Creates a buyer or seller account and signs it in. A seller also gets a Seller
 * profile with the PayPal account that receives their payments. */
export async function registerAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const values = { name: get("name"), email: get("email").toLowerCase(), role: get("role"), country: get("country"), paypalEmail: get("paypalEmail").toLowerCase() };
  const password = String(formData.get("password") ?? "");
  const fail = (error: string, field?: RegisterState["field"]): RegisterState => ({ error, field, values });

  if (values.name.length < 2 || values.name.length > 80) return fail("Enter your name or your company's name.", "name");
  if (!EMAIL.test(values.email) || values.email.length > 200) return fail("Enter a valid email address.", "email");
  if (password.length < 8) return fail("Use at least 8 characters for the password.", "password");
  if (password.length > 200) return fail("That password is too long.", "password");
  const role = values.role === "seller" ? "seller" : "buyer";
  if (role === "seller") {
    if (!(SELLER_COUNTRIES as readonly string[]).includes(values.country)) return fail("Choose the country you ship from.");
    if (!EMAIL.test(values.paypalEmail)) return fail("Enter the PayPal email that should receive your payments.", "paypalEmail");
  }
  if (await db.account.findUnique({ where: { email: values.email } })) {
    return fail("An account with this email already exists. Sign in instead.", "email");
  }

  const id = `acct-${randomUUID()}`;
  const sellerId = role === "seller" ? `seller-${randomUUID()}` : null;
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
  await setSession(id);
  redirect("/");
}
