# pptalk dev shortcuts. Each target opens a NEW Terminal window so the server
# stays out of your current shell — close the window to stop.
#
#   make web      # Next.js dev server on :3000
#   make worker   # Python pipeline worker (DB poller)
#   make dev      # both, in two windows

ROOT := $(shell pwd)

.PHONY: web worker dev

web:
	@osascript -e 'tell application "Terminal" to do script "cd $(ROOT)/web && npm run dev"'

worker:
	@osascript -e 'tell application "Terminal" to do script "cd $(ROOT)/pipeline && uv run narrator worker"'

dev: web worker
