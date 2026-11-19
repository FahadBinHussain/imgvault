import argparse
import asyncio
import json
import os
import struct
import sys

# Telethon is imported lazily so this module stays importable (and its mp4
# probe testable) on machines without it. main() exits 2 with the same
# JSON error the old import-time check produced.
try:
    from telethon import TelegramClient
    from telethon.tl.types import DocumentAttributeVideo
    TELETHON_AVAILABLE = True
except ImportError:
    TelegramClient = None
    DocumentAttributeVideo = None
    TELETHON_AVAILABLE = False

# MP4-family containers the probe understands. Other video containers
# (.mkv, .webm, ...) have no pure-python header parse here and upload
# without attributes, as before.
MP4_EXTENSIONS = {".mp4", ".m4v", ".mov"}

# A moov box is metadata (usually KBs, rarely a few MB). Anything bigger
# is a corrupt size field, not a real header — refuse to slurp it.
MOOV_MAX_BYTES = 64 * 1024 * 1024


def _read_box_header(f):
    """Read one ISO-BMFF box header at the current offset.

    Returns (size, type, header_len, content_start) or None at EOF.
    size == 1 means a 64-bit largesize follows; size == 0 means the box
    runs to end of file.
    """
    raw = f.read(8)
    if len(raw) < 8:
        return None
    size, typ = struct.unpack(">I4s", raw)
    typ = typ.decode("latin1")
    header_len = 8
    if size == 1:
        raw64 = f.read(8)
        if len(raw64) < 8:
            return None
        (size,) = struct.unpack(">Q", raw64)
        header_len = 16
    return (size, typ, header_len, f.tell())


def _parse_mvhd(content):
    """(timescale, duration) from an mvhd box body, or (0, 0)."""
    if len(content) < 4:
        return (0, 0)
    version = content[0]
    try:
        if version == 1:
            if len(content) < 32:
                return (0, 0)
            timescale, duration = struct.unpack_from(">IQ", content, 20)
        else:
            if len(content) < 20:
                return (0, 0)
            timescale, duration = struct.unpack_from(">II", content, 12)
    except struct.error:
        return (0, 0)
    return (timescale, duration)


def _parse_tkhd(content):
    """(width, height) from a tkhd box body, or (0, 0)."""
    if len(content) < 4:
        return (0, 0)
    version = content[0]
    try:
        if version == 1:
            if len(content) < 96:
                return (0, 0)
            width_raw, height_raw = struct.unpack_from(">II", content, 88)
        else:
            if len(content) < 84:
                return (0, 0)
            width_raw, height_raw = struct.unpack_from(">II", content, 76)
    except struct.error:
        return (0, 0)
    # 16.16 fixed point
    return (width_raw >> 16, height_raw >> 16)


def _parse_moov_children(moov, file_size):
    """Scan a moov box body for mvhd duration + the first video trak.

    Returns (duration_seconds, width, height, saw_trak). A trak counts as
    video when its tkhd has non-zero dimensions — audio traks are 0x0.
    """
    duration = 0
    width = 0
    height = 0
    saw_trak = False
    offset = 0
    end = len(moov)
    while offset + 8 <= end:
        size, typ = struct.unpack_from(">I4s", moov, offset)
        typ = typ.decode("latin1")
        header_len = 8
        if size == 1:
            if offset + 16 > end:
                break
            (size,) = struct.unpack_from(">Q", moov, offset + 8)
            header_len = 16
        if size == 0:
            size = end - offset
        if size < header_len or offset + size > end:
            break
        body = moov[offset + header_len:offset + size]
        if typ == "mvhd":
            timescale, raw_duration = _parse_mvhd(body)
            if timescale:
                duration = int(round(raw_duration / timescale))
        elif typ == "trak":
            saw_trak = True
            if width == 0 or height == 0:
                # find this trak's tkhd
                inner = 0
                while inner + 8 <= len(body):
                    isize, ityp = struct.unpack_from(">I4s", body, inner)
                    ityp = ityp.decode("latin1")
                    iheader = 8
                    if isize == 1:
                        if inner + 16 > len(body):
                            break
                        (isize,) = struct.unpack_from(">Q", body, inner + 8)
                        iheader = 16
                    if isize == 0:
                        isize = len(body) - inner
                    if isize < iheader or inner + isize > len(body):
                        break
                    if ityp == "tkhd":
                        w, h = _parse_tkhd(body[inner + iheader:inner + isize])
                        if w > 0 and h > 0:
                            width, height = w, h
                        break
                    inner += isize
        offset += size
    return (duration, width, height, saw_trak)


