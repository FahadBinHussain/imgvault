"""ImgVault Telegram MTProto file verifier.

Reads one channel message by id through the user's Telethon session and
reports the attached file's real size + name. This is the ONLY reader
that can see a file the Bot API getFile gate refuses (> 20 MB): getFile
answers 400 "file is too big" for the 30 MB ceramic spz, which proves
nothing about the file — Telethon reads the post itself and the caller
compares the size against the stored size (exact match = found).

Protocol (same line shapes as telegram_upload.py, read by the Rust host):
  RESULT:{"ok": true, "messageId": 589, "size": 30361257, "name": "..."}
  ERROR:<message>

Exit codes: 0 on RESULT, 1 on ERROR, 2 when Telethon is not installed.
"""

import argparse
import asyncio
import json
import os
import sqlite3
import sys

# Telethon is imported lazily so this module stays importable (and its
# pure helpers testable) on machines without it — same pattern as
# telegram_upload.py.
try:
    from telethon import TelegramClient
    TELETHON_AVAILABLE = True
except ImportError:
    TelegramClient = None
    TELETHON_AVAILABLE = False

# Two clients on one Telethon session file can hit sqlite locks; a
# verify is read-only and cheap, so retry a locked database a few times
# instead of failing the check for a transient lock.
LOCK_RETRIES = 3
LOCK_RETRY_DELAY_SECONDS = 2


def resolve_channel_entity(channel):
    """Map a stored channel value to the Telethon entity.

    Same rule as telegram_upload.py and the Bot API chat_id: a bare
    numeric id is a USER id to Telethon, never the channel — channels
    need the -100 prefix.
    """
    target = channel.strip()
    if target.lower() in ("me", "self", "saved messages"):
        return "me"
    if target.startswith("-"):
        return int(target)
    if target.isdigit():
        return int(f"-100{target}")
    return f"@{target.lstrip('@')}"


def extract_document_info(message):
    """(size, name) of the file attached to a Telethon message, or None.

    Pure function — duck-typed on purpose (no Telethon import) so it
    stays testable without the library: any object with a `document`
    (or `media.document`) carrying `size` and `attributes` works. The
    file name comes from the attribute carrying `file_name`
    (DocumentAttributeFilename); a document without one still reports
    its size with name None.
    """
    if message is None:
        return None
    doc = getattr(message, "document", None)
    if doc is None:
        media = getattr(message, "media", None)
        doc = getattr(media, "document", None)
    if doc is None:
        return None
    size = getattr(doc, "size", None)
    if size is None:
        return None
    name = None
    for attr in getattr(doc, "attributes", []) or []:
        file_name = getattr(attr, "file_name", None)
        if file_name:
            name = file_name
            break
    return {"size": int(size), "name": name}


def _is_locked_database_error(exc):
    if isinstance(exc, sqlite3.OperationalError):
        return "locked" in str(exc).lower()
    return "database is locked" in str(exc).lower()


async def verify_message(session_path, api_id, api_hash, channel, message_id):
    """Read one channel message and return its file facts.

    Returns {"ok": True, "messageId", "size", "name"} on success, or
    {"ok": False, "error", "code"} where code is "not_found" (no such
    message in the channel) or "no_document" (the message exists but
    carries no file). Raises on session/auth/connection failures.
    """
    if not TELETHON_AVAILABLE:
        raise ImportError("Telethon not installed. Run 'uv pip install telethon' or install telethon in Python.")

    clean_api_id = int(str(api_id).strip().lstrip("\ufeff"))
    clean_api_hash = str(api_hash).strip().lstrip("\ufeff")
    entity = resolve_channel_entity(channel)

    last_error = None
    for attempt in range(LOCK_RETRIES):
        client = TelegramClient(session_path, clean_api_id, clean_api_hash)
        try:
            await client.connect()
            if not await client.is_user_authorized():
                raise PermissionError(
                    "Telegram session is not authorized. Please log in using telegram-account.ps1 login first."
                )
            messages = await client.get_messages(entity, ids=[int(message_id)])
            message = messages[0] if messages else None
            if message is None:
                return {"ok": False, "code": "not_found",
                        "error": f"Message {message_id} not found in channel {channel}."}
            info = extract_document_info(message)
            if info is None:
                return {"ok": False, "code": "no_document",
                        "error": f"Message {message_id} carries no document."}
            return {"ok": True, "messageId": int(message_id),
                    "size": info["size"], "name": info["name"]}
        except Exception as exc:  # noqa: BLE001 — retried or reported, never swallowed silently
            last_error = exc
            if _is_locked_database_error(exc) and attempt + 1 < LOCK_RETRIES:
                await asyncio.sleep(LOCK_RETRY_DELAY_SECONDS)
                continue
            raise
        finally:
            await client.disconnect()
    raise last_error


def main():
    parser = argparse.ArgumentParser(description="ImgVault Telegram MTProto File Verifier")
    parser.add_argument("--session", required=True, help="Path to Telethon session base path")
    parser.add_argument("--api-id", required=True, help="Telegram API ID")
    parser.add_argument("--api-hash", required=True, help="Telegram API Hash")
    parser.add_argument("--channel", required=True, help="Telegram Channel username or ID")
    parser.add_argument("--message-id", required=True, type=int, help="Channel message id to verify")

    args = parser.parse_args()

    if not TELETHON_AVAILABLE:
        print("ERROR:Telethon not installed. Run 'uv pip install telethon' or install telethon in Python.", flush=True)
        sys.exit(2)

    try:
        result = asyncio.run(verify_message(
            session_path=args.session,
            api_id=args.api_id,
            api_hash=args.api_hash,
            channel=args.channel,
            message_id=args.message_id,
        ))
        if result.get("ok"):
            print(f"RESULT:{json.dumps(result)}", flush=True)
        else:
            print(f"ERROR:{result.get('error')}", flush=True)
            sys.exit(1)
    except Exception as e:  # noqa: BLE001 — the CLI reports every failure as one ERROR line
        print(f"ERROR:{str(e)}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
