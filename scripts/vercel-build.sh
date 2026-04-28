#!/usr/bin/env bash
# Vercel build entrypoint. Schema sync runs ONLY on production deploys.
# DO NOT add --accept-data-loss to `prisma db push` — destructive drift
# must fail the build, not silently rewrite prod.
set -euo pipefail

echo "[vercel-build] VERCEL_ENV=${VERCEL_ENV:-unset} VERCEL_GIT_COMMIT_REF=${VERCEL_GIT_COMMIT_REF:-unset}"

echo "[vercel-build] prisma generate"
npx prisma generate

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "[vercel-build] production deploy → prisma db push"
  npx prisma db push --skip-generate
else
  echo "[vercel-build] non-production deploy (${VERCEL_ENV:-unset}) → skipping prisma db push"
fi

echo "[vercel-build] next build"
npx next build
