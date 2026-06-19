import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { dispatchAdverseReactionNotifications } from '../services/notificationService';

/**
 * 创建一条不良反应通报，并自动给订阅了对应产品且开启提醒开关的家长派发通知
 */
export const createAdverseReaction = async (req: Request, res: Response) => {
  try {
    const { productId, title, description, reportDate, source, severity } = req.body;

    if (!productId || !title || !description || !reportDate || !source || !severity) {
      return res.status(400).json({ error: '请填写完整的不良反应通报信息' });
    }

    if (!['一般', '严重'].includes(severity)) {
      return res.status(400).json({ error: '严重程度必须为 一般 或 严重' });
    }

    const product = await prisma.product.findUnique({ where: { id: parseInt(productId) } });
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
    });

    const notifiedCount = await dispatchAdverseReactionNotifications({
      ...adverseReaction,
      product,
    });

    res.json({
      success: true,
      data: adverseReaction,
      notifiedCount,
      message: `已录入不良反应通报，向 ${notifiedCount} 位订阅家长发送通知`,
    });
  } catch (error) {
    console.error('录入不良反应通报失败:', error);
    res.status(500).json({ error: '录入不良反应通报失败' });
  }
};

/**
 * 获取某产品的不良反应通报列表
 */
export const getAdverseReactionsByProduct = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const list = await prisma.adverseReaction.findMany({
      where: { productId: parseInt(productId) },
      orderBy: { reportDate: 'desc' },
    });
    res.json({ success: true, data: list });
  } catch (error) {
    console.error('获取不良反应通报失败:', error);
    res.status(500).json({ error: '获取不良反应通报失败' });
  }
};
