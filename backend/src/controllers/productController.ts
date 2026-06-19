import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { getTrustLevel, calculateTrustIndex, isBlacklistedProduct } from '../utils/trustIndex';
import { checkProductAllergens } from '../utils/allergen';
import { notifyAdverseReaction, notifyInspectionFailed } from '../utils/notificationService';

// 搜索产品（按产品名或备案号）
export const searchProducts = async (req: Request, res: Response) => {
  try {
    const { keyword, category, usePersonalization } = req.query;

    if (!keyword || typeof keyword !== 'string') {
      return res.status(400).json({ error: '请输入搜索关键词' });
    }

    const keywordStr = String(keyword);
    const where: any = {
      OR: [
        { name: { contains: keywordStr } },
        { recordNumber: { contains: keywordStr } },
        { brand: { name: { contains: keywordStr } } },
      ],
    };

    if (category && typeof category === 'string') {
      where.category = category;
    }

    const parentId = parseInt(req.headers['x-parent-id'] as string) || 1;

    let allergenProfiles: any[] = [];
    if (usePersonalization !== 'false') {
      allergenProfiles = await prisma.allergenProfile.findMany({
        where: { parentId },
      });
    }

    const products = await prisma.product.findMany({
      where,
      include: {
        brand: {
          include: {
            blacklist: true,
          },
        },
        blacklist: true,
        reviews: true,
        adverseReactions: true,
        inspectionResults: true,
        _count: {
          select: { reviews: true },
        },
      },
      take: 50,
    });

    // 处理返回数据，实时计算放心指数，添加放心等级信息和过敏原检测
    const result = products.map((product) => {
      const calculatedTrustIndex = calculateTrustIndex({
        product: product as any,
      });
      const trustLevel = getTrustLevel(calculatedTrustIndex);
      const isBlacklisted = isBlacklistedProduct(product as any);

      let allergenInfo = null;
      if (allergenProfiles.length > 0) {
        allergenInfo = checkProductAllergens(product, allergenProfiles);
      }

      return {
        ...product,
        ingredients: JSON.parse(product.ingredients || '[]'),
        highAllergenIngredients: JSON.parse(product.highAllergenIngredients || '[]'),
        trustIndex: calculatedTrustIndex,
        trustLevel,
        isBlacklisted,
        reviewCount: product._count.reviews,
        allergenInfo,
      };
    });

    // 排序：黑名单产品排最后，然后按过敏原警告排序，最后按放心指数排序
    result.sort((a, b) => {
      if (a.isBlacklisted && !b.isBlacklisted) return 1;
      if (!a.isBlacklisted && b.isBlacklisted) return -1;

      const aHasAllergen = a.allergenInfo?.hasAllergen ? 1 : 0;
      const bHasAllergen = b.allergenInfo?.hasAllergen ? 1 : 0;

      if (aHasAllergen !== bHasAllergen) {
        return aHasAllergen - bHasAllergen;
      }

      if (aHasAllergen && bHasAllergen) {
        const aHasSevere = a.allergenInfo?.matchedAllergens.some((x: any) => x.severity === '严重')
          ? 1
          : 0;
        const bHasSevere = b.allergenInfo?.matchedAllergens.some((x: any) => x.severity === '严重')
          ? 1
          : 0;
        if (aHasSevere !== bHasSevere) {
          return aHasSevere - bHasSevere;
        }
      }

      return b.trustIndex - a.trustIndex;
    });

    const allergenWarningCount = result.filter((p: any) => p.allergenInfo?.hasAllergen).length;

    res.json({
      success: true,
      data: result,
      total: result.length,
      stats: {
        allergenWarningCount,
        userAllergenCount: allergenProfiles.length,
      },
    });
  } catch (error) {
    console.error('搜索产品失败:', error);
    res.status(500).json({ error: '搜索失败，请稍后重试' });
  }
};

