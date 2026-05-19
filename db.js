const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');
const SEED_PATH = path.join(__dirname, 'data.seed.json');
const ADMIN_PASSWORD = 'cqfood2026';

// ==================== 底层读写 ====================
function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    // Railway 等临时存储环境：从 seed 恢复
    if (fs.existsSync(SEED_PATH)) {
      const seedRaw = fs.readFileSync(SEED_PATH, 'utf8');
      fs.writeFileSync(DB_PATH, seedRaw, 'utf8');
      return JSON.parse(seedRaw);
    }
    const init = { categories: [
      { id: 1, name: '火锅' }, { id: 2, name: '小面' }, { id: 3, name: '烧烤' },
      { id: 4, name: '江湖菜' }, { id: 5, name: '串串' }, { id: 6, name: '其他' }
    ], restaurants: [], reviews: [], blocked_devices: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8').trim();
  if (!raw) {
    const init = { categories: [
      { id: 1, name: '火锅' }, { id: 2, name: '小面' }, { id: 3, name: '烧烤' },
      { id: 4, name: '江湖菜' }, { id: 5, name: '串串' }, { id: 6, name: '其他' }
    ], restaurants: [], reviews: [], blocked_devices: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
  const db = JSON.parse(raw);
  if (!db.blocked_devices) db.blocked_devices = [];
  if (!db.danmaku_messages) db.danmaku_messages = [];
  if (!db.danmaku_settings) db.danmaku_settings = { enabled: true, speed: 3000, showReview: true, showCustom: true };
  return db;
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// ==================== 分类管理 ====================
function getCategories() {
  const db = readDB();
  return db.categories || [];
}

function addCategory(name) {
  const db = readDB();
  if (!db.categories) db.categories = [];
  if (db.categories.find(c => c.name === name)) return null;
  const maxId = db.categories.length > 0
    ? Math.max(...db.categories.map(c => c.id))
    : 0;
  const cat = { id: maxId + 1, name };
  db.categories.push(cat);
  writeDB(db);
  return cat;
}

function deleteCategory(id) {
  const db = readDB();
  db.categories = (db.categories || []).filter(c => c.id !== Number(id));
  writeDB(db);
}

// ==================== 餐厅 CRUD ====================
function getAllRestaurants() {
  const db = readDB();
  return (db.restaurants || []).map(r => {
    const reviews = (db.reviews || [])
      .filter(rv => rv.restaurantId === r.id && rv.approved);
    const avg = reviews.length > 0
      ? reviews.reduce((s, rv) => s + rv.rating, 0) / reviews.length
      : 0;
    const avgCost = reviews.length > 0
      ? Math.round(reviews.reduce((s, rv) => s + (rv.avgCost || 0), 0) / reviews.filter(rv => rv.avgCost > 0).length) || 0
      : 0;
    // 搜索关键字段：汇总所有已审核评价的文本
    const searchKeywords = reviews.map(rv =>
      [rv.recommendReason, rv.signatureDishes, rv.comment, rv.reviewerName].filter(Boolean).join(' ')
    ).join(' ').toLowerCase();
    return { ...r, avgRating: avg > 0 ? avg.toFixed(1) : 0, reviewCount: reviews.length, avgCost, searchKeywords };
  });
}

function getRestaurantById(id) {
  const db = readDB();
  return (db.restaurants || []).find(r => r.id === Number(id)) || null;
}

function addRestaurant({ name, category, latitude, longitude, address, imagePath, phone, openingHours, images, deviceId }) {
  const db = readDB();
  if (!db.restaurants) db.restaurants = [];
  const maxId = db.restaurants.length > 0
    ? Math.max(...db.restaurants.map(r => r.id))
    : 0;
  const restaurant = {
    id: maxId + 1,
    name,
    category: category || '',
    latitude, longitude, address: address || '',
    imagePath: imagePath || '',
    phone: phone || '',
    openingHours: openingHours || '',
    images: images || [],
    createdByDeviceId: deviceId || null,
    createdAt: new Date().toISOString()
  };
  db.restaurants.push(restaurant);
  writeDB(db);
  return restaurant;
}

function deleteRestaurant(id) {
  const db = readDB();
  db.restaurants = (db.restaurants || []).filter(r => r.id !== Number(id));
  writeDB(db);
}

// ==================== 评价（推荐） CRUD ====================
function joinRestaurantInfo(reviews) {
  const db = readDB();
  const restaurants = db.restaurants || [];
  return reviews.map(rv => {
    const r = restaurants.find(res => res.id === rv.restaurantId);
    return {
      ...rv,
      restaurantName: r ? r.name : '未知餐厅',
      restaurantAddress: r ? r.address : '',
      restaurantImagePath: r ? r.imagePath : '',
      restaurantCategory: r ? r.category : ''
    };
  });
}

function getReviewsByRestaurantId(restaurantId) {
  const db = readDB();
  return (db.reviews || [])
    .filter(rv => rv.restaurantId === Number(restaurantId) && rv.approved)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function addReview({ restaurantId, reviewerName, rating, comment, recommendReason, signatureDishes, avgCost, bestTime, isOpen, images, deviceId }) {
  const db = readDB();
  if (!db.reviews) db.reviews = [];

  // 检查设备是否被封禁
  if (deviceId && db.blocked_devices && db.blocked_devices.includes(deviceId)) {
    throw new Error('该设备已被封禁，无法提交评价');
  }

  // 频率限制：同一设备10分钟内最多10条
  if (deviceId) {
    const TEN_MINUTES = 10 * 60 * 1000;
    const now = new Date();
    const recentCount = db.reviews.filter(rv =>
      rv.deviceId === deviceId &&
      now - new Date(rv.createdAt) < TEN_MINUTES
    ).length;
    if (recentCount >= 10) {
      throw new Error('提交过于频繁，10分钟内最多提交10条评价');
    }
  }

  const maxId = db.reviews.length > 0
    ? Math.max(...db.reviews.map(rv => rv.id))
    : 0;
  const review = {
    id: maxId + 1,
    restaurantId: Number(restaurantId),
    reviewerName: reviewerName || '',
    rating: Number(rating),
    comment: comment || '',
    recommendReason: recommendReason || '',
    signatureDishes: signatureDishes || '',
    avgCost: Number(avgCost) || 0,
    bestTime: bestTime || '',
    isOpen: isOpen !== false,
    images: images || [],
    createdAt: new Date().toISOString(),
    approved: false,
    deviceId: deviceId || null
  };
  db.reviews.push(review);
  writeDB(db);
  return review;
}

function getPendingReviews() {
  const db = readDB();
  const pending = (db.reviews || []).filter(rv => !rv.approved);
  return joinRestaurantInfo(pending);
}

function getAllReviewsAdmin() {
  const db = readDB();
  const all = (db.reviews || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return joinRestaurantInfo(all);
}

function approveReview(id, category) {
  const db = readDB();
  const rv = (db.reviews || []).find(rv => rv.id === Number(id));
  if (!rv) return false;
  rv.approved = true;
  // 同时更新餐厅分类（由管理员在审核时指定）
  if (category && category.trim()) {
    const restaurant = (db.restaurants || []).find(r => r.id === rv.restaurantId);
    if (restaurant) restaurant.category = category.trim();
  }
  writeDB(db);
  return true;
}

function rejectReview(id) {
  const db = readDB();
  const rv = (db.reviews || []).find(rv => rv.id === Number(id));
  if (!rv) return false;
  rv.rejected = true;
  rv.rejectedAt = new Date().toISOString();
  writeDB(db);
  return true;
}

function restoreReview(id) {
  const db = readDB();
  const rv = (db.reviews || []).find(rv => rv.id === Number(id));
  if (!rv) return false;
  rv.rejected = false;
  delete rv.rejectedAt;
  writeDB(db);
  return true;
}

// ==================== 弹幕数据（已审核评价）====================
function getApprovedReviewsForDanmaku() {
  const db = readDB();
  const reviews = (db.reviews || [])
    .filter(rv => rv.approved)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const restaurants = db.restaurants || [];
  return reviews.map(rv => {
    const r = restaurants.find(res => res.id === rv.restaurantId);
    return {
      ...rv,
      restaurantName: r ? r.name : '未知餐厅',
      restaurantAddress: r ? r.address : '',
      restaurantImagePath: r ? r.imagePath : '',
      restaurantCategory: r ? r.category : '',
      restaurantLatitude: r ? r.latitude : null,
      restaurantLongitude: r ? r.longitude : null
    };
  });
}

// ==================== 弹幕管理 ====================
function getDanmakuMessages() {
  const db = readDB();
  return (db.danmaku_messages || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function addDanmakuMessage({ text, type }) {
  const db = readDB();
  if (!db.danmaku_messages) db.danmaku_messages = [];
  const maxId = db.danmaku_messages.length > 0
    ? Math.max(...db.danmaku_messages.map(m => m.id))
    : 0;
  const msg = { id: maxId + 1, text: text.trim(), type: type || 'fun', enabled: true, createdAt: new Date().toISOString() };
  db.danmaku_messages.push(msg);
  writeDB(db);
  return msg;
}

function updateDanmakuMessage(id, updates) {
  const db = readDB();
  const msg = (db.danmaku_messages || []).find(m => m.id === Number(id));
  if (!msg) return false;
  if (updates.text !== undefined) msg.text = updates.text.trim();
  if (updates.type !== undefined) msg.type = updates.type;
  if (updates.enabled !== undefined) msg.enabled = updates.enabled;
  writeDB(db);
  return true;
}

function deleteDanmakuMessage(id) {
  const db = readDB();
  db.danmaku_messages = (db.danmaku_messages || []).filter(m => m.id !== Number(id));
  writeDB(db);
  return true;
}

function getDanmakuSettings() {
  const db = readDB();
  return db.danmaku_settings || { enabled: true, speed: 3000, showReview: true, showCustom: true };
}

function updateDanmakuSettings(settings) {
  const db = readDB();
  if (!db.danmaku_settings) db.danmaku_settings = {};
  Object.assign(db.danmaku_settings, settings);
  writeDB(db);
  return db.danmaku_settings;
}

function getEnabledDanmakuMessages() {
  const db = readDB();
  return (db.danmaku_messages || []).filter(m => m.enabled);
}

// ==================== 设备封禁管理 ====================
function isDeviceBlocked(deviceId) {
  const db = readDB();
  return db.blocked_devices && db.blocked_devices.includes(deviceId);
}

function blockDevice(deviceId) {
  if (!deviceId) return false;
  const db = readDB();
  if (!db.blocked_devices) db.blocked_devices = [];
  if (!db.blocked_devices.includes(deviceId)) {
    db.blocked_devices.push(deviceId);
    writeDB(db);
  }
  return true;
}

function unblockDevice(deviceId) {
  if (!deviceId) return false;
  const db = readDB();
  if (!db.blocked_devices) db.blocked_devices = [];
  const before = db.blocked_devices.length;
  db.blocked_devices = db.blocked_devices.filter(d => d !== deviceId);
  writeDB(db);
  return db.blocked_devices.length < before;
}

function getBlockedDevices() {
  const db = readDB();
  return db.blocked_devices || [];
}

// ==================== 管理员验证 ====================
function verifyAdminPassword(pwd) {
  return pwd === ADMIN_PASSWORD;
}

// ==================== 成就系统 ====================
function getAchievements() {
  const db = readDB();
  return db.achievements || [];
}

function getUserAchievements() {
  const db = readDB();
  return db.user_achievements || [];
}

// 生成人类可读的解锁条件文本
function getConditionText(achievement) {
  const cond = achievement.condition;
  const threshold = achievement.threshold;
  const cat = achievement.category;

  if (cond === 'add_restaurant') {
    return `添加 ${threshold} 家餐厅`;
  } else if (cond === 'write_review') {
    return `写 ${threshold} 条评价`;
  } else if (cond === 'five_star_review') {
    return `给出 ${threshold} 个五星评价`;
  } else if (cond === 'upload_image') {
    return `上传 ${threshold} 张美食图片`;
  } else if (cond === 'has_recommend_reason') {
    return `写 ${threshold} 条带推荐理由的评价`;
  } else if (cond === 'add_category') {
    return `添加 ${threshold} 家${cat}店`;
  }
  return achievement.description || '未知条件';
}

// 计算成就当前进度（按设备隔离）
function getAchievementsWithProgress(deviceId) {
  const db = readDB();
  const achievements = db.achievements || [];
  const userAchievements = db.user_achievements || [];
  const restaurants = db.restaurants || [];
  const reviews = db.reviews || [];

  // 按设备过滤解锁记录
  const unlockedMap = {};
  userAchievements.forEach(ua => {
    if (!deviceId || ua.device_id === deviceId) {
      unlockedMap[ua.achievement_id] = ua.unlocked_at;
    }
  });

  // 按设备过滤数据
  const deviceRestaurants = deviceId
    ? restaurants.filter(r => r.createdByDeviceId === deviceId)
    : restaurants;
  const deviceReviews = deviceId
    ? reviews.filter(rv => rv.deviceId === deviceId)
    : reviews;
  const approvedReviews = deviceReviews.filter(rv => rv.approved);

  return achievements.map(ach => {
    let current = 0;
    const cond = ach.condition;
    const cat = ach.category;

    if (cond === 'add_restaurant') {
      current = deviceRestaurants.length;
    } else if (cond === 'write_review') {
      current = approvedReviews.length;
    } else if (cond === 'five_star_review') {
      current = approvedReviews.filter(rv => rv.rating === 5).length;
    } else if (cond === 'upload_image') {
      current = approvedReviews.filter(rv => rv.images && rv.images.length > 0).length;
    } else if (cond === 'has_recommend_reason') {
      current = approvedReviews.filter(rv => rv.recommendReason && rv.recommendReason.trim()).length;
    } else if (cond === 'add_category') {
      current = deviceRestaurants.filter(r => r.category === cat).length;
    }

    const isUnlocked = !!unlockedMap[ach.id];
    const progress = isUnlocked ? ach.threshold : Math.min(current, ach.threshold);
    const percentage = Math.round((progress / ach.threshold) * 100);

    return {
      ...ach,
      conditionText: getConditionText(ach),
      currentProgress: current,
      isUnlocked,
      unlockedAt: unlockedMap[ach.id] || null,
      progressPercentage: percentage
    };
  });
}

function checkAndUpdateAchievements(action, data, deviceId) {
  const db = readDB();

  if (!db.achievements) db.achievements = [];
  if (!db.user_achievements) db.user_achievements = [];

  const userAchievements = db.user_achievements;
  const achievements = db.achievements;
  const restaurants = db.restaurants || [];
  const reviews = db.reviews || [];

  let newAchievements = [];

  if (action === 'add_restaurant') {
    // 只统计该设备添加的餐厅
    const count = deviceId
      ? restaurants.filter(r => r.createdByDeviceId === deviceId).length
      : restaurants.length;

    achievements.forEach(ach => {
      if (ach.condition === 'add_restaurant') {
        const alreadyUnlocked = userAchievements.some(ua => ua.achievement_id === ach.id && ua.device_id === deviceId);
        if (!alreadyUnlocked && count >= ach.threshold) {
          userAchievements.push({ achievement_id: ach.id, device_id: deviceId, unlocked_at: new Date().toISOString() });
          newAchievements.push(ach);
        }
      }
    });

    // 检查分类相关成就（按设备）
    if (data && data.category && deviceId) {
      const categoryCount = restaurants.filter(r => r.category === data.category && r.createdByDeviceId === deviceId).length;
      achievements.forEach(ach => {
        if (ach.condition === 'add_category' && ach.category === data.category) {
          const alreadyUnlocked = userAchievements.some(ua => ua.achievement_id === ach.id && ua.device_id === deviceId);
          if (!alreadyUnlocked && categoryCount >= ach.threshold) {
            userAchievements.push({ achievement_id: ach.id, device_id: deviceId, unlocked_at: new Date().toISOString() });
            newAchievements.push(ach);
          }
        }
      });
    }
  } else if (action === 'write_review') {
    // 只统计该设备的评价
    const count = deviceId
      ? reviews.filter(rv => rv.approved && rv.deviceId === deviceId).length
      : reviews.filter(rv => rv.approved).length;

    achievements.forEach(ach => {
      if (ach.condition === 'write_review') {
        const alreadyUnlocked = userAchievements.some(ua => ua.achievement_id === ach.id && ua.device_id === deviceId);
        if (!alreadyUnlocked && count >= ach.threshold) {
          userAchievements.push({ achievement_id: ach.id, device_id: deviceId, unlocked_at: new Date().toISOString() });
          newAchievements.push(ach);
        }
      }
    });
  } else if (action === 'add_review') {
    // 只检查该设备的评价
    const deviceReviews = deviceId
      ? reviews.filter(rv => rv.deviceId === deviceId)
      : reviews;
    const approvedReviews = deviceReviews.filter(rv => rv.approved);

    // five_star_review
    const fiveStarCount = approvedReviews.filter(rv => rv.rating === 5).length;
    achievements.forEach(ach => {
      if (ach.condition === 'five_star_review') {
        const alreadyUnlocked = userAchievements.some(ua => ua.achievement_id === ach.id && ua.device_id === deviceId);
        if (!alreadyUnlocked && fiveStarCount >= ach.threshold) {
          userAchievements.push({ achievement_id: ach.id, device_id: deviceId, unlocked_at: new Date().toISOString() });
          newAchievements.push(ach);
        }
      }
    });

    // upload_image
    const imageReviewCount = approvedReviews.filter(rv => rv.images && rv.images.length > 0).length;
    achievements.forEach(ach => {
      if (ach.condition === 'upload_image') {
        const alreadyUnlocked = userAchievements.some(ua => ua.achievement_id === ach.id && ua.device_id === deviceId);
        if (!alreadyUnlocked && imageReviewCount >= ach.threshold) {
          userAchievements.push({ achievement_id: ach.id, device_id: deviceId, unlocked_at: new Date().toISOString() });
          newAchievements.push(ach);
        }
      }
    });

    // has_recommend_reason
    const recommendCount = approvedReviews.filter(rv => rv.recommendReason && rv.recommendReason.trim() !== '').length;
    achievements.forEach(ach => {
      if (ach.condition === 'has_recommend_reason') {
        const alreadyUnlocked = userAchievements.some(ua => ua.achievement_id === ach.id && ua.device_id === deviceId);
        if (!alreadyUnlocked && recommendCount >= ach.threshold) {
          userAchievements.push({ achievement_id: ach.id, device_id: deviceId, unlocked_at: new Date().toISOString() });
          newAchievements.push(ach);
        }
      }
    });
  }

  if (newAchievements.length > 0) {
    db.user_achievements = userAchievements;
    writeDB(db);
  }

  return newAchievements;
}

// ==================== 公告系统 ====================
function getAnnouncements() {
  const db = readDB();
  if (!db.announcements) {
    // 初始化默认公告
    db.announcements = [
      { id: 1, text: '🎉 欢迎来到轰轰地吃！', enabled: true, createdAt: new Date().toISOString() },
      { id: 2, text: '🏍️ 生活打不败一个大口吃饭的人', enabled: true, createdAt: new Date().toISOString() }
    ];
    writeDB(db);
  }
  return (db.announcements || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getEnabledAnnouncements() {
  return getAnnouncements().filter(a => a.enabled);
}

function addAnnouncement({ text }) {
  const db = readDB();
  if (!db.announcements) db.announcements = [];
  const maxId = db.announcements.length > 0
    ? Math.max(...db.announcements.map(a => a.id))
    : 0;
  const announcement = {
    id: maxId + 1,
    text: (text || '').trim(),
    enabled: true,
    createdAt: new Date().toISOString()
  };
  if (!announcement.text) return null;
  db.announcements.push(announcement);
  writeDB(db);
  return announcement;
}

function updateAnnouncement(id, updates) {
  const db = readDB();
  const a = (db.announcements || []).find(a => a.id === Number(id));
  if (!a) return false;
  if (updates.text !== undefined) a.text = updates.text.trim();
  if (updates.enabled !== undefined) a.enabled = updates.enabled;
  writeDB(db);
  return true;
}

function deleteAnnouncement(id) {
  const db = readDB();
  db.announcements = (db.announcements || []).filter(a => a.id !== Number(id));
  writeDB(db);
  return true;
}

module.exports = {
  // 分类
  getCategories,
  addCategory,
  deleteCategory,
  // 餐厅
  getAllRestaurants,
  getRestaurantById,
  addRestaurant,
  deleteRestaurant,
  // 评价
  getReviewsByRestaurantId,
  addReview,
  getPendingReviews,
  getAllReviewsAdmin,
  approveReview,
  rejectReview,
  restoreReview,
  getApprovedReviewsForDanmaku,
  getDanmakuMessages, addDanmakuMessage, updateDanmakuMessage, deleteDanmakuMessage,
  getDanmakuSettings, updateDanmakuSettings, getEnabledDanmakuMessages,
  // 设备封禁
  isDeviceBlocked,
  blockDevice,
  unblockDevice,
  getBlockedDevices,
  // 管理员
  verifyAdminPassword,
  // 成就
  getAchievements,
  getUserAchievements,
  getAchievementsWithProgress,
  checkAndUpdateAchievements,
  // 公告
  getAnnouncements,
  getEnabledAnnouncements,
  addAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  // 底层读写
  readDB,
  writeDB
};
