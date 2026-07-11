import Groq from 'groq-sdk';
import { supabase } from '../db';
import { getWaterToday } from './healthService';
import { getMonthlySummary } from './expenseService';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error('Missing GROQ_API_KEY');

const groq = new Groq({ apiKey });

export async function generateDailySummary(userId: string, date?: string): Promise<string> {
  const today = date ?? new Date().toISOString().slice(0, 10);
  const dayName = new Date(today).toLocaleDateString('ar-EG', { weekday: 'long' });

  // --- Collect all data ---
  const { data: tasks } = await supabase
    .from('tasks')
    .select('content, due_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('due_at', { ascending: true });

  const todayTasks = (tasks ?? []).filter(t => t.due_at?.slice(0, 10) === today);
  const overdueTasks = (tasks ?? []).filter(t => t.due_at && t.due_at.slice(0, 10) < today);
  const totalPending = tasks?.length ?? 0;

  const { data: meds } = await supabase
    .from('medications')
    .select('name, times')
    .eq('user_id', userId)
    .eq('active', true);

  const water = await getWaterToday(userId, today);

  const { data: sleep } = await supabase
    .from('sleep_log')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  const { data: bills } = await supabase
    .from('bills')
    .select('name, amount, due_date, status')
    .eq('user_id', userId)
    .in('status', ['pending', 'overdue'])
    .order('due_date', { ascending: true });

  const { data: goals } = await supabase
    .from('goals')
    .select('title, progress, target_date')
    .eq('user_id', userId)
    .eq('status', 'in_progress')
    .order('target_date', { ascending: true });

  let expenses = '';
  try {
    const s = await getMonthlySummary(userId);
    expenses = `المصاريف: ${s.expenses} جنيه, الدخل: ${s.income} جنيه`;
  } catch { /* ignore */ }

  // --- Build AI prompt ---
  const info = [
    todayTasks.length ? `مهام النهاردة (${todayTasks.length}): ${todayTasks.map(t => `${t.content}${t.due_at ? ` (${new Date(t.due_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })})` : ''}`).join(', ')}` : '',
    overdueTasks.length ? `مهام متأخرة (${overdueTasks.length}) ⚠️` : '',
    totalPending ? `إجمالي المهام: ${totalPending}` : '',
    meds?.length ? `الأدوية: ${meds.map(m => `${m.name} (${(m.times as string[]).join('-')})`).join(', ')}` : '',
    water.total > 0 ? `المياه: ${water.total}/${water.target} مل` : '',
    sleep ? `النوم: ${sleep.bedtime?.toString().slice(11, 16)}${sleep.wake_time ? ` - ${sleep.wake_time.toString().slice(11, 16)}` : ''}${sleep.quality ? ` ⭐${'⭐'.repeat(sleep.quality)}` : ''}` : '',
    bills?.length ? `فواتير مستحقة (${bills.length}): ${bills.slice(0, 3).map(b => `${b.name} ${b.amount}ج`).join(', ')}${bills.length > 3 ? ` و ${bills.length - 3} تاني` : ''}` : '',
    goals?.length ? `الأهداف: ${goals.map(g => `${g.title} (${g.progress}%)`).join(', ')}` : '',
    expenses,
  ].filter(Boolean).join('\n');

  const prompt = `أنت صديق المستخدم المقرب. النهاردة ${dayName}. كلمه بالعامية المصرية كصاحب مش روبوت.

عنده النهاردة:\n${info || 'مافيش حاجة مسجلة'}

القواعد:
- رد في جملتين أو تلاتة بالكتير
- لو مافيش حاجة قوله كلمة تشجيعية
- لو فاضيله حاجات كتير، قوله بحس فكاهي "شغلك كتير 😅"
- لو مفيش مياه، ذكّره يشرب 💧
- لو فاتورة متأخرة، ذكّره`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'صديق حميم بالعامية المصرية. ردود قصيرة جملتين تلاتة. فيها روح ودمها خفيف. 😅😎👍❤️' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 300,
  });

  return completion.choices[0]?.message?.content?.trim() ?? 'صباح الفل ☀️';
}
