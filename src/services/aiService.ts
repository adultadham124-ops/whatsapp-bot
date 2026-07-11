import Groq from 'groq-sdk';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error('Missing GROQ_API_KEY in environment');

const groq = new Groq({ apiKey });

export interface AIResponse {
  intent:
    | 'create_task' | 'list_tasks' | 'mark_done'
    | 'daily_summary'
    | 'add_expense' | 'add_income' | 'monthly_summary' | 'set_budget'
    | 'add_medication' | 'list_medications'
    | 'log_water' | 'water_status'
    | 'log_sleep' | 'sleep_status'
    | 'add_bill' | 'list_bills' | 'pay_bill'
    | 'add_goal' | 'list_goals' | 'goal_progress'
    | 'get_weather'
    | 'general_chat';
  content: string;
  due_at: string | null;
  extra?: Record<string, unknown>;
}

export async function analyzeIntent(message: string): Promise<AIResponse> {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `أنت محلل نصوص ذكي بالعامية المصرية. حدد نية المستخدم وارجع JSON فقط.
القاعدة الأولى: لو الكلام عادي أو سؤال أو حوار → general_chat دايمًا.

التاريخ والوقت الحالي: ${new Date().toISOString()}

القواعد:
- مهمة/تذكير → create_task
- سؤال عن المهام → list_tasks
- خلصت حاجة → mark_done
- ملخص يومي → daily_summary
- مصروف/دفعت → add_expense (extra: { category, amount })
- قبضت/دخل → add_income (extra: { category, amount })
- ملخص مصاريف → monthly_summary
- ميزانية → set_budget (extra: { category, amount })
- دواء → add_medication (extra: { dosage, times })
- عاوز أدويتي → list_medications
- شربت مية → log_water (extra: { amount_ml })
- عاوز كام شربت → water_status
- نمت → log_sleep (extra: { bedtime })
- عاوز نومي → sleep_status
- فاتورة/اشتراك → add_bill (extra: { amount, frequency: "monthly"|"yearly"|"quarterly"|"one_time" })
- عاوز فواتيري → list_bills
- دفعت الفاتورة → pay_bill
- هدف → add_goal (extra: { type: "monthly"|"yearly"|"custom", target_date })
- عاوز أهدافي → list_goals
- تقدم هدف → goal_progress (extra: { progress })
- الطقس/الجو → get_weather (extra: { location })

أمثلة general_chat: "ازيك" "عامل ايه" "اخبارك" "عامل ايه النهاردة" "كلمني" "ضحكني" "حاسس بكسل" "ممكن اسالك" "عندي فضول" "تعرف" "ايه رايك"

التواريخ: "بكرة"=غداً، "كمان ساعة"=بعد ساعة

أرجع JSON:
{
  "intent": "...",
  "content": "نص أو وصف مختصر",
  "due_at": null,
  "extra": {}
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
  const now = new Date();
  const systemPrompt = `أنت صديق المستخدم المقرب ومساعده الشخصي. بتتكلم عامية مصرية طبيعية جدًا وودودة.

شخصيتك:
- صديق حميم مش موظف خدمة عملاء
- عندك حس فكاهي خفيف
- بتستخدم emoticons (:D , :P , <3)
- بتفتكر تفاصيل وتساعد

مهمتك:
- اسأل صباح الخير واقترح حاجات
- تابع: مصاريفه, أدويته, ميته, نومه, فواتيره, أهدافه
- ذكّره بلطف لو ناسي حاجة
- خلي الكلام طبيعي

التاريخ: ${now.toISOString().slice(0, 10)}
الوقت: ${now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
اليوم: ${now.toLocaleDateString('ar-EG', { weekday: 'long' })}
${context ? `\nسياق:\n${context}` : ''}`;

  const messages = [
    { role: 'system', content: systemPrompt } as const,
    ...history.slice(-10).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
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
