#!/usr/bin/env python3
"""Minimal Telegram helper that prints chat_id on /start.

Usage:
  export TELEGRAM_BOT_TOKEN=123456:ABCDEF
  python3 telegram_get_chat_id.py

Then send /start to your bot in Telegram. The script will print the
private chat_id and reply back in Telegram.

This uses long polling via getUpdates and standard library only.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API_BASE_TEMPLATE = "https://api.telegram.org/bot{token}/{method}"
POLL_TIMEOUT_SECONDS = 30
RETRY_DELAY_SECONDS = 3


def telegram_api(token: str, method: str, data: dict | None = None) -> dict:
    url = API_BASE_TEMPLATE.format(token=token, method=method)
    payload = None
    headers = {}

    if data is not None:
        payload = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=payload, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(request, timeout=POLL_TIMEOUT_SECONDS + 10) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Telegram API HTTP error {exc.code}: {error_body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Telegram API connection error: {exc}") from exc

    parsed = json.loads(body)
    if not parsed.get("ok"):
        raise RuntimeError(f"Telegram API returned error: {parsed}")
    return parsed["result"]


def send_message(token: str, chat_id: int, text: str) -> None:
    telegram_api(
        token,
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": text,
        },
    )


def main() -> int:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        print("ERROR: TELEGRAM_BOT_TOKEN is not set", file=sys.stderr)
        return 1

    print("Bot is polling. Send /start to the bot in Telegram.")
    print("Press Ctrl+C to stop.")

    offset: int | None = None

    while True:
        request_data = {
            "timeout": POLL_TIMEOUT_SECONDS,
            "allowed_updates": ["message"],
        }
        if offset is not None:
            request_data["offset"] = offset

        try:
            updates = telegram_api(token, "getUpdates", request_data)
        except KeyboardInterrupt:
            print("\nStopped.")
            return 0
        except Exception as exc:
            print(f"Polling error: {exc}", file=sys.stderr)
            time.sleep(RETRY_DELAY_SECONDS)
            continue

        for update in updates:
            offset = update["update_id"] + 1

            message = update.get("message")
            if not message:
                continue

            text = message.get("text", "")
            chat = message.get("chat", {})
            chat_id = chat.get("id")
            username = message.get("from", {}).get("username") or "<no username>"

            if text.strip() == "/start" and chat_id is not None:
                print(f"Received /start from username={username}, chat_id={chat_id}")
                send_message(token, chat_id, f"Your chat_id is: {chat_id}")


if __name__ == "__main__":
    sys.exit(main())
