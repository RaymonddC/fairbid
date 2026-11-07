import { DEMO_USERS } from "@/lib/auth";
import { signInAction } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl font-bold">FairBid</h1>
        <p className="mt-2" style={{ color: "var(--muted)" }}>
          Choose a demo account. Everything here is sample data and PayPal sandbox money.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {DEMO_USERS.map((user) => (
          <form key={user.id} action={signInAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="next" value={next ?? "/"} />
            <button
              type="submit"
              className="w-full rounded-lg border p-4 text-left"
              style={{ background: "var(--surface)", borderColor: "var(--line)" }}
            >
              <span className="block font-semibold">
                {user.name}, {user.role}
              </span>
              <span className="block text-sm" style={{ color: "var(--muted)" }}>
                {user.detail}
              </span>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
