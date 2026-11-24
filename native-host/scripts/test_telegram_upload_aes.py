"""Tests for the fast-AES-backend guard in telegram_upload.py.

No Telethon, no network: fake telethon.crypto modules are injected into
sys.modules to simulate each backend state. Run from this directory:
  python -m unittest -v test_telegram_upload_aes
"""
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import telegram_upload

_FAKE_NAMES = (
    "telethon",
    "telethon.crypto",
    "telethon.crypto.aes",
    "telethon.crypto.libssl",
)


def _fake_module(name, **attrs):
    mod = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    return mod


class HasFastAesBackendTest(unittest.TestCase):
    def setUp(self):
        self._saved_modules = {name: sys.modules.get(name) for name in _FAKE_NAMES}
        self._saved_flag = telegram_upload.TELETHON_AVAILABLE

    def tearDown(self):
        for name, mod in self._saved_modules.items():
            if mod is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = mod
        telegram_upload.TELETHON_AVAILABLE = self._saved_flag

    def _inject(self, cryptg, encrypt_ige):
        # Parent packages must exist in sys.modules for the from-imports.
        sys.modules["telethon"] = _fake_module("telethon")
        sys.modules["telethon.crypto"] = _fake_module("telethon.crypto")
        sys.modules["telethon.crypto.aes"] = _fake_module(
            "telethon.crypto.aes", cryptg=cryptg
        )
        sys.modules["telethon.crypto.libssl"] = _fake_module(
            "telethon.crypto.libssl", encrypt_ige=encrypt_ige
        )
        telegram_upload.TELETHON_AVAILABLE = True

    def test_cryptg_present_is_fast(self):
        self._inject(cryptg=object(), encrypt_ige=None)
        self.assertTrue(telegram_upload.has_fast_aes_backend())

    def test_libssl_present_is_fast(self):
        self._inject(cryptg=None, encrypt_ige=object())
        self.assertTrue(telegram_upload.has_fast_aes_backend())

    def test_neither_backend_is_slow(self):
        self._inject(cryptg=None, encrypt_ige=None)
        self.assertFalse(telegram_upload.has_fast_aes_backend())

    def test_telethon_missing_is_slow(self):
        telegram_upload.TELETHON_AVAILABLE = False
        self.assertFalse(telegram_upload.has_fast_aes_backend())

    def test_unimportable_crypto_is_slow(self):
        # A sys.modules entry of None makes the import raise ImportError.
        telegram_upload.TELETHON_AVAILABLE = True
        sys.modules["telethon"] = _fake_module("telethon")
        sys.modules["telethon.crypto"] = _fake_module("telethon.crypto")
        sys.modules["telethon.crypto.aes"] = None
        self.assertFalse(telegram_upload.has_fast_aes_backend())


if __name__ == "__main__":
    unittest.main()
