import { supabase } from '../db';
import { analyzeAndReply } from './aiService';
import { sendWhatsAppMessage } from './whatsappService';
import { generateDailySummary } from './dailySummaryService';
import { addTransaction, getMonthlySummary, setBudget } from './expenseService';
import { addMedication, getActiveMedications, deactivateMedication } from './medicationService';
import { logWater, getWaterToday, logSleep, getSleepWeek } from './healthService';
import { addBill, getPendingBills, markBillPaid } from './billService';
import { addGoal, getActiveGoals, updateGoalProgress } from './goalService';
import { getWeather } from './weatherService';

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString('ar-EG', { weekday: 'long', month: 'long', day: 'numeric' });
}

async function getHistory(userId: string, limit = 8) {
  const { data } = await supabase
    .from('conversations')
    .select('role, message')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).reverse().map(c => ({ role: c.role as 'user' | 'assistant', content: c.message }));
}

async function getPendingContext(userId: string) {
  const parts: string[] = [];
  const { data: tasks } = await supabase
    .from('tasks')
    .select('content, due_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('due_at', { ascending: true })
    .limit(5);
  if (tasks?.length) {
    parts.push('المهام: ' + tasks.map(t => `${t.content}${t.due_at ? ` (${formatDate(t.due_at)})` : ''}`).join(', '));
  }
  const water = await getWaterToday(userId);
  if (water.total > 0) parts.push(`الميه: ${water.total}/${water.target} مل`);
  return parts.join('\n');
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function guessCategory(text: string): string {
  const cat: [RegExp, string][] = [
    [/مواصلات|بس|مترو|اوبر|تكسي|سفر/iu, 'مواصلات'],
    [/أكل|اكل|مطبخ|سوبر|خضار|لحمة|فراخ/iu, 'أكل'],
    [/كهربا|نور|غاز|ميه/iu, 'مرافق'],
    [/نت|انترنت|محمول|شحن/iu, 'اتصالات'],
    [/ملابس|هدوم|جزمة|كوتشي/iu, 'ملابس'],
    [/علاج|دوا|دكتور|مستشفى|صيدلية/iu, 'صحة'],
    [/قسط|إيجار|ايجار|إيداع/iu, 'إيجار'],
    [/مرتب|مرتبي|راتب|خالص|شهرية/iu, 'مرتب'],
    [/ترفيه|خروج|قهاوي|كافيه|سينما/iu, 'ترفيه'],
  ];
  for (const [re, label] of cat) {
    if (re.test(text)) return label;
  }
  return 'أخرى';
}

const WELCOME = `أهلاً بيك يا صاحبي 🤗

أنا مساعدك الشخصي الشامل:
📌 مهام وتذکيرات
💰 مصاريف ودخل وميزانية
💊 تذكير بالأدوية
💧 عداد مياه
😴 تتبع النوم
🧾 فواتير واشتراكات
🎯 أهداف شهرية وسنوية
🌤️ حالة الطقس

اقدر أساعدك في أي حاجة، جرب تقولي! 😎`;

export async function handleIncomingMessage(
  phoneNumber: string,
  messageText: string
): Promise<string> {
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('phone_number', phoneNumber)
    .single();

  const isNewUser = !existingUser;

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ phone_number: phoneNumber, name: phoneNumber })
      .select()
      .single();
    if (error || !newUser) throw new Error('Failed to create user');
    userId = newUser.id;
  }

  await supabase.from('conversations').insert({ user_id: userId, message: messageText, role: 'user' });

  if (isNewUser) {
    await supabase.from('conversations').insert({ user_id: userId, message: WELCOME, role: 'assistant' });
    await sendWhatsAppMessage(phoneNumber, WELCOME);
    return WELCOME;
  }

  // Quick commands (no AI)
  if (messageText === 'مهامي') {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('content, due_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    const reply = !tasks?.length
      ? randomPick(['مافيش مهام معلقة 🎉', 'صفر مهام! 😎'])
      : 'مهامك المعلقة:\n' + tasks.map((t, i) => `\n${i + 1}. ${t.content}${t.due_at ? `\n   📅 ${formatDate(t.due_at)} ${formatTime(t.due_at)}` : ''}`).join('') + '\n\nقولي "تم [رقم]" عشان تشطب ✅';
    await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
    await sendWhatsAppMessage(phoneNumber, reply);
    return reply;
  }

  // Delete task: "شيل N" or "شيل مهمة X"
  const delMatch = messageText.match(/^(الغي|شيل|حذف|احذف|امسح|مسح)\s*(مهمة\s*)?(.+)$/i);
  if (delMatch) {
    const target = delMatch[3].trim();
    if (/^\d+$/.test(target)) {
      const num = parseInt(target, 10);
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, content')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (!tasks?.length || !tasks[num - 1]) {
        const reply = 'رقم غلط أو مفيش مهام';
        await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
        await sendWhatsAppMessage(phoneNumber, reply);
        return reply;
      }
      const task = tasks[num - 1];
      await supabase.from('tasks').delete().eq('id', task.id);
      const reply = `حذفت "${task.content}" 🗑️`;
      await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
      await sendWhatsAppMessage(phoneNumber, reply);
      return reply;
    }
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, content')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .or(`content.ilike.%${target}%,content.ilike.%${target.split(' ').slice(0, 2).join(' ')}%`)
      .limit(3);
    if (!tasks?.length) {
      const reply = 'معرفتش ألاقي مهمة بالمواصفات دي';
      await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
      await sendWhatsAppMessage(phoneNumber, reply);
      return reply;
    }
    if (tasks.length === 1) {
      await supabase.from('tasks').delete().eq('id', tasks[0].id);
      const reply = `حذفت "${tasks[0].content}" 🗑️`;
      await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
      await sendWhatsAppMessage(phoneNumber, reply);
      return reply;
    }
    const reply = 'في أكتر من مهمة زي كده:\n' +
      tasks.map((t, i) => `\n${i + 1}. ${t.content}`).join('') +
      '\nقول "شيل [رقم]" عشان تحدد';
    await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
    await sendWhatsAppMessage(phoneNumber, reply);
    return reply;
  }

  if (/^تم\s*(\d+)$/.test(messageText)) {
    const num = parseInt(messageText.match(/^تم\s*(\d+)$/)![1], 10);
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, content')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (!tasks?.length || !tasks[num - 1]) {
      const reply = 'رقم غلط أو مفيش مهام';
      await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
      await sendWhatsAppMessage(phoneNumber, reply);
      return reply;
    }
    const task = tasks[num - 1];
    await supabase.from('tasks').update({ status: 'done' }).eq('id', task.id);
    const reply = randomPick([`تم ✅ "${task.content}" 🎉`, `خلصت "${task.content}" 👏✅`]);
    await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
    await sendWhatsAppMessage(phoneNumber, reply);
    return reply;
  }

  // AI
  const history = await getHistory(userId);
  const ai = await analyzeAndReply(messageText, history);

  let reply = ai.reply;

  switch (ai.intent) {
    case 'create_task': {
      const content = ai.task_content || ai.reply;
      const { data: task, error } = await supabase
        .from('tasks')
        .insert({ user_id: userId, content, due_at: ai.due_at })
        .select()
        .single();
      if (error) {
        console.error('[TASK]', error);
        reply = 'حصل مشكلة في تسجيل المهمة';
      } else if (task.due_at) {
        await supabase.from('reminders').insert({
          entity_type: 'task', entity_id: task.id, user_id: userId, remind_at: task.due_at,
        });
      }
      break;
    }

    case 'save_info': {
      if (ai.info_key && ai.info_value) {
        await supabase.from('user_profile').upsert(
          { user_id: userId, key: ai.info_key, value: ai.info_value },
          { onConflict: 'user_id,key' }
        );
      }
      break;
    }

    case 'list_tasks': {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('content, due_at')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      reply = !tasks?.length
        ? 'مافيش مهام معلقة 😄'
        : 'مهامك:\n' + tasks.map((t, i) => `\n${i + 1}. ${t.content}${t.due_at ? `\n   📅 ${formatDate(t.due_at)} ${formatTime(t.due_at)}` : ''}`).join('');
      break;
    }

    case 'mark_done': {
      const q = ai.task_content || ai.reply.replace(/^(خلصت|تم|شطب|لغيت)\s*/i, '').trim();
      if (!q) {
        reply = 'أي مهمة تقصد بالظبط؟';
        break;
      }
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, content')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .or(`content.ilike.%${q}%,content.ilike.%${q.split(' ').slice(0, 2).join(' ')}%`)
        .limit(3);
      if (tasks?.length) {
        if (tasks.length === 1) {
          await supabase.from('tasks').update({ status: 'done' }).eq('id', tasks[0].id);
          reply = randomPick([`تم ✅ "${tasks[0].content}" 🎉`, `خلصت "${tasks[0].content}" 👏`]);
        } else {
          reply = 'في أكتر من مهمة زي كده:\n' +
            tasks.map((t, i) => `\n${i + 1}. ${t.content}`).join('') +
            '\nقول رقمها أو "تم [رقم]"';
        }
      } else {
        reply = randomPick([
          'معرفتش ألاقي مهمة زي كده، جرب تكتب "مهامي"',
          'مفيش حاجة بالمواصفات دي في الليستة',
        ]);
      }
      break;
    }

    case 'daily_summary': {
      reply = await generateDailySummary(userId);
      break;
    }

    // ---- المصاريف ----
    case 'expense': {
      try {
        if (ai.info_key === 'add_expense' || ai.info_key === 'add_income') {
          const amount = parseFloat(ai.info_value || '0');
          if (amount <= 0) { reply = 'المبلغ مش واضح'; break; }
          const category = ai.task_content || guessCategory(ai.task_content || '');
          await addTransaction(userId, ai.info_key === 'add_income' ? 'income' : 'expense', category, amount, category);
          reply = ai.info_key === 'add_income'
            ? `تم إضافة دخل ${amount} جنيه`
            : `تم تسجيل ${amount} جنيه ${category}`;
        } else if (ai.info_key === 'show_summary') {
          const s = await getMonthlySummary(userId);
          reply = `💰 ملخص الشهر:\nدخل: ${s.income} ج\nمصروفات: ${s.expenses} ج\nالمتبقي: ${s.balance} ج`;
          if (s.categories.length) {
            reply += '\n\nمصروفات:\n' + s.categories.map(c => `- ${c.category}: ${c.amount} ج`).join('\n');
          }
        } else if (ai.info_key === 'set_budget') {
          const amount = parseFloat(ai.info_value || '0');
          if (amount <= 0 || !ai.task_content) { reply = 'الفئة أو المبلغ مش واضح'; break; }
          await setBudget(userId, ai.task_content, amount);
          reply = `تم تحديد ميزانية ${ai.task_content} ${amount} ج`;
        }
      } catch (e: any) {
        console.error('[EXPENSE]', e);
        reply = 'حصل مشكلة في تسجيل المصاريف';
      }
      break;
    }

    // ---- الميه ----
    case 'water': {
      try {
        if (ai.info_key === 'log_water') {
          const ml = parseInt(ai.info_value || '250', 10);
          await logWater(userId, ml);
          const today = await getWaterToday(userId);
          reply = `تم ${ml} مل 💧 (الإجمالي: ${today.total}/${today.target} مل)`;
        } else if (ai.info_key === 'show_water') {
          const today = await getWaterToday(userId);
          reply = today.total === 0
            ? 'لسه مشربتش ميه النهاردة 💧'
            : `شربت ${today.total} مل من ${today.target} مل 💧\nالمتبقي: ${today.remaining} مل`;
        }
      } catch (e: any) {
        console.error('[WATER]', e);
        reply = 'حصل مشكلة في تسجيل الميه';
      }
      break;
    }

    // ---- النوم ----
    case 'sleep': {
      try {
        if (ai.info_key === 'log_sleep') {
          const today = new Date().toISOString().slice(0, 10);
          const bedtime = ai.task_content;
          const wakeTime = ai.info_value;
          const fullBed = bedtime ? `${today}T${bedtime.includes(':') ? bedtime.padStart(5, '0') : '00:00'}:00.000Z` : null;
          const fullWake = wakeTime ? `${today}T${wakeTime.includes(':') ? wakeTime.padStart(5, '0') : '00:00'}:00.000Z` : undefined;
          await logSleep(userId, today, fullBed || new Date().toISOString(), fullWake);
          reply = bedtime && wakeTime
            ? `تم تسجيل النوم من ${bedtime} لـ ${wakeTime} 🌙`
            : bedtime
              ? `تم تسجيل النوم الساعة ${bedtime} 🌙`
              : `تم تسجيل الصحوة ${wakeTime} 😴`;
        } else if (ai.info_key === 'show_sleep') {
          const week = await getSleepWeek(userId);
          if (!week.length) {
            reply = 'مفيش تسجيلات نوم';
          } else {
            const avgBed = week
              .filter(s => s.bedtime)
              .map(s => {
                const h = parseInt(s.bedtime.toString().slice(11, 13) || s.bedtime.toString().slice(0, 2), 10);
                const m = parseInt(s.bedtime.toString().slice(14, 16) || s.bedtime.toString().slice(3, 5), 10);
                return h * 60 + m;
              });
            const avgHour = avgBed.length ? Math.round(avgBed.reduce((a, b) => a + b, 0) / avgBed.length / 60) : 0;
            reply = `آخر أسبوع:\n${week.slice(0, 5).map(s =>
              `- ${formatDate(s.date)}: ${s.bedtime?.toString().slice(11, 16) || s.bedtime?.toString().slice(0, 5) || '?'}${s.wake_time ? ` → ${s.wake_time.toString().slice(11, 16)}` : ''}${s.quality ? ` ⭐${'⭐'.repeat(s.quality)}` : ''}`
            ).join('\n')}`;
            if (avgHour) reply += `\n\nمتوسط النوم: ${avgHour}:00`;
          }
        }
      } catch (e: any) {
        console.error('[SLEEP]', e);
        reply = 'حصل مشكلة في تسجيل النوم';
      }
      break;
    }

    // ---- الأدوية ----
    case 'medication': {
      try {
        if (ai.info_key === 'add_med') {
          const name = ai.task_content || 'دواء';
          const dosage = ai.info_value || null;
          await addMedication(userId, name, dosage, ['09:00', '21:00']);
          reply = `تم إضافة "${name}" 💊`;
        } else if (ai.info_key === 'show_meds') {
          const meds = await getActiveMedications(userId);
          reply = !meds.length
            ? 'مافيش أدوية نشطة'
            : 'أدويتك:\n' + meds.map(m =>
              `- ${m.name}${m.dosage ? ` (${m.dosage})` : ''}${m.times?.length ? ` ⏰ ${(m.times as string[]).join(' - ')}` : ''}`
            ).join('\n');
        }
      } catch (e: any) {
        console.error('[MED]', e);
        reply = 'حصل مشكلة في الأدوية';
      }
      break;
    }

    // ---- الفواتير ----
    case 'bill': {
      try {
        if (ai.info_key === 'add_bill') {
          const name = ai.task_content || 'فاتورة';
          const amount = parseFloat(ai.info_value || '0');
          if (amount <= 0) { reply = 'المبلغ مش واضح'; break; }
          const dueDate = ai.due_at || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
          await addBill(userId, name, amount, dueDate, 'monthly');
          reply = `تم إضافة "${name}" ${amount} ج شهرياً`;
        } else if (ai.info_key === 'show_bills') {
          const bills = await getPendingBills(userId);
          reply = !bills.length
            ? 'مافيش فواتير مستحقة 🎉'
            : 'الفواتير:\n' + bills.map(b =>
              `- ${b.name}: ${b.amount} ج (🔴 ${formatDate(b.due_date)})`
            ).join('\n');
        } else if (ai.info_key === 'pay_bill') {
          const q = ai.task_content || '';
          if (!q) { reply = 'أي فاتورة?'; break; }
          const bills = await getPendingBills(userId);
          const match = bills.find(b => b.name.includes(q));
          if (match) {
            await markBillPaid(match.id, userId);
            reply = `تم دفع "${match.name}" ✅`;
          } else {
            reply = 'معرفتش ألاقي الفاتورة دي';
          }
        }
      } catch (e: any) {
        console.error('[BILL]', e);
        reply = 'حصل مشكلة في الفواتير';
      }
      break;
    }

    // ---- الأهداف ----
    case 'goal': {
      try {
        if (ai.info_key === 'add_goal') {
          const title = ai.task_content || 'هدف';
          const targetDate = ai.due_at || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
          await addGoal(userId, title, 'monthly', targetDate);
          reply = `تم إضافة "${title}" 🎯`;
        } else if (ai.info_key === 'show_goals') {
          const goals = await getActiveGoals(userId);
          reply = !goals.length
            ? 'مافيش أهداف نشطة'
            : 'أهدافك:\n' + goals.map((g: any) => {
              const ms = g.goal_milestones?.filter((m: any) => m.done).length || 0;
              const mt = g.goal_milestones?.length || 0;
              return `- ${g.title} (${g.progress}%)${mt ? ` [${ms}/${mt}]` : ''} 📅 ${formatDate(g.target_date)}`;
            }).join('\n');
        } else if (ai.info_key === 'update_goal') {
          const q = ai.task_content || '';
          const progress = parseInt(ai.info_value || '0', 10);
          if (!q) { reply = 'أي هدف?'; break; }
          const goals = await getActiveGoals(userId);
          const match = goals.find((g: any) => g.title.includes(q));
          if (match) {
            await updateGoalProgress(match.id, userId, progress);
            reply = `تم تحديث "${match.title}" إلى ${progress}% 💪`;
          } else {
            reply = 'معرفتش ألاقي الهدف ده';
          }
        }
      } catch (e: any) {
        console.error('[GOAL]', e);
        reply = 'حصل مشكلة في الأهداف';
      }
      break;
    }

    // ---- الطقس ----
    case 'weather': {
      try {
        const location = ai.task_content || 'القاهرة';
        const w = await getWeather(location);
        reply = `🌤️ طقس ${location}: ${w}`;
      } catch (e: any) {
        console.error('[WEATHER]', e);
        reply = 'معرفتش أجيب الطقس';
      }
      break;
    }
  }

  await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
  await sendWhatsAppMessage(phoneNumber, reply);
  return reply;
}
