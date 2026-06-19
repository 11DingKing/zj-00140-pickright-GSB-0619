import prisma from './prisma';
import { checkProductAllergens } from './allergen';
import type { Product, AdverseReaction, InspectionResult } from '@prisma/client';

export async function notifyAdverseReaction(
  adverseReaction: AdverseReaction & { product: Product },
): Promise<number> {
  const subscriptions = await prisma.productSubscription.findMany({
    where: {
      productId: adverseReaction.productId,
      isActive: true,
      notifyOnAdverseReaction: true,
    },
  });

  if (subscriptions.length === 0) {
    return 0;
  }

  const notifications = subscriptions.map((sub) => ({
    parentId: sub.parentId,
    type: 'adverse_reaction',
    title: `⚠️ 订阅产品不良反应通报`,
    content: `您关注的「${adverseReaction.product.name}」被通报新的不良反应：${adverseReaction.description}`,
    productId: adverseReaction.productId,
    relatedId: adverseReaction.id,
  }));

  await prisma.notification.createMany({
    data: notifications,
  });

  return notifications.length;
}

export async function notifyInspectionFailed(
  inspectionResult: InspectionResult & { product: Product },
): Promise<number> {
  const subscriptions = await prisma.productSubscription.findMany({
    where: {
      productId: inspectionResult.productId,
      isActive: true,
      notifyOnInspection: true,
    },
  });

  if (subscriptions.length === 0) {
    return 0;
  }

  const notifications = subscriptions.map((sub) => ({
    parentId: sub.parentId,
    type: 'inspection_failed',
    title: `🚨 订阅产品抽检不合格`,
    content: `您关注的「${inspectionResult.product.name}」抽检不合格，不合格项：${inspectionResult.unqualifiedItems || '详见通报'}`,
    productId: inspectionResult.productId,
    relatedId: inspectionResult.id,
  }));

  await prisma.notification.createMany({
    data: notifications,
  });

  return notifications.length;
}

export async function checkProductAndNotifyAllergens(
  product: Product,
  parentId: number,
): Promise<boolean> {
  const allergenProfiles = await prisma.allergenProfile.findMany({
    where: { parentId },
  });

  if (allergenProfiles.length === 0) {
    return false;
  }

  const allergenInfo = checkProductAllergens(product, allergenProfiles);

  if (!allergenInfo.hasAllergen) {
    return false;
  }

  const existingNotification = await prisma.notification.findFirst({
    where: {
      parentId,
      productId: product.id,
      type: 'allergen_warning',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existingNotification) {
    return false;
  }

  const allergenNames = allergenInfo.matchedAllergens
    .map((a) => `${a.allergenName}(${a.severity})`)
    .join('、');
  const foundIngredients = [
    ...new Set(allergenInfo.matchedAllergens.flatMap((a) => a.foundIn)),
  ].join('、');

  await prisma.notification.create({
    data: {
      parentId,
      type: 'allergen_warning',
      title: `🌿 过敏原风险提醒`,
      content: `您订阅的「${product.name}」含有您关注的过敏原：${allergenNames}。涉及成分：${foundIngredients}，请谨慎使用。`,
      productId: product.id,
      relatedId: null,
    },
  });

  return true;
}

export async function checkAllSubscribedProductsForParent(parentId: number): Promise<number> {
  const allergenProfiles = await prisma.allergenProfile.findMany({
    where: { parentId },
  });

  if (allergenProfiles.length === 0) {
    return 0;
  }

  const subscriptions = await prisma.productSubscription.findMany({
    where: {
      parentId,
      isActive: true,
    },
    include: {
      product: true,
    },
  });

  let notifyCount = 0;

  for (const sub of subscriptions) {
    const notified = await checkProductAndNotifyAllergens(sub.product, parentId);
    if (notified) {
      notifyCount++;
    }
  }

  return notifyCount;
}
