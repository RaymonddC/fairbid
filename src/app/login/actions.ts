"use server";

import { redirect } from "next/navigation";
import { DEMO_USERS } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";
import { clearSession, setSession } from "@/lib/session";

export async function signInAction(formData: FormData) {
  const user = DEMO_USERS.find((candidate) => candidate.id === formData.get("userId"));
  if (!user) throw new Error("That demo account does not exist.");
  await setSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function signOutAction() {
  await clearSession();
  redirect("/login");
}
