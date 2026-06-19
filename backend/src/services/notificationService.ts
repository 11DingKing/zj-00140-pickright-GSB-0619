import prisma from '../utils/prisma';
import { checkProductAllergens } from '../utils/allergen';
import type { AdverseReaction, InspectionResult, Product } from '@prisma/client';

/**
 * 为指定不良反应记录派发通知
 * 命中条件：所有订阅该产品、且开启了 notifyOnAdverseReaction 开关的家长
 */
export async function dispatchAdverseReactionNotifications(
  adverseReaction: AdverseReaction & { product?: Product | null },
): Promise<number> {
  const product =
    adverseReaction.product ||
    (await prisma.product.findUnique({ where: { id: adverseReaction.productId } }));

  if (!product) {
    return 0;
  }

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

  const severityIcon = adverseReaction.severity === '严重' ? '🚨' : '⚠️';
  const data = subscriptions.map((sub) => ({
    parentId: sub.parentId,
    type: 'adverse_reaction',
    title: `${severityIcon} 订阅产品不良反应通报`,
    content: `您关注的「${product.name}」被通报新的不良反应：${adverseReaction.title}。${adverseReaction.description}`,
    productId: product.id,
    relatedId: adverseReaction.id,
  }));

  await prisma.notification.createMany({ data });
  return data.length;
}

/**
 * 为指定抽检记录派发通知
 * 仅在 result 为「不合格」时派发，命中条件：订阅该产品且开启 notifyOnInspection 的家长
 */
export async function dispatchInspectionNotifications(
  inspection: InspectionResult & { product?: Product | null },
): Promise<number> {
  if (inspection.result !== '不合格') {
    return 0;
  }

  const product =
    inspection.product ||
    (await prisma.product.findUnique({ where: { id: inspection.productId } }));

  if (!product) {
    return 0;
  }

  const subscriptions = await prisma.productSubscription.findMany({
    where: {
      productId: inspection.productId,
      isActive: true,
      notifyOnInspection: true,
    },
  });

  if (subscriptions.length === 0) {
    return 0;
  }

  const data = subscriptions.map((sub) => ({
    parentId: sub.parentId,
    type: 'inspection_failed',
    title: `🚨 订阅产品抽检不合格`,
    content: `您关注的「${product.name}」被${inspection.inspectionOrg}抽检不合格${
      inspection.unqualifiedItems ? `，不合格项：${inspection.unqualifiedItems}` : ''
    }。`,
    productId: product.id,
    relatedId: inspection.id,
  }));

  await prisma.notification.createMany({ data });
  return data.length;
}

/**
 * 检测家长某产品订阅是否命中其过敏原档案，命中则生成 allergen_warning 通知
 * 用于：1) 家长订阅新产品时；2) 家长新增过敏原档案时（遍历其所有订阅）
 *
 * 防重：同一 (parentId, productId) 已存在未读 allergen_warning 时不重复创建
 */
export async function dispatchAllergenWarningForSubscription(
  parentId: number,
  productId: number,
): Promise<boolean> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return false;

  const profiles = await prisma.allergenProfile.findMany({ where: { parentId } });
  if (profiles.length === 0) return false;

  const matchResult = checkProductAllergens(product, profiles);
  if (!matchResult.hasAllergen) return false;

  const existing = await prisma.notification.findFirst({
    where: {
      parentId,
      productId,
      type: 'allergen_warning',
      isRead: false,
    },
  });
  if (existing) return false;

  const matchedNames = matchResult.matchedAllergens.map((m) => m.allergenName).join('、');
  const foundIngredients = Array.from(
    new Set(matchResult.matchedAllergens.flatMap((m) => m.foundIn)),
  ).join('、');
  const maxSeverity = matchResult.matchedAllergens.reduce((acc, m) => {
    const order = { 严重: 3, 中度: 2, 轻微: 1 } as Record<string, number>;
    return (order[m.severity] || 0) > (order[acc] || 0) ? m.severity : acc;
  }, '轻微');
  const icon = maxSeverity === '严重' ? '🚨' : maxSeverity === '中度' ? '⚠️' : '🔔';

  await prisma.notification.create({
    data: {
      parentId,
      type: 'allergen_warning',
      title: `${icon} 订阅产品命中过敏原`,
      content: `您订阅的「${product.name}」含有您标记的过敏原：${matchedNames}。涉及成分：${foundIngredients}。`,
      productId,
      relatedId: null,
    },
  });

  return true;
}

/**
 * 当家长新增/更新一条过敏原档案后，遍历其所有活跃订阅，对命中的产品生成 allergen_warning
 */
export async function dispatchAllergenWarningForProfile(parentId: number): Promise<number> {
  const subscriptions = await prisma.productSubscription.findMany({
    where: { parentId, isActive: true },
  });

  let created = 0;
  for (const sub of subscriptions) {
    const ok = await dispatchAllergenWarningForSubscription(parentId, sub.productId);
    if (ok) created += 1;
  }
  return created;
}
