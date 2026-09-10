const https = require('https');

const LIBRARY_ID = process.env.BUNNY_LIBRARY_ID || '748666';
const CDN_HOSTNAME = process.env.BUNNY_CDN_HOSTNAME || 'vz-99f60e1e-149.b-cdn.net';
const API_KEY = process.env.BUNNY_API_KEY;

/**
 * Returns the official Bunny.net Stream Embed Iframe URL.
 * With MediaCage Basic DRM enabled, all streaming is protected via session-based dynamic encryption
 * in the native Bunny player iframe without requiring manual Token Authentication.
 * 
 * @param {string} videoId - The Bunny.net video GUID
 * @param {object} options - Optional query parameters (autoplay, preload, etc.)
 * @returns {string} - Full embed URL
 */
function getMediaCageEmbedUrl(videoId, options = {}) {
  if (!videoId) return '';

  const params = new URLSearchParams({
    autoplay: options.autoplay ? 'true' : 'false',
    preload: options.preload ? 'true' : 'true',
    responsive: 'true',
    ...options.extraParams,
  });

  return `https://iframe.mediadelivery.net/embed/${LIBRARY_ID}/${videoId}?${params.toString()}`;
}

/**
 * Helper to make HTTPS requests to the Bunny.net Stream REST API
 */
function bunnyApiRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      return reject(new Error('BUNNY_API_KEY is not configured in environment variables.'));
    }

    const options = {
      hostname: 'video.bunnycdn.com',
      path: endpoint,
      method,
      headers: {
        AccessKey: API_KEY,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.message || `Bunny API error: HTTP ${res.statusCode}`));
          }
        } catch (err) {
          reject(new Error(`Failed to parse Bunny API response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * List videos in the library
 */
async function listVideos(page = 1, itemsPerPage = 100) {
  return bunnyApiRequest(`/library/${LIBRARY_ID}/videos?page=${page}&itemsPerPage=${itemsPerPage}`);
}

/**
 * Get single video details from Bunny.net
 */
async function getVideo(videoId) {
  return bunnyApiRequest(`/library/${LIBRARY_ID}/videos/${videoId}`);
}

module.exports = {
  LIBRARY_ID,
  CDN_HOSTNAME,
  getMediaCageEmbedUrl,
  listVideos,
  getVideo,
};
