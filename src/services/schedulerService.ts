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

const morningGreetings = [
  '☀️ صباح الفل يا صاحبي!',
  '⏰ صباح النور والسرور!',
  '🌅 صباح الجمال يا باشا!',
  '☀️ يوه صباح الفل!',
  '🌄 صباح الورد!',
  '⏰ صباح الأمل والتفاؤل!',
];

function randomGreeting(): string {
  return morningGreetings[Math.floor(Math.random() * morningGreetings.length)];
}

function timeAwareGreeting(hour: number): string {
  if (hour < 12) return randomGreeting();
  if (hour < 17) return [
    '⛅ مساء الخفيف! عامل إيه النهاردة؟',
    '🌤️ ياه، النهاردة عامل إيه؟',
    '☁️ ازيك النهاردة؟',
  ][Math.floor(Math.random() * 3)];
  return [
    '🌆 مساء الخير، عامل إيه؟',
    '🌇 ازيك في آخر النهار؟',
    '🌃 مساء الفل، مالك النهاردة؟',
  ][Math.floor(Math.random() * 3)];
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

    const reminderMessages = [
      (c: string) => `⏰ ${c} — بقولك متنساش!`,
      (c: string) => `تنبيه 🔔 ${c} دلوقتي يا صاحبي`,
      (c: string) => `فاكر ${c}؟ 😅 ميحصلكش`,
      (c: string) => `${c} ⏰ بكلمك عشان متنساش`,
      (c: string) => `يالهوي ${c} 😬 فضلت أذكرك`,
    ];

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

        const msg = reminderMessages[Math.floor(Math.random() * reminderMessages.length)](content);
        await sendWhatsAppMessage(user.phone_number, msg);

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

        // Send even if no tasks — just a friendly check-in
        const summary = await generateDailySummary(user.id, localDate);
        const greeting = timeAwareGreeting(localHour);
        const fullMessage = `${greeting}\n\n${summary}`;

        await sendWhatsAppMessage(user.phone_number, fullMessage);

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
