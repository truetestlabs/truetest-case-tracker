import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

/**
 * Get the authenticated user from the request cookies.
 * Returns null if not authenticated.
 *
 * Usage in API routes:
 * ```ts
 * const user = await getAuthUser(request);
 * if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 * ```
 */
export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll() {
            // Can't set cookies in API route handlers via this path —
            // middleware handles cookie refresh.
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Look up or auto-create the app-side User record
    let appUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!appUser) {
      // First login — create the User record from Supabase Auth data
      appUser = await prisma.user.create({
        data: {
          id: user.id,
          email: user.email || "",
          name: user.user_metadata?.name || user.email?.split("@")[0] || "Staff",
          role: "admin", // First user is admin; subsequent users default to "staff"
        },
      });
    } else {
      // Update last login time
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }).catch((e) => console.error("[auth.ts] background fetch failed:", e)); // Non-blocking
    }

    return {
      id: appUser.id,
      email: appUser.email,
      name: appUser.name,
      role: appUser.role,
    };
  } catch {
    return null;
  }
}

/**
 * Shorthand: get user or return 401. Use at the top of protected API routes.
 */
export async function requireAuth(request: NextRequest): Promise<
  { user: AuthUser; response?: never } | { user?: never; response: NextResponse }
> {
  const user = await getAuthUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user };
}
