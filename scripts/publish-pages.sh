#!/usr/bin/env bash
# Publish files to the gh-pages branch and wait until GitHub Pages serves them.
#
#   scripts/publish-pages.sh "<commit message>" <dest>=<src> [<dest>=<src> ...]
#
# Each <dest> on gh-pages (a file or a whole folder) is replaced by <src>, so a
# runtime's folder holds only its current update instead of every bundle ever
# shipped. Everything else on gh-pages is left alone.
#
# GitHub's Pages deploy fails now and then with "Deployment failed, try again
# later"; a failed deploy is requested again instead of leaving the update
# unpublished. Needs GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail

message=$1
shift
repo=${GITHUB_REPOSITORY:?}
work=$(mktemp -d)

git clone --quiet --depth 1 --branch gh-pages \
  "https://x-access-token:${GH_TOKEN:?}@github.com/${repo}.git" "$work"

for pair in "$@"; do
  dest=${pair%%=*}
  src=${pair#*=}
  rm -rf "${work:?}/$dest"
  mkdir -p "$(dirname "$work/$dest")"
  cp -R "$src" "$work/$dest"
done

cd "$work"
git add -A
if git diff --cached --quiet; then
  echo "gh-pages already up to date"
  exit 0
fi
git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit --quiet -m "$message"
since=$(date -u -d '-1 min' +%FT%TZ)
git push --quiet origin gh-pages
sha=$(git rev-parse HEAD)
echo "pushed $sha"

# The newest build of this commit started after $since: a re-requested build
# must not be judged by the failed one before it.
status_of() {
  gh api "repos/${repo}/pages/builds" \
    -q "[.[] | select(.commit == \"$sha\" and .created_at >= \"$since\")][0].status // \"\""
}

for attempt in 1 2 3 4; do
  status=""
  for _ in $(seq 1 90); do
    sleep 10
    status=$(status_of)
    [ "$status" = built ] && { echo "Pages serves $sha"; exit 0; }
    [ "$status" = errored ] && break
  done
  echo "Pages deploy of $sha ${status:-did not start} (attempt $attempt), requesting it again"
  since=$(date -u -d '-30 sec' +%FT%TZ)
  gh api -X POST "repos/${repo}/pages/builds" > /dev/null
done

echo "::error::GitHub Pages never deployed $sha; re-run 'pages build and deployment' from the Actions tab."
exit 1
