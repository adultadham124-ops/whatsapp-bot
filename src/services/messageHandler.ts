import { supabase } from '../db';
import { analyzeIntent, chat } from './aiService';
import { generateDailySummary } from './dailySummaryService';
import { sendWhatsAppMessage } from './whatsappService';

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'مساءً' : 'صباحًا';
  const h12 = hours % 12 || 12;
  return `الساعة ${h12}:${minutes} ${ampm}`;
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('ar-EG', { weekday: 'long', month: 'long', day: 'numeric' });
}

async function getHistory(userId: string, limit = 8) {
  const { data } = await supabase
    .from('conversations')
    .select('role, message')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []).reverse().map(c => ({
    role: c.role as 'user' | 'assistant',
    content: c.message,
  }));
}

async function getPendingContext(userId: string): Promise<string> {
  const { data } = await supabase
    .from('tasks')
    .select('content, due_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('due_at', { ascending: true })
    .limit(5);

  if (!data || data.length === 0) return '';
  return 'المهام المعلقة:\n' + data
    .map(t => `- ${t.content}${t.due_at ? ` (${formatDate(t.due_at)} ${formatTime(t.due_at)})` : ''}`)
    .join('\n');
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const WELCOME = `أهلاً بيك يا صاحبي 🤗

أنا مساعدك الشخصي، تقدر تقولي:
• "فكرني أشتري حاجة بكرة" — عشان أسجل مهمة
• "مهامي" — عشان أشوف المهام
• "تم 1" — عشان أconfirm إنجاز مهمة
• "ملخصي" — عشان أقولك إ_day النهاردة

وأي كلام تاني عادي، أنا معاك 😎`;

export async function handleIncomingMessage(
  phoneNumber: string,
  messageText: string
): Promise<string> {
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, name')
    .eq('phone_number', phoneNumber)
    .single();

  const isNewUser = !existingUser;

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({ phone_number: phoneNumber, name: phoneNumber })
      .select()
      .single();

    if (createError || !newUser) throw new Error('Failed to create user');
    userId = newUser.id;
  }

  await supabase.from('conversations').insert({
    user_id: userId,
    message: messageText,
    role: 'user',
  });

  if (isNewUser) {
    await supabase.from('conversations').insert({
      user_id: userId,
      message: WELCOME,
      role: 'assistant',
    });

    await sendWhatsAppMessage(phoneNumber, WELCOME);
    return WELCOME;
  }

  const history = await getHistory(userId);
  const pendingContext = await getPendingContext(userId);

  let reply = '';

  if (messageText === 'مهامي') {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('content, due_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!tasks || tasks.length === 0) {
      reply = randomPick([
        'مافيش مهام معلقة ياباشا 🎉 عيش حياتك 😄',
        'صفر مهام! تقدر تريح بقى 😎',
        'معندكش حاجة تعملها النهاردة، عيش اليوم 😄',
      ]);
    } else {
      reply = 'ده شغلك المعلق يا صاحبي:\n';
      tasks.forEach((t, i) => {
        reply += `\n${i + 1}. ${t.content}`;
        if (t.due_at) {
          reply += `\n   📅 ${formatDate(t.due_at)} ${formatTime(t.due_at)}`;
        }
      });
      reply += '\n\nقولي "تم [رقم]" عشان تشطب اللي خلصته ✅';
    }
  } else if (/^تم\s*(\d+)$/.test(messageText)) {
    const num = parseInt(messageText.match(/^تم\s*(\d+)$/)![1], 10);
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, content')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!tasks || tasks.length === 0) {
      reply = 'مافيش حاجة تشطبها أصلاً 😅';
    } else {
      const task = tasks[num - 1];
      if (!task) {
        reply = randomPick([
          'الرقم دا مش موجود، جرب تكتب "مهامي" عشان تتأكد من الأرقام',
          'غلط في الترقيم يا صاحبي 😅 قولي "مهامي" الأول',
        ]);
      } else {
        await supabase.from('tasks').update({ status: 'done' }).eq('id', task.id);
        reply = randomPick([
          `تم ياباشا ✅ شطبنا "${task.content}" من الليستة 🎉`,
          `خلصت "${task.content}"؟ تسلم إيدك 🎉✅`,
          `أهو ده! ${task.content} خلصت. برافو عليك 👏✅`,
        ]);
      }
    }
  } else if (/^(ملخصي|ملخص يومي|عاوز ملخص)$/.test(messageText)) {
    reply = await generateDailySummary(userId);
  } else {
    const intent = await analyzeIntent(messageText);

    switch (intent.intent) {
      case 'create_task': {
        const { data: task, error: taskError } = await supabase
          .from('tasks')
          .insert({
            user_id: userId,
            content: intent.content,
            due_at: intent.due_at,
          })
          .select()
          .single();

        if (taskError) {
          reply = 'للأسف حصل خطأ، جرب تاني؟';
        } else {
          if (task.due_at) {
            await supabase.from('reminders').insert({
              task_id: task.id,
              remind_at: task.due_at,
            });
          }

          const timeStr = task.due_at
            ? `${formatDate(task.due_at)} ${formatTime(task.due_at)}`
            : null;

          reply = randomPick([
            `تم التسجيل ✅ هذكرك بــ "${task.content}"${timeStr ? ` يوم ${timeStr}` : ''}`,
            `حاضرين ✌️${timeStr ? ` يوم ${timeStr}` : ''} هقولك على "${task.content}"`,
            `تمام ياباشا، ضفنا "${task.content}"${timeStr ? ` لـ ${timeStr}` : ''} 👍`,
          ]);
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

        if (!tasks || tasks.length === 0) {
          reply = randomPick([
            'معرفتش ألاقي المهمة دي 😅 جرب تصيغ تاني',
            'مفيش مهمة زي كده في الليستة، متأكد من الصياغة؟',
          ]);
        } else {
          await supabase
            .from('tasks')
            .update({ status: 'done' })
            .eq('id', tasks[0].id);

          reply = randomPick([
            `خلصت "${tasks[0].content}"؟ تمام ✅ شطبناه 🎉`,
            `${tasks[0].content} ✅ خلاص، واحدة واحدة الليستة بتقل 😎`,
          ]);
        }
        break;
      }

      case 'daily_summary': {
        reply = await generateDailySummary(userId);
        break;
      }

      case 'list_tasks': {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('content, due_at')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (!tasks || tasks.length === 0) {
          reply = 'مافيش مهام معلقة! استمتع بيومك 😄';
        } else {
          reply = 'مهامك المعلقة:\n';
          tasks.forEach((t, i) => {
            reply += `\n${i + 1}. ${t.content}`;
            if (t.due_at) {
              reply += `\n   📅 ${formatDate(t.due_at)} ${formatTime(t.due_at)}`;
            }
          });
        }
        break;
      }

      case 'general_chat': {
        reply = await chat(messageText, history.slice(-6), pendingContext || undefined);
        break;
      }
    }
  }

  await supabase.from('conversations').insert({
    user_id: userId,
    message: reply,
    role: 'assistant',
  });

  await sendWhatsAppMessage(phoneNumber, reply);
  return reply;
}
