import { supabase } from '../db';
import { processMessage } from './aiService';
import { generateDailySummary } from './dailySummaryService';
import { sendWhatsAppMessage } from './whatsappService';
import { parseCommand } from '../utils/commandParser';

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

const WELCOME_MESSAGE = `أهلاً بيك في البوت 🤖

أنا مساعدك الشخصي. تقدر تعمل الآتي:

📌 *تسجيل مهمة*
مثال: "فكرني أشتري حاجة بكرة الساعة 5"

📋 *عرض المهام*
مثال: "أظهر لي مهامي"

✅ *تأكيد إنجاز مهمة*
مثال: "خلصت مهمة شراء الحاجة"

📊 *ملخص يومي*
مثال: "عاوز ملخص يومي"

أكتب أي حاجة وأنا هساعدك!`;

export async function handleIncomingMessage(
  phoneNumber: string,
  messageText: string
): Promise<string> {
  // Ensure user exists
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
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({ phone_number: phoneNumber, name: phoneNumber })
      .select()
      .single();

    if (createError || !newUser) {
      throw new Error('Failed to create user');
    }
    userId = newUser.id;
  }

  // Save incoming message to conversations
  await supabase.from('conversations').insert({
    user_id: userId,
    message: messageText,
    role: 'user',
  });

  // New users get welcome message
  if (isNewUser) {
    await supabase.from('conversations').insert({
      user_id: userId,
      message: WELCOME_MESSAGE,
      role: 'assistant',
    });

    await sendWhatsAppMessage(phoneNumber, WELCOME_MESSAGE);
    return WELCOME_MESSAGE;
  }

  // Check for quick commands before calling AI
  const command = parseCommand(messageText);
  if (command) {
    let reply = '';

    switch (command.type) {
      case 'list_tasks': {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('content, due_at')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (!tasks || tasks.length === 0) {
          reply = 'مافيش مهام معلقة. تمام! 🎉';
        } else {
          reply = 'مهامك المعلقة:\n';
          tasks.forEach((t, i) => {
            reply += `${i + 1}. ${t.content}`;
            if (t.due_at) {
              reply += ` (${new Date(t.due_at).toLocaleDateString('ar-EG')})`;
            }
            reply += '\n';
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
          .order('created_at', { ascending: false });

        if (!tasks || tasks.length === 0) {
          reply = 'مافيش مهام عشان تخلصها 🙂';
        } else {
          const idx = (command.taskNumber ?? 1) - 1;
          const task = tasks[idx];
          if (!task) {
            reply = 'رقم المهمة غلط. استخدم "مهامي" عشان تشوف الأرقام';
          } else {
            await supabase.from('tasks').update({ status: 'done' }).eq('id', task.id);
            reply = `تمام! تم تأكيد إنجاز: ${task.content} ✅`;
          }
        }
        break;
      }

      case 'daily_summary': {
        reply = await generateDailySummary(userId);
        break;
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

  // Process via AI
  const aiResponse = await processMessage(messageText);

  let reply = '';

  switch (aiResponse.intent) {
    case 'create_task': {
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert({
          user_id: userId,
          content: aiResponse.content,
          due_at: aiResponse.due_at,
        })
        .select()
        .single();

      if (taskError) {
        reply = 'حصل مشكلة في حفظ المهمة. حاول تاني';
      } else {
        if (task.due_at) {
          await supabase.from('reminders').insert({
            task_id: task.id,
            remind_at: task.due_at,
          });
        }

        reply = `تمام، هفكرك ${task.content}`;
        if (task.due_at) {
          const dateStr = formatDate(task.due_at);
          const timeStr = formatTime(task.due_at);
          reply += ` ${dateStr} ${timeStr}`;
        }
      }
      break;
    }

    case 'list_tasks': {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('content, due_at, status')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (!tasks || tasks.length === 0) {
        reply = 'مافيش مهام معلقة. تمام! 🎉';
      } else {
        reply = 'مهامك المعلقة:\n';
        tasks.forEach((t, i) => {
          reply += `${i + 1}. ${t.content}`;
          if (t.due_at) {
            reply += ` (${new Date(t.due_at).toLocaleDateString('ar-EG')})`;
          }
          reply += '\n';
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
        .ilike('content', `%${aiResponse.content}%`)
        .limit(1);

      if (!tasks || tasks.length === 0) {
        reply = 'ملقتش مهمة زي كده. جرب تصيغ تاني';
      } else {
        await supabase
          .from('tasks')
          .update({ status: 'done' })
          .eq('id', tasks[0].id);

        reply = `تمام! تم تأكيد إنجاز: ${tasks[0].content} ✅`;
      }
      break;
    }

    case 'daily_summary': {
      reply = await generateDailySummary(userId);
      break;
    }

    case 'general_chat': {
      reply = aiResponse.content;
      break;
    }
  }

  // Save bot reply to conversations
  await supabase.from('conversations').insert({
    user_id: userId,
    message: reply,
    role: 'assistant',
  });

  // Send WhatsApp reply
  await sendWhatsAppMessage(phoneNumber, reply);

  return reply;
}
