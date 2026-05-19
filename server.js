const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const https = require('https');

const AMAP_KEY = '94d265793b003cab6cca3c2749d41240';
const {
  getCategories, addCategory, deleteCategory,
  getAllRestaurants, getRestaurantById, addRestaurant, deleteRestaurant,
  getReviewsByRestaurantId, addReview,
  verifyAdminPassword, getPendingReviews, getAllReviewsAdmin,
  approveReview, rejectReview, restoreReview,
  getApprovedReviewsForDanmaku,
  getDanmakuMessages, addDanmakuMessage, updateDanmakuMessage, deleteDanmakuMessage,
  getDanmakuSettings, updateDanmakuSettings, getEnabledDanmakuMessages,
  isDeviceBlocked, blockDevice, unblockDevice, getBlockedDevices,
  getAchievements, getUserAchievements, getAchievementsWithProgress, checkAndUpdateAchievements,
  getAnnouncements, getEnabledAnnouncements, addAnnouncement, updateAnnouncement, deleteAnnouncement,
  readDB, writeDB
} = require('./db');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== 高德搜索代理（绕过 JS API 安全密钥限制）====================
function amapSearch(keyword) {
  return new Promise((resolve, reject) => {
    const url = `https://restapi.amap.com/v3/place/text?key=${AMAP_KEY}&keywords=${encodeURIComponent(keyword)}&city=重庆&offset=10&page=1`;
    https.get(url, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === '1' && json.pois) {
            resolve(json.pois.map(poi => ({
              name: poi.name,
              address: poi.address || '',
              district: poi.adname || poi.cityname || '',
              location: poi.location || ''
            })));
          } else {
            resolve([]);
          }
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

app.get('/api/search', async (req, res) => {
  const { keyword } = req.query;
  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ success: false, error: '缺少关键词' });
  }
  try {
    const pois = await amapSearch(keyword.trim());
    res.json({ success: true, data: pois });
  } catch (err) {
    console.error('高德搜索出错:', err.message);
    res.status(500).json({ success: false, error: '搜索服务暂时不可用' });
  }
});

// ==================== 图片上传 ====================
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '未收到图片文件' });
  }
  const relPath = '/uploads/' + req.file.filename;
  res.json({ success: true, data: { path: relPath } });
});

app.use('/uploads', express.static(uploadDir));

// ==================== 管理员登录 ====================
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (verifyAdminPassword(password)) {
    res.json({ success: true, message: '登录成功' });
  } else {
    res.status(401).json({ success: false, error: '密码错误' });
  }
});