def probe_mp4_video(file_path):
    """Read duration + dimensions from an MP4-family file header.

    Pure python, no dependencies: walks the top-level boxes to `moov`
    (before or after `mdat` — non-faststart files put it last), reads
    duration from `mvhd` and dimensions from the first video `trak`'s
    `tkhd`. Only the headers are read; the media data is never touched.

    Returns {"duration": int_seconds, "width": int, "height": int} when a
    video track is found, {"audio_only": True} when the file parses but
    has no video track (an audio-only .mp4), or None when the file is not
    a parseable MP4 (no moov, truncated header, corrupt sizes).
    """
    try:
        file_size = os.path.getsize(file_path)
    except OSError:
        return None
    try:
        with open(file_path, "rb") as f:
            while True:
                header = _read_box_header(f)
                if header is None:
                    return None
                size, typ, header_len, content_start = header
                if size == 0:
                    # box runs to EOF (mdat) — nothing can follow it
                    return None
                content_len = size - header_len
                if content_len < 0 or content_start + content_len > file_size:
                    return None
                if typ == "moov":
                    if content_len > MOOV_MAX_BYTES:
                        return None
                    moov = f.read(content_len)
                    if len(moov) < content_len:
                        return None
                    duration, width, height, saw_trak = _parse_moov_children(moov, file_size)
                    if width > 0 and height > 0:
                        return {"duration": duration, "width": width, "height": height}
                    if saw_trak:
                        return {"audio_only": True}
                    return None
                # any other box (ftyp, mdat, free, ...): skip it by size
                f.seek(content_start + content_len)
    except (OSError, struct.error, ValueError):
        return None


def progress_callback(current, total):
    if total > 0:
        percent = round((current / total) * 100, 1)
        print(f"PROGRESS:{current}:{total}:{percent}", flush=True)


async def upload_file(session_path, api_id, api_hash, channel, file_path, caption=""):
    if not TELETHON_AVAILABLE:
        raise ImportError("Telethon not installed. Run 'uv pip install telethon' or install telethon in Python.")
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    # Video attributes are what make Telegram treat the post as a VIDEO
    # (inline player + telesco.pe CDN URL). Without them send_file posts
    # a plain document even with supports_streaming=True — that flag only
    # has meaning ON a DocumentAttributeVideo, and Telethon cannot guess
    # duration/dimensions on its own. (2.19.23 fix: the 168.9 MB mp4
    # uploaded 2026-11-18 landed as a document for exactly this reason.)
    attributes = None
    warning = None
    video_attributes = False
    _, ext = os.path.splitext(file_path)
    if ext.lower() in MP4_EXTENSIONS:
        probe = probe_mp4_video(file_path)
        if probe and "audio_only" not in probe:
            attributes = [DocumentAttributeVideo(
                duration=int(probe["duration"]),
                w=int(probe["width"]),
                h=int(probe["height"]),
                supports_streaming=True,
            )]
            video_attributes = True
        elif probe and probe.get("audio_only"):
            pass  # audio-only mp4: no video track to describe, no warning
        else:
            warning = (
                f"Could not read video dimensions from {os.path.basename(file_path)} — "
                "Telethon will attach zeroed video attributes (duration 0, 1x1), so "
                "Telegram shows it as a video with unknown duration/size."
            )
            print(f"WARN:{warning}", flush=True)

    clean_api_id = int(str(api_id).strip().lstrip("\ufeff"))
    clean_api_hash = str(api_hash).strip().lstrip("\ufeff")
    client = TelegramClient(session_path, clean_api_id, clean_api_hash)
    await client.connect()

    if not await client.is_user_authorized():
        await client.disconnect()
        raise PermissionError("Telegram session is not authorized. Please log in using telegram-account.ps1 login first.")

    target = channel.strip()
    if target.lower() in ("me", "self", "saved messages"):
        entity = "me"
    elif target.startswith("-"):
        entity = int(target)
    elif target.isdigit():
        # A bare numeric id is a USER id to Telethon, never the channel —
        # channels need the -100 prefix (same rule as the Bot API chat_id).
        entity = int(f"-100{target}")
    else:
        clean = target.lstrip("@")
        entity = f"@{clean}"

    message = await client.send_file(
        entity,
        file_path,
        caption=caption or None,
        supports_streaming=True,
        attributes=attributes,
        progress_callback=progress_callback
    )

    await client.disconnect()

    result = {
        "ok": True,
        "messageId": message.id,
        "date": message.date.isoformat() if message.date else None,
        "size": os.path.getsize(file_path),
        "videoAttributes": video_attributes,
    }
    if warning:
        result["warning"] = warning
    return result


def main():
    parser = argparse.ArgumentParser(description="ImgVault Telegram MTProto Large File Uploader")
    parser.add_argument("--session", required=True, help="Path to Telethon session base path")
    parser.add_argument("--api-id", required=True, help="Telegram API ID")
    parser.add_argument("--api-hash", required=True, help="Telegram API Hash")
    parser.add_argument("--channel", required=True, help="Target Telegram Channel username or ID")
    parser.add_argument("--file", required=True, help="Path of the file to upload")
    parser.add_argument("--caption", default="", help="Optional caption")

    args = parser.parse_args()

    if not TELETHON_AVAILABLE:
        print(json.dumps({"ok": False, "error": "Telethon not installed. Run 'uv pip install telethon' or install telethon in Python."}), flush=True)
        sys.exit(2)

    try:
        result = asyncio.run(upload_file(
            session_path=args.session,
            api_id=args.api_id,
            api_hash=args.api_hash,
            channel=args.channel,
            file_path=args.file,
            caption=args.caption
        ))
        print(f"RESULT:{json.dumps(result)}", flush=True)
    except Exception as e:
        print(f"ERROR:{str(e)}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
