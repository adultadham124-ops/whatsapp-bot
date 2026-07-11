import { supabase } from '../db';
import { analyzeAndReply } from './aiService';
import { sendWhatsAppMessage } from './whatsappService';
import { generateDailySummary } from './dailySummaryService';
import { addTransaction, getMonthlySummary, setBudget } from './expenseService';
import { addMedication, getActiveMedications } from './medicationService';
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

  // Delete task: "شيل N" or "شيل مهمة X" or "الغي الاجتماع"
  const delMatch = messageText.match(/^(الغي|شيل|حذف|احذف|امسح|مسح)\s*(مهمة\s*)?(.+)$/i);
  if (delMatch) {
    const target = delMatch[3].trim();
    if (/^\d+$/.test(target)) {
      // Delete by index
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
    // Delete by content
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
  }

  await supabase.from('conversations').insert({ user_id: userId, message: reply, role: 'assistant' });
  await sendWhatsAppMessage(phoneNumber, reply);
  return reply;
}
