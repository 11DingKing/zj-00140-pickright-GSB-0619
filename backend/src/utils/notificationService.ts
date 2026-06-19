import prisma from './prisma';
import { checkProductAllergens } from './allergen';
import type { AdverseReaction, InspectionResult, Product } from '@prisma/client';

export interface NotificationResult {
  created: number;
  parentIds: number[];
}

export async function notifyAdverseReaction(
  adverseReaction: AdverseReaction & { product: Product },
): Promise<NotificationResult> {
  const subscriptions = await prisma.productSubscription.findMany({
    where: {
      productId: adverseReaction.productId,
      isActive: true,
      notifyOnAdverseReaction: true,
    },
  });

  const parentIds = subscriptions.map((s) => s.parentId);
  if (parentIds.length === 0) {
    return { created: 0, parentIds: [] };
  }

  const notifications = parentIds.map((parentId) => ({
    parentId,
    type: 'adverse_reaction',
    title: '⚠️ 订阅产品不良反应通报',
    content: `您关注的「${adverseReaction.product.name}」被通报新的不良反应：${adverseReaction.description}`,
    productId: adverseReaction.productId,
    relatedId: adverseReaction.id,
  }));

  await prisma.notification.createMany({
    data: notifications,
  });

  return { created: notifications.length, parentIds };
}

export async function notifyInspectionFailed(
  inspectionResult: InspectionResult & { product: Product },
): Promise<NotificationResult> {
  const subscriptions = await prisma.productSubscription.findMany({
    where: {
      productId: inspectionResult.productId,
      isActive: true,
      notifyOnInspection: true,
    },
  });

  const parentIds = subscriptions.map((s) => s.parentId);
  if (parentIds.length === 0) {
    return { created: 0, parentIds: [] };
  }

  const notifications = parentIds.map((parentId) => ({
    parentId,
    type: 'inspection_failed',
    title: '🚨 订阅产品抽检不合格',
    content: `您关注的「${inspectionResult.product.name}」抽检不合格，不合格项：${inspectionResult.unqualifiedItems || '未注明具体项目'}`,
    productId: inspectionResult.productId,
    relatedId: inspectionResult.id,
  }));

  await prisma.notification.createMany({
    data: notifications,
  });

  return { created: notifications.length, parentIds };
}

export async function notifyAllergenWarning(
  parentId: number,
  product: Product,
  allergenInfo: ReturnType<typeof checkProductAllergens>,
): Promise<NotificationResult> {
  if (!allergenInfo.hasAllergen || allergenInfo.matchedAllergens.length === 0) {
    return { created: 0, parentIds: [] };
  }

  const severeAllergens = allergenInfo.matchedAllergens.filter((a) => a.severity === '严重');
  const hasSevere = severeAllergens.length > 0;

  const allergenNames = allergenInfo.matchedAllergens
    .map((a) => `${a.allergenName}(${a.severity})`)
    .join('、');

  const existingNotification = await prisma.notification.findFirst({
    where: {
      parentId,
      productId: product.id,
      type: 'allergen_warning',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existingNotification) {
    return { created: 0, parentIds: [] };
  }

  await prisma.notification.create({
    data: {
      parentId,
      type: 'allergen_warning',
      title: hasSevere ? '🔴 严重过敏原警告' : '🟡 过敏原提醒',
      content: `您订阅的「${product.name}」含有您关注的过敏原：${allergenNames}。请谨慎使用！`,
      productId: product.id,
    },
  });

  return { created: 1, parentIds: [parentId] };
}

export async function checkAndNotifyAllergensOnSubscribe(
  parentId: number,
  productId: number,
): Promise<NotificationResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    return { created: 0, parentIds: [] };
  }

  const allergenProfiles = await prisma.allergenProfile.findMany({
    where: { parentId },
  });

  if (allergenProfiles.length === 0) {
    return { created: 0, parentIds: [] };
  }

  const allergenInfo = checkProductAllergens(product, allergenProfiles);
  return notifyAllergenWarning(parentId, product, allergenInfo);
}

export async function checkAndNotifyAllergensForAllSubscriptions(
  parentId: number,
): Promise<{ created: number; productIds: number[] }> {
  const allergenProfiles = await prisma.allergenProfile.findMany({
    where: { parentId },
  });

  if (allergenProfiles.length === 0) {
    return { created: 0, productIds: [] };
  }

  const subscriptions = await prisma.productSubscription.findMany({
    where: { parentId, isActive: true },
    include: { product: true },
  });

  let totalCreated = 0;
  const matchedProductIds: number[] = [];

  for (const sub of subscriptions) {
    const allergenInfo = checkProductAllergens(sub.product, allergenProfiles);
    if (allergenInfo.hasAllergen) {
      const result = await notifyAllergenWarning(parentId, sub.product, allergenInfo);
      if (result.created > 0) {
        totalCreated += result.created;
        matchedProductIds.push(sub.productId);
      }
    }
  }

  return { created: totalCreated, productIds: matchedProductIds };
}
