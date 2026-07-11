import Groq from 'groq-sdk';
import { supabase } from '../db';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error('Missing GROQ_API_KEY in environment');

const groq = new Groq({ apiKey });

export async function generateDailySummary(userId: string, date?: string): Promise<string> {
  const today = date ?? new Date().toISOString().slice(0, 10);

  const { data: tasks } = await supabase
    .from('tasks')
    .select('content, due_at, status')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .not('due_at', 'is', null)
    .order('due_at', { ascending: true });

  const todayTasks = tasks?.filter(
    (t) => t.due_at?.slice(0, 10) === today
  ) ?? [];

  const { data: dailyContext } = await supabase
    .from('daily_context')
    .select('calendar_events, expenses_summary, notes')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  const nearestTask = tasks?.[0] ?? null;

  const prompt = `أنت مساعد شخصي ودود. المستخدم طلب ملخص يومه. ارجع ملخص قصير بالعامية المصرية (جملتين أو تلاتة)، طبيعي ومش رسمي، فيه:

- عدد المهام النهاردة: ${todayTasks.length}
- أول مهمة: ${nearestTask ? `${nearestTask.content} الساعة ${nearestTask.due_at}` : 'مافيش مهام'}
- ملاحظات: ${dailyContext?.notes ?? 'مافيش'}
- أحداث اليوم: ${JSON.stringify(dailyContext?.calendar_events ?? [])}

لو مفيش مهام أو ملاحظات، قول كلمة تشجيعية بسيطة.`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'أنت مساعد شخصي ودود بتتكلم عامية مصرية. ردودك قصيرة وطبيعية ومش رسمية خالص.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
  });

  return completion.choices[0]?.message?.content ?? 'معنديش حاجة أقولها النهاردة';
}
