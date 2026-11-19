"""Tests for the pure-python mp4 probe in telegram_upload.py.

No Telethon, no ffmpeg, no network: synthetic MP4s are built in memory
(box headers + mvhd/tkhd) and probed from temp files. Run from this
directory:  python -m unittest -v test_mp4_probe
"""
import os
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import telegram_upload
from telegram_upload import probe_mp4_video


def box(typ, body):
    return struct.pack(">I4s", 8 + len(body), typ.encode("latin1")) + body


def box64(typ, body):
    # size == 1 + 64-bit largesize
    return struct.pack(">I4sQ", 1, typ.encode("latin1"), 16 + len(body)) + body


def mvhd_v0(timescale, duration):
    body = struct.pack(
        ">IIIIII", 0, 0, 0, timescale, duration, 0x00010000,
    )
    body += b"\x00" * (100 - len(body))
    return box("mvhd", body)


def mvhd_v1(timescale, duration):
    body = struct.pack(">IQQIQ", 0x01000000, 0, 0, timescale, duration)
    body += b"\x00" * (108 - len(body))
    return box("mvhd", body)


def tkhd_v0(width, height):
    # version/flags, creation, modification, track id, reserved, duration,
    # reserved(8), layer, alt group, volume, reserved, matrix(36), w, h
    body = struct.pack(">IIIIII", 0, 0, 0, 1, 0, 0)
    body += b"\x00" * 8
    body += struct.pack(">HHHH", 0, 0, 0, 0)
    body += b"\x00" * 36
    body += struct.pack(">II", width << 16, height << 16)
    assert len(body) == 84
    return box("tkhd", body)


def tkhd_v1(width, height):
    body = struct.pack(">IQQIIQ", 0x01000000, 0, 0, 1, 0, 0)
    body += b"\x00" * 8
    body += struct.pack(">HHHH", 0, 0, 0, 0)
    body += b"\x00" * 36
    body += struct.pack(">II", width << 16, height << 16)
    assert len(body) == 96
    return box("tkhd", body)


def trak(tkhd):
    return box("trak", tkhd)


def moov(*children):
    return box("moov", b"".join(children))


def ftyp():
    return box("ftyp", b"isom\x00\x00\x02\x00isomiso2")


def mdat(payload=b"\x00" * 1024):
    return box("mdat", payload)


def write_temp(data):
    fd, path = tempfile.mkstemp(suffix=".mp4")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return path


class ProbeMp4VideoTests(unittest.TestCase):
    def tearDown(self):
        for path in getattr(self, "_tmp", []):
            os.unlink(path)

    def probe(self, data):
        path = write_temp(data)
        self._tmp = getattr(self, "_tmp", []) + [path]
        return probe_mp4_video(path)

    def test_v0_boxes_faststart(self):
        # moov first (faststart), mvhd v0 + tkhd v0
        data = ftyp() + moov(mvhd_v0(1000, 125500), trak(tkhd_v0(1920, 1080))) + mdat()
        result = self.probe(data)
        self.assertEqual(result["duration"], 126)  # 125.5s rounds to 126
        self.assertEqual(result["width"], 1920)
        self.assertEqual(result["height"], 1080)

    def test_v1_boxes(self):
        data = ftyp() + moov(mvhd_v1(600, 36000), trak(tkhd_v1(1280, 720))) + mdat()
        result = self.probe(data)
        self.assertEqual(result["duration"], 60)
        self.assertEqual(result["width"], 1280)
        self.assertEqual(result["height"], 720)

    def test_moov_after_mdat(self):
        # non-faststart: the probe must seek past mdat by size
        data = ftyp() + mdat(b"\x11" * 4096) + moov(mvhd_v0(1000, 5000), trak(tkhd_v0(640, 360)))
        result = self.probe(data)
        self.assertEqual(result, {"duration": 5, "width": 640, "height": 360})

    def test_64bit_mdat_before_moov(self):
        data = ftyp() + box64("mdat", b"\x22" * 512) + moov(mvhd_v0(1000, 2000), trak(tkhd_v0(320, 240)))
        result = self.probe(data)
        self.assertEqual(result, {"duration": 2, "width": 320, "height": 240})

    def test_audio_track_first_video_track_second(self):
        # audio trak is 0x0 and must be skipped, not reported
        data = ftyp() + moov(
            mvhd_v0(1000, 3000),
            trak(tkhd_v0(0, 0)),
            trak(tkhd_v0(1920, 1080)),
        ) + mdat()
        result = self.probe(data)
        self.assertEqual(result, {"duration": 3, "width": 1920, "height": 1080})

    def test_audio_only_mp4(self):
        data = ftyp() + moov(mvhd_v0(1000, 3000), trak(tkhd_v0(0, 0))) + mdat()
        self.assertEqual(self.probe(data), {"audio_only": True})

    def test_no_moov_returns_none(self):
        self.assertIsNone(self.probe(ftyp() + mdat()))

    def test_garbage_returns_none(self):
        self.assertIsNone(self.probe(b"this is not an mp4 file at all" * 4))

    def test_truncated_moov_returns_none_without_raising(self):
        full = ftyp() + moov(mvhd_v0(1000, 5000), trak(tkhd_v0(640, 360)))
        self.assertIsNone(self.probe(full[: len(full) // 2]))

    def test_moov_size_past_eof_returns_none(self):
        # moov header claims 10 MB, the file has 100 bytes
        fake = struct.pack(">I4s", 10 * 1024 * 1024, b"moov") + b"\x00" * 92
        self.assertIsNone(self.probe(ftyp() + fake))

    def test_missing_file_returns_none(self):
        self.assertIsNone(probe_mp4_video("/nonexistent/path/clip.mp4"))

    def test_zero_timescale_does_not_divide_by_zero(self):
        data = ftyp() + moov(mvhd_v0(0, 5000), trak(tkhd_v0(640, 360))) + mdat()
        result = self.probe(data)
        self.assertEqual(result["duration"], 0)
        self.assertEqual(result["width"], 640)

    def test_module_imports_without_telethon(self):
        # the probe must stay usable on machines without telethon installed
        self.assertTrue(callable(probe_mp4_video))
        if not telegram_upload.TELETHON_AVAILABLE:
            import asyncio

            with self.assertRaises(ImportError):
                asyncio.run(telegram_upload.upload_file("s", "1", "h", "c", "/tmp/x.mp4"))


if __name__ == "__main__":
    unittest.main()
