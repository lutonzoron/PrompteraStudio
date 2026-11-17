import unittest
from unittest.mock import patch

from fastapi import HTTPException
from app.main import ProjectUpdateBody, api_patch_project
from app.inbox.service import import_takes_file


class VideoFormatTests(unittest.TestCase):
    def test_inbox_preserves_confirmed_dimensions_and_legacy_defaults(self):
        for dimensions in ({'width': 1024, 'height': 576}, {}):
            with self.subTest(dimensions=dimensions), \
                    patch('app.inbox.service.ensure_inbox'), \
                    patch('app.inbox.service._load_takes', return_value=[]), \
                    patch('app.inbox.service._normalize_imported_takes', return_value=[]), \
                    patch('app.inbox.service.validate_takes', return_value=[]), \
                    patch('app.inbox.service.db.get_project_by_slug', return_value=None), \
                    patch('app.inbox.service.db.create_project', return_value={'id': 'test'}) as create:
                import_takes_file('example.json', meta={'slug': 'example', **dimensions})
                data = create.call_args.args[0]
                self.assertEqual(data['width'], dimensions.get('width', 544))
                self.assertEqual(data['height'], dimensions.get('height', 992))

    def test_draft_saves_dimensions(self):
        project = {'id': 'test', 'status': 'draft', 'width': 544, 'height': 992}
        with patch('app.main.db.get_project', return_value=project), \
                patch('app.main.db.get_runner_state', return_value={}), \
                patch('app.main.db.update_project', return_value={**project, 'width': 1024, 'height': 576}) as update:
            result = api_patch_project('test', ProjectUpdateBody(width=1024, height=576))
        self.assertEqual((result['width'], result['height']), (1024, 576))
        update.assert_called_once_with('test', width=1024, height=576)

    def test_queued_or_rendered_project_rejects_dimension_change(self):
        for status, state in [('queued', {}), ('failed', {'completed': [1]}),
                              ('failed', {'last_ok': 'checkpoint'})]:
            with self.subTest(status=status, state=state), \
                    patch('app.main.db.get_project', return_value={
                        'status': status, 'width': 544, 'height': 992}), \
                    patch('app.main.db.get_runner_state', return_value=state), \
                    patch('app.main.db.update_project') as update:
                with self.assertRaises(HTTPException) as error:
                    api_patch_project('test', ProjectUpdateBody(width=1024, height=576))
                self.assertEqual(error.exception.status_code, 409)
                update.assert_not_called()
