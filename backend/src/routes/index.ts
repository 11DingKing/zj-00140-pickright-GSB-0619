import { Router } from 'express';
import { searchProducts, getProductDetail, getCategories } from '../controllers/productController';
import { getWhitelist, getBlacklist, getTrustRank } from '../controllers/listController';
import { getRecommendedProducts } from '../controllers/recommendController';
import { createReview, getMyReviews, getProductReviews } from '../controllers/reviewController';
import {
  getCurrentParent,
  updateParent,
  addAllergenProfile,
  updateAllergenProfile,
  deleteAllergenProfile,
  getAllergenProfiles,
} from '../controllers/parentController';
import {
  getSubscriptions,
  addSubscription,
  updateSubscription,
  cancelSubscription,
  checkSubscription,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
} from '../controllers/subscriptionController';
import {
  createAdverseReaction,
  getAdverseReactionsByProduct,
} from '../controllers/adverseReactionController';
import {
  createInspectionResult,
  getInspectionResultsByProduct,
} from '../controllers/inspectionController';

const router = Router();

// 产品相关接口
router.get('/products/search', searchProducts);
router.get('/products/categories', getCategories);
router.get('/products/recommend', getRecommendedProducts);
router.post('/products/recommend', getRecommendedProducts);
router.get('/products/:id', getProductDetail);
router.get('/products/:productId/reviews', getProductReviews);

// 榜单相关接口
router.get('/lists/whitelist', getWhitelist);
router.get('/lists/blacklist', getBlacklist);
router.get('/lists/trust-rank', getTrustRank);

// 评价相关接口
router.post('/reviews', createReview);
router.get('/reviews/my', getMyReviews);

// 用户相关接口
router.get('/parent/me', getCurrentParent);
router.put('/parent/me', updateParent);

// 过敏原档案接口
router.get('/parent/allergen-profiles', getAllergenProfiles);
router.post('/parent/allergen-profiles', addAllergenProfile);
router.put('/parent/allergen-profiles/:id', updateAllergenProfile);
router.delete('/parent/allergen-profiles/:id', deleteAllergenProfile);

// 订阅相关接口
router.get('/parent/subscriptions', getSubscriptions);
router.post('/parent/subscriptions', addSubscription);
router.put('/parent/subscriptions/:id', updateSubscription);
router.delete('/parent/subscriptions/:id', cancelSubscription);
router.get('/parent/subscriptions/check/:productId', checkSubscription);

// 通知相关接口
router.get('/parent/notifications', getNotifications);
router.put('/parent/notifications/:id/read', markNotificationRead);
router.put('/parent/notifications/read-all', markAllNotificationsRead);
router.get('/parent/notifications/unread-count', getUnreadCount);

// 不良反应通报录入与查询
router.post('/admin/adverse-reactions', createAdverseReaction);
router.get('/products/:productId/adverse-reactions', getAdverseReactionsByProduct);

// 抽检结果录入与查询
router.post('/admin/inspection-results', createInspectionResult);
router.get('/products/:productId/inspection-results', getInspectionResultsByProduct);

export default router;
