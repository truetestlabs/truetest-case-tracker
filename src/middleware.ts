import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js middleware — runs before every request.
 *
 * Checks for a valid Supabase Auth session. If no session and the
 * route is protected, redirects to /login. Public routes (kiosk,
 * intake, checkin, public API) pass through without auth.
 *
 * Also refreshes the auth session cookie on every request so it
 * stays alive while the user is active.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — no auth required
  const publicPaths = [
    "/login",
    "/kiosk",
    "/intake",
    "/checkin",
    "/api/kiosk",
    "/api/checkin",
    "/api/public",
    "/api/test-catalog",
  ];

  // Check if this path is public
  const isPublic = publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // Static assets and Next.js internals — always pass through
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".webmanifest") ||
    pathname.endsWith(".json") && pathname.startsWith("/manifest")
  ) {
    return NextResponse.next();
  }

  // Create a response that we can modify (to set refreshed cookies)
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Update the request cookies (for downstream handlers)
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          // Update the response cookies (sent back to browser)
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh the session — this keeps the cookie alive
  const { data: { user } } = await supabase.auth.getUser();

  // Public routes pass through regardless of auth status
  if (isPublic) {
    return response;
  }

  // Protected route — redirect to login if no session
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the intended destination so we can redirect back after login
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files
    "/((?!_next/static|_next/image).*)",
  ],
};
