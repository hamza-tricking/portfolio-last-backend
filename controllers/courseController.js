const Course = require('../models/Course');
const bunnyService = require('../services/bunnyService');

exports.getCourses = async (req, res) => {
  try {
    const filter = (req.user && req.user.role === 'admin') ? {} : { isPublished: true };
    const courses = await Course.find(filter).populate('createdBy', 'fullName');
    res.json(courses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate('createdBy', 'fullName');
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }
    res.json(course);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createCourse = async (req, res) => {
  try {
    const course = await Course.create({ ...req.body, createdBy: req.user._id });
    res.status(201).json(course);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateCourse = async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }
    res.json(course);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteCourse = async (req, res) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }
    res.json({ message: 'Course deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/courses/stream/:videoId ────────────────────────────────
// Delivers the official Bunny.net MediaCage Basic DRM embed URL to authorized buyers
exports.getStreamUrl = async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!videoId) {
      return res.status(400).json({ message: 'Video ID is required.' });
    }

    // 1. Account must not be blocked (e.g. from leak reports)
    if (req.user.isBlocked) {
      return res.status(403).json({ message: 'Account is blocked. Please contact support.' });
    }

    // 2. Only admins or verified course buyers/members can access protected video streams
    const isEligible = req.user.role === 'admin' || ['buyer', 'member'].includes(req.user.buyerStatus);
    if (!isEligible) {
      return res.status(403).json({
        message: 'Access restricted. You must have an active course purchase to watch this video.',
      });
    }

    // 3. Generate Bunny MediaCage DRM embed URL (without token auth to prevent conflict with DRM)
    const embedUrl = bunnyService.getMediaCageEmbedUrl(videoId);

    res.json({
      videoId,
      embedUrl,
      libraryId: bunnyService.LIBRARY_ID,
      drmType: 'MediaCage Basic DRM',
      protected: true,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/courses/bunny/videos (Admin only) ──────────────────────
// Browse Bunny.net Video Library contents to link video IDs with lessons
exports.getBunnyVideos = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const itemsPerPage = parseInt(req.query.itemsPerPage, 10) || 50;
    const data = await bunnyService.listVideos(page, itemsPerPage);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/courses/previews ──────────────────────────────────────
// Returns preview images organized by lesson from the backend
exports.getPreviews = async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const previewsBaseDir = path.join(__dirname, '../public/course-previews');

    const folderMap = {
      1: 'lesson-1',
      2: 'lesson-2',
      3: 'lesson-3',
      4: 'lesson-4',
      5: 'lesson-5',
    };

    const previews = {};

    for (const [lessonId, folderName] of Object.entries(folderMap)) {
      const folderPath = path.join(previewsBaseDir, folderName);
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath)
          .filter(file => /\.(jpg|jpeg|png|webp|gif)$/i.test(file))
          .sort();
        previews[lessonId] = files.map(file => `/course-previews/${folderName}/${file}`);
      } else {
        previews[lessonId] = [];
      }
    }

    res.json({ success: true, previews });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


