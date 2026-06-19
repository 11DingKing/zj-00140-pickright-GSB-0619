import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { dispatchInspectionNotifications } from '../services/notificationService';

/**
 * 录入一条抽检结果，若结果为「不合格」则给订阅该产品且开启提醒的家长派发通知
 */
export const createInspectionResult = async (req: Request, res: Response) => {
  try {
    const { productId, inspectionOrg, inspectionDate, result, unqualifiedItems, source } = req.body;

    if (!productId || !inspectionOrg || !inspectionDate || !result || !source) {
      return res.status(400).json({ error: '请填写完整的抽检结果信息' });
    }

    if (!['合格', '不合格'].includes(result)) {
      return res.status(400).json({ error: '抽检结果必须为 合格 或 不合格' });
    }

    if (result === '不合格' && !unqualifiedItems) {
      return res.status(400).json({ error: '不合格抽检必须填写不合格项目' });
    }

    const product = await prisma.product.findUnique({ where: { id: parseInt(productId) } });
    if (!product) {
      return res.status(404).json({ error: '产品不存在' });
    }

    const inspection = await prisma.inspectionResult.create({
      data: {
        productId: parseInt(productId),
        inspectionOrg,
        inspectionDate: new Date(inspectionDate),
        result,
        unqualifiedItems: unqualifiedItems || null,
        source,
      },
    });

    const notifiedCount = await dispatchInspectionNotifications({
      ...inspection,
      product,
    });

    res.json({
      success: true,
      data: inspection,
      notifiedCount,
      message:
        result === '不合格'
          ? `已录入抽检不合格记录，向 ${notifiedCount} 位订阅家长发送通知`
          : '已录入抽检合格记录',
    });
  } catch (error) {
    console.error('录入抽检结果失败:', error);
    res.status(500).json({ error: '录入抽检结果失败' });
  }
};

/**
 * 获取某产品的抽检结果列表
 */
export const getInspectionResultsByProduct = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const list = await prisma.inspectionResult.findMany({
      where: { productId: parseInt(productId) },
      orderBy: { inspectionDate: 'desc' },
    });
    res.json({ success: true, data: list });
  } catch (error) {
    console.error('获取抽检结果失败:', error);
    res.status(500).json({ error: '获取抽检结果失败' });
  }
};
