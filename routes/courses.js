const router = require('express').Router();
const {
  getCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  getStreamUrl,
  getBunnyVideos,
} = require('../controllers/courseController');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, getCourses);

// Streaming & Bunny API routes (must precede /:id)
router.get('/stream/:videoId', protect, getStreamUrl);
router.get('/bunny/videos', protect, adminOnly, getBunnyVideos);

router.get('/:id', getCourse);

router.post('/', protect, adminOnly, createCourse);
router.put('/:id', protect, adminOnly, updateCourse);
router.delete('/:id', protect, adminOnly, deleteCourse);

module.exports = router;

