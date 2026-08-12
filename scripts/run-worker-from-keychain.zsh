#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
repository_root="${script_directory:h}"

if [[ ! -f "${repository_root}/package.json" ]]; then
  print -u2 "Unable to locate repository root."
  exit 1
fi

cd "${repository_root}"

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  print -u2 "Refusing to start the Worker from a dirty worktree because its code would not match the persisted application commit."
  exit 1
fi

if ! application_commit="$(git rev-parse --verify HEAD 2>/dev/null)"; then
  print -u2 "Unable to resolve the current Git commit for Worker execution identity."
  exit 1
fi
export APPLICATION_COMMIT="$application_commit"

read_keychain_secret() {
  local service_name="$1"
  local secret_value

  if ! secret_value="$(security find-generic-password -a "$USER" -s "$service_name" -w)"; then
    print -u2 "Required Keychain service unavailable: ${service_name}"
    return 1
  fi

  if [[ -z "$secret_value" ]]; then
    print -u2 "Required Keychain service is empty: ${service_name}"
    return 1
  fi

  REPLY="$secret_value"
}

read_keychain_secret "vsee-supabase-url"
export SUPABASE_URL="$REPLY"
read_keychain_secret "vsee-supabase-service-role-key"
export SUPABASE_SERVICE_ROLE_KEY="$REPLY"
read_keychain_secret "vsee-anthropic-api-key"
export ANTHROPIC_API_KEY="$REPLY"
read_keychain_secret "vsee-xtrace-api-key"
export XTRACE_API_KEY="$REPLY"
read_keychain_secret "vsee-document-url-signing-secret"
export DOCUMENT_URL_SIGNING_SECRET="$REPLY"

export VSEE_DEPLOYMENT_MODE="public_sandbox"
export DEMO_WORKSPACE_ID="workspace_demo"
export SUPABASE_STORAGE_BUCKET="vsee-demo-sources"
export ANTHROPIC_MODEL="claude-opus-4-8"
export XTRACE_API_BASE_URL="https://api.production.xtrace.ai"
export XTRACE_APP_ID="xtrace-vc-deal-intelligence-public-sandbox"
export MARKET_USER_AGENT="VSee VC Intelligence public-sandbox"
export MARKET_OFFICIAL_FEEDS_JSON='[{"id":"sequoia-official","name":"Sequoia Capital official insights","url":"https://www.sequoiacap.com/feed/","publisher":"Sequoia Capital","eventType":"funding","confidence":"medium"},{"id":"lsvp-official","name":"Lightspeed Venture Partners insights","url":"https://lsvp.com/feed/","publisher":"Lightspeed Venture Partners","eventType":"funding","confidence":"medium"}]'
export MARKET_PUBLISHER_FEEDS_JSON='[{"id":"a16z-news","name":"a16z News","url":"https://www.a16z.news/feed","publisher":"Andreessen Horowitz","eventType":"trend","confidence":"medium"},{"id":"marijuana-moment","name":"Marijuana Moment policy news","url":"https://www.marijuanamoment.net/feed","publisher":"Marijuana Moment","eventType":"regulatory","confidence":"medium"},{"id":"fierce-healthcare","name":"Fierce Healthcare news","url":"https://www.fiercehealthcare.com/rss/xml","publisher":"Fierce Healthcare","eventType":"commercial","confidence":"medium"},{"id":"supply-chain-dive","name":"Supply Chain Dive news","url":"https://www.supplychaindive.com/feeds/news/","publisher":"Supply Chain Dive","eventType":"commercial","confidence":"medium"},{"id":"retail-dive","name":"Retail Dive news","url":"https://www.retaildive.com/feeds/news/","publisher":"Retail Dive","eventType":"commercial","confidence":"medium"}]'

runtime_directory="${repository_root}/.runtime"
mkdir -p "$runtime_directory"
exec npm run worker >>"${runtime_directory}/worker.log" 2>&1
