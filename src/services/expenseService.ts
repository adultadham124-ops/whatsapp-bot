import { supabase } from '../db';

export async function addTransaction(
  userId: string,
  type: 'income' | 'expense',
  category: string,
  amount: number,
  description?: string,
  date?: string
) {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      type,
      category,
      amount,
      description: description || null,
      date: date || new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getMonthlySummary(userId: string, month?: number, year?: number) {
  const now = new Date();
  const m = month ?? now.getMonth() + 1;
  const y = year ?? now.getFullYear();
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = new Date(y, m, 0).toISOString().slice(0, 10);

  const { data } = await supabase
    .from('transactions')
    .select('type, category, amount')
    .eq('user_id', userId)
    .gte('date', start)
    .lte('date', end);

  if (!data) return { income: 0, expenses: 0, balance: 0, categories: [] };

  const income = data.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expenses = data.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  const catMap = new Map<string, number>();
  data.filter(t => t.type === 'expense').forEach(t => {
    catMap.set(t.category, (catMap.get(t.category) || 0) + Number(t.amount));
  });
  const categories = Array.from(catMap.entries()).map(([cat, amt]) => ({ category: cat, amount: amt }));

  return { income, expenses, balance: income - expenses, categories };
}

export async function setBudget(userId: string, category: string, amount: number, month?: number, year?: number) {
  const now = new Date();
  const m = month ?? now.getMonth() + 1;
  const y = year ?? now.getFullYear();

  const { data, error } = await supabase
    .from('budgets')
    .upsert(
      { user_id: userId, category, amount, month: m, year: y },
      { onConflict: 'user_id,category,month,year' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}
