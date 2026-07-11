import Groq from 'groq-sdk';
import { supabase } from '../db';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error('Missing GROQ_API_KEY in environment');

const groq = new Groq({ apiKey });

export async function generateDailySummary(userId: string, date?: string): Promise<string> {
  const today = date ?? new Date().toISOString().slice(0, 10);
  const dayName = new Date(today).toLocaleDateString('ar-EG', { weekday: 'long' });

  const { data: tasks } = await supabase
    .from('tasks')
    .select('content, due_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('due_at', { ascending: true });

  const todayTasks = (tasks ?? []).filter(t => t.due_at?.slice(0, 10) === today);
  const overdueTasks = (tasks ?? []).filter(
    t => t.due_at && t.due_at.slice(0, 10) < today
  );
  const upcomingTasks = (tasks ?? []).filter(
    t => t.due_at && t.due_at.slice(0, 10) > today
  ).slice(0, 3);

  const { data: context } = await supabase
    .from('daily_context')
    .select('calendar_events, expenses_summary, notes')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  const events = (context?.calendar_events as string[]) ?? [];
  const notes = context?.notes ?? '';
  const expenses = context?.expenses_summary ?? '';

  const totalPending = tasks?.length ?? 0;
  const taskData = {
    dayName,
    todayCount: todayTasks.length,
    overdueCount: overdueTasks.length,
    upcomingCount: upcomingTasks.length,
    totalPending,
    todayTasks: todayTasks.map(t => `${t.content}${t.due_at ? ` (${new Date(t.due_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })})` : ''}`),
    overdueTasks: overdueTasks.map(t => t.content),
    upcomingTasks: upcomingTasks.map(t => `${t.content} — ${new Date(t.due_at!).toLocaleDateString('ar-EG', { weekday: 'long', month: 'long', day: 'numeric' })}`),
    events,
    notes,
    expenses,
  };

  const prompt = `أنت صديق المستخدم المقرب. النهاردة ${dayName}. كلمه بالعامية المصرية (كصاحب مش روبوت)، طبيعي وعفوي، بأسلوب "صاحبي" أو "يا باشا"..

معلومات اليوم:
- المهام النهاردة (${taskData.todayCount}): ${taskData.todayTasks.join(' | ') || 'مافيش'}
- مهام متأخرة (${taskData.overdueCount}): ${taskData.overdueTasks.join(' | ') || 'مافيش'}
- مهام جاية (${taskData.upcomingCount}): ${taskData.upcomingTasks.join(' | ') || 'مافيش'}
- الأحداث: ${taskData.events.join(' | ') || 'مافيش'}
- الملاحظات: ${taskData.notes || 'مافيش'}
- المصروفات: ${taskData.expenses || 'مافيش'}
- إجمالي المهام المعلقة: ${taskData.totalPending}

القواعد:
1. متكتبش عنوان ولا "صباح الخير" لو الـ reply دا لـ summary عادية (التوقيت بيتحط بره)
2. اختصر في جملتين أو تلاتة بالكتير
3. لو فاضيله حاجات كتير (>3) قوله بحس فكاهي "شغلك كتير 😅"
4. لو خلاص مافيش حاجة، قوله يريح ويخرج
5. لو فيه مهام متأخرة، ذكّره بلطف ودمها خفيف "فاكس كذا لسه واقفة 😬"
6. لو فيه أحداث النهاردة، قوله يستعد
7. متفششششششششششششش في الحديث أعمل رد قصير`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `أنت صديق المستخدم المقرب. بتتكلم عامية مصرية طبيعية. ردودك قصيرة (جملتين أو تلاتة بالكتير)، فيها روح ودمها خفيف. بتستخدم emoticons زي 😅😎👍❤️.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 300,
  });

  return completion.choices[0]?.message?.content?.trim() ?? 'صباح الفل يا صاحبي ☀️';
}
