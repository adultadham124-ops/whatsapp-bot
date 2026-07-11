import { supabase } from '../db';

export async function logWater(userId: string, amountMl: number, date?: string) {
  const day = date || new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('water_intake')
    .insert({ user_id: userId, amount_ml: amountMl, date: day })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getWaterToday(userId: string, date?: string) {
  const day = date || new Date().toISOString().slice(0, 10);

  const { data: user } = await supabase
    .from('users')
    .select('water_target')
    .eq('id', userId)
    .single();

  const { data } = await supabase
    .from('water_intake')
    .select('amount_ml')
    .eq('user_id', userId)
    .eq('date', day);

  const total = (data ?? []).reduce((s, r) => s + r.amount_ml, 0);
  const target = user?.water_target ?? 2000;

  return { total, target, remaining: Math.max(0, target - total) };
}

export async function logSleep(
  userId: string,
  date: string,
  bedtime: string,
  wakeTime?: string,
  quality?: number,
  notes?: string
) {
  // Delete existing record for same date if any, then insert
  await supabase.from('sleep_log').delete().eq('user_id', userId).eq('date', date);
  const { data, error } = await supabase
    .from('sleep_log')
    .insert({
      user_id: userId,
      date,
      bedtime,
      wake_time: wakeTime || null,
      quality: quality || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getSleepWeek(userId: string) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { data } = await supabase
    .from('sleep_log')
    .select('*')
    .eq('user_id', userId)
    .gte('date', weekAgo.toISOString().slice(0, 10))
    .order('date', { ascending: false });

  return data ?? [];
}
