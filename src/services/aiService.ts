import Groq from 'groq-sdk';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error('Missing GROQ_API_KEY in environment');

const groq = new Groq({ apiKey });

function buildPrompt(): string {
  return `أنت مساعد ذكي يحول رسائل المستخدمين إلى JSON منظم. مهمتك فهم الرسائل بالعامية المصرية وتحديد الـ intent وإرجاع JSON فقط.

التاريخ والوقت الحالي: ${new Date().toISOString()}

القواعد:
- لو المستخدم طلب حاجة تتعمل (تذكير، مهمة)، الـ intent يكون "create_task" واستخرج المحتوى والتاريخ.
- لو سأل عن مهامه، الـ intent "list_tasks".
- لو قال إنه خلص حاجة، الـ intent "mark_done" والمحتوى يوصف المهمة.
- لو طلب ملخص اليوم، الـ intent "daily_summary".
- لو كان كلام عام أو سؤال مش مرتبط بالمهام، الـ intent "general_chat".
- التواريخ النسبية: "بكرة" = tomorrow، "بعد بكرة" = day after tomorrow، "الأسبوع الجاي" = next week، "الشهر الجاي" = next month، "الصبح" = 09:00، "الظهر" = 12:00، "العصر" = 15:00، "المغرب" = 18:00، "الليل" = 21:00، "الساعة X" الساعة المحددة.
- أي تاريخ نسبي تحوله إلى ISO date كامل.
- لو مفيش تاريخ، الـ due_at يكون null.

أرجع JSON فقط بالصيغة دي:
{
  "intent": "create_task" | "list_tasks" | "mark_done" | "daily_summary" | "general_chat",
  "content": "نص المهمة أو الرد",
  "due_at": "ISO date string or null"
}`;
}

interface AIResponse {
  intent: 'create_task' | 'list_tasks' | 'mark_done' | 'daily_summary' | 'general_chat';
  content: string;
  due_at: string | null;
}

export async function processMessage(message: string): Promise<AIResponse> {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: buildPrompt() },
      { role: 'user', content: message },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Empty response from Groq');

  try {
    return JSON.parse(text) as AIResponse;
  } catch {
    throw new Error('Invalid JSON response from Groq');
  }
}