// 获取产品详情
export const getProductDetail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parentId = parseInt(req.headers['x-parent-id'] as string) || 1;

    const product = await prisma.product.findUnique({
      where: { id: parseInt(id) },
      include: {
        brand: {
          include: {
            blacklist: true,
          },
        },
        blacklist: true,
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        adverseReactions: {
          orderBy: { reportDate: 'desc' },
        },
        inspectionResults: {
          orderBy: { inspectionDate: 'desc' },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ error: '产品不存在' });
    }

    const calculatedTrustIndex = calculateTrustIndex({
      product: product as any,
    });
    const trustLevel = getTrustLevel(calculatedTrustIndex);
    const isBlacklisted = isBlacklistedProduct(product as any);

    // 统计过敏率
    const totalReviews = product.reviews.length;
    const allergyReviews = product.reviews.filter((r) => r.hasAllergy).length;
    const allergyRate = totalReviews > 0 ? ((allergyReviews / totalReviews) * 100).toFixed(1) : '0';

    // 获取用户过敏原档案并检测
    const allergenProfiles = await prisma.allergenProfile.findMany({
      where: { parentId },
    });
    const allergenInfo =
      allergenProfiles.length > 0 ? checkProductAllergens(product, allergenProfiles) : null;

    // 检查订阅状态
    const subscription = await prisma.productSubscription.findUnique({
      where: {
        parentId_productId: {
          parentId,
          productId: parseInt(id),
        },
      },
    });

    const result = {
      ...product,
      ingredients: JSON.parse(product.ingredients || '[]'),
      highAllergenIngredients: JSON.parse(product.highAllergenIngredients || '[]'),
      reviews: product.reviews.map((r) => ({
        ...r,
        allergySymptoms: r.allergySymptoms ? JSON.parse(r.allergySymptoms) : [],
      })),
      trustIndex: calculatedTrustIndex,
      trustLevel,
      isBlacklisted,
      allergyRate,
      totalReviews,
      allergyReviews,
      allergenInfo,
      isSubscribed: subscription?.isActive || false,
      subscription: subscription || null,
    };

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('获取产品详情失败:', error);
    res.status(500).json({ error: '获取产品详情失败' });
  }
};

// 获取产品分类
export const getCategories = async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.product.groupBy({
      by: ['category'],
      _count: true,
    });

    res.json({
      success: true,
      data: categories.map((c) => ({
        name: c.category,
        count: c._count,
      })),
    });
  } catch (error) {
    console.error('获取分类失败:', error);
    res.status(500).json({ error: '获取分类失败' });
  }
};

export const createAdverseReaction = async (req: Request, res: Response) => {
  try {
    const { productId, title, description, reportDate, source, severity } = req.body;

    if (!productId || !title || !description || !reportDate || !source || !severity) {
      return res.status(400).json({ error: '请填写完整信息' });
    }

    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
    });

    if (!product) {
      return res.status(404).json({ error: '产品不存在' });
    }

    const adverseReaction = await prisma.adverseReaction.create({
      data: {
        productId: parseInt(productId),
        title,
        description,
        reportDate: new Date(reportDate),
        source,
        severity,
      },
      include: {
        product: true,
      },
    });

    const notifyResult = await notifyAdverseReaction(adverseReaction);

    await recalculateProductTrustIndex(parseInt(productId));

    res.json({
      success: true,
      data: adverseReaction,
      notifications: notifyResult,
      message: `不良反应通报已创建，已向 ${notifyResult.created} 位订阅家长发送通知`,
    });
  } catch (error) {
    console.error('创建不良反应通报失败:', error);
    res.status(500).json({ error: '创建失败' });
  }
};

export const createInspectionResult = async (req: Request, res: Response) => {
  try {
    const { productId, inspectionOrg, inspectionDate, result, unqualifiedItems, source } = req.body;

    if (!productId || !inspectionOrg || !inspectionDate || !result || !source) {
      return res.status(400).json({ error: '请填写完整信息' });
    }

    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
    });

    if (!product) {
      return res.status(404).json({ error: '产品不存在' });
    }

    const inspectionResult = await prisma.inspectionResult.create({
      data: {
        productId: parseInt(productId),
        inspectionOrg,
        inspectionDate: new Date(inspectionDate),
        result,
        unqualifiedItems: unqualifiedItems || null,
        source,
      },
      include: {
        product: true,
      },
    });

    let notifyResult = { created: 0, parentIds: [] as number[] };
    if (result === '不合格') {
      notifyResult = await notifyInspectionFailed(inspectionResult);
    }

    await recalculateProductTrustIndex(parseInt(productId));

    res.json({
      success: true,
      data: inspectionResult,
      notifications: notifyResult,
      message:
        result === '不合格'
          ? `抽检结果已创建，已向 ${notifyResult.created} 位订阅家长发送通知`
          : '抽检结果已创建',
    });
  } catch (error) {
    console.error('创建抽检结果失败:', error);
    res.status(500).json({ error: '创建失败' });
  }
};

async function recalculateProductTrustIndex(productId: number) {
  const productWithRelations = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      brand: {
        include: {
          blacklist: true,
        },
      },
      reviews: true,
      adverseReactions: true,
      inspectionResults: true,
      blacklist: true,
    },
  });

  if (productWithRelations) {
    const newTrustIndex = calculateTrustIndex({
      product: productWithRelations as any,
    });
    await prisma.product.update({
      where: { id: productId },
      data: { trustIndex: newTrustIndex },
    });
  }
}
