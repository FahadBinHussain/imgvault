"""ImgVault Telegram MTProto file downloader.

Downloads a byte range of one channel message's file through the user's
Telethon session. This is the ONLY reader for a vault blob the Bot API
can never serve: a Telethon-uploaded file has no Bot API file_id at all
(the extension stores `native-<messageId>`), and even a Bot API file_id
for a >20 MB file cannot be read back (getFile answers 400 "file is
too big"). The vault stream reads its 8 MiB encrypted chunks through
this script, one native-host call per range.

Protocol (same line shapes as telegram_upload.py, read by the Rust host):
  DATA:<base64 of <=512 KiB of file bytes>   (one line per chunk)
  RESULT:{"ok": true, "messageId": 589, "offset": 0, "length": 1234, "size": 30361257}
  ERROR:<message>

Length 0 means "to end of file". The Rust host forwards each DATA line
to the extension as its own native message, so no message exceeds
Chrome's 1 MiB native-message cap (512 KiB -> ~700 KiB of base64).

Exit codes: 0 on RESULT, 1 on ERROR, 2 when Telethon is not installed.
"""

import argparse
import asyncio
import base64
import json
import sqlite3
import sys

# Telethon is imported lazily so this module stays importable (and its
# pure helpers testable) on machines without it — same pattern as
# telegram_verify.py.
try:
    from telethon import TelegramClient
    TELETHON_AVAILABLE = True
except ImportError:
    TelegramClient = None
    TELETHON_AVAILABLE = False

# 512 KiB of bytes -> ~700 KiB of base64 on the wire, under Chrome's
# 1 MiB native-message cap (the same chunk the staging writer uses).
CHUNK_BYTES = 512 * 1024

# Two clients on one Telethon session file can hit sqlite locks; a
# download is read-only, so retry a locked database a few times
# instead of failing the read for a transient lock.
LOCK_RETRIES = 3
LOCK_RETRY_DELAY_SECONDS = 2


def resolve_channel_entity(channel):
    """Map a stored channel value to the Telethon entity.

    Same rule as telegram_verify.py and the Bot API chat_id: a bare
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
    (or `media.document`) carrying `size` and `attributes` works.
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


def resolve_range(offset, length, size):
    """Clamp a requested (offset, length) to a file of `size` bytes.

    Pure function. Length 0 means "to end of file". Raises ValueError
    on a negative offset/length or an offset past the end of the file;
    a length running past EOF is clamped, never an error.
    """
    offset = int(offset)
    length = int(length)
    size = int(size)
    if offset < 0:
        raise ValueError(f"offset {offset} is negative")
    if length < 0:
        raise ValueError(f"length {length} is negative")
    if offset > size:
        raise ValueError(f"offset {offset} is past the end of the file ({size} bytes)")
    if length == 0:
        length = size - offset
    else:
        length = min(length, size - offset)
    return offset, length


def _is_locked_database_error(exc):
    if isinstance(exc, sqlite3.OperationalError):
        return "locked" in str(exc).lower()
    return "database is locked" in str(exc).lower()


async def download_range(client, entity, message_id, offset, length, emit):
    """Download bytes [offset, offset+length) of one channel message.

    Length 0 means "to end of file". Each 512 KiB chunk goes out as one
    `DATA:<base64>` line through `emit`. Returns
    {"messageId", "offset", "length", "size"} with the ACTUAL byte
    count served. Raises LookupError (no such message), ValueError (no
    document / bad range) or IOError (short download — the stream
    ended before the requested bytes arrived).
    """
    messages = await client.get_messages(entity, ids=[int(message_id)])
    message = messages[0] if messages else None
    if message is None:
        raise LookupError(f"Message {message_id} not found in channel.")
    info = extract_document_info(message)
    if info is None:
        raise ValueError(f"Message {message_id} carries no document.")
    off, total = resolve_range(offset, length, info["size"])
    remaining = total
    # iter_download takes limit itself, but the manual trim below is the
    # real guard — it holds on any Telethon version, limit or not.
    async for chunk in client.iter_download(
        message.media,
        offset=off,
        chunk_size=CHUNK_BYTES,
        limit=total if total > 0 else None,
        file_size=info["size"],
    ):
        if remaining <= 0:
            break
        if len(chunk) > remaining:
            chunk = chunk[:remaining]
        emit(f"DATA:{base64.b64encode(chunk).decode('ascii')}")
        remaining -= len(chunk)
    got = total - remaining
    if got != total:
        raise IOError(f"short download: got {got} of {total} bytes")
    return {"messageId": int(message_id), "offset": off, "length": got, "size": info["size"]}


async def download_message(session_path, api_id, api_hash, channel, message_id, offset, length, emit):
    """Build the Telethon client (sqlite-lock retries) and download.

    Returns {"ok": True, "messageId", "offset", "length", "size"}.
    Raises on session/auth/connection failures and on download errors
    (the CLI turns those into one ERROR line).
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
            result = await download_range(client, entity, message_id, offset, length, emit)
            return {"ok": True, **result}
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
    parser = argparse.ArgumentParser(description="ImgVault Telegram MTProto File Downloader")
    parser.add_argument("--session", required=True, help="Path to Telethon session base path")
    parser.add_argument("--api-id", required=True, help="Telegram API ID")
    parser.add_argument("--api-hash", required=True, help="Telegram API Hash")
    parser.add_argument("--channel", required=True, help="Telegram Channel username or ID")
    parser.add_argument("--message-id", required=True, type=int, help="Channel message id to download from")
    parser.add_argument("--offset", required=False, type=int, default=0, help="First byte to download (default 0)")
    parser.add_argument("--length", required=False, type=int, default=0, help="Bytes to download (default 0 = to end of file)")

    args = parser.parse_args()

    if not TELETHON_AVAILABLE:
        print("ERROR:Telethon not installed. Run 'uv pip install telethon' or install telethon in Python.", flush=True)
        sys.exit(2)

    def emit(line):
        print(line, flush=True)

    try:
        result = asyncio.run(download_message(
            session_path=args.session,
            api_id=args.api_id,
            api_hash=args.api_hash,
            channel=args.channel,
            message_id=args.message_id,
            offset=args.offset,
            length=args.length,
            emit=emit,
        ))
        print(f"RESULT:{json.dumps(result)}", flush=True)
    except Exception as e:  # noqa: BLE001 — the CLI reports every failure as one ERROR line
        print(f"ERROR:{str(e)}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