// ==================== 分类管理 ====================
app.get('/api/categories', (req, res) => {
  try {
    res.json({ success: true, data: getCategories() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/categories', (req, res) => {
  const { password, name } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: '分类名称不能为空' });
  }
  try {
    const cat = addCategory(name.trim());
    if (!cat) return res.status(409).json({ success: false, error: '该分类已存在' });
    res.json({ success: true, data: cat });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/categories/:id', (req, res) => {
  const { password } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    deleteCategory(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 餐厅管理（管理员）====================
app.put('/api/admin/restaurants/:id', (req, res) => {
  const { password, name, category, address, imagePath, phone, openingHours } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    const db = readDB();
    const restaurant = db.restaurants.find(r => r.id === Number(req.params.id));
    if (!restaurant) return res.status(404).json({ success: false, error: '餐厅不存在' });
    if (name !== undefined) restaurant.name = name.trim();
    if (category !== undefined) restaurant.category = category.trim();
    if (address !== undefined) restaurant.address = address.trim();
    if (imagePath !== undefined) restaurant.imagePath = imagePath;
    if (phone !== undefined) restaurant.phone = phone.trim();
    if (openingHours !== undefined) restaurant.openingHours = openingHours.trim();
    writeDB(db);
    res.json({ success: true, data: restaurant });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/restaurants/:id', (req, res) => {
  const { password } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    const db = readDB();
    db.restaurants = (db.restaurants || []).filter(r => r.id !== Number(req.params.id));
    writeDB(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 评价管理 ====================
app.get('/api/admin/reviews/pending', (req, res) => {
  const { password } = req.query;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    res.json({ success: true, data: getPendingReviews() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/reviews/all', (req, res) => {
  const { password } = req.query;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    res.json({ success: true, data: getAllReviewsAdmin() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/reviews/:id/approve', (req, res) => {
  const { password, category } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    const id = Number(req.params.id);
    // 先获取评价的设备ID，用于成就按设备隔离
    const dbData = readDB();
    const review = (dbData.reviews || []).find(rv => rv.id === id);
    const reviewDeviceId = review ? review.deviceId : null;

    const ok = approveReview(id, category || '');
    if (!ok) return res.status(404).json({ success: false, error: '评价不存在' });

    // 审核通过后触发成就检查（按设备隔离）
    const newAchievements1 = triggerAchievementCheck('write_review', {}, reviewDeviceId);
    const newAchievements2 = triggerAchievementCheck('add_review', { review }, reviewDeviceId);
    const allNew = [...newAchievements1, ...newAchievements2];
    res.json({ success: true, newAchievements: allNew });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/reviews/:id/reject', (req, res) => {
  const { password } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    const id = Number(req.params.id);
    const ok = rejectReview(id);
    if (!ok) return res.status(404).json({ success: false, error: '评价不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 恢复已拒绝的评价（软删除恢复）
app.post('/api/admin/reviews/:id/restore', (req, res) => {
  const { password } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    const id = Number(req.params.id);
    const ok = restoreReview(id);
    if (!ok) return res.status(404).json({ success: false, error: '评价不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 设备封禁管理 API ====================
app.get('/api/admin/devices/blocked', (req, res) => {
  const { password } = req.query;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    res.json({ success: true, data: getBlockedDevices() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/devices/block', (req, res) => {
  const { password, deviceId } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    if (!deviceId) return res.status(400).json({ success: false, error: '缺少设备ID' });
    const ok = blockDevice(deviceId);
    res.json({ success: true, data: { blocked: ok } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/devices/unblock', (req, res) => {
  const { password, deviceId } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    if (!deviceId) return res.status(400).json({ success: false, error: '缺少设备ID' });
    const ok = unblockDevice(deviceId);
    res.json({ success: true, data: { unblocked: ok } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 弹幕管理 API ====================
app.get('/api/admin/danmaku', (req, res) => {
  const { password } = req.query;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    const messages = getDanmakuMessages();
    const settings = getDanmakuSettings();
    res.json({ success: true, data: messages, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/danmaku', (req, res) => {
  const { password, text, type } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, error: '弹幕内容不能为空' });
  }
  try {
    const msg = addDanmakuMessage({ text, type });
    res.json({ success: true, data: msg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/danmaku/:id', (req, res) => {
  const { password, text, type, enabled } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    const id = Number(req.params.id);
    const ok = updateDanmakuMessage(id, { text, type, enabled });
    if (!ok) return res.status(404).json({ success: false, error: '弹幕不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/danmaku/:id', (req, res) => {
  const { password } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    const id = Number(req.params.id);
    deleteDanmakuMessage(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/danmaku/settings', (req, res) => {
  const { password } = req.query;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    res.json({ success: true, data: getDanmakuSettings() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/danmaku/settings', (req, res) => {
  const { password, ...settings } = req.body;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ success: false, error: '管理员密码错误' });
  }
  try {
    const updated = updateDanmakuSettings(settings);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 成就系统 API ====================
app.get('/api/achievements', (req, res) => {
  try {
    const deviceId = req.query.deviceId || null;
    const achievements = getAchievementsWithProgress(deviceId);
    res.json({ success: true, data: achievements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/user/achievements', (req, res) => {
  try {
    const deviceId = req.query.deviceId || null;
    const userAchievements = getUserAchievements();
    const achievements = getAchievements();

    // 按设备过滤解锁记录
    const filtered = deviceId ? userAchievements.filter(ua => ua.device_id === deviceId) : userAchievements;
    // 合并成就详情
    const result = filtered.map(ua => {
      const achievement = achievements.find(a => a.id === ua.achievement_id);
      return {
        ...achievement,
        unlocked_at: ua.unlocked_at
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 检查并更新成就（内部调用，支持按设备隔离）
function triggerAchievementCheck(action, data, deviceId) {
  try {
    const newAchievements = checkAndUpdateAchievements(action, data, deviceId);
    return newAchievements;
  } catch (err) {
    console.error('成就检查失败:', err.message);
    return [];
  }
}

// ==================== 公告系统 API ====================
// 前端获取已启用的公告
app.get('/api/announcements', (req, res) => {
  try {
    const announcements = getEnabledAnnouncements();
    res.json({ success: true, data: announcements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 后台获取全部公告
app.get('/api/admin/announcements', (req, res) => {
  try {
    const { password } = req.query;
    if (!verifyAdminPassword(password)) {
      return res.status(401).json({ success: false, error: '管理员密码错误' });
    }
    const announcements = getAnnouncements();
    res.json({ success: true, data: announcements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 新增公告
app.post('/api/admin/announcements', (req, res) => {
  try {
    const { password, text } = req.body;
    if (!verifyAdminPassword(password)) {
      return res.status(401).json({ success: false, error: '管理员密码错误' });
    }
    const announcement = addAnnouncement({ text });
    if (!announcement) return res.status(400).json({ success: false, error: '公告内容不能为空' });
    res.json({ success: true, data: announcement });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 修改公告
app.put('/api/admin/announcements/:id', (req, res) => {
  try {
    const { password } = req.body;
    if (!verifyAdminPassword(password)) {
      return res.status(401).json({ success: false, error: '管理员密码错误' });
    }
    const ok = updateAnnouncement(Number(req.params.id), req.body);
    if (!ok) return res.status(404).json({ success: false, error: '公告不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除公告
app.delete('/api/admin/announcements/:id', (req, res) => {
  try {
    const { password } = req.query;
    if (!verifyAdminPassword(password)) {
      return res.status(401).json({ success: false, error: '管理员密码错误' });
    }
    deleteAnnouncement(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get('/api/reviews/danmaku', (req, res) => {
  try {
    const settings = getDanmakuSettings();
    const reviews = settings.showReview ? getApprovedReviewsForDanmaku() : [];
    const customMsgs = settings.showCustom ? getEnabledDanmakuMessages() : [];
    const data = reviews.map(rv => ({
      id: rv.id,
      source: 'review',
      reviewerName: rv.reviewerName,
      rating: rv.rating,
      comment: rv.comment,
      recommendReason: rv.recommendReason,
      signatureDishes: rv.signatureDishes,
      restaurantId: rv.restaurantId,
      restaurantName: rv.restaurantName,
      restaurantLatitude: rv.restaurantLatitude,
      restaurantLongitude: rv.restaurantLongitude,
      createdAt: rv.createdAt
    })).concat(customMsgs.map(m => ({
      id: m.id,
      source: 'custom',
      text: m.text,
      type: m.type,
      createdAt: m.createdAt
    })));
    res.json({ success: true, data, settings: { enabled: settings.enabled, speed: settings.speed } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 餐厅 API ====================
app.get('/api/restaurants', (req, res) => {
  try {
    const restaurants = getAllRestaurants();
    res.json({ success: true, data: restaurants });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/restaurants', (req, res) => {
  try {
    const { name, category, latitude, longitude, address, imagePath, phone, openingHours, images, deviceId } = req.body;
    if (!name || latitude == null || longitude == null) {
      return res.status(400).json({ success: false, error: '缺少必要字段：name, latitude, longitude' });
    }
    // 去重检查：同名且坐标接近的餐厅（0.0005度约55米）
    const existing = getAllRestaurants();
    const dup = existing.find(r =>
      r.name.trim() === name.trim() &&
      Math.abs(r.latitude - Number(latitude)) < 0.0005 &&
      Math.abs(r.longitude - Number(longitude)) < 0.0005
    );
    if (dup) {
      return res.status(409).json({ success: false, error: '该餐厅已存在', data: dup });
    }
    const restaurant = addRestaurant({ name, category: category || '', latitude: Number(latitude), longitude: Number(longitude), address: address || '', imagePath: imagePath || '', phone: phone || '', openingHours: openingHours || '', images: images || [], deviceId });

    // 触发成就检查（按设备隔离）
    const newAchievements = triggerAchievementCheck('add_restaurant', { category: category || '' }, deviceId);
    res.json({ success: true, data: restaurant, newAchievements: newAchievements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/restaurants/:id', (req, res) => {
  try {
    deleteRestaurant(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 评价 API（含新字段）====================
app.get('/api/restaurants/:id/reviews', (req, res) => {
  try {
    const restaurantId = Number(req.params.id);
    const restaurant = getRestaurantById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: '餐厅不存在' });
    }
    const reviews = getReviewsByRestaurantId(restaurantId);
    res.json({ success: true, data: reviews });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/restaurants/:id/reviews', (req, res) => {
  try {
    const restaurantId = Number(req.params.id);
    const { reviewerName, rating, comment, recommendReason, signatureDishes, avgCost, bestTime, isOpen, images, deviceId } = req.body;

    const restaurant = getRestaurantById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: '餐厅不存在' });
    }
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: '评分必须在 1-5 之间' });
    }

    const review = addReview({
      restaurantId,
      reviewerName,
      rating,
      comment,
      recommendReason,
      signatureDishes,
      avgCost,
      bestTime,
      isOpen,
      images: images || [],
      deviceId
    });

    // 提交时触发 add_review 检查（五星、图片、推荐理由类成就）
    const newAchievements1 = triggerAchievementCheck('add_review', { review }, deviceId);

    res.json({ success: true, data: review, message: '评价已提交，等待管理员审核', newAchievements: newAchievements1 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  console.log(`🍜 轰轰地吃服务已启动！`);
  console.log(`   本机访问：http://localhost:${PORT}`);
  Object.values(nets).forEach(arr => {
    arr.forEach(n => {
      if (n.family === 'IPv4' && !n.internal) {
        console.log(`   局域网访问：http://${n.address}:${PORT}`);
      }
    });
  });
  console.log(`   管理后台：http://localhost:${PORT}/admin.html`);
});

// ========== 全局错误兜底 ==========
process.on('uncaughtException', (err) => {
  console.error('🔥 未捕获异常:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('🔥 未处理 Promise 拒绝:', reason?.message || reason);
});

// 健康检查端点（可被定时监控调用）
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
