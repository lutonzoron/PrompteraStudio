import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import db
from app.main import ProjectUpdateBody, api_patch_project


class TimelineReviewedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        mock = patch('app.db.DB_PATH', root / 'studio.db')
        mock.start()
        self.addCleanup(mock.stop)
        mock = patch('app.db.PROJECTS_DIR', root / 'projects')
        mock.start()
        self.addCleanup(mock.stop)
        db.init_db()

    def test_reviewed_defaults_false_and_toggles_without_bumping_updated_at(self):
        project = db.create_project({'title': 'Timeline clip', 'slug': 'timeline_clip'})
        self.assertFalse(project['reviewed'])
        before = project['updated_at']

        updated = db.update_project(project['id'], reviewed=True)
        self.assertTrue(updated['reviewed'])
        self.assertEqual(updated['updated_at'], before)

        cleared = db.update_project(project['id'], reviewed=False)
        self.assertFalse(cleared['reviewed'])
        self.assertEqual(cleared['updated_at'], before)

    def test_api_patch_accepts_reviewed_flag(self):
        project = {'id': 'test', 'status': 'done', 'width': 544, 'height': 992, 'reviewed': False}
        with patch('app.main.db.get_project', return_value=project), \
                patch('app.main.db.get_runner_state', return_value={}), \
                patch('app.main.db.update_project', return_value={**project, 'reviewed': True}) as update:
            result = api_patch_project('test', ProjectUpdateBody(reviewed=True))
        self.assertTrue(result['reviewed'])
        update.assert_called_once_with('test', reviewed=True)


if __name__ == '__main__':
    unittest.main()
