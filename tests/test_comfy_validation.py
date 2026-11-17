import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.comfy.validation import validate_prompt, check_runtime
from app.comfy.client import ComfyClient


class ValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_runtime_checks_generated_workflow_for_both_packs(self):
        client = AsyncMock()
        client.get.return_value = httpx.Response(200, json={},
            request=httpx.Request('GET', 'http://comfy/object_info'))
        with patch('app.comfy.client.ComfyClient') as comfy, patch(
                'app.comfy.validation.httpx.AsyncClient') as factory:
            comfy.return_value.base = 'http://comfy'
            factory.return_value.__aenter__.return_value = client
            for pack in ('sfw', 'nsfw'):
                report = await check_runtime({'model_pack': pack})
                self.assertFalse(report['ok'])
                self.assertEqual(report['model_pack'], pack)
                self.assertTrue(any('MiniMaxH3Director' in e for e in report['errors']))

    def test_missing_node_and_model(self):
        prompt = {'1': {'class_type': 'Loader', 'inputs': {'model': 'missing'}},
                  '2': {'class_type': 'Unavailable', 'inputs': {}}}
        catalog = {'Loader': {'input': {'required': {'model': [['installed']]}}}}
        errors = validate_prompt(prompt, catalog)
        self.assertEqual(len(errors), 2)
        self.assertIn('missing', errors[0])
        self.assertIn('Unavailable', errors[1])

    def test_required_input_and_valid_link(self):
        catalog = {'Node': {'input': {'required': {'source': ['MODEL'], 'mode': [['a']]}}}}
        self.assertEqual(validate_prompt({'1': {'class_type': 'Node', 'inputs': {
            'source': ['2', 0], 'mode': 'a'}}}, catalog), [])
        self.assertIn('source', validate_prompt({'1': {'class_type': 'Node', 'inputs': {
            'mode': 'a'}}}, catalog)[0])

    async def test_rejection_preserves_server_details(self):
        request = httpx.Request('POST', 'http://comfy/prompt')
        client = AsyncMock()
        client.get.return_value = httpx.Response(200, json={}, request=request)
        client.post.return_value = httpx.Response(400, json={
            'node_errors': {'12': {'errors': ['dependency failed']}}}, request=request)
        with patch('app.comfy.client.httpx.AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            with self.assertRaisesRegex(RuntimeError, 'dependency failed'):
                await ComfyClient('http://comfy').queue_prompt({}, 'test')

    async def test_invalid_workflow_never_posts(self):
        client = AsyncMock()
        client.get.return_value = httpx.Response(200, json={},
            request=httpx.Request('GET', 'http://comfy/object_info'))
        with patch('app.comfy.client.httpx.AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            with self.assertRaisesRegex(RuntimeError, 'Missing'):
                await ComfyClient('http://comfy').queue_prompt(
                    {'1': {'class_type': 'Missing', 'inputs': {}}}, 'test')
        client.post.assert_not_called()
