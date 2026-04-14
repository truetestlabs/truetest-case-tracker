import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

/**
 * Next.js middleware — runs before every request.
 *
 * Checks for a valid Supabase Auth session. If no session and the
 * route is protected, redirects to /login. Public routes (kiosk,
 * intake, checkin, public API) pass through without auth.
 *
 * Also rate-limits public API routes (anything reachable without auth)
 * to brake drive-by abuse and runaway client loops, and refreshes the
 * auth session cookie on every request so it stays alive.
 */

// Public routes that get an IP-based rate limit (60 req / minute / IP).
// We deliberately limit only API routes, not the public HTML pages — page
// hits go through Vercel's CDN and shouldn't be throttled.
const PUBLIC_API_PREFIXES = ["/api/public", "/api/kiosk", "/api/checkin"];

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

  // Rate-limit public API routes BEFORE the auth check — auth is irrelevant
  // for these and we don't want to burn the Supabase getUser() call on flood
  // traffic. 60 req/min/IP is generous for the kiosk/intake flows and tight
  // enough to brake any real abuse.
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    const ip = getClientIp(request.headers);
    const rl = rateLimit(`mw:${pathname}:${ip}`, 60, 60_000);
    if (!rl.ok) {
      return new NextResponse(
        JSON.stringify({ error: "Too many requests" }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        }
      );
    }
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
