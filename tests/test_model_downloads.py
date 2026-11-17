import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.onboarding import setup
from app.comfy.validation import describe_rejection


class DownloadTests(unittest.TestCase):
    def test_source_validation_and_reset(self):
        with patch.object(setup.db, 'get_setting', return_value={}), patch.object(setup.db, 'set_setting') as save:
            with self.assertRaises(ValueError):
                setup.set_model_download_url('unet_nsfw', 'http://example.org/model')
            setup.set_model_download_url('unet_nsfw', 'https://example.org/model.safetensors')
            self.assertEqual(save.call_args.args[1]['unet_nsfw'], 'https://example.org/model.safetensors')
            setup.set_model_download_url('unet_nsfw', '')
            self.assertEqual(save.call_args.args[1], {})

    def test_pack_includes_shared_vaes_and_reports_failure(self):
        with patch.object(setup, 'download_model', side_effect=lambda key: {
                'key': key, 'ok': key != 'unet_nsfw'} ) as download, patch.object(setup, 'model_status', return_value={}):
            result = setup.download_model_pack('nsfw')
            self.assertFalse(result['ok'])
            self.assertEqual([c.args[0] for c in download.call_args_list],
                             ['vae_v', 'vae_a', 'unet_nsfw', 'clip_nsfw'])

    def test_invalid_download_never_replaces_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / 'model.safetensors'
            response = httpx.Response(200, content=b'<html>not a model</html>',
                request=httpx.Request('GET', 'https://example.org/model'))
            with patch.object(setup, 'model_download_url', return_value='https://example.org/model'), \
                    patch.object(setup, 'model_file', return_value=destination), \
                    patch.dict(setup.MODEL_MIN_BYTES, {'unet_sfw': 1}), \
                    patch.object(setup.httpx, 'stream') as stream:
                stream.return_value.__enter__.return_value = response
                result = setup.download_model('unet_sfw')
            self.assertFalse(result['ok'])
            self.assertIn('safetensors', result['error'])
            self.assertFalse(destination.exists())
            self.assertFalse(destination.with_suffix('.safetensors.part').exists())

    def test_valid_download_installs_at_configured_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / 'nested' / 'model.safetensors'
            body = (2).to_bytes(8, 'little') + b'{}'
            response = httpx.Response(200, content=body,
                request=httpx.Request('GET', 'https://example.org/model'))
            with patch.object(setup, 'model_download_url', return_value='https://example.org/model'), \
                    patch.object(setup, 'model_file', return_value=destination), \
                    patch.dict(setup.MODEL_MIN_BYTES, {'unet_sfw': 1}), \
                    patch.object(setup.httpx, 'stream') as stream:
                stream.return_value.__enter__.return_value = response
                result = setup.download_model('unet_sfw')
            self.assertTrue(result['ok'])
            self.assertEqual(destination.read_bytes(), body)

    def test_rejection_suggests_model_download(self):
        message = describe_rejection({'node_errors': {'1': {'class_type': 'UNETLoader', 'errors': [{
            'type': 'value_not_in_list', 'details': 'missing.safetensors',
            'extra_info': {'input_name': 'unet_name'}}]}}}, {})
        self.assertIn('missing.safetensors', message)
        self.assertIn('Como corrigir', message)
        self.assertIn('baixe o modelo', message)
