"use server";

import { redirect } from "next/navigation";
import { DEMO_USERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";
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
