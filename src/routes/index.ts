import { Router } from 'express';
import tasksRouter from './tasks';
import webhookRouter from './webhook';
import testRouter from './test';

const router = Router();

router.use('/tasks', tasksRouter);
router.use('/webhook', webhookRouter);
router.use('/test', testRouter);

export default router;
