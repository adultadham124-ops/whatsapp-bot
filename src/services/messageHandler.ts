import { supabase } from '../db';
import { analyzeIntent, chat } from './aiService';
import { generateDailySummary } from './dailySummaryService';
import { sendWhatsAppMessage } from './whatsappService';
import { addTransaction, getMonthlySummary, setBudget } from './expenseService';
import { addMedication, getActiveMedications, deactivateMedication } from './medicationService';
import { logWater, getWaterToday, logSleep, getSleepWeek } from './healthService';
import { addBill, getPendingBills, markBillPaid } from './billService';
import { addGoal, getActiveGoals, updateGoalProgress, completeMilestone } from './goalService';
import { getWeather, getForecast } from './weatherService';

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() >= 12 ? 'مساءً' : 'صباحًا';
  return `الساعة ${h}:${m} ${ampm}`;
}

function formatDate(d: string | Date): string {
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

async function getAllContext(userId: string): Promise<string> {
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

const WELCOME = `أهلاً بيك يا صاحبي 🤗

أنا مساعدك الشخصي الشامل:
📌 مهام وتذكيرات
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

  const history = await getHistory(userId);
  const context = await getAllContext(userId);
  let reply = '';

  // --- Quick commands (no AI) ---
  if (messageText === 'مهامي') {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('content, due_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!tasks?.length) {
      reply = randomPick(['مافيش مهام معلقة 🎉', 'صفر مهام! 😎', 'معندكش حاجة النهاردة 😄']);
    } else {
      reply = 'مهامك المعلقة:\n';
      tasks.forEach((t, i) => {
        reply += `\n${i + 1}. ${t.content}`;
        if (t.due_at) reply += `\n   📅 ${formatDate(t.due_at)} ${formatTime(t.due_at)}`;
      });
      reply += '\n\nقولي "تم [رقم]" عشان تشطب ✅';
    }
  } else if (/^تم\s*(\d+)$/.test(messageText)) {
    const num = parseInt(messageText.match(/^تم\s*(\d+)$/)![1], 10);
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, content')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!tasks?.length) {
      reply = 'مافيش حاجة تشطبها 😅';
    } else {
      const task = tasks[num - 1];
      if (!task) {
        reply = 'رقم غلط، جرب "مهامي"';
      } else {
        await supabase.from('tasks').update({ status: 'done' }).eq('id', task.id);
        reply = randomPick([
          `تم ✅ شطبنا "${task.content}" 🎉`,
          `خلصت "${task.content}"؟ برافو 👏✅`,
          `أهو ده! ${task.content} تم ✅`,
        ]);
      }
    }
  } else if (/^(ملخصي|ملخص يومي|عاوز ملخص)$/.test(messageText)) {
    reply = await generateDailySummary(userId);
  } else {
    // --- AI intent parsing ---
    const intent = await analyzeIntent(messageText);

    switch (intent.intent) {
      // ============ TASKS ============
      case 'create_task': {
        const { data: task, error: err } = await supabase
          .from('tasks')
          .insert({ user_id: userId, content: intent.content, due_at: intent.due_at })
          .select()
          .single();

        if (err) {
          reply = 'حصل مشكلة، جرب تاني';
        } else {
          if (task.due_at) {
            await supabase.from('reminders').insert({
              entity_type: 'task', entity_id: task.id, user_id: userId, remind_at: task.due_at,
            });
          }
          const ts = task.due_at ? `${formatDate(task.due_at)} ${formatTime(task.due_at)}` : null;
          reply = randomPick([
            `تم التسجيل ✅ هذكرك بــ "${task.content}"${ts ? ` يوم ${ts}` : ''}`,
            `حاضرين ✌️${ts ? ` يوم ${ts}` : ''} هقولك على "${task.content}"`,
            `تمام، ضفنا "${task.content}"${ts ? ` لـ ${ts}` : ''} 👍`,
          ]);
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

        if (!tasks?.length) {
          reply = 'مافيش مهام معلقة! 😄';
        } else {
          reply = 'مهامك:\n';
          tasks.forEach((t, i) => {
            reply += `\n${i + 1}. ${t.content}`;
            if (t.due_at) reply += `\n   📅 ${formatDate(t.due_at)} ${formatTime(t.due_at)}`;
          });
        }
        break;
      }

      case 'mark_done': {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('id, content')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .ilike('content', `%${intent.content}%`)
          .limit(1);

        if (!tasks?.length) {
          reply = 'ملقتش مهمة زي كده 😅';
        } else {
          await supabase.from('tasks').update({ status: 'done' }).eq('id', tasks[0].id);
          reply = randomPick([`خلصت "${tasks[0].content}"؟ ✅`, `${tasks[0].content} ✅ شطبناه 🎉`]);
        }
        break;
      }

      // ============ EXPENSES ============
      case 'add_expense': {
        try {
          const amount = Number((intent.extra as any)?.amount ?? 0);
          const category = String((intent.extra as any)?.category ?? 'مصروفات');
          await addTransaction(userId, 'expense', category, amount, intent.content);
          reply = randomPick([
            `تم تسجيل ${amount} جنيه ${category} ✅`,
            `حاضر، ${amount} جنيه ${category} 🧾`,
            `ضفنا ${amount} جنيه ${category} 👍`,
          ]);
        } catch (e) { console.error('[EXPENSE]', e); reply = 'حصل مشكلة في تسجيل المصروف 😅'; }
        break;
      }

      case 'add_income': {
        try {
          const amount = Number((intent.extra as any)?.amount ?? 0);
          const category = String((intent.extra as any)?.category ?? 'مرتب');
          await addTransaction(userId, 'income', category, amount, intent.content);
          reply = randomPick([
            `تم ${amount} جنيه دخل من ${category} ✅💰`,
            `تمام، ${amount} جنيه ${category} استلمنا 👍💰`,
          ]);
        } catch (e) { console.error("[add_goal]", e); reply = 'حصل مشكلة 😅'; }
        break;
      }

      case 'monthly_summary': {
        try {
          const summary = await getMonthlySummary(userId);
          reply = `ملخص الشهر:\n💰 الدخل: ${summary.income} جنيه\n💸 المصروفات: ${summary.expenses} جنيه\n📊 الباقي: ${summary.balance} جنيه`;
          if (summary.categories.length) {
            reply += '\n\nمصروفات:\n';
            summary.categories.forEach(c => { reply += `• ${c.category}: ${c.amount} جنيه\n`; });
          }
        } catch { reply = 'معرفتش أجيب الملخص 😅'; }
        break;
      }

      case 'set_budget': {
        try {
          const amount = Number((intent.extra as any)?.amount ?? 0);
          const category = String((intent.extra as any)?.category ?? 'مصروفات');
          await setBudget(userId, category, amount);
          reply = `تم تحديد ميزانية ${category} ب ${amount} جنيه للشهر الجاري ✅`;
        } catch (e) { console.error("[add_goal]", e); reply = 'حصل مشكلة 😅'; }
        break;
      }

      // ============ MEDICATIONS ============
      case 'add_medication': {
        try {
          const extra = intent.extra as any;
          const times: string[] = extra?.times ?? ['08:00', '20:00'];
          await addMedication(userId, intent.content, extra?.dosage ?? null, times);
          reply = randomPick([
            `تم إضافة "${intent.content}" ${times.join(' و ')} 💊`,
            `حاضرين، هذكرك ب "${intent.content}" ${times.join(' و ')} 💊`,
          ]);
        } catch (e) { console.error('[MEDS]', e); reply = 'حصل مشكلة في إضافة الدواء 😅'; }
        break;
      }

      case 'list_medications': {
        const meds = await getActiveMedications(userId);
        if (!meds.length) {
          reply = 'مافيش أدوية نشطة';
        } else {
          reply = 'أدوبتك:\n';
          meds.forEach(m => {
            reply += `\n💊 ${m.name}${m.dosage ? ` (${m.dosage})` : ''}`;
            reply += `\n   ⏰ ${(m.times as string[]).join(' - ')}`;
          });
        }
        break;
      }

      // ============ WATER ============
      case 'log_water': {
        try {
          const amount = Number((intent.extra as any)?.amount_ml ?? 250);
          await logWater(userId, amount);
          const status = await getWaterToday(userId);
          reply = `تم 💧 +${amount} مل (${status.total}/${status.target} مل)`;
        } catch (e) { console.error("[add_goal]", e); reply = 'حصل مشكلة 😅'; }
        break;
      }

      case 'water_status': {
        const status = await getWaterToday(userId);
        if (status.total === 0) {
          reply = 'لسه مشربتش ميه النهاردة! اشرب كوبايه بقى 💧';
        } else {
          reply = `شربت ${status.total} مل من ${status.target} مل النهاردة 💧${status.remaining === 0 ? ' 🎉 برافو!' : `\nمت́بقي ${status.remaining} مل`}`;
        }
        break;
      }

      // ============ SLEEP ============
      case 'log_sleep': {
        try {
          const extra = intent.extra as any;
          const today = new Date().toISOString().slice(0, 10);
          await logSleep(userId, today, extra?.bedtime ?? '23:00', extra?.wake_time ?? null, extra?.quality ?? null);
          reply = randomPick([
            `تم تسجيل النوم 😴`,
            `حاضر، نمت الساعة ${extra?.bedtime ?? '23:00'} 😴`,
          ]);
        } catch (e) { console.error("[add_goal]", e); reply = 'حصل مشكلة 😅'; }
        break;
      }

      case 'sleep_status': {
        const week = await getSleepWeek(userId);
        if (!week.length) {
          reply = 'مفيش بيانات نوم لسه، قولي "نميت الساعة 11" عشان أسجل';
        } else {
          reply = 'نومك آخر أسبوع:\n';
          week.slice(0, 7).forEach(s => {
            reply += `\n${formatDate(s.date)}: ${s.bedtime?.toString().slice(11, 16) ?? '?'}`;
            if (s.wake_time) reply += ` - ${s.wake_time.toString().slice(11, 16)}`;
            if (s.quality) reply += ` ⭐${'⭐'.repeat(s.quality)}`;
          });
        }
        break;
      }

      // ============ BILLS ============
      case 'add_bill': {
        try {
          const extra = intent.extra as any;
          const amount = Number(extra?.amount ?? 0);
          const freq = ['monthly', 'quarterly', 'yearly', 'one_time'].includes(extra?.frequency) ? extra.frequency : 'monthly';
          const due = intent.due_at?.slice(0, 10) ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
          await addBill(userId, intent.content, amount, due, freq);
          reply = randomPick([
            `تم إضافة "${intent.content}" ب ${amount} جنيه 🧾`,
            `حاضرين، "${intent.content}" ${amount} جنيه ${formatDate(due)} 🧾`,
          ]);
        } catch (e) { console.error("[add_goal]", e); reply = 'حصل مشكلة 😅'; }
        break;
      }

      case 'list_bills': {
        const bills = await getPendingBills(userId);
        if (!bills.length) {
          reply = 'مافيش فواتير معلقة 🎉';
        } else {
          reply = 'الفواتير:\n';
          bills.forEach(b => {
            reply += `\n🧾 ${b.name}: ${b.amount} جنيه`;
            reply += `\n   📅 ${formatDate(b.due_date)} ${b.status === 'overdue' ? '⚠️ متأخر!' : ''}`;
          });
        }
        break;
      }

      case 'pay_bill': {
        const bills = await getPendingBills(userId);
        const match = bills.find(b => intent.content && b.name.toLowerCase().includes(intent.content.toLowerCase()));
        if (!match) {
          reply = 'ملقتش الفاتورة دي';
        } else {
          try {
            await markBillPaid(match.id, userId);
            reply = `تم دفع "${match.name}" ✅🧾`;
          } catch (e) { console.error("[add_goal]", e); reply = 'حصل مشكلة 😅'; }
        }
        break;
      }

      // ============ GOALS ============
      case 'add_goal': {
        try {
          const extra = intent.extra as any;
          const targetDate = extra?.target_date ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
          const type = ['monthly', 'yearly', 'custom'].includes(extra?.type) ? extra.type : 'monthly';
          await addGoal(userId, intent.content, type, targetDate);
          reply = randomPick([
            `تم إضافة الهدف "${intent.content}" 🎯 حتى ${formatDate(targetDate)}`,
            `حاضرين، "${intent.content}" هدف ${type === 'yearly' ? 'سنوي' : 'شهري'} 🎯`,
          ]);
        } catch (e) { console.error("[add_goal]", e); reply = 'حصل مشكلة 😅'; }
        break;
      }

      case 'list_goals': {
        const goals = await getActiveGoals(userId);
        if (!goals.length) {
          reply = 'مافيش أهداف نشطة. عاوز تحدد هدف؟ 🎯';
        } else {
          reply = 'أهدافك:\n';
          goals.forEach(g => {
            reply += `\n🎯 ${g.title}`;
            reply += `\n   📊 ${g.progress}%`;
            reply += `\n   📅 ${formatDate(g.target_date)}`;
            if ((g as any).goal_milestones?.length) {
              reply += '\n   milestones:';
              (g as any).goal_milestones.forEach((m: any) => {
                reply += `\n   ${m.done ? '✅' : '⬜'} ${m.title}`;
              });
            }
          });
        }
        break;
      }

      case 'goal_progress': {
        try {
          const progress = Number((intent.extra as any)?.progress ?? 50);
          const goals = await getActiveGoals(userId);
          if (goals.length) {
            await updateGoalProgress(goals[0].id, userId, progress);
            reply = `تم تحديث تقدم "${goals[0].title}" إلى ${progress}% 🎯`;
          } else {
            reply = 'مافيش أهداف نشطة';
          }
        } catch (e) { console.error("[add_goal]", e); reply = 'حصل مشكلة 😅'; }
        break;
      }

      // ============ WEATHER ============
      case 'get_weather': {
        const location = ((intent.extra as any)?.location as string) || 'القاهرة';
        const weather = await getWeather(location);
        reply = `🌤️ الطقس في ${location}:\n${weather}`;
        break;
      }

      // ============ SUMMARY ============
      case 'daily_summary': {
        reply = await generateDailySummary(userId);
        break;
      }

      // ============ GENERAL CHAT ============
      case 'general_chat': {
        reply = await chat(messageText, history.slice(-6), context || undefined);
        break;
      }
    }
  }

  await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
  await sendWhatsAppMessage(phoneNumber, reply);
  return reply;
}
