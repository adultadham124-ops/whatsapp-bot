import cron from 'node-cron';
import { supabase } from '../db';
import { sendWhatsAppMessage } from './whatsappService';
import { generateDailySummary } from './dailySummaryService';

const isProcessing = { reminders: false, summaries: false };
const sentSummaries = new Set<string>();

function getLocalDate(tz: string) {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}
function getLocalHour(tz: string) {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }), 10);
}

const morningGreetings = [
  '☀️ صباح الفل!', '⏰ صباح النور!', '🌅 صباح الجمال!',
  '☀️ صباح الورد!', '🌄 صباح الأمل!',
];
function randomGreeting() { return morningGreetings[Math.floor(Math.random() * morningGreetings.length)]; }
function timeGreeting(h: number) {
  if (h < 12) return randomGreeting();
  if (h < 17) return ['⛅ عامل إيه؟', '🌤️ ازيك النهاردة؟', '☁️ ياه عامل إيه؟'][Math.floor(Math.random() * 3)];
  return ['🌆 مساء الخير', '🌇 ازيك في آخر النهار', '🌃 مساء الفل'][Math.floor(Math.random() * 3)];
}

async function scheduleNextRecurring(reminder: any) {
  if (!reminder.recurring) return;

  const next = new Date(reminder.remind_at);
  switch (reminder.recurring) {
    case 'daily': next.setDate(next.getDate() + 1); break;
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'monthly': next.setMonth(next.getMonth() + 1); break;
    case 'yearly': next.setFullYear(next.getFullYear() + 1); break;
    default: return;
  }

  await supabase.from('reminders').insert({
    entity_type: reminder.entity_type,
    entity_id: reminder.entity_id,
    user_id: reminder.user_id,
    remind_at: next.toISOString(),
    recurring: reminder.recurring,
  });
}

export async function processReminders(): Promise<void> {
  if (isProcessing.reminders) { console.log('[SCHEDULER] Skipping reminder run (in progress)'); return; }
  isProcessing.reminders = true;

  try {
    const { data: reminders } = await supabase
      .from('reminders')
      .select('*')
      .eq('sent', false)
      .lte('remind_at', new Date().toISOString());

    for (const r of reminders ?? []) {
      try {
        let msg = '';
        let phone = '';

        const { data: user } = await supabase
          .from('users')
          .select('phone_number')
          .eq('id', r.user_id)
          .single();
        if (!user) continue;
        phone = user.phone_number;

        switch (r.entity_type) {
          case 'task': {
            const { data: task } = await supabase
              .from('tasks')
              .select('content')
              .eq('id', r.entity_id)
              .single();
            if (!task) continue;
            const msgs = [
              `⏰ ${task.content} — بقولك متنساش!`,
              `تذكير 🔔 ${task.content}`,
              `فاكر ${task.content}؟ 😅`,
              `${task.content} ⏰ بقولك`,
            ];
            msg = msgs[Math.floor(Math.random() * msgs.length)];
            break;
          }
          case 'medication': {
            const { data: med } = await supabase
              .from('medications')
              .select('name, dosage')
              .eq('id', r.entity_id)
              .single();
            if (!med) continue;
            msg = `💊 ${med.name}${med.dosage ? ` (${med.dosage})` : ''} — حان الآن موعد الدواء!`;
            break;
          }
          case 'bill': {
            const { data: bill } = await supabase
              .from('bills')
              .select('name, amount, due_date')
              .eq('id', r.entity_id)
              .single();
            if (!bill) continue;
            msg = `🧾 "${bill.name}" مستحقة ب ${bill.amount} جنيه ${format(new Date(bill.due_date))} — متنساش تدفع!`;
            break;
          }
        }

        if (msg && phone) {
          await sendWhatsAppMessage(phone, msg);
          console.log(`[SCHEDULER] ${r.entity_type} reminder sent: ${r.id}`);
        }

        await supabase.from('reminders').update({ sent: true }).eq('id', r.id);
        await scheduleNextRecurring(r);
      } catch (e) {
        console.error('[SCHEDULER] Error processing reminder:', e);
      }
    }
  } finally { isProcessing.reminders = false; }
}

function format(d: Date) {
  return d.toLocaleDateString('ar-EG', { weekday: 'long', month: 'long', day: 'numeric' });
}

export async function sendDailySummaries(): Promise<void> {
  if (isProcessing.summaries) { console.log('[SCHEDULER] Skipping summary run'); return; }
  isProcessing.summaries = true;

  try {
    const { data: users } = await supabase.from('users').select('id, phone_number, timezone');

    for (const user of users ?? []) {
      try {
        const localDate = getLocalDate(user.timezone);
        const localHour = getLocalHour(user.timezone);
        const key = `${user.id}_${localDate}`;
        if (sentSummaries.has(key)) continue;
        if (localHour !== 7) continue;

        const summary = await generateDailySummary(user.id, localDate);
        await sendWhatsAppMessage(user.phone_number, `${timeGreeting(localHour)}\n\n${summary}`);
        sentSummaries.add(key);
        console.log(`[SCHEDULER] Summary sent to user ${user.id}`);
      } catch (e) {
        console.error('[SCHEDULER] Error sending summary:', e);
      }
    }
  } finally { isProcessing.summaries = false; }
}

export function startScheduler(): void {
  cron.schedule('* * * * *', () => {
    processReminders();
    sendDailySummaries();
  });
  console.log('[SCHEDULER] Started');
}
