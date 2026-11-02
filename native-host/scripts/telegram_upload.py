import argparse
import asyncio
import json
import os
import sys

try:
    from telethon import TelegramClient
except ImportError:
    print(json.dumps({"ok": False, "error": "Telethon not installed. Run 'uv pip install telethon' or install telethon in Python."}), flush=True)
    sys.exit(2)

def progress_callback(current, total):
    if total > 0:
        percent = round((current / total) * 100, 1)
        print(f"PROGRESS:{current}:{total}:{percent}", flush=True)

async def upload_file(session_path, api_id, api_hash, channel, file_path, caption=""):
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    client = TelegramClient(session_path, int(api_id), str(api_hash))
    await client.connect()

    if not await client.is_user_authorized():
        await client.disconnect()
        raise PermissionError("Telegram session is not authorized. Please log in using telegram-account.ps1 login first.")

    target = channel.strip()
    if target.lower() in ("me", "self", "saved messages"):
        entity = "me"
    elif target.startswith("-"):
        entity = int(target)
    else:
        clean = target.lstrip("@")
        entity = f"@{clean}"

    message = await client.send_file(
        entity,
        file_path,
        caption=caption or None,
        supports_streaming=True,
        progress_callback=progress_callback
    )

    await client.disconnect()

    return {
        "ok": True,
        "messageId": message.id,
        "date": message.date.isoformat() if message.date else None,
        "size": os.path.getsize(file_path)
    }

def main():
    parser = argparse.ArgumentParser(description="ImgVault Telegram MTProto Large File Uploader")
    parser.add_argument("--session", required=True, help="Path to Telethon session base path")
    parser.add_argument("--api-id", required=True, help="Telegram API ID")
    parser.add_argument("--api-hash", required=True, help="Telegram API Hash")
    parser.add_argument("--channel", required=True, help="Target Telegram Channel username or ID")
    parser.add_argument("--file", required=True, help="Path of the file to upload")
    parser.add_argument("--caption", default="", help="Optional caption")

    args = parser.parse_args()

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
