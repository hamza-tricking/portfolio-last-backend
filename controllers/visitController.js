const PageVisit = require('../models/PageVisit');
const User = require('../models/User');

// ── Helpers ──────────────────────────────────────────────────────────

function parseReferrerDomain(referrer) {
  if (!referrer) return 'Direct';
  try {
    const url = new URL(referrer);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('instagram.com') || host.includes('ig.me')) return 'Instagram';
    if (host.includes('tiktok.com') || host.includes('vm.tiktok.com')) return 'TikTok';
    if (host.includes('google.')) return 'Google';
    if (host.includes('facebook.com') || host.includes('fb.com') || host.includes('m.facebook.com')) return 'Facebook';
    if (host.includes('twitter.com') || host.includes('t.co') || host.includes('x.com')) return 'Twitter/X';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube';
    if (host.includes('whatsapp.com') || host.includes('wa.me')) return 'WhatsApp';
    if (host.includes('telegram.org') || host.includes('t.me')) return 'Telegram';
    if (host.includes('linkedin.com')) return 'LinkedIn';
    if (host.includes('snapchat.com')) return 'Snapchat';
    return host || 'Other';
  } catch {
    return 'Other';
  }
}

function parseCountryFromAcceptLanguage(acceptLang) {
  if (!acceptLang) return '';
  // e.g. 'ar-DZ,ar;q=0.9,fr;q=0.8,en;q=0.7'
  const primary = acceptLang.split(',')[0].trim();
  const parts = primary.split('-');
  const lang = parts[0].toLowerCase();
  const region = (parts[1] || '').toUpperCase();
  const countryMap = {
    'DZ': 'Algeria', 'MA': 'Morocco', 'TN': 'Tunisia', 'LY': 'Libya',
    'EG': 'Egypt', 'SA': 'Saudi Arabia', 'AE': 'UAE', 'FR': 'France',
    'GB': 'UK', 'US': 'USA', 'DE': 'Germany', 'TR': 'Turkey',
    'NG': 'Nigeria', 'SN': 'Senegal', 'CM': 'Cameroon',
  };
  if (region && countryMap[region]) return countryMap[region];
  const langMap = { 'ar': 'Arabic-speaking', 'fr': 'French-speaking', 'en': 'English-speaking', 'tr': 'Turkey' };
  return langMap[lang] || lang;
}

function anonymizeIp(ip) {
  if (!ip) return '';
  // IPv4: keep first 3 octets
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return v4[1] + '.xxx';
  // IPv6: keep first 3 groups
  const v6 = ip.split(':');
  if (v6.length >= 4) return v6.slice(0, 3).join(':') + ':xxxx';
  return ip;
}

