import { supabase } from '../db';

export async function addBill(
  userId: string,
  name: string,
  amount: number,
  dueDate: string,
  frequency: 'monthly' | 'quarterly' | 'yearly' | 'one_time',
  category?: string
) {
  const { data, error } = await supabase
    .from('bills')
    .insert({
      user_id: userId,
      name,
      amount,
      due_date: dueDate,
      frequency,
      category: category || null,
    })
    .select()
    .single();

  if (error) throw error;

  const remindAt = new Date(dueDate);
  remindAt.setDate(remindAt.getDate() - 2);

  await supabase.from('reminders').insert({
    entity_type: 'bill',
    entity_id: data.id,
    user_id: userId,
    remind_at: remindAt.toISOString(),
    recurring: frequency === 'one_time' ? null : frequency,
  });

  return data;
}

export async function getPendingBills(userId: string) {
  const { data } = await supabase
    .from('bills')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['pending', 'overdue'])
    .order('due_date', { ascending: true });

  return data ?? [];
}

export async function markBillPaid(id: string, userId: string) {
  const bill = await supabase
    .from('bills')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (bill.error) throw bill.error;
  if (!bill.data) throw new Error('Bill not found');

  const { error } = await supabase
    .from('bills')
    .update({ status: 'paid', auto_paid: true })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;

  // Create next bill if recurring
  if (bill.data.frequency !== 'one_time') {
    const nextDate = new Date(bill.data.due_date);
    switch (bill.data.frequency) {
      case 'monthly': nextDate.setMonth(nextDate.getMonth() + 1); break;
      case 'quarterly': nextDate.setMonth(nextDate.getMonth() + 3); break;
      case 'yearly': nextDate.setFullYear(nextDate.getFullYear() + 1); break;
    }

    await addBill(userId, bill.data.name, Number(bill.data.amount), nextDate.toISOString().slice(0, 10), bill.data.frequency, bill.data.category ?? undefined);
  }
}
