import { redirect } from "next/navigation";

/**
 * Legacy entry point — the donor portal lives at /portal now. Keep this
 * route as a permanent redirect so old bookmarks, printed instructions,
 * and any lingering links continue to work.
 */
export default function CheckInRedirect() {
  redirect("/portal");
}
