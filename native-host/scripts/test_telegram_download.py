"""Tests for telegram_download.py.

No Telethon, no network: range resolution and document extraction are
pure, and download_range runs against a fake client whose iter_download
yields slices of a known byte string.
Run from this directory:  python -m unittest -v test_telegram_download
"""

import asyncio
import base64
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import telegram_download
from telegram_download import (
    download_range,
    extract_document_info,
    resolve_channel_entity,
    resolve_range,
)


class FakeAttr:
    def __init__(self, file_name=None):
        if file_name is not None:
            self.file_name = file_name


class FakeDoc:
    def __init__(self, size, attributes=None):
        self.size = size
        self.attributes = attributes if attributes is not None else []


class FakeMedia:
    def __init__(self, document=None):
        self.document = document


class FakeMessage:
    def __init__(self, document=None, media=None):
        self.document = document
        self.media = media


class FakeClient:
    """A Telethon stand-in serving one fixed byte string."""

    def __init__(self, data, message=None, short_by=0):
        self.data = data
        self.message = message
        self.short_by = short_by
        self.seen = {}

    async def get_messages(self, entity, ids=None):
        self.seen["entity"] = entity
        self.seen["ids"] = ids
        return [self.message] if self.message is not None else [None]

    async def iter_download(self, media, offset=0, chunk_size=None, limit=None, file_size=None):
        self.seen["offset"] = offset
        self.seen["limit"] = limit
        self.seen["chunk_size"] = chunk_size
        end = len(self.data) if limit is None else min(len(self.data), offset + limit)
        end -= self.short_by
        step = chunk_size or 1024
        pos = offset
        while pos < end:
            yield self.data[pos:min(pos + step, end)]
            pos += step


def make_message(size, name="blob.bin"):
    return FakeMessage(document=FakeDoc(size, [FakeAttr(name)]), media=FakeMedia(FakeDoc(size, [FakeAttr(name)])))


class TestResolveRange(unittest.TestCase):
    def test_length_zero_means_to_end_of_file(self):
        self.assertEqual(resolve_range(0, 0, 100), (0, 100))
        self.assertEqual(resolve_range(30, 0, 100), (30, 70))

    def test_in_range_request_passes_through(self):
        self.assertEqual(resolve_range(10, 20, 100), (10, 20))

    def test_length_past_eof_clamps(self):
        self.assertEqual(resolve_range(90, 50, 100), (90, 10))

    def test_offset_at_eof_with_zero_length_is_empty(self):
        self.assertEqual(resolve_range(100, 0, 100), (100, 0))

    def test_offset_past_eof_raises(self):
        with self.assertRaises(ValueError):
            resolve_range(101, 0, 100)

    def test_negative_offset_or_length_raises(self):
        with self.assertRaises(ValueError):
            resolve_range(-1, 10, 100)
        with self.assertRaises(ValueError):
            resolve_range(0, -1, 100)


class TestResolveChannelEntity(unittest.TestCase):
    def test_bare_digits_get_the_minus_100_prefix(self):
        self.assertEqual(resolve_channel_entity("3959088547"), -1003959088547)

    def test_negative_id_passes_through_as_int(self):
        self.assertEqual(resolve_channel_entity("-1003959088547"), -1003959088547)

    def test_username_gets_at_prefix(self):
        self.assertEqual(resolve_channel_entity("testchannel"), "@testchannel")


class TestExtractDocumentInfo(unittest.TestCase):
    def test_size_and_name_from_document(self):
        info = extract_document_info(make_message(1234, "blob.bin"))
        self.assertEqual(info, {"size": 1234, "name": "blob.bin"})

    def test_no_document_returns_none(self):
        self.assertIsNone(extract_document_info(FakeMessage()))


class TestDownloadRange(unittest.TestCase):
    def run_download(self, data, offset=0, length=0, chunk_bytes=4, short_by=0, message=None):
        client = FakeClient(data, message=message if message is not None else make_message(len(data)), short_by=short_by)
        lines = []
        old_chunk = telegram_download.CHUNK_BYTES
        telegram_download.CHUNK_BYTES = chunk_bytes
        try:
            result = asyncio.run(download_range(client, -1001, 589, offset, length, lines.append))
        finally:
            telegram_download.CHUNK_BYTES = old_chunk
        joined = b"".join(base64.b64decode(line[5:]) for line in lines)
        return result, lines, joined, client

    def test_full_download_joins_to_exact_bytes(self):
        data = bytes(range(256)) * 3
        result, lines, joined, _ = self.run_download(data)
        self.assertEqual(joined, data)
        self.assertEqual(result, {"messageId": 589, "offset": 0, "length": len(data), "size": len(data)})
        self.assertTrue(all(line.startswith("DATA:") for line in lines))
        self.assertGreater(len(lines), 1)  # chunked, not one giant line

    def test_offset_and_length_serve_the_exact_slice(self):
        data = bytes(range(256)) * 3
        result, _, joined, _ = self.run_download(data, offset=100, length=50)
        self.assertEqual(joined, data[100:150])
        self.assertEqual(result["offset"], 100)
        self.assertEqual(result["length"], 50)

    def test_length_zero_from_offset_goes_to_eof(self):
        data = bytes(range(256))
        result, _, joined, _ = self.run_download(data, offset=200, length=0)
        self.assertEqual(joined, data[200:])
        self.assertEqual(result["length"], 56)

    def test_length_past_eof_clamps_to_available_bytes(self):
        data = bytes(range(100))
        result, _, joined, _ = self.run_download(data, offset=90, length=50)
        self.assertEqual(joined, data[90:])
        self.assertEqual(result["length"], 10)

    def test_short_download_raises_ioerror(self):
        data = bytes(range(100))
        with self.assertRaises(IOError):
            self.run_download(data, short_by=10)

    def test_missing_message_raises_lookup_error(self):
        client = FakeClient(b"abc", message=None)
        with self.assertRaises(LookupError):
            asyncio.run(download_range(client, -1001, 589, 0, 0, lambda line: None))

    def test_message_without_document_raises_value_error(self):
        client = FakeClient(b"abc", message=FakeMessage())
        with self.assertRaises(ValueError):
            asyncio.run(download_range(client, -1001, 589, 0, 0, lambda line: None))

    def test_offset_past_eof_raises_value_error(self):
        data = bytes(range(100))
        with self.assertRaises(ValueError):
            self.run_download(data, offset=101, length=0)


if __name__ == "__main__":
    unittest.main()
