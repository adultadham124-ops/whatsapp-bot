import Groq from 'groq-sdk';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error('Missing GROQ_API_KEY in environment');

const groq = new Groq({ apiKey });

export interface AIResponse {
  intent: 'create_task' | 'list_tasks' | 'mark_done' | 'daily_summary' | 'general_chat';
  content: string;
  due_at: string | null;
}

export async function analyzeIntent(message: string): Promise<AIResponse> {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `أنت محلل نصوص بتحدد نية المستخدم من رسالته بالعامية المصرية. ارجع JSON فقط.

التاريخ والوقت الحالي: ${new Date().toISOString()}

القواعد:
- لو طلب حاجة تتعمل (تذكير، مهمة) → intent: "create_task"
- لو سأل عن مهامه أو عاوز يشوفها → intent: "list_tasks"
- لو قال إنه خلص حاجة أو عاوز يشطبها → intent: "mark_done"
- لو طلب ملخص أو عاوز يعرف يومه → intent: "daily_summary"
- أي كلام تاني → intent: "general_chat"

التواريخ النسبية للعامية المصرية:
"بكرة" = tomorrow, "بعد بكرة" = day after tomorrow
"الأسبوع الجاي" = next week, "الشهر الجاي" = next month
"الصبح" = 09:00, "الظهر" = 12:00, "العصر" = 15:00
"المغرب" = 18:00, "الليل" = 21:00
"كمان دقيقة" = 1 minute from now
"كمان ساعة" = 1 hour from now
"كمان كذا دقيقة/ساعة" = حسب الرقم

حوّل أي تاريخ نسبي إلى ISO date كامل. لو مفيش تاريخ، due_at = null.

content: وصف المهمة (للـ create_task/mark_done) أو رسالة المستخدم نفسها (لـ general_chat)

أرجع JSON:
{
  "intent": "create_task" | "list_tasks" | "mark_done" | "daily_summary" | "general_chat",
  "content": "نص مختصر",
  "due_at": "ISO date or null"
}`,
      },
      { role: 'user', content: message },
    ],
    temperature: 0.05,
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

export async function chat(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  context?: string
): Promise<string> {
  const systemPrompt = `أنت صديق المستخدم المقرب ومساعده الشخصي. بتتكلم عامية مصرية طبيعية جدًا وودودة. مش روبوت ولا رسمي.

شخصيتك:
- صديق حميم، بتتكلم زي صاحبك مش موظف خدمة عملاء
- فاكرهومساعد، بتفتكر تفاصيل وأيام الأسبوع
- عندك حس فكاهي خفيف
- بتستخدم emoticons (:D , :P , <3) بطريقة طبيعية
- لو المستخدم قال حاجة حزينة، تتفهم وتحاول تشجع
- لو قال حاجة مضحكة، تضحك معاه
- مبتقولش "كيف أقدر أساعدك" ولا أي حاجة رسمية

مهمتك:
- اسأل صباح الخير واقترح حاجات يعملها النهاردة
- ذكرني بالمهام المتأخرة أو القريبة
- لو عرفت إنه ناسي حاجة، ذكّره بلطف
- اسأله عن يومه واهتماماته
- خلي الكلام طبيعي مش متكلف

التاريخ والوقت الحالي: ${new Date().toISOString()}
${context ? `\nسياق إضافي عن المستخدم حالياً:\n${context}` : ''}`;

  const messages = [
    { role: 'system', content: systemPrompt } as const,
    ...history.slice(-10).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: message } as const,
  ];

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.8,
    max_tokens: 500,
  });

  return completion.choices[0]?.message?.content ?? '';
}
