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
    include: {
      parent: true,
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
    isRead: false,
  }));

  await prisma.notification.createMany({
    data: notifications,
  });

  return notifications.length;
}

export async function notifyInspectionFailed(
  inspectionResult: InspectionResult & { product: Product },
): Promise<number> {
  if (inspectionResult.result !== '不合格') {
    return 0;
  }

  const subscriptions = await prisma.productSubscription.findMany({
    where: {
      productId: inspectionResult.productId,
      isActive: true,
      notifyOnInspection: true,
    },
    include: {
      parent: true,
    },
  });

  if (subscriptions.length === 0) {
    return 0;
  }

  const notifications = subscriptions.map((sub) => ({
    parentId: sub.parentId,
    type: 'inspection_failed',
    title: `🚨 订阅产品抽检不合格`,
    content: `您关注的「${inspectionResult.product.name}」抽检不合格，不合格项：${inspectionResult.unqualifiedItems || '未注明'}`,
    productId: inspectionResult.productId,
    relatedId: inspectionResult.id,
    isRead: false,
  }));

  await prisma.notification.createMany({
    data: notifications,
  });

  return notifications.length;
}

export async function checkAndNotifyAllergenOnSubscribe(
  parentId: number,
  product: Product,
): Promise<number> {
  const allergenProfiles = await prisma.allergenProfile.findMany({
    where: { parentId },
  });

  if (allergenProfiles.length === 0) {
    return 0;
  }

  const allergenInfo = checkProductAllergens(product, allergenProfiles);

  if (!allergenInfo.hasAllergen || allergenInfo.matchedAllergens.length === 0) {
    return 0;
  }

  const matchedNames = allergenInfo.matchedAllergens
    .map((m) => `${m.allergenName}(${m.severity})`)
    .join('、');

  const existingNotification = await prisma.notification.findFirst({
    where: {
      parentId,
      productId: product.id,
      type: 'allergen_warning',
    },
  });

  if (existingNotification) {
    return 0;
  }

  await prisma.notification.create({
    data: {
      parentId,
      type: 'allergen_warning',
      title: `🔴 过敏原警告`,
      content: `您订阅的「${product.name}」中含有您或孩子过敏的成分：${matchedNames}，请谨慎使用！`,
      productId: product.id,
      isRead: false,
    },
  });

  return 1;
}

export async function notifyAllergenForExistingSubscriptions(
  product: Product,
  allergenProfiles: any[],
): Promise<number> {
  if (allergenProfiles.length === 0) {
    return 0;
  }

  const subscriptions = await prisma.productSubscription.findMany({
    where: {
      productId: product.id,
      isActive: true,
    },
    include: {
      parent: {
        include: {
          allergenProfiles: true,
        },
      },
    },
  });

  let createdCount = 0;

  for (const sub of subscriptions) {
    const parentAllergenProfiles = sub.parent.allergenProfiles;
    if (parentAllergenProfiles.length === 0) continue;

    const allergenInfo = checkProductAllergens(product, parentAllergenProfiles);
    if (!allergenInfo.hasAllergen) continue;

    const existingNotification = await prisma.notification.findFirst({
      where: {
        parentId: sub.parentId,
        productId: product.id,
        type: 'allergen_warning',
      },
    });

    if (existingNotification) continue;

    const matchedNames = allergenInfo.matchedAllergens
      .map((m) => `${m.allergenName}(${m.severity})`)
      .join('、');

    await prisma.notification.create({
      data: {
        parentId: sub.parentId,
        type: 'allergen_warning',
        title: `🔴 过敏原警告`,
        content: `您订阅的「${product.name}」中含有您或孩子过敏的成分：${matchedNames}，请谨慎使用！`,
        productId: product.id,
        isRead: false,
      },
    });

    createdCount++;
  }

  return createdCount;
}
