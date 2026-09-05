const router = require('express').Router();
const { getCourses, getCourse, createCourse, updateCourse, deleteCourse } = require('../controllers/courseController');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, getCourses);
router.get('/:id', getCourse);

router.post('/', protect, adminOnly, createCourse);
router.put('/:id', protect, adminOnly, updateCourse);
router.delete('/:id', protect, adminOnly, deleteCourse);

module.exports = router;
