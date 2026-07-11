import { Router, Request, Response } from 'express';
import { handleIncomingMessage } from '../services/messageHandler';

const router = Router();

router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    const from = req.body.From?.replace('whatsapp:', '');
    const body = req.body.Body?.trim();

    if (!from || !body) {
      res.status(400).json({ error: 'Missing From or Body' });
      return;
    }

    // Respond immediately to Twilio, then process async
    res.status(200).end();

    await handleIncomingMessage(from, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[WEBHOOK] Error:', message);
  }
});

export default router;
