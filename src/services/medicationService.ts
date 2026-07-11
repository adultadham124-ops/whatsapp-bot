import { supabase } from '../db';

export async function addMedication(
  userId: string,
  name: string,
  dosage: string | null,
  times: string[],
  startDate?: string,
  endDate?: string,
  notes?: string
) {
  const { data, error } = await supabase
    .from('medications')
    .insert({
      user_id: userId,
      name,
      dosage,
      times,
      start_date: startDate || new Date().toISOString().slice(0, 10),
      end_date: endDate || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) throw error;

  for (const time of times) {
    const [h, m] = time.split(':').map(Number);
    const remindAt = new Date();
    remindAt.setHours(h, m, 0, 0);
    if (remindAt <= new Date()) remindAt.setDate(remindAt.getDate() + 1);

    await supabase.from('reminders').insert({
      entity_type: 'medication',
      entity_id: data.id,
      user_id: userId,
      remind_at: remindAt.toISOString(),
      recurring: 'daily',
    });
  }

  return data;
}

export async function getActiveMedications(userId: string) {
  const { data } = await supabase
    .from('medications')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: false });

  return data ?? [];
}

export async function deactivateMedication(id: string, userId: string) {
  const { error } = await supabase
    .from('medications')
    .update({ active: false })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;
}
