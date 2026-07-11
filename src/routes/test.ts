import { Router, Request, Response } from 'express';
import { handleIncomingMessage } from '../services/messageHandler';

const router = Router();

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const from = req.body.From?.replace('whatsapp:', '') || req.body.From;
    const body = req.body.Body?.trim();

    if (!from || !body) {
      res.status(400).json({ error: 'Missing From or Body' });
      return;
    }

    const reply = await handleIncomingMessage(from, body);
    res.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
