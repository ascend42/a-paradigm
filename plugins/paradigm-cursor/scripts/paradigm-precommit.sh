#!/bin/sh
# Paradigm Cursor Pre-Commit Hook — retired (kept as a no-op).
# It used to rebuild the index on `git commit` and `git add` scan-index.json,
# navigator.yaml and flow-index.json. Those files carry a generatedAt stamp, so
# every commit picked up an index diff. They are now gitignored generated state
# (#session-markers-gitignore): the MCP server serves a live index and
# rebuilds the files.
# The file stays because existing .cursor/hooks.json entries call it.
# Installed by: paradigm hooks install --cursor
#
# Hook type: beforeShellExecution (matcher: "git commit")
# Exit 0 = allow (never blocks), never stages anything.

cat >/dev/null 2>&1
exit 0
