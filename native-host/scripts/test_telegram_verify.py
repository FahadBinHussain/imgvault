"""Tests for the pure helpers in telegram_verify.py.

No Telethon, no network: entity resolution and document extraction are
duck-typed on purpose, so fake message/document objects exercise them.
Run from this directory:  python -m unittest -v test_telegram_verify
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import telegram_verify
from telegram_verify import extract_document_info, resolve_channel_entity


class FakeAttr:
    def __init__(self, file_name=None):
        if file_name is not None:
            self.file_name = file_name


class FakeDoc:
    def __init__(self, size, attributes=None):
        self.size = size
        self.attributes = attributes if attributes is not None else []


class FakeMessage:
    def __init__(self, document=None, media=None):
        self.document = document
        self.media = media


class FakeMedia:
    def __init__(self, document=None):
        self.document = document


class TestResolveChannelEntity(unittest.TestCase):
    def test_saved_messages_forms(self):
        for value in ("me", "ME", "self", "Saved Messages"):
            self.assertEqual(resolve_channel_entity(value), "me")

    def test_negative_id_passes_through_as_int(self):
        self.assertEqual(resolve_channel_entity("-1003959088547"), -1003959088547)

    def test_bare_digits_get_the_minus_100_prefix(self):
        # A bare numeric id is a USER id to Telethon, never the channel.
        self.assertEqual(resolve_channel_entity("3959088547"), -1003959088547)

    def test_username_gets_at_prefix(self):
        self.assertEqual(resolve_channel_entity("testchannel"), "@testchannel")
        self.assertEqual(resolve_channel_entity("@testchannel"), "@testchannel")

    def test_whitespace_is_trimmed(self):
        self.assertEqual(resolve_channel_entity("  -1001  "), -1001)


class TestExtractDocumentInfo(unittest.TestCase):
    def test_document_with_filename(self):
        msg = FakeMessage(document=FakeDoc(30361257, [FakeAttr(), FakeAttr("model.spz")]))
        self.assertEqual(
            extract_document_info(msg),
            {"size": 30361257, "name": "model.spz"},
        )

    def test_document_without_filename_still_reports_size(self):
        msg = FakeMessage(document=FakeDoc(67104, [FakeAttr()]))
        self.assertEqual(extract_document_info(msg), {"size": 67104, "name": None})

    def test_media_document_is_found_when_message_document_is_absent(self):
        msg = FakeMessage(document=None, media=FakeMedia(FakeDoc(100, [FakeAttr("x.webp")])))
        self.assertEqual(extract_document_info(msg), {"size": 100, "name": "x.webp"})

    def test_none_message_returns_none(self):
        self.assertIsNone(extract_document_info(None))

    def test_message_without_any_document_returns_none(self):
        self.assertIsNone(extract_document_info(FakeMessage()))
        self.assertIsNone(extract_document_info(FakeMessage(media=FakeMedia(None))))

    def test_document_without_size_returns_none(self):
        doc = FakeDoc(100)
        del doc.size
        self.assertIsNone(extract_document_info(FakeMessage(document=doc)))


class TestModuleImportableWithoutTelethon(unittest.TestCase):
    def test_lazy_import_flag_exists(self):
        # The module must stay importable (and these helpers testable) on
        # machines without Telethon installed.
        self.assertIsInstance(telegram_verify.TELETHON_AVAILABLE, bool)


if __name__ == "__main__":
    unittest.main()
