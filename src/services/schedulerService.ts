import cron from 'node-cron';
import { supabase } from '../db';
import { sendWhatsAppMessage } from './whatsappService';
import { generateDailySummary } from './dailySummaryService';

const isProcessing = { reminders: false, summaries: false };
const sentSummaries = new Set<string>();

function getLocalDate(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

function getLocalHour(timezone: string): number {
  return parseInt(
    new Date().toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }),
    10
  );
}

export async function processReminders(): Promise<void> {
  if (isProcessing.reminders) {
    console.log('[SCHEDULER] Previous reminder run still in progress, skipping');
    return;
  }

  isProcessing.reminders = true;

  try {
    const { data: reminders, error } = await supabase
      .from('reminders')
      .select('id, task_id, tasks!inner(user_id, content)')
      .eq('sent', false)
      .lte('remind_at', new Date().toISOString());

    if (error) {
      console.error('[SCHEDULER] Error fetching reminders:', error.message);
      return;
    }

    for (const reminder of reminders || []) {
      try {
        const task = reminder.tasks as unknown as { user_id: string; content: string };
        const user_id = task?.user_id;
        const content = task?.content;

        if (!user_id || !content) {
          console.error('[SCHEDULER] Invalid reminder data:', reminder.id);
          continue;
        }

        const { data: user } = await supabase
          .from('users')
          .select('phone_number')
          .eq('id', user_id)
          .single();

        if (!user) {
          console.error('[SCHEDULER] User not found:', user_id);
          continue;
        }

        await sendWhatsAppMessage(user.phone_number, `تذكير: ${content}`);

        const { error: updateError } = await supabase
          .from('reminders')
          .update({ sent: true })
          .eq('id', reminder.id);

        if (updateError) {
          console.error('[SCHEDULER] Error updating reminder:', updateError.message);
        } else {
          console.log(`[SCHEDULER] Reminder ${reminder.id} sent`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[SCHEDULER] Error processing reminder:', message);
      }
    }
  } finally {
    isProcessing.reminders = false;
  }
}

export async function sendDailySummaries(): Promise<void> {
  if (isProcessing.summaries) {
    console.log('[SCHEDULER] Previous summary run still in progress, skipping');
    return;
  }

  isProcessing.summaries = true;

  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, phone_number, timezone');

    if (error) {
      console.error('[SCHEDULER] Error fetching users:', error.message);
      return;
    }

    for (const user of users || []) {
      try {
        const localDate = getLocalDate(user.timezone);
        const localHour = getLocalHour(user.timezone);
        const key = `${user.id}_${localDate}`;

        if (sentSummaries.has(key)) continue;

        if (localHour !== 7) continue;

        // Check if user has anything today before calling AI
        const { count: taskCount } = await supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .gte('due_at', `${localDate}T00:00:00`)
          .lte('due_at', `${localDate}T23:59:59`);

        const { count: contextCount } = await supabase
          .from('daily_context')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('date', localDate);

        const hasContent = (taskCount ?? 0) > 0 || (contextCount ?? 0) > 0;
        if (!hasContent) continue;

        const summary = await generateDailySummary(user.id, localDate);
        await sendWhatsAppMessage(user.phone_number, `☀️ صباح الخير!\n\n${summary}`);

        sentSummaries.add(key);
        console.log(`[SCHEDULER] Daily summary sent to user ${user.id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[SCHEDULER] Error sending summary:', message);
      }
    }
  } finally {
    isProcessing.summaries = false;
  }
}

export function startScheduler(): void {
  cron.schedule('* * * * *', () => {
    processReminders();
    sendDailySummaries();
  });

  console.log('[SCHEDULER] Started — checking reminders & daily summaries every minute');
}