// ── POST /api/visits — Record a new page visit ───────────────────────
exports.recordVisit = async (req, res) => {
  try {
    const {
      sessionId, visitorId, page, refCode,
      referrer, deviceType, browser, os,
      screenWidth, screenHeight, language,
    } = req.body;

    if (!sessionId || !page) {
      return res.status(400).json({ message: 'sessionId and page are required' });
    }

    // Skip duplicate session (e.g. page re-renders in strict mode)
    const existing = await PageVisit.findOne({ sessionId });
    if (existing) {
      return res.json({ sessionId: existing.sessionId, message: 'already recorded' });
    }

    const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
    const acceptLang = req.headers['accept-language'] || language || '';
    
    // 1. Resolve User ID from token or client payload or previous memory
    let userId = req.user?._id || null;
    let isRegistered = !!req.user;
    let buyerStatus = req.user?.buyerStatus || null;

    if (!userId && req.body.userId) {
      try {
        const found = await User.findById(req.body.userId).lean();
        if (found) {
          userId = found._id;
          isRegistered = true;
          buyerStatus = found.buyerStatus || null;
        }
      } catch {}
    }

    if (!userId && visitorId) {
      const pastKnown = await PageVisit.findOne({ visitorId, userId: { $ne: null } })
        .populate('userId', 'buyerStatus')
        .lean();
      if (pastKnown && pastKnown.userId) {
        userId = pastKnown.userId._id || pastKnown.userId;
        isRegistered = true;
        buyerStatus = pastKnown.userId?.buyerStatus || pastKnown.buyerStatus || null;
      }
    }

    // 2. Identity stitching: if this visitor has a resolved user, stitch ALL their past anonymous visits
    if (userId && visitorId) {
      await PageVisit.updateMany(
        { visitorId, userId: null },
        { 
          $set: { 
            userId, 
            isRegistered: true,
            buyerStatus: buyerStatus || null
          } 
        }
      );
    }

    const visit = await PageVisit.create({
      sessionId,
      visitorId:    visitorId || null,
      userId:       userId || null,
      isRegistered: isRegistered,
      buyerStatus:  buyerStatus || null,
      page,
      enteredAt:    new Date(),
      referrer:     referrer || '',
      referrerDomain: parseReferrerDomain(referrer),
      refCode:      refCode || null,
      deviceType:   deviceType || 'desktop',
      browser:      browser || '',
      os:           os || '',
      screenWidth:  screenWidth || null,
      screenHeight: screenHeight || null,
      language:     language || acceptLang.split(',')[0] || '',
      ip:           anonymizeIp(rawIp),
      country:      parseCountryFromAcceptLanguage(acceptLang),
    });

    res.status(201).json({ sessionId: visit.sessionId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── POST/PATCH /api/visits/:sessionId — Update visit duration & exit ──
exports.updateVisit = async (req, res) => {
  try {
    const { sessionId } = req.params;
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
    const { exitedAt, timeOnPageSec, scrollDepthPct, startedOrder, convertedToOrder, orderId } = body || {};

    const update = {};
    if (exitedAt)        update.exitedAt = new Date(exitedAt);
    if (timeOnPageSec != null) update.timeOnPageSec = Math.max(1, Math.round(Number(timeOnPageSec)));
    if (scrollDepthPct != null) update.scrollDepthPct = Math.round(Number(scrollDepthPct));
    if (startedOrder != null)   update.startedOrder = Boolean(startedOrder);
    if (convertedToOrder != null) update.convertedToOrder = Boolean(convertedToOrder);
    if (orderId)         update.orderId = orderId;

    await PageVisit.findOneAndUpdate({ sessionId }, { $set: update });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/visits — Admin: get paginated visits with stats ─────────
exports.getVisits = async (req, res) => {
  try {
    // 0. Auto-stitch any orphaned visits whose visitorId is known to belong to a registered user
    try {
      const knownVisitors = await PageVisit.aggregate([
        { $match: { userId: { $ne: null }, visitorId: { $ne: null } } },
        { $group: { _id: '$visitorId', userId: { $first: '$userId' }, buyerStatus: { $first: '$buyerStatus' } } }
      ]);
      for (const reg of knownVisitors) {
        if (reg._id && reg.userId) {
          await PageVisit.updateMany(
            { visitorId: reg._id, userId: null },
            { $set: { userId: reg.userId, isRegistered: true, buyerStatus: reg.buyerStatus || null } }
          );
        }
      }
    } catch {}

    const {
      page = 1, limit = 50,
      pageFilter,       // 'home' | 'courses'
      dateFilter,       // 'today' | 'week' | 'month'
      visitorType,      // 'registered' | 'anonymous'
      converted,        // 'true' | 'false'
      device,           // 'mobile' | 'tablet' | 'desktop'
      visitorId,        // single visitor journey
    } = req.query;

    const query = {};

    if (pageFilter && pageFilter !== 'all') query.page = pageFilter;

    if (dateFilter) {
      const now = new Date();
      if (dateFilter === 'today') {
        const start = new Date(now); start.setHours(0, 0, 0, 0);
        query.enteredAt = { $gte: start };
      } else if (dateFilter === 'week') {
        query.enteredAt = { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) };
      } else if (dateFilter === 'month') {
        query.enteredAt = { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };
      }
    }

    if (visitorType === 'registered') query.isRegistered = true;
    if (visitorType === 'anonymous')  query.isRegistered = false;
    if (converted === 'true')  query.convertedToOrder = true;
    if (converted === 'false') query.convertedToOrder = false;
    if (device) query.deviceType = device;
    if (visitorId) query.visitorId = visitorId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [visits, totalCount] = await Promise.all([
      PageVisit.find(query)
        .populate('userId', 'fullName username email phone buyerStatus')
        .populate('orderId', 'status amountUSD paymentMethod')
        .sort({ enteredAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      PageVisit.countDocuments(query),
    ]);

    // ── Summary stats (all-time or filtered) ──
    const statsQuery = { ...query };
    delete statsQuery.page; // stats across all pages unless explicitly filtered

    const [
      totalVisits,
      uniqueVisitorIds,
      homeCount,
      coursesCount,
      dashboardCount,
      mobileCount,
      desktopCount,
      convertedCount,
      registeredCount,
    ] = await Promise.all([
      PageVisit.countDocuments(statsQuery),
      PageVisit.distinct('visitorId', { ...statsQuery, visitorId: { $ne: null } }),
      PageVisit.countDocuments({ ...statsQuery, page: 'home' }),
      PageVisit.countDocuments({ ...statsQuery, page: 'courses' }),
      PageVisit.countDocuments({ ...statsQuery, page: 'dashboard' }),
      PageVisit.countDocuments({ ...statsQuery, deviceType: 'mobile' }),
      PageVisit.countDocuments({ ...statsQuery, deviceType: 'desktop' }),
      PageVisit.countDocuments({ ...statsQuery, convertedToOrder: true }),
      PageVisit.countDocuments({ ...statsQuery, isRegistered: true }),
    ]);

    // Average time on page
    const avgTimeResult = await PageVisit.aggregate([
      { $match: { ...statsQuery, timeOnPageSec: { $ne: null } } },
      { $group: { _id: null, avgTime: { $avg: '$timeOnPageSec' } } },
    ]);
    const avgTimeSec = avgTimeResult[0]?.avgTime || 0;

    // Top referrer domains
    const topReferrers = await PageVisit.aggregate([
      { $match: statsQuery },
      { $group: { _id: '$referrerDomain', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]);

    res.json({
      visits,
      pagination: { total: totalCount, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(totalCount / parseInt(limit)) },
      stats: {
        totalVisits,
        uniqueVisitors: uniqueVisitorIds.length,
        homeCount,
        coursesCount,
        dashboardCount,
        mobileCount,
        desktopCount,
        mobilePercent: totalVisits ? Math.round((mobileCount / totalVisits) * 100) : 0,
        convertedCount,
        conversionRate: coursesCount ? Math.round((convertedCount / coursesCount) * 100) : 0,
        registeredCount,
        anonymousCount: totalVisits - registeredCount,
        avgTimeSec: Math.round(avgTimeSec),
        topReferrers,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/visits/journey/:visitorId — Visitor full journey ─────────
exports.getVisitorJourney = async (req, res) => {
  try {
    const visits = await PageVisit.find({ visitorId: req.params.visitorId })
      .populate('userId', 'fullName username email buyerStatus')
      .populate('orderId', 'status amountUSD')
      .sort({ enteredAt: 1 })
      .lean();
    res.json({ visits });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
