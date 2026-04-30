// Pin tz so date-bucketing logic runs against the same calendar
// behavior every test sees in CI and on production (Vercel runs UTC).
// Without this, tests that assert "same Chicago day" semantics would
// silently pass on a CT-local dev box and fail under UTC.
process.env.TZ = "UTC";
