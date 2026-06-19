import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { notifyAdverseReaction, notifyInspectionFailed } from '../utils/notificationService';

export const createAdverseReaction = async (req: Request, res: Response) => {
  try {
    const { productId, title, description, reportDate, source, severity } = req.body;

    if (!productId || !title || !description || !source || !severity) {
      return res.status(400).json({ error: '请填写完整信息' });
    }

    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
      include: { brand: true },
    });

    if (!product) {
      return res.status(404).json({ error: '产品不存在' });
    }

    const adverseReaction = await prisma.adverseReaction.create({
      data: {
        productId: parseInt(productId),
        title,
        description,
        reportDate: reportDate ? new Date(reportDate) : new Date(),
        source,
        severity,
      },
      include: {
        product: true,
      },
    });

    const notifiedCount = await notifyAdverseReaction(adverseReaction);

    res.json({
      success: true,
      data: adverseReaction,
      notifiedCount,
      message: `不良反应通报录入成功，已向 ${notifiedCount} 位订阅家长发送通知`,
    });
  } catch (error) {
    console.error('录入不良反应通报失败:', error);
    res.status(500).json({ error: '录入失败，请稍后重试' });
  }
};

export const createInspectionResult = async (req: Request, res: Response) => {
  try {
    const { productId, inspectionOrg, inspectionDate, result, unqualifiedItems, source } = req.body;

    if (!productId || !inspectionOrg || !result || !source) {
      return res.status(400).json({ error: '请填写完整信息' });
    }

    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
      include: { brand: true },
    });

    if (!product) {
      return res.status(404).json({ error: '产品不存在' });
    }

    const inspectionResult = await prisma.inspectionResult.create({
      data: {
        productId: parseInt(productId),
        inspectionOrg,
        inspectionDate: inspectionDate ? new Date(inspectionDate) : new Date(),
        result,
        unqualifiedItems: result === '不合格' ? unqualifiedItems : null,
        source,
      },
      include: {
        product: true,
      },
    });

    let notifiedCount = 0;
    if (result === '不合格') {
      notifiedCount = await notifyInspectionFailed(inspectionResult);
    }

    res.json({
      success: true,
      data: inspectionResult,
      notifiedCount,
      message:
        result === '不合格'
          ? `抽检不合格记录录入成功，已向 ${notifiedCount} 位订阅家长发送通知`
          : '抽检合格记录录入成功',
    });
  } catch (error) {
    console.error('录入抽检结果失败:', error);
    res.status(500).json({ error: '录入失败，请稍后重试' });
  }
};
