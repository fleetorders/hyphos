#!/usr/bin/env sh
# The packed artifact must START under a production-only install. Guards the
# class behind the iconv-lite outage: dist/ requiring a package the tree only
# carries as a dev-marked or nested transitive — a production install does not
# place it on the require path, and the CLI dies on its first import, on every
# command. npm pack runs `prepare` (the build), so this packs what would ship.
set -eu

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "› pack"
npm pack --pack-destination "$WORK" >/dev/null

# --install-strategy=nested is the load-bearing flag: a default (hoisting)
# install can mask an undeclared runtime require — the transitive lands at the
# consumer's top level, on the CLI's require path, and the broken artifact
# passes. Nested strategy places every package under its requirer, so a
# package the CLI requires must be declared by hyphos itself to be resolvable.
echo "› production install of the tarball (nested, no dev deps, no lifecycle scripts)"
mkdir "$WORK/consumer"
(
  cd "$WORK/consumer"
  npm install --omit=dev --ignore-scripts --install-strategy=nested --no-audit --no-fund "$WORK"/hyphos-*.tgz >/dev/null
)

# `rules` (list) is a real, data-free command: it imports the whole CLI — the
# bundled requires run at import, so an undeclared package fails HERE — and
# then exercises enforcement logic, not just the argument parser.
echo "› cli rules from the installed copy"
node "$WORK/consumer/node_modules/hyphos/dist/cli.js" rules >/dev/null && echo "cli ok"
