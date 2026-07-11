import { Router, Response } from 'express';
import { supabase } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

// POST /api/tasks
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { content, due_at } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'content is required and must be a non-empty string' });
      return;
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert({ user_id: req.userId, content: content.trim(), due_at: due_at || null })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /api/tasks
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from('tasks')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (status && typeof status === 'string' && ['pending', 'done', 'snoozed'].includes(status)) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// PATCH /api/tasks/:id
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, content, due_at } = req.body;

    const updates: Record<string, unknown> = {};
    if (status !== undefined) {
      if (!['pending', 'done', 'snoozed'].includes(status)) {
        res.status(400).json({ error: 'Invalid status value' });
        return;
      }
      updates.status = status;
    }
    if (content !== undefined) {
      if (typeof content !== 'string' || !content.trim()) {
        res.status(400).json({ error: 'content must be a non-empty string' });
        return;
      }
      updates.content = content.trim();
    }
    if (due_at !== undefined) updates.due_at = due_at;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Task not found or unauthorized' });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId)
      .select();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    if (!data || data.length === 0) {
      res.status(404).json({ error: 'Task not found or unauthorized' });
      return;
    }

    res.json({ message: 'Task deleted successfully' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
